/* ============================================================
   GRID COMPONENT
   
   Main visualization canvas showing:
   - Vertical grid lines (bars, beats, subdivisions)
   - Horizontal pitch lines
   - Contour lines for each voice
   - User's pitch trace during recording
   - Playhead
   ============================================================ */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Arrangement, LyricConnector } from '../../types';
import { useAppStore, makeNodeKey, type NodeKey } from '../../stores/appStore';
import { degreeToSemitoneOffset, semitoneToLabel, semitoneToSolfege, semitoneToLetterName, midiToFrequency, noteNameToMidi, SCALE_PATTERNS } from '../../utils/music';
import { generateGridLines } from '../../utils/timing';
import { darkenColor } from '../../utils/colors';
import { playbackEngine, type NodeEvent } from '../../services/PlaybackEngine';
import { AudioService } from '../../services/AudioService';
import {
  type LyricUiEntry,
  type LyricHoldSpan,
  parseLyricDraft,
  formatLyricDraft,
  localT16ToNearestWorldT,
  hasAnchorBetween,
  buildLyricHoldSpans,
  getCssVar,
  lightenCssColorTowardWhite,
  isChordDiatonic,
  semitoneToY,
  degreeToY,
} from './gridDataUtils';
import {
  type ContourStackLookup,
  buildContourSegmentStackLookup,
} from './gridContourUtils';
import { drawPitchTrace, drawVoiceContour } from './gridCanvasRenderers';
import {
  getContourHitAtMouseVoiceId,
  getGroupDragDelta,
  getLoopBoundaryScreenPositions,
  getNearestLoopHandle,
  getSnappedLoopTimeFromMouseX,
  isEditableKeyboardTarget,
  isMouseNearLoopHandle,
} from './gridInteractionUtils';
import {
  cameraLeftWorldT,
  worldTToScreenX,
  screenXToWorldT,
  tileLocalToWorldT,
  getGridLOD,
  dragPixelsToTimeDelta,
  resolveToCanonical,
} from '../../utils/followCamera';
import {
  type SmartCamState,
  isStaticState,
  evaluateSmartCamState,
  stepSmartCam,
  snapIfPlayheadOffscreen,
  LOOP_ZOOM_PADDING,
} from '../../utils/smartCam';
import {
  getCameraCenterWorldT,
  setCameraCenterWorldT,
  isFreeLook,
  setFreeLook,
} from '../../utils/cameraState';

/* ------------------------------------------------------------
   Types
   ------------------------------------------------------------ */

interface GridProps {
  arrangement: Arrangement | null;
  className?: string;
  hideChords?: boolean;
  onlyChords?: boolean;
}



/* ------------------------------------------------------------
   Grid Component
   ------------------------------------------------------------ */

// Type for tracking dragged node
interface DragState {
  voiceId: string;
  originalT16: number;
  isDragging: boolean;
  anchorParentT16?: number;
}

// The "anchor" range for the Y-axis (pitch) view.
// We compute this once when an arrangement is loaded, and then keep it stable.
// This prevents Create mode from "jumping" when you add/move notes.
interface PitchRangeAnchor {
  centerSemitone: number;
  paddedRangeSemitones: number;
}

// A snapped, "legal" grid point for Create mode.
// - `t16` is time snapped to the nearest 16th-note.
// - `deg` + `octave` are snapped to the nearest in-scale pitch.
interface SnappedGridPoint {
  t16: number;
  deg: number;
  octave: number;
  semi?: number;
}

// If these differ, the "ghost" preview and click zones will feel offset.
const GRID_MARGIN = { top: 40, right: 20, bottom: 40, left: 50 };

export function Grid({
  arrangement: arrangementProp,
  className = '',
  hideChords = false,
  onlyChords = false
}: GridProps) {

  // Canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Offscreen layers used for contour-only node shadows:
  // - shadowMaskCanvasRef holds only contour pixels (white alpha mask)
  // - shadowCompositeCanvasRef holds radial node shadows before masking
  const shadowMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const shadowCompositeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Playback flash state: keyed by voiceId + worldT16.
  // Value is performance.now() timestamp (ms) when the flash was triggered.
  const nodeFlashStartMsRef = useRef<Map<string, number>>(new Map());

  // Fallback flash trigger uses the world (monotonic) playhead position.
  // We store the previous world time so we can detect when the playhead crosses
  // a node event time even if the engine-scheduled callback is not arriving.
  const lastFlashTriggerWorldT16Ref = useRef<number | null>(null);

  // Hook the playback engine so we get callbacks scheduled at the same audio time
  // as synth attacks/glides. This keeps the visual flash aligned to the sound.
  useEffect(() => {
    const onNodeEvent = (ev: NodeEvent) => {
      // DAW-style grid:
      // We no longer draw tiled copies of the arrangement, so we key flashes by
      // the local (arrangement) time `t16`. Each time the loop wraps, the same
      // node will re-trigger and overwrite the same key, producing a new flash.
      const key = `${ev.voiceId}:${ev.t16}`;
      nodeFlashStartMsRef.current.set(key, window.performance.now());
    };

    const onLoop = () => {
      const state = useAppStore.getState();
      const arr = state.arrangement;
      if (!arr) return;

      const loopStartT16 = state.playback.loopStart;
      const nowMs = window.performance.now();

      for (const voice of arr.voices) {
        for (const node of voice.nodes) {
          if (node.term) continue;
          if (node.t16 !== loopStartT16) continue;
          const key = `${voice.id}:${node.t16}`;
          nodeFlashStartMsRef.current.set(key, nowMs);
        }
      }
    };

    playbackEngine.setConfig({ onNodeEvent, onLoop });
  }, []);

  // Cached canvas sizing / layout metrics.
  // IMPORTANT:
  // - Resizing a canvas (setting canvas.width / canvas.height) allocates a new
  //   backing bitmap. Doing that every animation frame can trigger periodic
  //   garbage collection pauses, which feels like "random" stutters.
  // - Reading layout (getBoundingClientRect) every frame can also add pressure.
  //
  // We keep these metrics in a ref and update them only when the container size
  // or devicePixelRatio changes.
  const canvasMetricsRef = useRef<{
    dpr: number;
    cssWidth: number;
    cssHeight: number;
    gridLeft: number;
    gridTop: number;
    gridWidth: number;
    gridHeight: number;
  } | null>(null);

  const updateCanvasMetrics = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const cssWidth = rect.width;
    const cssHeight = rect.height;
    if (cssWidth <= 0 || cssHeight <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const deviceWidth = Math.round(cssWidth * dpr);
    const deviceHeight = Math.round(cssHeight * dpr);

    // Only resize the canvas when the actual pixel size changes.
    // This avoids per-frame bitmap reallocations.
    if (canvas.width !== deviceWidth) canvas.width = deviceWidth;
    if (canvas.height !== deviceHeight) canvas.height = deviceHeight;

    // Keep CSS size in sync (layout size, not backing bitmap).
    const cssWidthPx = `${cssWidth}px`;
    const cssHeightPx = `${cssHeight}px`;
    if (canvas.style.width !== cssWidthPx) canvas.style.width = cssWidthPx;
    if (canvas.style.height !== cssHeightPx) canvas.style.height = cssHeightPx;

    canvasMetricsRef.current = {
      dpr,
      cssWidth,
      cssHeight,
      gridLeft: GRID_MARGIN.left,
      gridTop: GRID_MARGIN.top,
      gridWidth: cssWidth - GRID_MARGIN.left - GRID_MARGIN.right,
      gridHeight: cssHeight - GRID_MARGIN.top - GRID_MARGIN.bottom,
    };
  }, []);

  // Drag state for node editing
  const [dragState, setDragState] = useState<DragState | null>(null);

  // Hover preview state (stored in a ref so it can update frequently without re-rendering).
  // The draw loop runs continuously, so it can just read the latest ref value.
  const hoverPreviewRef = useRef<{ voiceId: string; point: SnappedGridPoint } | null>(null);

  // When you press the mouse down in Create mode, we treat it as an "audition" gesture.
  // While held, moving the mouse glides the synth pitch; releasing stops the note.
  const auditionRef = useRef<{ voiceId: string } | null>(null);

  // When placing a NEW node (not dragging an existing one), we commit it on mouse-up.
  const placingNewNodeRef = useRef<{ voiceId: string; point: SnappedGridPoint } | null>(null);

  // React will still fire an `onClick` after a `mousedown`/`mouseup`.
  // We use this flag to avoid double-adding nodes (because Create mode now commits on mouse-up).
  const skipNextClickRef = useRef(false);

  // Stable pitch-range anchor for the current arrangement.
  // This is what makes zoom behavior stable (only changes when you change zoom manually
  // or load a different arrangement).
  const [pitchRangeAnchor, setPitchRangeAnchor] = useState<PitchRangeAnchor | null>(null);
  // True when the mouse is over any existing node (regular or anchor) in Create mode.
  // Used to switch the cursor from crosshair to grab.
  const [isHoveringNode, setIsHoveringNode] = useState(false);

  // True when the mouse is over a node that is already selected.
  // In Shift mode we only show the grab hint for selected nodes.
  const [isHoveringSelectedNode, setIsHoveringSelectedNode] = useState(false);

  // Tracks whether Shift is currently held so cursor styling can respond even
  // before the next mousemove event.
  const [isShiftHeld, setIsShiftHeld] = useState(false);

  // True when the mouse is near a loop boundary handle (start/end) while loop is enabled.
  // Used to switch the cursor to a resize/grab style only when it makes sense.
  const [isHoveringLoopHandle, setIsHoveringLoopHandle] = useState(false);
  const isHoveringLoopHandleRef = useRef(false);

  // True when the smart cam is in a "static" state (camera not following playhead).
  // Used to show the "Jump to Playhead" button in the UI.
  const [smartCamIsStatic, setSmartCamIsStatic] = useState(false);
  // Ref mirror so the RAF loop can check the value without causing re-renders.
  const smartCamIsStaticRef = useRef(false);

  // Get arrangement from store to ensure we always have latest (for create mode updates)
  const arrangementFromStore = useAppStore((state) => state.arrangement);
  const arrangement = arrangementFromStore || arrangementProp;

  // Subscribe only to the playback flags this component actually uses.
  // Subscribing to the entire playback object would re-render the Grid on every
  // position tick (which can be ~60fps), even though the canvas draw loop already
  // runs every animation frame.
  const isPlaying = useAppStore((state) => state.playback.isPlaying);
  const isRecording = useAppStore((state) => state.playback.isRecording);
  const loopEnabled = useAppStore((state) => state.playback.loopEnabled);
  const loopStart = useAppStore((state) => state.playback.loopStart);
  const loopEnd = useAppStore((state) => state.playback.loopEnd);
  const setPosition = useAppStore((state) => state.setPosition);
  const setLoopPoints = useAppStore((state) => state.setLoopPoints);

  // Throttle UI position updates during normal playback.
  // See App.tsx for the same reasoning: 60fps store writes force React work.
  // While recording, we keep full-rate updates so auto-stop logic stays precise.
  const lastUiPositionUpdateMsRef = useRef<number>(0);
  const onEnginePositionUpdate = useCallback((t16: number) => {
    const storeState = useAppStore.getState();
    const currentlyRecording = storeState.playback.isRecording;

    if (currentlyRecording) {
      setPosition(t16);
      return;
    }

    const nowMs = performance.now();
    const UI_POSITION_THROTTLE_MS = 33; // ~30fps
    if (nowMs - lastUiPositionUpdateMsRef.current < UI_POSITION_THROTTLE_MS) return;

    lastUiPositionUpdateMsRef.current = nowMs;
    setPosition(t16);
  }, [setPosition]);

  // If audio isn't initialized yet, we queue the first preview attack until it is.
  // This prevents the first click/drag in Create mode from being silent.
  const pendingAuditionAttackRef = useRef<{ voiceId: string; deg: number; octave: number; semi?: number } | null>(null);

  // Prevent double-initializing audio/engine if the user clicks rapidly.
  const audioInitPromiseRef = useRef<Promise<void> | null>(null);

  const ensureAudioAndEngineReadyForPreview = useCallback((): Promise<void> => {
    if (AudioService.isReady()) return Promise.resolve();
    if (audioInitPromiseRef.current) return audioInitPromiseRef.current;

    audioInitPromiseRef.current = (async () => {
      await AudioService.initialize();
      if (arrangement) {
        playbackEngine.initialize(arrangement, {
          onPositionUpdate: onEnginePositionUpdate,
        });

        // IMPORTANT:
        // `initialize()` resets the engine to arrangement defaults.
        // We must re-apply any current playback settings from the app store,
        // otherwise the engine's internal tempo/speed can drift from what the UI
        // thinks it is, which shows up as playhead/camera jitter.
        const state = useAppStore.getState();
        playbackEngine.setTempoMultiplier(state.playback.tempoMultiplier);
        playbackEngine.setLoopEnabled(state.playback.loopEnabled);
        playbackEngine.setTransposition(state.transposition);
      }
    })().finally(() => {
      audioInitPromiseRef.current = null;
    });

    return audioInitPromiseRef.current;
  }, [arrangement, onEnginePositionUpdate]);
  const voiceStates = useAppStore((state) => state.voiceStates);
  const livePitchTrace = useAppStore((state) => state.livePitchTrace);
  const livePitchTraceVoiceId = useAppStore((state) => state.livePitchTraceVoiceId);
  const display = useAppStore((state) => state.display);
  const recordings = useAppStore((state) => state.recordings);
  const armedVoiceId = useAppStore((state) => state.armedVoiceId);
  const mode = useAppStore((state) => state.mode);
  const selectedVoiceId = useAppStore((state) => state.selectedVoiceId);
  const addNode = useAppStore((state) => state.addNode);
  const removeNode = useAppStore((state) => state.removeNode);
  const setSelectedVoiceId = useAppStore((state) => state.setSelectedVoiceId);
  const updateNode = useAppStore((state) => state.updateNode);
  const transposition = useAppStore((state) => state.transposition);
  const theme = useAppStore((state) => state.theme);

  // Focus actions — triggered by clicking contour lines or pressing Escape
  const toggleFocus = useAppStore((state) => state.toggleFocus);
  const focusOnlyVoice = useAppStore((state) => state.focusOnlyVoice);
  const clearAllFocus = useAppStore((state) => state.clearAllFocus);
  const cleanupFocusForExistingContours = useAppStore((state) => state.cleanupFocusForExistingContours);
  const pushHistoryCheckpoint = useAppStore((state) => state.pushHistoryCheckpoint);

  // Which voice's contour line the mouse is currently hovering over (null = none).
  // Stored in a ref because it updates on every mouse move and the draw loop reads it
  // every frame — no need for React re-renders.
  const hoveredContourVoiceIdRef = useRef<string | null>(null);

  // Follow-mode timeline state and actions
  const followMode = useAppStore((state) => state.followMode);
  const startTimelineDrag = useAppStore((state) => state.startTimelineDrag);
  const updatePendingWorldT = useAppStore((state) => state.updatePendingWorldT);
  const commitTimelineDrag = useAppStore((state) => state.commitTimelineDrag);
  // Create-mode actions
  const adjustPlayPitchPanSemitones = useAppStore((state) => state.adjustPlayPitchPanSemitones);
  const setCameraMode = useAppStore((state) => state.setCameraMode);
  const resetCreateView = useAppStore((state) => state.resetCreateView);

  // ── Node selection actions (Create mode) ──
  const selectedNodeKeys = useAppStore((state) => state.createView.selectedNodeKeys);
  const selectNode = useAppStore((state) => state.selectNode);
  const toggleNodeInSelection = useAppStore((state) => state.toggleNodeInSelection);
  const clearNodeSelection = useAppStore((state) => state.clearNodeSelection);
  const setNodeSelection = useAppStore((state) => state.setNodeSelection);
  const addNodesToSelection = useAppStore((state) => state.addNodesToSelection);
  const deleteSelectedNodes = useAppStore((state) => state.deleteSelectedNodes);
  const copySelectedNodes = useAppStore((state) => state.copySelectedNodes);
  const cutSelectedNodes = useAppStore((state) => state.cutSelectedNodes);
  const pasteNodes = useAppStore((state) => state.pasteNodes);
  const duplicateSelectedNodes = useAppStore((state) => state.duplicateSelectedNodes);
  const moveSelectedNodes = useAppStore((state) => state.moveSelectedNodes);

  // Lookup used to vertically stack contour segments that are exactly overlapping.
  // Recomputed when arrangement content/order OR horizontal zoom changes.
  const contourStackLookup = useMemo<ContourStackLookup>(() => {
    if (!arrangement) return new Map();
    return buildContourSegmentStackLookup(arrangement, followMode.pxPerT);
  }, [arrangement, followMode.pxPerT]);

  // ── Marquee selection state (Create mode, Ctrl+left-drag on empty space) ──
  // Stored in refs so the RAF draw loop can render the rect without re-renders.
  const marqueeRef = useRef<{
    startX: number;       // CSS px relative to container
    startY: number;
    currentX: number;
    currentY: number;
    additive: boolean;    // true = Ctrl+Shift (union), false = Ctrl (replace)
  } | null>(null);

  // ── Group drag state (Create mode, drag selected node) ──
  // Tracks the cumulative time+pitch delta applied during a group drag.
  const groupDragRef = useRef<{
    startMouseX: number;    // Initial mouse clientX
    startMouseY: number;    // Initial mouse clientY
    lastDeltaT16: number;   // Accumulated time delta applied so far
    lastDeltaSemi: number;  // Accumulated pitch delta applied so far
  } | null>(null);

  // ── Smart Cam state ──
  // The smart-cam state ref is updated every animation frame.
  // Camera center position lives in the cameraState module (single source of truth).
  // null means "no previous state" — forces a fresh evaluation with no
  // follow/static persistence.  Set to null by external triggers like loop toggle.
  const smartCamStateRef = useRef<SmartCamState | null>('FOLLOW_CENTER');

  // Ref to track drag start position for seek gestures (Alt+left-drag, seek-on-release)
  const seekDragRef = useRef<{ startX: number; startWorldT: number } | null>(null);

  // Ref to track right-click horizontal pan drag.
  // Used in BOTH Create and Play modes — right-drag always pans the camera horizontally.
  // Vertical pitch panning is handled by scroll wheel instead.
  const panDragRef = useRef<{
    startX: number;
    startCameraWorldT: number;
  } | null>(null);

  // True once we have pushed a single pre-drag history checkpoint for the
  // current drag gesture. This prevents undo spam from per-frame drag updates.
  const hasPushedDragHistoryRef = useRef(false);

  // React state mirror for freeLook so the Jump-to-Playhead button re-renders.
  // The authoritative value is in cameraState module (isFreeLook()), but React
  // needs a state variable to know when to show/hide the button.
  const [freeLookReact, setFreeLookReact] = useState(false);

  // The Recenter button should not be affected by the grid's fade masks.
  // App.tsx provides a sibling overlay root outside the masked layers.
  const [gridOverlayRoot, setGridOverlayRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    setGridOverlayRoot(document.getElementById('grid-overlay-root'));
  }, []);

  // Ref to track loop handle dragging ('start' or 'end' boundary, or null if not dragging)
  const loopHandleDragRef = useRef<'start' | 'end' | null>(null);

  /**
   * Set the SHARED camera center for both Play and Create modes.
   *
   * We intentionally keep one camera state so camera changes affect the app
   * universally (no dual camera systems to keep in sync).
   */
  const setSharedCameraAndMaybeSeek = useCallback((nextWorldT: number) => {
    setCameraCenterWorldT(nextWorldT);

    // While paused, keep transport aligned with what the user is looking at.
    if (!isPlaying) {
      playbackEngine.seekWorld(nextWorldT);
    }
  }, [isPlaying]);

  // NOTE:
  // We intentionally do NOT auto-snap camera on pause in either mode.
  // If the user panned away (FREE_LOOK), pause should preserve that view.
  // Re-centering back to playhead is handled on explicit actions:
  // - Play start in smart/follow modes
  // - Restart action (camera follow reset trigger)

  // If the mouse is released outside the canvas, stop any active pan drag.
  // Without this, the grid can get "stuck" in panning mode.
  // This covers BOTH Create and Play mode since right-drag pan is now universal.
  useEffect(() => {
    const stopPanDrag = () => {
      if (panDragRef.current) {
        panDragRef.current = null;
      }
    };

    window.addEventListener('mouseup', stopPanDrag);
    window.addEventListener('blur', stopPanDrag);

    return () => {
      window.removeEventListener('mouseup', stopPanDrag);
      window.removeEventListener('blur', stopPanDrag);
    };
  }, []);

  // Keep an explicit Shift-key state for cursor styling in Create mode.
  useEffect(() => {
    const handleKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === 'Shift') setIsShiftHeld(true);
    };

    const handleKeyUp = (evt: KeyboardEvent) => {
      if (evt.key === 'Shift') setIsShiftHeld(false);
    };

    const handleBlur = () => {
      setIsShiftHeld(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // When playback STARTS in Play or Create mode, decide camera behavior based on
  // the camera mode:
  //
  //   Follow mode  → always snap camera to playhead.
  //   Static mode  → do nothing (camera stays where it is).
  //   Smart mode   → clear free-look, snap to playhead, resume follow.
  //                  Exception: if looping is active (STATIC_LOOP), stay static.
  //
  // When playback STOPS, keep the camera where it is (don't snap).
  useEffect(() => {
    if (mode !== 'play' && mode !== 'create') return;
    if (!isPlaying) return; // stop pressed — camera stays put

    const cameraMode = useAppStore.getState().followMode.cameraMode;

    if (cameraMode === 'follow') {
      // Follow mode: always snap camera to playhead.
      const worldT = playbackEngine.getWorldPositionT16();
      setCameraCenterWorldT(worldT);
      setFreeLook(false);
      setFreeLookReact(false);
      smartCamStateRef.current = 'FOLLOW_CENTER';
      smartCamIsStaticRef.current = false;
      setSmartCamIsStatic(false);
      return;
    }

    if (cameraMode === 'static') {
      // Static mode: camera stays where it is, nothing to do.
      return;
    }

    // ── Smart mode ──
    const isLoopActive = useAppStore.getState().playback.loopEnabled;
    // If loop is active, stay in STATIC_LOOP (already zoomed to fit).
    if (isLoopActive) {
      return;
    }

    // If this play-start came from a user panned FREE_LOOK state,
    // promote back to explicit FOLLOW mode.
    if (isFreeLook()) {
      setCameraMode('follow');
    }

    // Otherwise: clear free-look and snap to playhead for strict follow.
    const worldT = playbackEngine.getWorldPositionT16();
    setCameraCenterWorldT(worldT);
    setFreeLook(false);
    setFreeLookReact(false);
    smartCamStateRef.current = 'FOLLOW_CENTER';
    smartCamIsStaticRef.current = false;
    setSmartCamIsStatic(false);
  }, [mode, isPlaying]);

  // When the loop is toggled ON in Smart mode, auto-zoom the
  // viewport to fit the entire loop with padding, and center the camera on it.
  //
  // This keeps loop framing behavior consistent between Play and Create modes.
  //
  // When toggled OFF, clear free-look and snap back to follow behaviour.
  useEffect(() => {
    if (mode !== 'play' && mode !== 'create') return;
    const cameraMode = useAppStore.getState().followMode.cameraMode;

    if (loopEnabled && cameraMode === 'smart') {
      // Auto-zoom to fit the loop in the viewport.
      const curPb = useAppStore.getState().playback;
      // Seek the playhead to the loop start.
      // - If we were playing already, playback continues from the loop start.
      // - If we were paused, we remain paused but the playhead moves.
      playbackEngine.seekWorld(curPb.loopStart);
      setPosition(curPb.loopStart);
      // Keep visual playhead in sync immediately (prevents a one-frame mismatch).
      visualWorldTRef.current = curPb.loopStart;

      const loopDuration = curPb.loopEnd - curPb.loopStart;
      if (loopDuration > 0) {
        const rect = containerRef.current?.getBoundingClientRect();
        const gridW = rect
          ? rect.width - GRID_MARGIN.left - GRID_MARGIN.right
          : useAppStore.getState().followMode.viewportWidthPx;

        if (gridW > 0) {
          // Calculate pxPerT so the loop fills the viewport with padding.
          const paddedDuration = loopDuration * (1 + 2 * LOOP_ZOOM_PADDING);
          const targetPxPerT = gridW / paddedDuration;
          setPxPerT(targetPxPerT);

          // Center camera on the loop.
          const loopCenter = (curPb.loopStart + curPb.loopEnd) / 2;
          setCameraCenterWorldT(loopCenter);
        }
      }
      // Clear free-look so evaluator returns STATIC_LOOP.
      setFreeLook(false);
      setFreeLookReact(false);
      smartCamStateRef.current = 'STATIC_LOOP';
      smartCamIsStaticRef.current = true;
      setSmartCamIsStatic(true);
    } else {
      // Loop disabled (or not in smart mode): clear free-look and let the
      // evaluator return to FOLLOW_CENTER on the next frame.
      setFreeLook(false);
      setFreeLookReact(false);
      // Snap camera back to playhead so follow is immediate.
      if (cameraMode === 'smart') {
        const worldT = playbackEngine.getWorldPositionT16();
        setCameraCenterWorldT(worldT);
        smartCamStateRef.current = 'FOLLOW_CENTER';
        smartCamIsStaticRef.current = false;
        setSmartCamIsStatic(false);
      }
    }
  }, [mode, loopEnabled]);

  // When the user toggles the camera mode via the transport bar, apply
  // side effects so the mode change takes effect visually:
  //   Follow → clear free-look, snap camera to playhead.
  //   Smart  → clear free-look so the evaluator runs a fresh check.
  //   Static → no special action (evaluator returns FREE_LOOK automatically).
  useEffect(() => {
    if (mode !== 'play' && mode !== 'create') return;
    const cameraMode = followMode.cameraMode;

    if (cameraMode === 'follow') {
      // Snap camera to playhead immediately.
      const worldT = playbackEngine.getWorldPositionT16();
      setCameraCenterWorldT(worldT);
      setFreeLook(false);
      setFreeLookReact(false);
      smartCamStateRef.current = 'FOLLOW_CENTER';
      smartCamIsStaticRef.current = false;
      setSmartCamIsStatic(false);
    }
    // Smart mode keeps the current free-look flag (if any).
    // Static mode: evaluator will return FREE_LOOK on the next frame.
  }, [mode, followMode.cameraMode]);

  // When the restart button is pressed, reset camera to FOLLOW mode.
  // The restart button increments cameraFollowResetCount in the store;
  // this effect watches it and snaps the camera to the playhead (now at 0).
  useEffect(() => {
    if (mode !== 'play' && mode !== 'create') return;
    // Skip the initial mount (count = 0).
    if (followMode.cameraFollowResetCount === 0) return;

    const worldT = playbackEngine.getWorldPositionT16();
    setCameraCenterWorldT(worldT);
    setFreeLook(false);
    setFreeLookReact(false);
    setCameraMode('follow');
    smartCamStateRef.current = 'FOLLOW_CENTER';
    smartCamIsStaticRef.current = false;
    setSmartCamIsStatic(false);
  }, [mode, followMode.cameraFollowResetCount, setCameraMode]);

  // While scrubbing in Play mode (right-click drag), prevent the browser context menu.
  // If the mouse-up happens outside the canvas, the browser may try to open the menu anyway.
  useEffect(() => {
    if (mode !== 'play') return;
    if (!followMode.isDraggingTimeline) return;

    const preventContextMenu = (evt: MouseEvent) => {
      evt.preventDefault();
    };

    window.addEventListener('contextmenu', preventContextMenu, true);
    return () => window.removeEventListener('contextmenu', preventContextMenu, true);
  }, [mode, followMode.isDraggingTimeline]);

  // Chord-track editor actions (Create mode)
  const enableChordTrack = useAppStore((state) => state.enableChordTrack);
  const setChordName = useAppStore((state) => state.setChordName);
  const splitChordAt = useAppStore((state) => state.splitChordAt);
  const resizeChordBoundary = useAppStore((state) => state.resizeChordBoundary);
  const deleteChord = useAppStore((state) => state.deleteChord);

  // Lyrics-track editor actions (Create mode)
  const enableLyricsTrack = useAppStore((state) => state.enableLyricsTrack);
  const disableLyricsTrack = useAppStore((state) => state.disableLyricsTrack);
  const setLyricEntry = useAppStore((state) => state.setLyricEntry);

  // Which chord label is currently being edited (inline rename).
  const [editingChordIndex, setEditingChordIndex] = useState<number | null>(null);
  const [editingChordName, setEditingChordName] = useState<string>('');

  // Hover-based split marker (Create mode chord editing)
  const [hoverSplitT16, setHoverSplitT16] = useState<number | null>(null);
  const [hoverSplitScreenX, setHoverSplitScreenX] = useState<number | null>(null);

  // DOM ref for the chord lane overlay (used for boundary-drag hit testing).
  const chordLaneRef = useRef<HTMLDivElement | null>(null);

  // DOM ref for the lyrics lane overlay (used for node-aligned lyric editing).
  const lyricLaneRef = useRef<HTMLDivElement | null>(null);
  const lyricLaneCameraTrackRef = useRef<HTMLDivElement | null>(null);

  // Temporary drag state for resizing a boundary between two chord blocks.
  const chordBoundaryDragRef = useRef<{ leftChordIndex: number } | null>(null);

  // Which lyric token is currently being edited (by Voice 1 node time).
  const [editingLyricT16, setEditingLyricT16] = useState<number | null>(null);
  const [editingLyricText, setEditingLyricText] = useState<string>('');
  const editingLyricT16Ref = useRef<number | null>(null);

  // Voice 1 melody nodes are the only legal lyric-attachment targets.
  const voice1MelodyNodes = useMemo(() => {
    if (!arrangement?.voices[0]) return [] as Array<{ t16: number }>;
    return arrangement.voices[0].nodes
      .filter((node) => !node.term)
      .sort((a, b) => a.t16 - b.t16)
      .map((node) => ({ t16: node.t16 }));
  }, [arrangement]);

  const voice1LyricNodeTimes = useMemo(() => {
    return new Set<number>(voice1MelodyNodes.map((node) => node.t16));
  }, [voice1MelodyNodes]);

  const voice1AnchorTimes = useMemo(() => {
    const voice1 = arrangement?.voices[0];
    if (!voice1) return [] as number[];

    const anchorTimes = voice1.nodes
      .filter((node) => node.term)
      .map((node) => Math.round(node.t16))
      .sort((a, b) => a - b);

    return [...new Set(anchorTimes)];
  }, [arrangement]);

  // Fast lookup of "this node has a next melody node".
  const voice1NextNodeT16ByT16 = useMemo(() => {
    const byTime = new Map<number, number>();
    for (let i = 0; i < voice1MelodyNodes.length - 1; i++) {
      byTime.set(voice1MelodyNodes[i].t16, voice1MelodyNodes[i + 1].t16);
    }
    return byTime;
  }, [voice1MelodyNodes]);

  // Fast lookup for rendered lyric payload per Voice 1 node.
  const lyricEntryByT16 = useMemo(() => {
    const byTime = new Map<number, LyricUiEntry>();
    if (!arrangement?.lyrics?.entries) return byTime;

    for (const entry of arrangement.lyrics.entries) {
      const snappedT16 = Math.round(entry.t16);
      if (!voice1LyricNodeTimes.has(snappedT16)) continue;

      const normalized = parseLyricDraft(entry.text, entry.connectorToNext);

      // Connector is only valid when this node has a following melody node.
      const allowConnector = voice1NextNodeT16ByT16.has(snappedT16);
      const payload: LyricUiEntry = {
        text: normalized.text,
        ...(allowConnector && normalized.connectorToNext
          ? { connectorToNext: normalized.connectorToNext }
          : {}),
      };

      if (!payload.text && !payload.connectorToNext) continue;
      byTime.set(snappedT16, payload);
    }

    return byTime;
  }, [arrangement?.lyrics?.entries, voice1LyricNodeTimes, voice1NextNodeT16ByT16]);

  const lyricHoldSpans = useMemo(() => {
    if (!arrangement) return [] as LyricHoldSpan[];
    const loopLengthT = arrangement.bars * arrangement.timeSig.numerator * 4;
    return buildLyricHoldSpans(
      voice1MelodyNodes.map((node) => node.t16),
      voice1AnchorTimes,
      lyricEntryByT16,
      loopLengthT
    );
  }, [arrangement, voice1MelodyNodes, voice1AnchorTimes, lyricEntryByT16]);

  // Nodes covered by a hold span are hidden to keep one continuous held word.
  const hiddenLyricNodeTimes = useMemo(() => {
    const hidden = new Set<number>();
    for (const node of voice1MelodyNodes) {
      for (const span of lyricHoldSpans) {
        if (node.t16 > span.startT16 && node.t16 < span.endT16) {
          hidden.add(node.t16);
          break;
        }
      }
    }
    return hidden;
  }, [voice1MelodyNodes, lyricHoldSpans]);

  // ── Memoized vertical grid lines ──
  // Only recompute when the arrangement's bar count or time signature changes.
  // Previously this was called inside draw() on every frame (~60fps), allocating a new array each time.
  const memoizedGridLines = useMemo(() => {
    if (!arrangement) return [];
    return generateGridLines(arrangement.bars, arrangement.timeSig);
  }, [arrangement?.bars, arrangement?.timeSig.numerator, arrangement?.timeSig.denominator]);

  // ── Cached CSS colors ──
  // Reading CSS variables via getComputedStyle is expensive when done every frame.
  // We cache all the colors here and only re-read when the theme or display settings change.
  const cssColors = useMemo(() => {
    return {
      barLine: getCssVar('--grid-line-bar') || 'rgba(255, 255, 255, 0.15)',
      beatLine: getCssVar('--grid-line-beat') || 'rgba(255, 255, 255, 0.08)',
      subdivLine: getCssVar('--grid-line-subdivision') || 'rgba(255, 255, 255, 0.04)',
      pitchLineTonic: getCssVar('--grid-pitch-line-tonic') || 'rgba(255, 255, 255, 0.35)',
      pitchLine: getCssVar('--grid-pitch-line') || 'rgba(255, 255, 255, 0.05)',
      playhead: getCssVar('--playhead-color') || '#ffffff',
      text: getCssVar('--text-secondary') || '#a8a3b8',
      chordFillTop: getCssVar('--chord-fill-top') || '#5a4c80',
      chordFillBottom: getCssVar('--chord-fill-bottom') || '#342656',
      chordFillTensionTop: getCssVar('--chord-fill-tension-top') || '#8a2e47',
      chordFillTensionBot: getCssVar('--chord-fill-tension-bottom') || '#4a1a28',
      chordStroke: getCssVar('--chord-stroke') || 'rgba(255, 255, 255, 0.35)',
      chordStrokeTension: getCssVar('--chord-stroke-tension') || 'rgba(255, 148, 180, 0.7)',
      chordText: getCssVar('--chord-text') || '#fefaff',
      chordTextTension: getCssVar('--chord-text-tension') || '#ffe6ef',
      // Pre-cache voice fallback colors (--voice-1 through --voice-8).
      // These are used when a voice object doesn't have its own `color` property.
      // Previously getCssVar was called inside draw() every frame (~60fps),
      // which triggers getComputedStyle → forced style recalculation → jank.
      voiceFallback: Array.from({ length: 8 }, (_, i) =>
        getCssVar(`--voice-${i + 1}`) || '#ff6b9d'
      ),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, display]);

  // If the arrangement changes (or chord list is replaced), cancel any inline rename.
  useEffect(() => {
    setEditingChordIndex(null);
    setEditingChordName('');
    setHoverSplitT16(null);
    setHoverSplitScreenX(null);
    editingLyricT16Ref.current = null;
    setEditingLyricT16(null);
    setEditingLyricText('');
  }, [arrangement?.id]);

  // Keep a live ref of the currently edited lyric node so blur handlers
  // can ignore stale commits after auto-advance / focus handoff.
  useEffect(() => {
    editingLyricT16Ref.current = editingLyricT16;
  }, [editingLyricT16]);

  // If lyrics are disabled externally, always close the inline lyric editor.
  useEffect(() => {
    if (!arrangement?.lyrics?.enabled) {
      editingLyricT16Ref.current = null;
      setEditingLyricT16(null);
      setEditingLyricText('');
    }
  }, [arrangement?.lyrics?.enabled]);

  // If the lyrics lane is hidden in Display Settings, close the editor.
  useEffect(() => {
    if (!display.showLyricsTrack) {
      editingLyricT16Ref.current = null;
      setEditingLyricT16(null);
      setEditingLyricText('');
    }
  }, [display.showLyricsTrack]);

  // If the currently edited lyric node no longer exists, close the editor.
  useEffect(() => {
    if (editingLyricT16 === null) return;
    if (voice1LyricNodeTimes.has(editingLyricT16)) return;
    editingLyricT16Ref.current = null;
    setEditingLyricT16(null);
    setEditingLyricText('');
  }, [editingLyricT16, voice1LyricNodeTimes]);

  // If a node becomes covered by a hold span, hide it and close inline editing.
  useEffect(() => {
    if (editingLyricT16 === null) return;
    if (!hiddenLyricNodeTimes.has(editingLyricT16)) return;
    editingLyricT16Ref.current = null;
    setEditingLyricT16(null);
    setEditingLyricText('');
  }, [editingLyricT16, hiddenLyricNodeTimes]);

  // Keep the DOM-based Create-mode lyric lane continuously synced to the camera.
  // We update this with RAF because camera position lives in a mutable module ref,
  // not in React state, so normal React rerenders are not guaranteed each frame.
  useEffect(() => {
    if (mode !== 'create') return;
    if (!display.showLyricsTrack) return;
    if (!arrangement?.lyrics?.enabled) return;

    let rafId = 0;

    const updateTrackTransform = () => {
      const laneEl = lyricLaneRef.current;
      const trackEl = lyricLaneCameraTrackRef.current;
      const pxPerTVal = followMode.pxPerT;

      if (laneEl && trackEl && pxPerTVal > 0) {
        const measuredLaneWidth = laneEl.getBoundingClientRect().width;
        const viewportWidth = followMode.viewportWidthPx > 0 ? followMode.viewportWidthPx : measuredLaneWidth;

        if (viewportWidth > 0) {
          const currentWorldT = followMode.pendingWorldT !== null
            ? followMode.pendingWorldT
            : getCameraCenterWorldT();
          const camLeft = cameraLeftWorldT(currentWorldT, viewportWidth, pxPerTVal);

          // Match the exact camera snapping logic used by canvas rendering so
          // chip centers stay perfectly aligned with node centers.
          const dpr = window.devicePixelRatio || 1;
          const camLeftSnapped = display.snapCameraToPixels
            ? (Math.round(camLeft * pxPerTVal * dpr) / dpr) / pxPerTVal
            : camLeft;
          const translateX = worldTToScreenX(0, camLeftSnapped, pxPerTVal);

          trackEl.style.transform = `translateX(${translateX}px)`;
        }
      }

      rafId = window.requestAnimationFrame(updateTrackTransform);
    };

    rafId = window.requestAnimationFrame(updateTrackTransform);
    return () => window.cancelAnimationFrame(rafId);
  }, [
    mode,
    display.showLyricsTrack,
    arrangement?.lyrics?.enabled,
    display.snapCameraToPixels,
    followMode.viewportWidthPx,
    followMode.pxPerT,
    followMode.pendingWorldT,
  ]);

  /**
   * Return the previous/next Voice 1 melody-node time from a given node time.
   */
  const getAdjacentVoice1NodeT16 = useCallback((fromT16: number, direction: -1 | 1): number | null => {
    const idx = voice1MelodyNodes.findIndex((node) => node.t16 === fromT16);
    if (idx < 0) return null;
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= voice1MelodyNodes.length) return null;
    return voice1MelodyNodes[nextIdx].t16;
  }, [voice1MelodyNodes]);

  /**
   * Start editing one lyric token attached to a specific Voice 1 node.
   */
  const startLyricEditAt = useCallback((t16: number) => {
    editingLyricT16Ref.current = t16;
    setEditingLyricT16(t16);
    setEditingLyricText(formatLyricDraft(lyricEntryByT16.get(t16)));
  }, [lyricEntryByT16]);

  /**
   * Save the current lyric edit and optionally continue to another node.
   */
  const commitLyricEdit = useCallback((
    nextNodeT16: number | null = null,
    connectorOverride?: LyricConnector | null
  ) => {
    if (editingLyricT16 === null) return;

    const parsedDraft = parseLyricDraft(editingLyricText);
    const connectorToNext = connectorOverride !== undefined
      ? (connectorOverride ?? undefined)
      : parsedDraft.connectorToNext;

    setLyricEntry(editingLyricT16, parsedDraft.text, {
      connectorToNext: connectorToNext ?? null,
    });

    if (nextNodeT16 !== null) {
      editingLyricT16Ref.current = nextNodeT16;
      setEditingLyricT16(nextNodeT16);
      setEditingLyricText(formatLyricDraft(lyricEntryByT16.get(nextNodeT16)));
      return;
    }

    editingLyricT16Ref.current = null;
    setEditingLyricT16(null);
    setEditingLyricText('');
  }, [editingLyricT16, editingLyricText, setLyricEntry, lyricEntryByT16]);

  /**
   * Apply a connector shortcut (dash/hold), save this node, then jump to next node.
   */
  const applyLyricConnectorAndAdvance = useCallback((
    connectorToNext: LyricConnector,
    draftTextOverride?: string
  ) => {
    if (editingLyricT16 === null) return;

    const nextNodeT16 = getAdjacentVoice1NodeT16(editingLyricT16, 1);
    const draftToUse = draftTextOverride ?? editingLyricText;
    const parsedDraft = parseLyricDraft(draftToUse);

    // If there is no next melody node, we cannot keep a connector.
    if (nextNodeT16 === null) {
      commitLyricEdit(null, null);
      return;
    }

    setLyricEntry(editingLyricT16, parsedDraft.text, { connectorToNext });

    // Hold connectors skip held-through nodes so the editor lands on the next
    // visible chip after the continued line.
    let targetNodeT16: number | null = nextNodeT16;
    if (connectorToNext === 'hold') {
      const startIndex = voice1MelodyNodes.findIndex((node) => node.t16 === editingLyricT16);
      if (startIndex >= 0) {
        let targetIndex = startIndex + 2;
        let cursor = startIndex + 1;

        while (cursor < voice1MelodyNodes.length - 1) {
          const cursorT16 = voice1MelodyNodes[cursor].t16;
          const nextCursorT16 = voice1MelodyNodes[cursor + 1].t16;
          const continuesHold = lyricEntryByT16.get(cursorT16)?.connectorToNext === 'hold';
          const blockedByAnchor = hasAnchorBetween(voice1AnchorTimes, cursorT16, nextCursorT16);
          if (!continuesHold || blockedByAnchor) break;

          targetIndex = cursor + 2;
          cursor += 1;
        }

        targetNodeT16 = targetIndex < voice1MelodyNodes.length
          ? voice1MelodyNodes[targetIndex].t16
          : null;
      }
    }

    editingLyricT16Ref.current = targetNodeT16;
    setEditingLyricT16(targetNodeT16);
    setEditingLyricText(formatLyricDraft(targetNodeT16 !== null ? lyricEntryByT16.get(targetNodeT16) : undefined));
  }, [editingLyricT16, editingLyricText, getAdjacentVoice1NodeT16, setLyricEntry, lyricEntryByT16, commitLyricEdit, voice1MelodyNodes, voice1AnchorTimes]);

  /**
   * Toggle a connector button while editing.
   * - If the same connector is already active, remove it.
   * - Otherwise apply the connector and advance to the next editable node.
   */
  const handleLyricConnectorButton = useCallback((connectorToNext: LyricConnector) => {
    if (editingLyricT16 === null) return;

    const parsedDraft = parseLyricDraft(editingLyricText);
    if (parsedDraft.connectorToNext === connectorToNext) {
      setLyricEntry(editingLyricT16, parsedDraft.text, { connectorToNext: null });
      setEditingLyricText(parsedDraft.text);
      return;
    }

    applyLyricConnectorAndAdvance(connectorToNext, editingLyricText);
  }, [editingLyricT16, editingLyricText, setLyricEntry, applyLyricConnectorAndAdvance]);

  /**
   * Stop editing (commit changes back into the store).
   */
  const commitChordNameEdit = useCallback(() => {
    if (!arrangement) return;
    if (editingChordIndex === null) return;

    const nextName = editingChordName.trim() || 'C';
    setChordName(editingChordIndex, nextName);
    setEditingChordIndex(null);
  }, [arrangement, editingChordIndex, editingChordName, setChordName]);

  /**
   * Convert a mouse X position inside the chord lane into a snapped `t16` value.
   */
  const chordLaneMouseXToT16 = useCallback((clientX: number): number | null => {
    if (!arrangement) return null;
    const lane = chordLaneRef.current;
    if (!lane) return null;

    const rect = lane.getBoundingClientRect();
    const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;

    // Chord lane is aligned with the grid's drawing area (same left/right margins),
    // so we use the same camera math as the canvas to map pixels -> world time.
    const pxPerTVal = followMode.pxPerT;

    // IMPORTANT:
    // - When playing we must use the engine's *world* time (monotonic) so the chord lane
    //   stays aligned across loops.
    // - playback.position is loop-relative and would visually "jump".
    const worldT = followMode.pendingWorldT !== null
      ? followMode.pendingWorldT
      : getCameraCenterWorldT();
    const camLeft = cameraLeftWorldT(worldT, rect.width, pxPerTVal);

    const screenX = clientX - rect.left;
    const clickWorldT = screenXToWorldT(screenX, camLeft, pxPerTVal);
    const { tLocal } = resolveToCanonical(clickWorldT, totalT16);

    return Math.max(0, Math.min(totalT16, Math.round(tLocal)));
  }, [arrangement, followMode.pxPerT, followMode.pendingWorldT]);

  /**
   * Install global mouse listeners while dragging a chord boundary.
   * This keeps the resize working even if your mouse leaves the chord lane.
   */
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (mode !== 'create') return;
      if (!arrangement) return;
      const drag = chordBoundaryDragRef.current;
      if (!drag) return;

      const t16 = chordLaneMouseXToT16(e.clientX);
      if (t16 === null) return;
      resizeChordBoundary(drag.leftChordIndex, t16);
    };

    const handleUp = () => {
      if (chordBoundaryDragRef.current) {
        chordBoundaryDragRef.current = null;
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [mode, arrangement, chordLaneMouseXToT16, resizeChordBoundary]);


  /**
   * Find the closest existing node to the mouse (pixel-based hit testing).
   * This avoids the old behavior where you had to be "3 sixteenths away" from another node.
   */
  const getNodeHitAtMouseEvent = useCallback((
    e: React.MouseEvent<HTMLCanvasElement>,
    voiceId: string,
    _startT16: number,
    _endT16: number,
    gridLeft: number,
    gridTop: number,
    gridWidth: number,
    gridHeight: number,
    minSemitone: number,
    maxSemitone: number
  ) => {
    if (!arrangement) return null;

    const container = containerRef.current;
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const voice = arrangement.voices.find((v) => v.id === voiceId);
    if (!voice) return null;

    const hitRadius = 14 * display.noteSize;

    // ── Compute camera to position nodes on screen ──
    const pxPerTVal = followMode.pxPerT;
    const currentWorldT = followMode.pendingWorldT !== null
      ? followMode.pendingWorldT
      : getCameraCenterWorldT();
    const camLeft = cameraLeftWorldT(currentWorldT, gridWidth, pxPerTVal);

    // Check tile 0 only (no tiling)
    for (const node of voice.nodes) {
      const r = node.term ? 9 * display.noteSize : hitRadius;

      const nodeWorldT = node.t16;
      const x = gridLeft + worldTToScreenX(nodeWorldT, camLeft, pxPerTVal);

      // Skip off-screen nodes
      if (x < gridLeft - r || x > gridLeft + gridWidth + r) continue;

      const y = node.semi !== undefined
        ? semitoneToY(node.semi, minSemitone, maxSemitone, gridTop, gridHeight)
        : degreeToY(node.deg ?? 0, node.octave || 0, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale);

      const dx = mouseX - x;
      const dy = mouseY - y;
      if (dx * dx + dy * dy <= r * r) {
        return node;
      }
    }

    return null;
  }, [arrangement, followMode.pxPerT, followMode.pendingWorldT]);

  /**
   * Find the closest existing node across ALL voices under the mouse cursor.
   * Returns { voiceId, node } or null.  Used by the selection system so that
   * clicking any node (not just the selected voice) works for multi-select.
   */
  const getAnyNodeHitAtMouseEvent = useCallback((
    e: React.MouseEvent<HTMLCanvasElement>,
    gridLeft: number,
    gridTop: number,
    gridWidth: number,
    gridHeight: number,
    minSemitone: number,
    maxSemitone: number
  ): { voiceId: string; node: import('../../types').Node } | null => {
    if (!arrangement) return null;
    const container = containerRef.current;
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const hitRadius = 14 * display.noteSize;
    const pxPerTVal = followMode.pxPerT;
    const currentWorldT = followMode.pendingWorldT !== null
      ? followMode.pendingWorldT
      : getCameraCenterWorldT();
    const camLeft = cameraLeftWorldT(currentWorldT, gridWidth, pxPerTVal);

    // Check every voice, return the first hit found.
    for (const voice of arrangement.voices) {
      for (const node of voice.nodes) {
        const r = node.term ? 9 * display.noteSize : hitRadius;
        const nodeWorldT = node.t16;
        const x = gridLeft + worldTToScreenX(nodeWorldT, camLeft, pxPerTVal);
        if (x < gridLeft - r || x > gridLeft + gridWidth + r) continue;

        const y = node.semi !== undefined
          ? semitoneToY(node.semi, minSemitone, maxSemitone, gridTop, gridHeight)
          : degreeToY(node.deg ?? 0, node.octave || 0, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale);

        const dx = mouseX - x;
        const dy = mouseY - y;
        if (dx * dx + dy * dy <= r * r) {
          return { voiceId: voice.id, node };
        }
      }
    }
    return null;
  }, [arrangement, followMode.pxPerT, followMode.pendingWorldT, display.noteSize]);

  /**
   * Check if the mouse is near any voice's contour line (for hover/click-to-focus).
   * Returns the voiceId of the closest contour within the hit threshold, or null.
   *
   * Works by walking each voice's node list and checking the pixel distance from
   * the mouse to each line segment (horizontal holds + bends between nodes).
   * We use a generous threshold (12px) so you don't have to be pixel-perfect.
   */
  const getContourHitAtMouse = useCallback((
    mouseX: number,
    mouseY: number,
    gridLeft: number,
    gridTop: number,
    gridWidth: number,
    gridHeight: number,
    minSemitone: number,
    maxSemitone: number
  ): string | null => {
    if (!arrangement) return null;
    return getContourHitAtMouseVoiceId({
      arrangement,
      contourStackLookup,
      mouseX,
      mouseY,
      gridLeft,
      gridTop,
      gridWidth,
      gridHeight,
      minSemitone,
      maxSemitone,
      noteSize: display.noteSize,
      lineThickness: display.lineThickness,
      pxPerT: followMode.pxPerT,
      worldT: followMode.pendingWorldT !== null
        ? followMode.pendingWorldT
        : getCameraCenterWorldT(),
      splitStackedContoursForHit: hoveredContourVoiceIdRef.current !== null,
    });
  }, [arrangement, contourStackLookup, display.noteSize, display.lineThickness, followMode.pxPerT, followMode.pendingWorldT]);

  /**
   * Compute a stable pitch-range anchor from the arrangement content.
   *
   * NOTE: We intentionally do NOT recompute this on every node edit.
   * We only recompute when the arrangement ID changes.
   */
  const computePitchRangeAnchor = useCallback((arr: Arrangement): PitchRangeAnchor => {
    let minSemi = Infinity;
    let maxSemi = -Infinity;

    for (const voice of arr.voices) {
      for (const node of voice.nodes) {
        const semitone = node.semi !== undefined
          ? node.semi
          : degreeToSemitoneOffset(node.deg ?? 0, node.octave || 0, arr.scale);
        minSemi = Math.min(minSemi, semitone);
        maxSemi = Math.max(maxSemi, semitone);
      }
    }

    // If no nodes exist yet, use a reasonable default range.
    if (minSemi === Infinity || maxSemi === -Infinity) {
      minSemi = -5;
      maxSemi = 19;
    }

    const centerSemitone = (minSemi + maxSemi) / 2;
    const baseRange = maxSemi - minSemi;
    const basePadding = 10;
    const paddedRangeSemitones = baseRange + basePadding * 2;

    return { centerSemitone, paddedRangeSemitones };
  }, []);

  // Initialize / refresh the stable pitch anchor when a new arrangement is loaded.
  // We key off `arrangement.id` so Create-mode edits (which update nodes) don't cause jumps.
  useEffect(() => {
    if (!arrangement) {
      setPitchRangeAnchor(null);
      return;
    }

    setPitchRangeAnchor(computePitchRangeAnchor(arrangement));
  }, [arrangement?.id, computePitchRangeAnchor]);

  // Keep focus state valid whenever the contour set changes.
  // If a previously focused voice is deleted, or all its nodes are deleted,
  // this automatically clears that stale focus entry.
  useEffect(() => {
    cleanupFocusForExistingContours();
  }, [arrangement, cleanupFocusForExistingContours]);

  /**
   * Calculate the pitch range for the arrangement in semitones.
   * Returns min/max semitones relative to the tonic, plus frequency range.
   * Uses zoomLevel to adjust the visible range (higher zoom = fewer semitones visible).
   * ...
   */
  const getPitchRange = useCallback(() => {
    if (!arrangement) return { minSemitone: -5, maxSemitone: 19, minFreq: 130, maxFreq: 520, effectiveTonicMidi: 60 };

    // Use the stable pitch anchor if available.
    // Fallback to computing it directly (should be rare; mainly first render).
    const anchor = pitchRangeAnchor ?? computePitchRangeAnchor(arrangement);

    // Apply zoom: zoomLevel 1 = fit all, higher = zoomed in (fewer semitones)
    // zoomLevel 2 = half the range, zoomLevel 0.5 = double the range
    const zoomFactor = Math.max(0.25, display.zoomLevel); // Prevent extreme zoom out
    const zoomedRange = anchor.paddedRangeSemitones / zoomFactor;

    // Calculate final min/max centered on the arrangement anchor.
    // Use the shared follow-mode pitch pan in BOTH modes so middle-mouse and
    // keyboard vertical pans behave consistently everywhere.
    const pitchPan = followMode.pitchPanSemitones;
    const finalMin = Math.floor(anchor.centerSemitone - zoomedRange / 2 + pitchPan);
    const finalMax = Math.ceil(anchor.centerSemitone + zoomedRange / 2 + pitchPan);

    // Calculate frequency range (using MIDI-based calculation)
    // Get the MIDI pitch of the arrangement's tonic at base octave 4
    const tonicMidi = noteNameToMidi(`${arrangement.tonic}4`) || 60;

    // We also need to factor in playback transposition for the frequencies
    // but the grid itself stays in 'compositional' semitones (where tonic is 0)
    const effectiveTonicMidi = tonicMidi + (transposition || 0);

    const minFreq = midiToFrequency(effectiveTonicMidi + finalMin);
    const maxFreq = midiToFrequency(effectiveTonicMidi + finalMax);

    return { minSemitone: finalMin, maxSemitone: finalMax, minFreq, maxFreq, effectiveTonicMidi };
  }, [arrangement, display.zoomLevel, pitchRangeAnchor, computePitchRangeAnchor, transposition, followMode.pitchPanSemitones]);

  /**
   * Given a mouse event, compute the nearest legal grid point for Create mode.
   * Returns null if the mouse is outside the grid.
   */
  const getSnappedPointFromMouseEvent = useCallback((e: React.MouseEvent<HTMLCanvasElement>): SnappedGridPoint | null => {
    if (!arrangement) return null;
    const container = containerRef.current;

    // Use the container rect so mouse math matches the exact same box used in draw().
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const width = rect.width;
    const height = rect.height;

    const gridLeft = GRID_MARGIN.left;
    const gridTop = GRID_MARGIN.top;
    const gridWidth = width - GRID_MARGIN.left - GRID_MARGIN.right;
    const gridHeight = height - GRID_MARGIN.top - GRID_MARGIN.bottom;

    // Horizontal bounds are strict (outside means no valid time placement).
    // Vertical bounds are clamped so drag interactions remain stable even if
    // the pointer drifts slightly above/below the grid while dragging.
    if (x < gridLeft || x > gridLeft + gridWidth) return null;

    const clampedY = Math.max(gridTop, Math.min(gridTop + gridHeight, y));

    const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
    const { minSemitone, maxSemitone } = getPitchRange();

    // ── Convert screen X → world time → local t16 (clamped, no wrap) ──
    const pxPerTVal = followMode.pxPerT;
    const currentWorldT = followMode.pendingWorldT !== null
      ? followMode.pendingWorldT
      : getCameraCenterWorldT();
    const camLeft = cameraLeftWorldT(currentWorldT, gridWidth, pxPerTVal);

    // Screen X (relative to grid left) → world time
    const clickWorldT = screenXToWorldT(x - gridLeft, camLeft, pxPerTVal);
    // In Create interactions we do NOT wrap time around the loop length.
    // Wrapping causes drags near the right side to jump backward instead of
    // continuing forward. Clamp keeps dragging direction intuitive.
    const t16 = Math.max(0, Math.min(totalT16, Math.round(clickWorldT)));

    const relativeY = (clampedY - gridTop) / gridHeight;
    const rawSemitone = maxSemitone - relativeY * (maxSemitone - minSemitone);

    // Always allow chromatic placement (no modifier required).
    const chromaticSemitone = Math.round(rawSemitone);
    return { t16, deg: 1, octave: 0, semi: chromaticSemitone };
  }, [arrangement, getPitchRange, followMode.pxPerT, followMode.pendingWorldT]);

  /**
   * Main drawing function.
   */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Ensure we have up-to-date canvas metrics.
    // In normal operation this is updated by ResizeObserver + window resize.
    if (!canvasMetricsRef.current) {
      updateCanvasMetrics();
    }

    const metrics = canvasMetricsRef.current;
    if (!metrics) return;

    // Handle high DPI displays
    // IMPORTANT: We must reset the transform each frame.
    // If we call `ctx.scale(dpr, dpr)` repeatedly without resetting, the scale accumulates,
    // which makes drawings (and mouse hit-testing) feel offset.
    const dpr = metrics.dpr;

    // Clear in device pixels with identity transform.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw in CSS pixels with a single DPR transform.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = metrics.cssWidth;
    const height = metrics.cssHeight;

    // Grid area (with margins for labels)
    const gridLeft = metrics.gridLeft;
    const gridTop = metrics.gridTop;
    const gridWidth = metrics.gridWidth;
    const gridHeight = metrics.gridHeight;

    // Read colors from the cached CSS variables (refreshed only on theme/display change).
    const barLineColor = cssColors.barLine;
    const beatLineColor = cssColors.beatLine;
    const subdivLineColor = cssColors.subdivLine;
    const pitchLineTonicColor = cssColors.pitchLineTonic;
    const pitchLineColor = cssColors.pitchLine;
    const playheadColor = cssColors.playhead;
    const textColor = cssColors.text;
    const chordFillTop = cssColors.chordFillTop;
    const chordFillBottom = cssColors.chordFillBottom;
    const chordFillTensionTop = cssColors.chordFillTensionTop;
    const chordFillTensionBottom = cssColors.chordFillTensionBot;
    const chordStroke = cssColors.chordStroke;
    const chordStrokeTension = cssColors.chordStrokeTension;
    const chordText = cssColors.chordText;
    const chordTextTension = cssColors.chordTextTension;

    // Canvas was already cleared above (in device pixels)


    if (!arrangement) {
      // Draw placeholder text
      ctx.fillStyle = textColor;
      ctx.font = '16px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Select an arrangement to begin', width / 2, height / 2);
      return;
    }

    // Get pitch range (now in semitones)
    const { minSemitone, maxSemitone, effectiveTonicMidi } = getPitchRange();

    // ── Follow-mode camera setup ──
    // loopLengthT is the arrangement length in 16th notes (one full loop cycle).
    const loopLengthT = arrangement.bars * arrangement.timeSig.numerator * 4;

    // Horizontal zoom: pixels per 16th note
    const pxPerT = followMode.pxPerT;

    // ── Camera center ("worldT") and playhead position ──
    //
    // In Create mode the camera is independent (user pans with right-click).
    // In Play mode the Smart Cam decides the camera center each frame
    // and stores it in the cameraState module.  The playhead may NOT be at
    // the viewport center (static states let it drift).
    //
    // We track both:
    //   worldT       – camera center (determines what the viewport shows)
    //   playheadWorldT – actual transport position (for drawing the playhead line)
    const engineWorldT = playbackEngine.getWorldPositionT16();
    const visualWorldT = visualWorldTRef.current ?? engineWorldT;

    // Playhead position (always the transport position, used for the playhead line)
    const playheadWorldT = followMode.pendingWorldT !== null
      ? followMode.pendingWorldT
      : visualWorldT;

    // Camera center — single source of truth from cameraState module.
    // In Play mode, both the main grid AND the chord overlay read from
    // getCameraCenterWorldT(), so they are always perfectly synchronized.
    // During a pending seek drag, override with the drag position.
    const worldT = followMode.pendingWorldT !== null
      ? followMode.pendingWorldT
      : getCameraCenterWorldT();

    // Camera left edge in world time (may be negative near the start).
    const camLeft = cameraLeftWorldT(worldT, gridWidth, pxPerT);

    // NOTE:
    // - If snapCameraToPixels is ON, we quantize the camera to device pixels.
    //   This reduces shimmer in thin lines but can create subtle micro-lurching.
    // - If snapCameraToPixels is OFF, motion is perfectly continuous, but thin
    //   lines may shimmer slightly at some zoom levels.
    const camLeftSnapped = display.snapCameraToPixels
      ? (Math.round(camLeft * pxPerT * dpr) / dpr) / pxPerT
      : camLeft;

    // Use fresh loop state (from the store) so dragging loop handles updates the
    // canvas immediately (the RAF draw loop will pick up new values without
    // needing a React re-render).
    const pb = useAppStore.getState().playback;
    const loopEnabledNow = pb.loopEnabled;
    const loopStartNow = pb.loopStart;
    const loopEndNow = pb.loopEnd;

    // DAW-style: always draw tile 0 only — no tiling.
    const kStart = 0;
    const kEnd = 0;

    // Helper: convert a world-time value to a screen X pixel inside the grid area.
    const wToX = (wt: number) => gridLeft + worldTToScreenX(wt, camLeftSnapped, pxPerT);

    // Keep these around for pitch trace + chord drawing that still use local coordinates.
    const totalT16 = loopLengthT;
    const startT16 = 0;
    const endT16 = totalT16;

    // Grid level-of-detail: hide subdivision / beat lines when zoomed far out.
    const lod = getGridLOD(pxPerT);

    // Draw horizontal pitch lines (semitone-based chromatic grid)
    if (!onlyChords) {
      ctx.save();
      ctx.globalAlpha = display.gridOpacity;

      for (let semi = Math.ceil(minSemitone); semi <= Math.floor(maxSemitone); semi++) {
        // Determine if this pitch is diatonic
        // Normalize semi to 0-11 range relative to tonic
        // minSemitone is relative to tonic, so semi is also relative to tonic
        const noteInScale = ((semi % 12) + 12) % 12;
        const scalePattern = SCALE_PATTERNS[arrangement.scale] || SCALE_PATTERNS['major'];
        const isDiatonic = scalePattern.includes(noteInScale);

        // Only draw grid lines for diatonic notes
        if (!isDiatonic) continue;

        const y = semitoneToY(semi, minSemitone, maxSemitone, gridTop, gridHeight);
        const label = semitoneToLabel(semi);

        // Make tonic (1) and octave brighter for orientation
        if (semi % 12 === 0) {
          ctx.strokeStyle = pitchLineTonicColor;
          ctx.lineWidth = 1.5;
        } else {
          // Standard diatonic lines
          ctx.strokeStyle = pitchLineColor;
          ctx.lineWidth = 0.5; // Thinner lines
        }

        ctx.beginPath();
        ctx.moveTo(gridLeft, y);
        ctx.lineTo(gridLeft + gridWidth, y);
        ctx.stroke();

        // Draw semitone label on the left
        if (semi >= minSemitone + 1 && semi <= maxSemitone - 1) {
          ctx.fillStyle = semi % 12 === 0 ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.35)';
          ctx.font = 'bold 10px system-ui';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, gridLeft - 15, y);
        }
      }

      // ── Tiled vertical grid lines ──
      // Draw grid lines for every visible tile (seamless infinite looping).
      // Uses the memoized array (only recomputed when bars/timeSig change).
      const gridLines = memoizedGridLines;

      for (let k = kStart; k <= kEnd; k++) {
        for (const line of gridLines) {
          // Skip line types based on LOD (zoom level)
          if (line.type === 'subdivision' && !lod.showSubdivisions) continue;
          if (line.type === 'beat' && !lod.showBeats) continue;

          // Convert local grid time → world time for this tile
          const drawWorldT = tileLocalToWorldT(line.t16, k, loopLengthT);
          if (drawWorldT === null) continue; // before time 0

          const x = wToX(drawWorldT);
          // Skip lines that are off-screen (with a small margin)
          if (x < gridLeft - 2 || x > gridLeft + gridWidth + 2) continue;

          switch (line.type) {
            case 'bar':
              ctx.strokeStyle = barLineColor;
              ctx.lineWidth = 2;
              break;
            case 'beat':
              ctx.strokeStyle = beatLineColor;
              ctx.lineWidth = 1;
              break;
            case 'subdivision':
              ctx.strokeStyle = subdivLineColor;
              ctx.lineWidth = 1;
              break;
          }

          ctx.beginPath();
          ctx.moveTo(x, gridTop);
          ctx.lineTo(x, gridTop + gridHeight);
          ctx.stroke();
        }

        // ── Loop Start Marker ──
        // Draw a distinctive marker at the beginning of each loop repetition.
        // This helps the singer see "bar 1" approaching at the end of each cycle.
        const loopStartWorldT = k * loopLengthT;
        if (loopStartWorldT >= 0) {
          const lsX = wToX(loopStartWorldT);
          if (lsX >= gridLeft - 2 && lsX <= gridLeft + gridWidth + 2) {
            // Bright, thick line
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
            ctx.lineWidth = 3;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(lsX, gridTop);
            ctx.lineTo(lsX, gridTop + gridHeight);
            ctx.stroke();

            // Label "1" (bar 1) above the marker
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.font = 'bold 13px system-ui';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText('1', lsX, gridTop - 2);
            ctx.restore();
          }
        }

        // Draw bar numbers for this tile (skip bar 0 since the loop marker covers it)
        ctx.fillStyle = textColor;
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center';
        for (let bar = 1; bar < arrangement.bars; bar++) {
          const localT16 = bar * arrangement.timeSig.numerator * 4;
          const drawWT = tileLocalToWorldT(localT16, k, loopLengthT);
          if (drawWT === null) continue;
          const bx = wToX(drawWT);
          if (bx < gridLeft - 20 || bx > gridLeft + gridWidth + 20) continue;
          ctx.fillText(`${bar + 1}`, bx, gridTop - 10);
        }
      }
      ctx.restore();
    }

    // Draw chord track (tiled across visible tiles)
    // In Create mode we render interactive chord blocks as HTML overlay elements,
    // so we skip the canvas chord drawing to avoid double-rendering.
    if (!hideChords && mode !== 'create' && display.showChordTrack && arrangement.chords) {
      // Clip chords horizontally so they stop exactly at the visible grid edges.
      // (Chord blocks sit slightly above `gridTop`, so we only clip in X, not Y.)
      ctx.save();
      ctx.beginPath();
      ctx.rect(gridLeft, 0, gridWidth, height);
      ctx.clip();

      const blockHeight = 24;
      const blockY = gridTop - 30;

      for (let k = kStart; k <= kEnd; k++) {
        for (let i = 0; i < arrangement.chords.length; i++) {
          const chord = arrangement.chords[i];
          const isDiatonicChord = arrangement ? isChordDiatonic(chord, arrangement) : true;

          // Convert chord local times to world time for this tile
          const chordStartWT = tileLocalToWorldT(chord.t16, k, loopLengthT);
          const chordEndWT = tileLocalToWorldT(chord.t16 + chord.duration16, k, loopLengthT);
          if (chordStartWT === null || chordEndWT === null) continue;

          const blockStartX = wToX(chordStartWT);
          const blockEndX = wToX(chordEndWT);
          const blockWidth = blockEndX - blockStartX;

          // Skip off-screen blocks
          if (blockEndX < gridLeft - 10 || blockStartX > gridLeft + gridWidth + 10) continue;

          // Draw glass-like rounded block with gap
          const gap = 6;
          const radius = 8;
          const bStartX = blockStartX + gap / 2;
          const bWidth = Math.max(0, blockWidth - gap);

          // Build the main fill gradient
          const gradient = ctx.createLinearGradient(bStartX, blockY, bStartX, blockY + blockHeight);
          if (isDiatonicChord) {
            gradient.addColorStop(0, chordFillTop);
            gradient.addColorStop(1, chordFillBottom);
          } else {
            gradient.addColorStop(0, chordFillTensionTop);
            gradient.addColorStop(1, chordFillTensionBottom);
          }

          // Path for the rounded "chip".
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(bStartX, blockY, bWidth, blockHeight, radius);
          } else {
            ctx.rect(bStartX, blockY, bWidth, blockHeight);
          }

          // 1) Soft drop shadow
          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
          ctx.shadowBlur = 12;
          ctx.shadowOffsetY = 4;
          ctx.fillStyle = gradient;
          ctx.fill();
          ctx.restore();

          // 2) Crisp outer stroke.
          ctx.strokeStyle = isDiatonicChord ? chordStroke : chordStrokeTension;
          ctx.lineWidth = 1.25;
          ctx.stroke();

          // 3) Top "sheen" highlight
          const sheen = ctx.createLinearGradient(0, blockY, 0, blockY + blockHeight);
          sheen.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
          sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0.04)');
          sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.strokeStyle = sheen;
          ctx.lineWidth = 1;
          ctx.stroke();

          // Draw chord text centered in block.
          ctx.save();
          ctx.fillStyle = isDiatonicChord ? chordText : chordTextTension;
          ctx.font = '700 13px system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
          ctx.shadowBlur = 6;
          ctx.fillText(chord.name, blockStartX + blockWidth / 2, blockY + blockHeight / 2);
          ctx.restore(); // Must match the ctx.save() for chord text above!
        }
      }

      // Pop the chord-track clip rect.
      ctx.restore();
    }

    // 3. Draw contours + nodes + playhead (these are part of the "main grid layer")
    // IMPORTANT: When `onlyChords=true`, this component is being used as a dedicated chord-track overlay
    // that sits on top of the main (masked) grid.
    // In that mode, we must NOT draw contours/nodes/playhead, otherwise they won't receive the fade mask.
    if (!onlyChords) {
      // Clip to the visible grid rectangle so contour lines / nodes / playhead
      // do not render past the left/right grid edge.
      ctx.save();
      ctx.beginPath();
      ctx.rect(gridLeft, gridTop, gridWidth, gridHeight);
      ctx.clip();

      ctx.lineJoin = 'round';

      // Pre-compute once: is ANY voice soloed? Used by mute/solo logic below.
      const anySoloActive = voiceStates.some(v => v.synthSolo || v.vocalSolo);

      // 1. Draw recorded pitch traces (behind contours) — tiled across visible tiles
      for (const [voiceId, recording] of recordings.entries()) {
        // Skip drawing the saved trace for the voice currently being recorded.
        // The live trace (drawn below) replaces it during recording.
        // Without this, both traces render simultaneously, causing flickering
        // and wrong-color artifacts.
        if (isRecording && voiceId === livePitchTraceVoiceId) continue;

        const voiceIndex = arrangement.voices.findIndex(v => v.id === voiceId);
        if (voiceIndex === -1) continue;

        const voice = arrangement.voices[voiceIndex];
        const voiceState = voiceStates.find(v => v.voiceId === voiceId);

        // Recorded traces follow the VOX (vocal) mute/solo state.
        const isVocalMuted = (voiceState?.vocalMuted ?? false) || (anySoloActive && !(voiceState?.vocalSolo ?? false));

        const voiceColor = isVocalMuted
          ? 'rgba(150, 150, 150, 0.4)'
          : (voice.color || cssColors.voiceFallback[voiceIndex] || '#ff6b9d');

        // Draw the pitch trace for each visible tile
        for (let k = kStart; k <= kEnd; k++) {
          const tileOffset = k * loopLengthT;
          drawPitchTrace(ctx, recording.pitchTrace, startT16, endT16,
            arrangement.tempo, arrangement.timeSig, gridLeft, gridTop, gridWidth, gridHeight, {
            color: voiceColor,
            lineWidth: 10,
            opacity: isVocalMuted ? 0.2 : 0.4,
            isLive: false,
            effectiveTonicMidi,
            minSemitone,
            maxSemitone,
            worldTimeOffset: tileOffset,
            camLeft: camLeftSnapped,
            pxPerT,
          });
        }
      }

      // 2. Draw live pitch trace (during recording) — tiled across visible tiles
      // This is important in Loop mode so that, as the next repetition (bar 1) scrolls
      // into view near the end of the current loop, you can also see the beginning of
      // the pitch trace you are currently recording.
      if (livePitchTrace.length > 0 && livePitchTraceVoiceId && isRecording) {
        // Use the tagged voiceId (not armedVoiceId) so the color is always
        // correct even if armedVoiceId changes mid-render.
        const voiceIndex = arrangement.voices.findIndex(v => v.id === livePitchTraceVoiceId);
        const voice = voiceIndex >= 0 ? arrangement.voices[voiceIndex] : null;
        const traceColor = voice?.color || cssColors.voiceFallback[voiceIndex] || '#ffffff';

        // Compute the playhead screen X from the actual transport position.
        // In follow states the playhead is near viewport center; in static
        // states it can drift to either side.
        const playheadXUnsnapped = gridLeft + worldTToScreenX(playheadWorldT, camLeftSnapped, pxPerT);
        const playheadX = Math.round(playheadXUnsnapped * dpr) / dpr;

        // Identify which tile the playhead is currently in, so we only draw ONE head flare.
        // (The trace itself still renders on every tile so looping looks continuous.)
        // Use playheadWorldT (transport position), NOT worldT (camera center).
        const playheadTile = loopLengthT > 0
          ? Math.floor(Math.max(0, playheadWorldT) / loopLengthT)
          : 0;

        // Draw the same live trace for each visible tile.
        // Because the live trace time axis starts at 0 for the recording,
        // drawing it with `worldTimeOffset = k * loopLengthT` makes the trace
        // appear correctly within each repeated copy of the arrangement.
        for (let k = kStart; k <= kEnd; k++) {
          const tileOffset = k * loopLengthT;
          drawPitchTrace(ctx, livePitchTrace, startT16, endT16,
            arrangement.tempo, arrangement.timeSig, gridLeft, gridTop, gridWidth, gridHeight, {
            color: traceColor,
            lineWidth: 10,
            opacity: 0.8,
            isLive: k === playheadTile,
            effectiveTonicMidi,
            minSemitone,
            maxSemitone,
            worldTimeOffset: tileOffset,
            camLeft: camLeftSnapped,
            pxPerT,
            headXOverride: k === playheadTile ? playheadX : undefined,
          });
        }
      }

      // 3A. Draw contour lines for each voice — tiled
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Node sizes are shared across voices.
      // We draw *all* contour lines first, then draw *all* nodes afterwards.
      // This guarantees nodes always sit on top.
      const nodeRadius = 12 * display.noteSize;
      const anchorRadius = nodeRadius * 0.5;

      // Rendering order rule:
      // - Default: sidebar top voice should render on top, so we draw from bottom -> top.
      // - Create mode: actively edited voice (selectedVoiceId) is forced to top.
      const voiceRenderOrder = arrangement.voices.map((_, idx) => idx).reverse();
      if (mode === 'create' && selectedVoiceId) {
        const selectedIdx = arrangement.voices.findIndex(v => v.id === selectedVoiceId);
        if (selectedIdx >= 0) {
          const withoutSelected = voiceRenderOrder.filter(idx => idx !== selectedIdx);
          voiceRenderOrder.length = 0;
          voiceRenderOrder.push(...withoutSelected, selectedIdx);
        }
      }

      // Pass A: Contour lines only (including glow) — for each visible tile
      // Hovering any contour temporarily expands stacked lines so users can inspect
      // which voices are currently in a unison stack.
      const splitStackedContours = hoveredContourVoiceIdRef.current !== null;
      for (let k = kStart; k <= kEnd; k++) {
        const tileOffset = k * loopLengthT;

        for (const voiceIndex of voiceRenderOrder) {
          const voice = arrangement.voices[voiceIndex];
          const voiceState = voiceStates.find(v => v.voiceId === voice.id);

          // Contour lines follow the SYN (synth) mute/solo state.
          const isSynthMuted = (voiceState?.synthMuted ?? false) || (anySoloActive && !(voiceState?.synthSolo ?? false));

          // Get voice color
          const baseColor = voice.color || cssColors.voiceFallback[voiceIndex] || '#ff6b9d';
          const voiceColor = isSynthMuted ? 'rgba(150, 150, 150, 0.4)' : baseColor;
          const glowColor = voiceColor.includes('rgba') ? voiceColor : voiceColor.replace(')', ', 0.5)').replace('rgb', 'rgba');

          // Contour lines get thicker when the mouse hovers over them (play mode only).
          const isHoveredContour = hoveredContourVoiceIdRef.current === voice.id;
          const baseContourWidth = 3 * display.lineThickness;
          const contourLineWidth = isHoveredContour ? baseContourWidth * 1.67 : baseContourWidth;
          const voiceSegmentStackMap = contourStackLookup.get(voice.id);

          // Draw contour with glow effect
          ctx.save();

          // Glow layer - only if not muted
          if (display.glowIntensity > 0 && !isSynthMuted) {
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 10 * display.glowIntensity;
            ctx.strokeStyle = voiceColor;
            ctx.lineWidth = contourLineWidth;
            drawVoiceContour(ctx, voice, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale, tileOffset, camLeftSnapped, pxPerT, gridLeft, loopLengthT, voiceSegmentStackMap, baseContourWidth, splitStackedContours, voiceColor, display.noteSize);
          }

          // Main line
          ctx.shadowBlur = 0;
          ctx.strokeStyle = voiceColor;
          ctx.lineWidth = contourLineWidth;
          drawVoiceContour(ctx, voice, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale, tileOffset, camLeftSnapped, pxPerT, gridLeft, loopLengthT, voiceSegmentStackMap, baseContourWidth, splitStackedContours, voiceColor, display.noteSize);
          ctx.restore();
        }
      }

      // Pass A.5: Node radial shadows projected onto contours only.
      // We render shadows into an offscreen layer, then mask it with a contour-only
      // alpha mask so the darkening affects contour lines but NOT nodes/background.
      const ensureOffscreenCanvas = (
        canvasRefObj: React.MutableRefObject<HTMLCanvasElement | null>
      ): HTMLCanvasElement => {
        if (!canvasRefObj.current) {
          canvasRefObj.current = document.createElement('canvas');
        }
        const offscreen = canvasRefObj.current;
        if (offscreen.width !== canvas.width || offscreen.height !== canvas.height) {
          offscreen.width = canvas.width;
          offscreen.height = canvas.height;
        }
        return offscreen;
      };

      const shadowMaskCanvas = ensureOffscreenCanvas(shadowMaskCanvasRef);
      const shadowCompositeCanvas = ensureOffscreenCanvas(shadowCompositeCanvasRef);
      const maskCtx = shadowMaskCanvas.getContext('2d');
      const shadowCtx = shadowCompositeCanvas.getContext('2d');

      if (maskCtx && shadowCtx) {
        // 1) Build contour mask layer (only contour pixels are opaque).
        maskCtx.setTransform(1, 0, 0, 1, 0, 0);
        maskCtx.clearRect(0, 0, shadowMaskCanvas.width, shadowMaskCanvas.height);
        maskCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        maskCtx.save();
        maskCtx.beginPath();
        maskCtx.rect(gridLeft, gridTop, gridWidth, gridHeight);
        maskCtx.clip();
        maskCtx.lineCap = 'round';
        maskCtx.lineJoin = 'round';
        maskCtx.strokeStyle = '#ffffff';

        for (let k = kStart; k <= kEnd; k++) {
          const tileOffset = k * loopLengthT;
          for (const voiceIndex of voiceRenderOrder) {
            const voice = arrangement.voices[voiceIndex];
            const isHoveredContour = hoveredContourVoiceIdRef.current === voice.id;
            const baseContourWidth = 3 * display.lineThickness;
            const contourLineWidth = isHoveredContour ? baseContourWidth * 1.67 : baseContourWidth;
            const voiceSegmentStackMap = contourStackLookup.get(voice.id);

            maskCtx.lineWidth = contourLineWidth;
            drawVoiceContour(maskCtx, voice, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale, tileOffset, camLeftSnapped, pxPerT, gridLeft, loopLengthT, voiceSegmentStackMap, baseContourWidth, splitStackedContours, '#ffffff', display.noteSize);
          }
        }
        maskCtx.restore();

        // 2) Draw radial shadows at node positions.
        shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
        shadowCtx.clearRect(0, 0, shadowCompositeCanvas.width, shadowCompositeCanvas.height);
        shadowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        shadowCtx.save();
        shadowCtx.beginPath();
        shadowCtx.rect(gridLeft, gridTop, gridWidth, gridHeight);
        shadowCtx.clip();

        // Multiple voices can share the same rendered node position.
        // To avoid stacking several identical radial fills on top of each other,
        // we keep one shadow entry per screen position and draw it once.
        const shadowByPosition = new Map<string, { x: number; y: number; radius: number }>();

        for (let k = kStart; k <= kEnd; k++) {
          const tileOffset = k * loopLengthT;
          for (const voice of arrangement.voices) {
            for (const node of voice.nodes) {
              const nodeWorldT = node.t16 + tileOffset;
              if (nodeWorldT < 0) continue;
              const x = wToX(nodeWorldT);
              if (x < gridLeft - 30 || x > gridLeft + gridWidth + 30) continue;

              const y = node.semi !== undefined
                ? semitoneToY(node.semi, minSemitone, maxSemitone, gridTop, gridHeight)
                : degreeToY(node.deg ?? 0, node.octave || 0, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale);

              const nodeShadowRadius = node.term ? anchorRadius * 2.6 : nodeRadius * 2.1;
              const shadowKey = `${Math.round(x * 10)}:${Math.round(y * 10)}`;
              const existingShadow = shadowByPosition.get(shadowKey);

              if (!existingShadow) {
                shadowByPosition.set(shadowKey, { x, y, radius: nodeShadowRadius });
                continue;
              }

              // Keep the widest radius so mixed node types at one position still
              // produce a shadow large enough to cover the visible node marker.
              if (nodeShadowRadius > existingShadow.radius) {
                existingShadow.radius = nodeShadowRadius;
              }
            }
          }
        }

        for (const { x, y, radius } of shadowByPosition.values()) {
          const shadowGradient = shadowCtx.createRadialGradient(
            x,
            y,
            0,
            x,
            y,
            radius
          );
          shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0.100)');
          shadowGradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.60)');
          shadowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

          shadowCtx.fillStyle = shadowGradient;
          shadowCtx.beginPath();
          shadowCtx.arc(x, y, radius, 0, Math.PI * 2);
          shadowCtx.fill();
        }
        shadowCtx.restore();

        // 3) Keep shadow only where contours exist.
        shadowCtx.save();
        shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
        shadowCtx.globalCompositeOperation = 'destination-in';
        shadowCtx.drawImage(shadowMaskCanvas, 0, 0);
        shadowCtx.restore();

        // 4) Composite shadow onto main canvas before nodes draw.
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = 0.95;
        ctx.drawImage(shadowCompositeCanvas, 0, 0);
        ctx.restore();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      // Draw playhead above contour lines but below nodes.
      // In follow states the playhead is near viewport center;
      // in static states it can be anywhere on screen.
      const playheadXUnsnapped = gridLeft + worldTToScreenX(playheadWorldT, camLeftSnapped, pxPerT);
      const playheadX = Math.round(playheadXUnsnapped * dpr) / dpr;

      ctx.strokeStyle = playheadColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, gridTop);
      ctx.lineTo(playheadX, gridTop + gridHeight);
      ctx.stroke();

      // Pass B: Nodes on top (for every voice) — tiled
      for (let k = kStart; k <= kEnd; k++) {
        const tileOffset = k * loopLengthT;

        for (const voiceIndex of voiceRenderOrder) {
          const voice = arrangement.voices[voiceIndex];
          const voiceState = voiceStates.find(v => v.voiceId === voice.id);

          // Contour nodes follow the SYN (synth) mute/solo state.
          const isSynthMuted = (voiceState?.synthMuted ?? false) || (anySoloActive && !(voiceState?.synthSolo ?? false));

          const baseColor = voice.color || cssColors.voiceFallback[voiceIndex] || '#ff6b9d';
          const voiceColor = isSynthMuted ? 'rgba(150, 150, 150, 0.4)' : baseColor;

          const nodeStrokeColor = voiceColor;
          const nodeFillColor = isSynthMuted
            ? 'rgba(90, 90, 90, 1)'
            : (baseColor.startsWith('#') ? darkenColor(baseColor, 35) : baseColor);

          for (const node of voice.nodes) {
            // Convert node local time to world time for this tile
            const nodeWorldT = node.t16 + tileOffset;
            if (nodeWorldT < 0) continue; // before time 0
            const x = wToX(nodeWorldT);
            // Skip nodes that are off-screen
            if (x < gridLeft - 20 || x > gridLeft + gridWidth + 20) continue;

            const y = node.semi !== undefined
              ? semitoneToY(node.semi, minSemitone, maxSemitone, gridTop, gridHeight)
              : degreeToY(node.deg ?? 0, node.octave || 0, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale);

            // Draw node glow - only if not muted
            if (display.glowIntensity > 0 && !isSynthMuted) {
              ctx.shadowColor = voiceColor;
              ctx.shadowBlur = 8 * display.glowIntensity;
            }

            if (node.term) {
              // Anchor: small filled circle, no stroke, same color as the line.
              const isDraggedAnchor = !!dragState?.isDragging && dragState.voiceId === voice.id && dragState.originalT16 === node.t16;

              if (isDraggedAnchor) {
                // Simple "halo" while dragging: a slightly larger solid circle.
                ctx.save();
                ctx.globalAlpha = 0.35;
                ctx.beginPath();
                ctx.arc(x, y, anchorRadius * 2.2, 0, Math.PI * 2);
                ctx.fillStyle = voiceColor;
                ctx.fill();
                ctx.restore();
              }

              ctx.beginPath();
              ctx.arc(x, y, anchorRadius, 0, Math.PI * 2);
              ctx.fillStyle = voiceColor;
              ctx.fill();

              ctx.shadowBlur = 0;
              continue;
            }

            // Regular node circle with opaque fill
            ctx.beginPath();
            ctx.arc(x, y, nodeRadius, 0, Math.PI * 2);
            ctx.fillStyle = nodeFillColor;
            ctx.fill();

            // Playback flash:
            // When the playhead triggers this node's synth event, we briefly thicken
            // and lighten the stroke toward white, then fade back to normal.
            // IMPORTANT:
            // Use world time so only this specific tiled copy flashes.
            const flashKey = `${voice.id}:${node.t16}`;
            const flashStartMs = nodeFlashStartMsRef.current.get(flashKey);
            const nowMs = window.performance.now();

            // These timings mirror the old IndexOLD.html behavior:
            // 200ms "rise" (instant hold at peak) + 1000ms decay.
            // NOTE:
            // The old behavior included a noticeable "full" hold. For the newer
            // feel you asked for (fast initial falloff, slow tail), we use a short
            // attack ramp and then start the decay immediately.
            const FLASH_ATTACK_MS = 35;
            const FLASH_DECAY_MS = 2000;
            const flashAgeMs = flashStartMs !== undefined ? (nowMs - flashStartMs) : Infinity;

            let flashIntensity = 0;
            if (flashAgeMs >= 0 && flashAgeMs <= (FLASH_ATTACK_MS + FLASH_DECAY_MS)) {
              if (flashAgeMs <= FLASH_ATTACK_MS) {
                // Quick ramp up to avoid a harsh single-frame jump.
                flashIntensity = Math.max(0, Math.min(1, flashAgeMs / FLASH_ATTACK_MS));
              } else {
                // Exponential-style decay: fast initial falloff, slow tail.
                // Larger DECAY_K = faster drop.
                const DECAY_K = 4;
                const decay01 = (flashAgeMs - FLASH_ATTACK_MS) / FLASH_DECAY_MS;
                flashIntensity = Math.exp(-DECAY_K * decay01);
              }
            } else if (flashStartMs !== undefined && flashAgeMs > (FLASH_ATTACK_MS + FLASH_DECAY_MS)) {
              // Cleanup so the map doesn't grow unbounded during long playback.
              nodeFlashStartMsRef.current.delete(flashKey);
            }

            const baseStrokeWidth = 1.5;
            const flashStrokeWidth = baseStrokeWidth + flashIntensity * 3;
            const flashStrokeColor = flashIntensity > 0
              ? lightenCssColorTowardWhite(nodeStrokeColor, 0.4 * flashIntensity)
              : nodeStrokeColor;

            ctx.strokeStyle = flashStrokeColor;
            ctx.lineWidth = flashStrokeWidth;
            ctx.stroke();

            ctx.shadowBlur = 0;

            // Note label inside node (controlled by showNoteLabels toggle)
            if (display.showNoteLabels) {
              const labelFontSize = Math.round(12 * display.noteSize);
              ctx.fillStyle = isSynthMuted ? 'rgba(255, 255, 255, 0.5)' : '#ffffff';
              ctx.font = `bold ${labelFontSize}px system-ui`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';

              // Determine label text based on labelFormat setting
              let labelText: string;
              if (node.semi !== undefined) {
                // Node stored as raw semitone offset
                if (display.labelFormat === 'solfege') {
                  labelText = semitoneToSolfege(node.semi);
                } else if (display.labelFormat === 'noteName') {
                  labelText = semitoneToLetterName(node.semi, arrangement.tonic || 'C', transposition);
                } else {
                  labelText = semitoneToLabel(node.semi);
                }
              } else {
                // Node stored as scale degree
                const deg = node.deg ?? 0;
                if (display.labelFormat === 'solfege') {
                  const semi = degreeToSemitoneOffset(deg, 0, arrangement.scale);
                  labelText = semitoneToSolfege(semi);
                } else if (display.labelFormat === 'noteName') {
                  const semi = degreeToSemitoneOffset(deg, 0, arrangement.scale);
                  labelText = semitoneToLetterName(semi, arrangement.tonic || 'C', transposition);
                } else {
                  labelText = String(deg);
                }
              }

              ctx.fillText(labelText, x, y + 0.5);
            }

            // ── Selection highlight: draw a bright ring around selected nodes ──
            if (mode === 'create' && k === kStart) {
              const selKeys = useAppStore.getState().createView.selectedNodeKeys;
              const nk = `${voice.id}:${node.t16}`;
              if (selKeys.has(nk)) {
                ctx.save();
                ctx.strokeStyle = '#00ffff';   // Cyan selection ring
                ctx.lineWidth = 2.5;
                ctx.shadowColor = '#00ffff';
                ctx.shadowBlur = 8;
                const selRadius = node.term ? anchorRadius + 4 : nodeRadius + 4;
                ctx.beginPath();
                ctx.arc(x, y, selRadius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
              }
            }
          }

          // Create mode hover preview ("phantom" node) — only draw once (not per tile)
          if (k === kStart) {
            const isDraggingAnchor = !!dragState?.isDragging && dragState.voiceId === voice.id && !!voice.nodes.find(n => n.term && n.t16 === dragState.originalT16);

            if (mode === 'create' && hoverPreviewRef.current?.voiceId === voice.id && !onlyChords && !isDraggingAnchor) {
              const preview = hoverPreviewRef.current.point;
              // For create-mode hover, use the nearest visible tile to show the preview
              const previewWorldT = preview.t16 + kStart * loopLengthT;
              const px = wToX(previewWorldT);
              const py = preview.semi !== undefined
                ? semitoneToY(preview.semi, minSemitone, maxSemitone, gridTop, gridHeight)
                : degreeToY(preview.deg, preview.octave, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale);

              ctx.save();
              ctx.globalAlpha = 0.35;

              ctx.beginPath();
              ctx.arc(px, py, nodeRadius, 0, Math.PI * 2);
              ctx.fillStyle = nodeFillColor;
              ctx.fill();

              ctx.strokeStyle = nodeStrokeColor;
              ctx.lineWidth = 1.5;
              ctx.stroke();

              if (display.showNoteLabels) {
                const labelFontSize = Math.round(12 * display.noteSize);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                ctx.font = `bold ${labelFontSize}px system-ui`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                let previewLabel: string;
                if (preview.semi !== undefined) {
                  if (display.labelFormat === 'solfege') {
                    previewLabel = semitoneToSolfege(preview.semi);
                  } else if (display.labelFormat === 'noteName') {
                    previewLabel = semitoneToLetterName(preview.semi, arrangement.tonic || 'C', transposition);
                  } else {
                    previewLabel = semitoneToLabel(preview.semi);
                  }
                } else {
                  if (display.labelFormat === 'solfege') {
                    const semi = degreeToSemitoneOffset(preview.deg, 0, arrangement.scale);
                    previewLabel = semitoneToSolfege(semi);
                  } else if (display.labelFormat === 'noteName') {
                    const semi = degreeToSemitoneOffset(preview.deg, 0, arrangement.scale);
                    previewLabel = semitoneToLetterName(semi, arrangement.tonic || 'C', transposition);
                  } else {
                    previewLabel = String(preview.deg);
                  }
                }

                ctx.fillText(previewLabel, px, py + 0.5);
              }

              ctx.restore();
            }
          }
        }
      }
      ctx.restore();

      // Pop the clip rect.
      // ── Loop region overlay ──
      // Draw this AFTER contours/nodes so it dims them too.
      if (loopEnabledNow) {
        const loopStartX = wToX(loopStartNow);
        const loopEndX = wToX(loopEndNow);

        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';

        const dimLeftStart = gridLeft;
        const dimLeftEnd = Math.max(gridLeft, Math.min(gridLeft + gridWidth, loopStartX));
        if (dimLeftEnd > dimLeftStart) {
          ctx.fillRect(dimLeftStart, gridTop, dimLeftEnd - dimLeftStart, gridHeight);
        }

        const dimRightStart = Math.max(gridLeft, Math.min(gridLeft + gridWidth, loopEndX));
        const dimRightEnd = gridLeft + gridWidth;
        if (dimRightEnd > dimRightStart) {
          ctx.fillRect(dimRightStart, gridTop, dimRightEnd - dimRightStart, gridHeight);
        }
        ctx.restore();

        // Re-draw boundary lines on top so the handles remain obvious.
        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);

        if (loopStartX >= gridLeft && loopStartX <= gridLeft + gridWidth) {
          ctx.beginPath();
          ctx.moveTo(loopStartX, gridTop);
          ctx.lineTo(loopStartX, gridTop + gridHeight);
          ctx.stroke();
        }

        if (loopEndX >= gridLeft && loopEndX <= gridLeft + gridWidth) {
          ctx.beginPath();
          ctx.moveTo(loopEndX, gridTop);
          ctx.lineTo(loopEndX, gridTop + gridHeight);
          ctx.stroke();
        }

        ctx.restore();
      }

      // ── Marquee selection rectangle (Create mode only) ──
      // Drawn on top of everything so it's always visible.
      if (mode === 'create' && marqueeRef.current) {
        const mq = marqueeRef.current;
        const mqLeftPx = Math.min(mq.startX, mq.currentX) * dpr;
        const mqTopPx = Math.min(mq.startY, mq.currentY) * dpr;
        const mqW = Math.abs(mq.currentX - mq.startX) * dpr;
        const mqH = Math.abs(mq.currentY - mq.startY) * dpr;

        ctx.save();
        // Semi-transparent blue fill
        ctx.fillStyle = 'rgba(0, 180, 255, 0.12)';
        ctx.fillRect(mqLeftPx, mqTopPx, mqW, mqH);
        // Dashed cyan border
        ctx.strokeStyle = 'rgba(0, 200, 255, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(mqLeftPx, mqTopPx, mqW, mqH);
        ctx.setLineDash([]);
        ctx.restore();
      }

      ctx.restore();
    }

    // ── Lyrics lane (Play mode) ──
    // Draw AFTER the contour clip is restored so bottom-lane text is not clipped.
    // IMPORTANT:
    // App.tsx renders two Grid instances:
    // - hideChords=true  -> main contour layer (inside vertical fade mask)
    // - hideChords=false -> overlay lane used for chords (outside vertical fade mask)
    // Lyrics should live on the overlay lane so bottom text stays readable.
    if (!hideChords && mode === 'play' && display.showLyricsTrack && arrangement.lyrics?.enabled && voice1MelodyNodes.length > 0) {
      const lyricLaneHeight = 24;
      const lyricLaneBottom = 8;
      const lyricLaneTop = height - lyricLaneBottom - lyricLaneHeight;
      const lyricBaselineY = lyricLaneTop + lyricLaneHeight / 2 + 0.5;
      const voice1Id = arrangement.voices[0]?.id ?? null;

      // Match the node-flash timing so lyric flashes feel synchronized with note hits.
      const LYRIC_FLASH_ATTACK_MS = 35;
      const LYRIC_FLASH_DECAY_MS = 2000;

      // Determine the currently active lyric by playhead position.
      let activeLyricT16: number | null = null;
      if (isPlaying) {
        // In loop mode, wrap world time into one arrangement-length local lane.
        // In one-shot mode, clamp instead of wrapping so the final frame does not
        // briefly jump back to lyric #1 at the very end.
        const localPlayheadT16 = loopLengthT > 0
          ? (
            loopEnabled
              ? (((playheadWorldT % loopLengthT) + loopLengthT) % loopLengthT)
              : Math.max(0, Math.min(loopLengthT, playheadWorldT))
          )
          : playheadWorldT;

        for (const node of voice1MelodyNodes) {
          if (node.t16 > localPlayheadT16) break;
          const entry = lyricEntryByT16.get(node.t16);
          if (entry?.text) {
            activeLyricT16 = node.t16;
          }
        }
      }

      ctx.save();

      // Subtle lane baseline (sheet-music style guide line).
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gridLeft, lyricBaselineY);
      ctx.lineTo(gridLeft + gridWidth, lyricBaselineY);
      ctx.stroke();

      // Draw connector lines first so text sits cleanly on top.
      // Dash connectors stay adjacent. Hold connectors are rendered from
      // precomputed spans so they can cross multiple nodes and stop at anchors.
      for (let i = 0; i < voice1MelodyNodes.length - 1; i++) {
        const fromNode = voice1MelodyNodes[i];
        const toNode = voice1MelodyNodes[i + 1];
        const connector = lyricEntryByT16.get(fromNode.t16)?.connectorToNext;
        if (connector !== 'dash') continue;

        const fromWorldT = localT16ToNearestWorldT(fromNode.t16, loopLengthT, worldT);
        const toWorldT = localT16ToNearestWorldT(toNode.t16, loopLengthT, fromWorldT + (toNode.t16 - fromNode.t16));
        const x1 = wToX(fromWorldT);
        const x2 = wToX(toWorldT);

        if (Math.max(x1, x2) < gridLeft - 36 || Math.min(x1, x2) > gridLeft + gridWidth + 36) continue;

        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const mid = (left + right) / 2;
        const dashLength = Math.min(16, Math.max(7, (right - left) * 0.35));
        ctx.moveTo(mid - dashLength / 2, lyricBaselineY + 0.5);
        ctx.lineTo(mid + dashLength / 2, lyricBaselineY + 0.5);

        ctx.stroke();
        ctx.restore();
      }

      for (const span of lyricHoldSpans) {
        const startWorldT = localT16ToNearestWorldT(span.startT16, loopLengthT, worldT);
        const endWorldT = localT16ToNearestWorldT(span.endT16, loopLengthT, startWorldT + (span.endT16 - span.startT16));
        const x1 = wToX(startWorldT);
        const x2 = wToX(endWorldT);

        if (Math.max(x1, x2) < gridLeft - 36 || Math.min(x1, x2) > gridLeft + gridWidth + 36) continue;

        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const bubbleInset = 22;
        const lineStart = left + bubbleInset;
        const lineEnd = span.endAtAnchor ? right : (right - bubbleInset);
        if (lineEnd <= lineStart) continue;

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1.7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(lineStart, lyricBaselineY + 8);
        ctx.lineTo(lineEnd, lyricBaselineY + 8);
        ctx.stroke();
        ctx.restore();
      }

      // Render lyric tokens centered under their Voice 1 melody node.
      ctx.font = '600 13px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (const node of voice1MelodyNodes) {
        if (hiddenLyricNodeTimes.has(node.t16)) continue;
        const text = lyricEntryByT16.get(node.t16)?.text ?? '';
        if (!text) continue;

        const drawWorldT = localT16ToNearestWorldT(node.t16, loopLengthT, worldT);
        const x = wToX(drawWorldT);
        if (x < gridLeft - 36 || x > gridLeft + gridWidth + 36) continue;

        // Triggered flash comes from playback-engine note events (same source as node flashes).
        let flashIntensity = 0;
        if (voice1Id) {
          const flashKey = `${voice1Id}:${node.t16}`;
          const flashStartMs = nodeFlashStartMsRef.current.get(flashKey);
          const nowMs = window.performance.now();
          const flashAgeMs = flashStartMs !== undefined ? (nowMs - flashStartMs) : Infinity;

          if (flashAgeMs >= 0 && flashAgeMs <= (LYRIC_FLASH_ATTACK_MS + LYRIC_FLASH_DECAY_MS)) {
            if (flashAgeMs <= LYRIC_FLASH_ATTACK_MS) {
              flashIntensity = Math.max(0, Math.min(1, flashAgeMs / LYRIC_FLASH_ATTACK_MS));
            } else {
              const DECAY_K = 4;
              const decay01 = (flashAgeMs - LYRIC_FLASH_ATTACK_MS) / LYRIC_FLASH_DECAY_MS;
              flashIntensity = Math.exp(-DECAY_K * decay01);
            }
          }
        }

        const isActive = activeLyricT16 === node.t16;
        const highlightStrength = Math.max(isActive ? 0.45 : 0, flashIntensity);

        if (highlightStrength > 0.001) {
          ctx.save();
          const textAlpha = Math.min(1, 0.78 + highlightStrength * 0.22);
          const glowAlpha = Math.min(0.82, 0.24 + highlightStrength * 0.58);
          const glowBlur = 4 + highlightStrength * 10;

          ctx.fillStyle = `rgba(255, 250, 205, ${textAlpha})`;
          ctx.shadowColor = `rgba(255, 235, 140, ${glowAlpha})`;
          ctx.shadowBlur = glowBlur;
          ctx.fillText(text, x, lyricBaselineY);
          ctx.restore();
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
          ctx.fillText(text, x, lyricBaselineY);
        }
      }

      ctx.restore();
    }

    // Apply edge fades directly in-canvas for reliable cross-browser behavior.
    // We use destination-in so drawn content fades out toward transparent edges
    // without adding any dark overlay box on top of the artwork.
    {
      // Fade tuning (in CSS pixels):
      // - edgeClearPx: fully transparent strip at the edge
      // - fadePx: transition distance from transparent -> fully visible
      const sideFadePx = 80;
      const verticalFadePx = 80;
      const sideEdgeClearPx = 10;
      const verticalEdgeClearPx = 10;

      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';

      // Side fades (left/right): applied to BOTH layers so chord + lyric lanes
      // also fade smoothly at the horizontal edges.
      // Anchor horizontal fade to the visible grid bounds so it can fully fade
      // out exactly at the left/right edges of the grid area.
      const sideRatio = Math.min(0.49, sideFadePx / Math.max(1, gridWidth));
      const sideEdgePadRatio = Math.min(0.25, sideEdgeClearPx / Math.max(1, gridWidth));
      const sideSolidStart = Math.max(sideEdgePadRatio, sideRatio);
      const sideSolidEnd = Math.min(1 - sideEdgePadRatio, 1 - sideRatio);
      const sideGradient = ctx.createLinearGradient(gridLeft, 0, gridLeft + gridWidth, 0);
      sideGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      sideGradient.addColorStop(sideEdgePadRatio, 'rgba(0, 0, 0, 0)');
      sideGradient.addColorStop(sideSolidStart, 'rgba(0, 0, 0, 1)');
      sideGradient.addColorStop(sideSolidEnd, 'rgba(0, 0, 0, 1)');
      sideGradient.addColorStop(1 - sideEdgePadRatio, 'rgba(0, 0, 0, 0)');
      sideGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = sideGradient;
      ctx.fillRect(0, 0, width, height);

      // Vertical fades (top/bottom): applied only to the main grid layer.
      // The chord/lyric overlay should keep full vertical readability.
      if (!onlyChords) {
        // Anchor vertical fade to the visible grid bounds so top/bottom fade reaches
        // full transparency before the grid area ends.
        const verticalRatio = Math.min(0.49, verticalFadePx / Math.max(1, gridHeight));
        const verticalEdgePadRatio = Math.min(0.25, verticalEdgeClearPx / Math.max(1, gridHeight));
        const verticalSolidStart = Math.max(verticalEdgePadRatio, verticalRatio);
        const verticalSolidEnd = Math.min(1 - verticalEdgePadRatio, 1 - verticalRatio);
        const verticalGradient = ctx.createLinearGradient(0, gridTop, 0, gridTop + gridHeight);
        verticalGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        verticalGradient.addColorStop(verticalEdgePadRatio, 'rgba(0, 0, 0, 0)');
        verticalGradient.addColorStop(verticalSolidStart, 'rgba(0, 0, 0, 1)');
        verticalGradient.addColorStop(verticalSolidEnd, 'rgba(0, 0, 0, 1)');
        verticalGradient.addColorStop(1 - verticalEdgePadRatio, 'rgba(0, 0, 0, 0)');
        verticalGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = verticalGradient;
        ctx.fillRect(0, 0, width, height);
      }

      ctx.restore();
    }
  }, [arrangement, voiceStates, livePitchTrace, livePitchTraceVoiceId, display, recordings, armedVoiceId, selectedVoiceId, getPitchRange, hideChords, onlyChords, isRecording, followMode.pxPerT, followMode.pendingWorldT, cssColors, memoizedGridLines, mode, isPlaying, loopEnabled, loopStart, loopEnd, contourStackLookup, voice1MelodyNodes, lyricEntryByT16, lyricHoldSpans, hiddenLyricNodeTimes]);

  // Keep the latest draw() in a ref so the RAF loop never needs to restart.
  // Restarting the RAF effect on every state change can leak multiple loops,
  // which shows up as flicker (different stale closures drawing alternating frames).
  const drawRef = useRef(draw);

  // Smoothed visual world-time (in 16th notes).
  //
  // The PlaybackEngine's `getWorldPositionT16()` is derived from AudioContext.currentTime,
  // which advances in discrete audio-rendering quanta (~2.7ms at 48kHz). This quantization
  // causes the engine's world time to step unevenly between display frames, producing
  // visible micro-stutter even at a steady 60fps.
  //
  // To fix this we compute visual world time purely from the RAF timestamp (which is the
  // display clock and therefore perfectly smooth). We "anchor" to the engine's true world
  // time at playback start, then advance by `frameGapMs * t16PerMs` each frame. The engine
  // time is only re-read for drift detection and re-anchoring (seek, loop, tempo change).
  //
  // This ref is used ONLY for visuals (camera/playhead placement). It does NOT affect
  // audio scheduling, recording, or scrubbing.
  const visualWorldTRef = useRef<number | null>(null);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  // Animation loop for smooth playhead movement
  useEffect(() => {
    let animationId: number;

    // ── RAF-anchor state for smooth visual world time ──
    // We store a fixed anchor point (RAF timestamp + engine worldT) and compute the
    // visual position each frame as:
    //   visualWorldT = anchorWorldT + (ts - anchorRafTs) * t16PerMs
    // Because (ts - anchorRafTs) changes by exactly the frame gap each tick, the
    // resulting position is perfectly smooth (no audio-clock noise).
    let anchorRafTs: number | null = null; // RAF timestamp at anchor point (ms)
    let anchorWorldT: number = 0;          // Engine worldT at anchor point (t16)
    let anchorT16PerMs: number = 0;        // Sixteenth notes per millisecond at anchor
    let wasPlaying = false;                // Track play/pause transitions

    // How much of the drift between the RAF clock and the audio engine clock
    // we correct each frame. A tiny value (0.005 = 0.5%) spreads the correction
    // evenly across many frames so no single frame has a visible speed change.
    // At 60fps this gives a ~17ms time constant — fast enough to stay in sync
    // with the audio, slow enough to be invisible.
    const DRIFT_CORRECTION_FACTOR = 0.005;

    const animate = (ts: number) => {
      // ── Update visual world time (anchor-based, zero per-frame jitter) ──
      const state = useAppStore.getState();
      const p = state.playback;
      const arr = state.arrangement;

      // IMPORTANT:
      // During recording count-in, the STORE says "isPlaying" (so the UI can show
      // the active transport state), but the PlaybackEngine has NOT started its
      // audio-clock update loop yet.
      //
      // If we try to run the smooth follow-camera code while the engine is still
      // stationary, the RAF-based world time will advance and then repeatedly snap
      // back to the engine (which is stuck at 0). This looks like the grid is
      // "starting over and over" during count-in.
      //
      // Fix: treat count-in as "not playing" for VISUALS. The grid holds still
      // until the downbeat when the engine actually starts moving.
      const engineIsCountingIn = playbackEngine.getIsCountingIn();

      if (p.isPlaying && arr && !engineIsCountingIn) {
        // ── Fallback flash trigger (visual safety net) ──
        // If, for any reason, the engine-scheduled onNodeEvent callback is not
        // reaching this component, we still want node flashes to be visible.
        //
        // This uses the playhead crossing node times.
        const currentWorldT16 = playbackEngine.getWorldPositionT16();
        const nowMs = window.performance.now();

        const epsilon = 0.01;
        const lastWorld = lastFlashTriggerWorldT16Ref.current;
        let effectiveLastWorld = lastWorld === null ? (currentWorldT16 - epsilon) : lastWorld;

        // If the playhead jumped backwards (loop wrap), re-arm the range scan
        // from just before the loop start so nodes at loop start can flash again.
        if (currentWorldT16 < effectiveLastWorld) {
          const loopStartT16 = playbackEngine.getLoopStartT16();
          effectiveLastWorld = loopStartT16 - epsilon;
        }

        for (const voice of arr.voices) {
          for (const node of voice.nodes) {
            if (node.term) continue;
            if (node.t16 <= effectiveLastWorld || node.t16 > currentWorldT16) continue;
            const key = `${voice.id}:${node.t16}`;
            nodeFlashStartMsRef.current.set(key, nowMs);
          }
        }

        // Advance stored value for the next frame.
        lastFlashTriggerWorldT16Ref.current = currentWorldT16;

        const engineWorldT = playbackEngine.getWorldPositionT16();
        const effectiveTempo = playbackEngine.getEffectiveTempoBpm();
        // t16 per millisecond: (tempo BPM * 4 sixteenths/beat) / 60_000 ms/min
        const t16PerMs = effectiveTempo * 4 / 60_000;

        if (!wasPlaying || anchorRafTs === null) {
          // Playback just started (or first frame): anchor to the engine.
          anchorRafTs = ts;
          anchorWorldT = engineWorldT;
          anchorT16PerMs = t16PerMs;
          visualWorldTRef.current = engineWorldT;
        } else {
          // Compute purely from the RAF clock (perfectly smooth).
          const elapsedMs = ts - anchorRafTs;
          const rafWorldT = anchorWorldT + elapsedMs * anchorT16PerMs;

          // Check for discontinuities that require re-anchoring:
          // - Seek / scrub (large jump in engine time)
          // - Loop transition (engine loopCount changed, causing a worldT jump)
          // - Tempo change (t16PerMs changed)
          const drift = engineWorldT - rafWorldT;
          const tempoChanged = Math.abs(t16PerMs - anchorT16PerMs) > 1e-9;

          if (Math.abs(drift) > 1.0 || tempoChanged) {
            // Large discontinuity: snap to engine time immediately.
            anchorRafTs = ts;
            anchorWorldT = engineWorldT;
            anchorT16PerMs = t16PerMs;
            visualWorldTRef.current = engineWorldT;
          } else {
            // Normal frame: use RAF-derived time with continuous micro-correction.
            // The RAF clock (performance.now) and the audio clock (AudioContext.currentTime)
            // run on different hardware oscillators and drift apart over time.
            // Instead of correcting in one visible jump every N seconds, we nudge the
            // anchor by a tiny fraction of the drift EVERY frame. This spreads the
            // correction evenly so no single frame has a perceptible speed change.
            const corrected = rafWorldT + drift * DRIFT_CORRECTION_FACTOR;
            anchorRafTs = ts;
            anchorWorldT = corrected;
            visualWorldTRef.current = corrected;
          }
        }

        wasPlaying = true;
      } else {
        // Not playing: reset anchor so the next play starts fresh.
        wasPlaying = false;
        anchorRafTs = null;
        visualWorldTRef.current = null;

        // Reset fallback trigger so next play re-arms cleanly.
        lastFlashTriggerWorldT16Ref.current = null;
      }

      // ── Smart Cam: compute camera center for this frame ──
      // In Play mode while playing, the smart cam decides whether the camera
      // follows the playhead (follow states) or stays put (static states).
      // In Create mode or when paused, we fall back to existing behavior.
      const curState = useAppStore.getState();
      const curMode = curState.mode;
      const curPb = curState.playback;
      const curArr = curState.arrangement;
      const curFm = curState.followMode;

      if ((curMode === 'play' || curMode === 'create') && curPb.isPlaying && curArr && !playbackEngine.getIsCountingIn() && !onlyChords) {
        const playheadWorldT = visualWorldTRef.current ?? playbackEngine.getWorldPositionT16();
        const rect = containerRef.current?.getBoundingClientRect();
        const gridW = rect
          ? rect.width - GRID_MARGIN.left - GRID_MARGIN.right
          : curFm.viewportWidthPx;

        // Run one smart-cam step using the simplified interface.
        const prevCamera = getCameraCenterWorldT();
        const result = stepSmartCam(prevCamera, {
          cameraMode: curFm.cameraMode,
          freeLook: isFreeLook(),
          loopEnabled: curPb.loopEnabled,
          cameraCenterWorldT: prevCamera,
          playheadWorldT,
        });

        // Apply off-screen playhead snap (follow states only).
        const snapped = snapIfPlayheadOffscreen(
          result.state,
          result.cameraCenterWorldT,
          playheadWorldT,
          gridW,
          curFm.pxPerT,
        );

        smartCamStateRef.current = result.state;
        // Write to the single source of truth (module-level state).
        // Both main grid and chord overlay read from here — no throttling needed.
        setCameraCenterWorldT(snapped);

        // Update the React state that drives the "Jump to Playhead" button.
        // Only trigger a React re-render when the static/follow status actually changes.
        const nowStatic = isStaticState(result.state);
        if (nowStatic !== smartCamIsStaticRef.current) {
          smartCamIsStaticRef.current = nowStatic;
          setSmartCamIsStatic(nowStatic);
        }

        // If we re-enter a follow state, free-look is no longer needed.
        // (This prevents the Jump-to-Playhead pill from lingering.)
        if (!nowStatic && isFreeLook()) {
          setFreeLook(false);
          setFreeLookReact(false);
        }
      } else if ((curMode === 'play' || curMode === 'create') && curPb.isPlaying && playbackEngine.getIsCountingIn() && !onlyChords) {
        // During count-in we don't run the smart cam step, but we also don't
        // want the "Jump to Playhead" pill to linger from a previous static state.
        if (smartCamIsStaticRef.current) {
          smartCamIsStaticRef.current = false;
          setSmartCamIsStatic(false);
        }
      } else if ((curMode === 'play' || curMode === 'create') && !curPb.isPlaying && curArr && !onlyChords) {
        // Paused in Play mode: keep the camera wherever it currently is.
        // We still evaluate the smart cam state so the Jump-to-Playhead pill
        // appears/disappears correctly.
        const playheadWorldT = playbackEngine.getWorldPositionT16();

        const state = evaluateSmartCamState({
          cameraMode: curFm.cameraMode,
          freeLook: isFreeLook(),
          loopEnabled: curPb.loopEnabled,
          cameraCenterWorldT: getCameraCenterWorldT(),
          playheadWorldT,
        });

        // Keep smartCamStateRef in sync even while paused so the play-start
        // effect reads the correct state (e.g., if loop was toggled while paused).
        smartCamStateRef.current = state;

        const nowStatic = isStaticState(state);
        if (nowStatic !== smartCamIsStaticRef.current) {
          smartCamIsStaticRef.current = nowStatic;
          setSmartCamIsStatic(nowStatic);
        }
      }
      // (Create mode is handled separately inside draw() — unchanged.)

      drawRef.current();

      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, []);

  // Keep canvas metrics in sync with container size and devicePixelRatio.
  // - ResizeObserver covers container resizes from layout changes.
  // - window resize covers DPI changes from browser zoom / moving between monitors.
  useEffect(() => {
    updateCanvasMetrics();

    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      updateCanvasMetrics();
    });
    observer.observe(container);

    window.addEventListener('resize', updateCanvasMetrics);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateCanvasMetrics);
    };
  }, [updateCanvasMetrics]);

  /**
   * Handle canvas click.
   * In Create mode, placement is handled via mousedown/mouseup, so this is mostly a skip.
   * Shift+click delete has been REMOVED — use Delete/Backspace key instead.
   */
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // In Create mode, we commit placement on mouse-up (not on click),
    // so we skip the click handler to avoid double-adding nodes.
    if (skipNextClickRef.current) {
      skipNextClickRef.current = false;
      return;
    }

    // No click-based actions needed in Create or Play mode.
    // (Selection and placement are handled via mousedown/move/up.)
    void e;
  }, []);

  /**
   * Handle double-click to toggle termination status of a node.
   */
  const handleCanvasDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Only handle double-clicks in create mode
    if (mode !== 'create' || !arrangement) return;

    const container = containerRef.current;
    if (!container) return;

    const voiceId = selectedVoiceId || arrangement.voices[0]?.id;
    if (!voiceId) return;

    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const gridLeft = GRID_MARGIN.left;
    const gridTop = GRID_MARGIN.top;
    const gridWidth = width - GRID_MARGIN.left - GRID_MARGIN.right;
    const gridHeight = height - GRID_MARGIN.top - GRID_MARGIN.bottom;

    const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
    const startT16 = 0;
    const endT16 = totalT16;
    const { minSemitone, maxSemitone } = getPitchRange();

    const hit = getNodeHitAtMouseEvent(e, voiceId, startT16, endT16, gridLeft, gridTop, gridWidth, gridHeight, minSemitone, maxSemitone);
    if (hit) {
      // Double-clicking a node toggles anchor state.
      // When turning INTO an anchor, it must inherit the pitch of the previous note.
      if (!hit.term) {
        const voice = arrangement.voices.find((v) => v.id === voiceId);
        if (!voice) return;

        const previousNodes = voice.nodes
          .filter((n) => !n.term && n.t16 < hit.t16)
          .sort((a, b) => a.t16 - b.t16);

        const prev = previousNodes.length > 0 ? previousNodes[previousNodes.length - 1] : null;
        if (!prev) return;

        // Enforce: first note of a phrase can never be an anchor.
        // (No previous note => we returned above.)

        // This conversion creates an anchor at hit.t16 that ends the hold started at `prev`.
        // Only one anchor is allowed per held segment, and it must be the one closest to the note.
        const nextNoteAfterHit = voice.nodes
          .filter((n) => !n.term && n.t16 > hit.t16)
          .sort((a, b) => a.t16 - b.t16)[0];

        const segmentEndT16 = nextNoteAfterHit ? nextNoteAfterHit.t16 : Infinity;

        const existingAnchor = voice.nodes
          .filter((n) => n.term && n.t16 > prev.t16 && n.t16 < segmentEndT16)
          .sort((a, b) => a.t16 - b.t16)[0];

        // If an anchor already exists and it's closer (earlier) than this candidate,
        // do nothing. (Prevents creating "later" anchors that orphan the segment.)
        if (existingAnchor && existingAnchor.t16 < hit.t16) {
          return;
        }

        for (const n of voice.nodes) {
          if (!n.term) continue;
          if (n.t16 <= hit.t16) continue;
          if (n.t16 >= segmentEndT16) continue;
          removeNode(voiceId, n.t16);
        }

        updateNode(voiceId, hit.t16, hit.t16, prev.deg ?? 0, prev.octave ?? 0, true, prev.semi);
        return;
      }

      // Turning an anchor back into a normal node: keep its stored pitch.
      updateNode(voiceId, hit.t16, hit.t16, hit.deg ?? 0, hit.octave ?? 0, false, hit.semi);
      return;
    }

    // Double-clicking an empty grid point creates a termination (hold end) node.
    // We copy the pitch from the most recent node before that time.
    const snapped = getSnappedPointFromMouseEvent(e);
    if (!snapped) return;

    const voice = arrangement.voices.find((v) => v.id === voiceId);
    if (!voice) return;

    const previousNodes = voice.nodes
      .filter((n) => !n.term && n.t16 <= snapped.t16)
      .sort((a, b) => a.t16 - b.t16);

    const prev = previousNodes.length > 0 ? previousNodes[previousNodes.length - 1] : null;
    if (!prev) return;

    // Remove any later anchors between this parent note and the next note.
    // This ensures there is only one "end of hold" anchor for a held segment,
    // and inserting a closer anchor deletes the older one.
    const nextNote = voice.nodes
      .filter((n) => !n.term && n.t16 > prev.t16)
      .sort((a, b) => a.t16 - b.t16)[0];
    const segmentEndT16 = nextNote ? nextNote.t16 : Infinity;

    const existingAnchor = voice.nodes
      .filter((n) => n.term && n.t16 > prev.t16 && n.t16 < segmentEndT16)
      .sort((a, b) => a.t16 - b.t16)[0];

    // If an anchor already exists and this new one would be later, do nothing.
    // You can only "move" an anchor closer to the note (earlier), not farther away.
    if (existingAnchor && snapped.t16 > existingAnchor.t16) {
      return;
    }

    for (const n of voice.nodes) {
      if (!n.term) continue;
      if (n.t16 <= prev.t16) continue;
      if (n.t16 >= segmentEndT16) continue;
      // Keep only the earliest anchor in the segment.
      // If we're creating a new anchor at snapped.t16, any anchor AFTER it is superseded.
      if (n.t16 <= snapped.t16) continue;
      removeNode(voiceId, n.t16);
    }

    // Use updateNode to "insert" a term node at this time.
    // We pass deg/octave/semi of the previous note so the contour line holds visually.
    updateNode(voiceId, snapped.t16, snapped.t16, prev.deg ?? 0, prev.octave ?? 0, true, prev.semi);
  }, [mode, arrangement, selectedVoiceId, updateNode, removeNode, getPitchRange, getNodeHitAtMouseEvent, getSnappedPointFromMouseEvent]);

  /**
   * Handle mouse down for starting node drag in create mode,
   * or for starting a timeline scrub/drag in play mode.
   */
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!arrangement) return;

    // ── Middle-mouse button: ignore entirely — global pan handler in App.tsx handles it ──
    if (e.button === 1) return;

    // ── Loop handle drag: check if the user clicked near a loop boundary ──
    // Only active when loop is enabled and left-clicking.
    const pb = useAppStore.getState().playback;
    const loopEnabledNow = pb.loopEnabled;
    const loopStartNow = pb.loopStart;
    const loopEndNow = pb.loopEnd;

    if (loopEnabledNow && e.button === 0) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = e.clientX - rect.left;
        const gridLeftPx = GRID_MARGIN.left;
        const gridWidthPx = rect.width - GRID_MARGIN.left - GRID_MARGIN.right;

        // Compute screen X of the two loop boundaries.
        // In Play mode, use the smart-cam camera center (not the playhead)
        // so hit-testing is correct when the camera is in a static state.
        const pxPerTVal = followMode.pxPerT;
        const currentWorldT = followMode.pendingWorldT !== null
          ? followMode.pendingWorldT
          : getCameraCenterWorldT();
        const { loopStartX, loopEndX } = getLoopBoundaryScreenPositions({
          loopStartT: loopStartNow,
          loopEndT: loopEndNow,
          gridLeftPx,
          gridWidthPx,
          pxPerT: pxPerTVal,
          worldT: currentWorldT,
        });

        // Hit threshold in pixels for grabbing a loop handle
        const handleHitPx = 8;
        const nearestHandle = getNearestLoopHandle(mouseX, loopStartX, loopEndX, handleHitPx);

        if (nearestHandle) {
          loopHandleDragRef.current = nearestHandle;
          isHoveringLoopHandleRef.current = true;
          setIsHoveringLoopHandle(true);
          e.preventDefault();
          return;
        }
      }
    }

    // ── Right-click drag = horizontal pan in BOTH modes ──
    // Right-drag pans the camera along the timeline only.
    // Vertical pitch panning is done via scroll wheel.
    if (e.button === 2) {
      e.preventDefault();
      const camWorldT = getCameraCenterWorldT();

      panDragRef.current = {
        startX: e.clientX,
        startCameraWorldT: camWorldT,
      };

      // In Play mode, panning enters FREE_LOOK.
      // If we were in Follow mode, switch to Smart first so FREE_LOOK can apply.
      const curCameraMode = useAppStore.getState().followMode.cameraMode;
      if (curCameraMode === 'follow') {
        setCameraMode('smart');
      }
      setFreeLook(true);
      setFreeLookReact(true);
      return;
    }

    // ── Alt + left-click = seek/scrub (both modes) ──
    // Starts a drag that seeks the playhead on release.
    if (e.button === 0 && e.altKey) {
      e.preventDefault();
      const currentWorldT = playbackEngine.getWorldPositionT16();
      seekDragRef.current = { startX: e.clientX, startWorldT: currentWorldT };
      startTimelineDrag();
      updatePendingWorldT(currentWorldT);
      return;
    }

    // ── Play mode: deterministic click hit-testing (node first, contour second) ──
    if (mode === 'play') {
      if (e.button === 0) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          const gridLeftVal = GRID_MARGIN.left;
          const gridTopVal = GRID_MARGIN.top;
          const gridWidthVal = rect.width - GRID_MARGIN.left - GRID_MARGIN.right;
          const gridHeightVal = rect.height - GRID_MARGIN.top - GRID_MARGIN.bottom;
          const { minSemitone, maxSemitone } = getPitchRange();

          // 1) Node hit has priority over contour hit.
          // Clicking a node should audition only (no focus changes).
          const hitNode = getAnyNodeHitAtMouseEvent(
            e,
            gridLeftVal,
            gridTopVal,
            gridWidthVal,
            gridHeightVal,
            minSemitone,
            maxSemitone,
          );

          if (hitNode) {
            const { voiceId: hitVoiceId, node: hitNodeData } = hitNode;

            // Start audition for the clicked node.
            auditionRef.current = { voiceId: hitVoiceId };
            playbackEngine.previewSynthAttack(
              hitVoiceId,
              hitNodeData.deg ?? 0,
              hitNodeData.octave ?? 0,
              hitNodeData.semi,
            );
            return;
          }

          // 2) No node hit: test contour stroke and apply focus behavior.
          const hitVoiceId = getContourHitAtMouse(
            mouseX, mouseY, gridLeftVal, gridTopVal, gridWidthVal, gridHeightVal, minSemitone, maxSemitone
          );

          if (hitVoiceId) {
            // Shift+click = toggle membership (multi-focus)
            // Plain click = replace set with one focused voice
            if (e.shiftKey) {
              toggleFocus(hitVoiceId);
            } else {
              // Plain click in Play mode should also behave like a toggle when
              // this contour is already the ONLY focused voice.
              const focusedVoiceIds = useAppStore
                .getState()
                .voiceStates
                .filter((vs) => vs.synthSolo || vs.vocalSolo)
                .map((vs) => vs.voiceId);

              const isOnlyFocusedVoice =
                focusedVoiceIds.length === 1 && focusedVoiceIds[0] === hitVoiceId;

              if (isOnlyFocusedVoice) {
                clearAllFocus();
              } else {
                focusOnlyVoice(hitVoiceId);
              }
            }
            return;
          }

          // 3) Empty click: do nothing for focus state.
        }
      }
      return;
    }

    if (mode !== 'create') return;

    // If this is the second click of a double-click, don't start auditioning/placing.
    // The `onDoubleClick` handler will take care of the interaction.
    if (e.detail > 1) return;

    // We will handle Create mode placement via mouse down/move/up.
    // Prevent the older `onClick` handler from also firing.
    skipNextClickRef.current = true;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const gridLeft = GRID_MARGIN.left;
    const gridTopVal = GRID_MARGIN.top;
    const gridWidth = rect.width - GRID_MARGIN.left - GRID_MARGIN.right;
    const gridHeight = rect.height - GRID_MARGIN.top - GRID_MARGIN.bottom;
    const { minSemitone, maxSemitone } = getPitchRange();

    // Shared deterministic hit-test for Create mode interactions:
    // 1) node first
    // 2) contour second
    const editableVoiceId = selectedVoiceId || arrangement.voices[0]?.id;
    const hitResult = e.button === 0 && editableVoiceId
      ? getNodeHitAtMouseEvent(
        e,
        editableVoiceId,
        0,
        0,
        gridLeft,
        gridTopVal,
        gridWidth,
        gridHeight,
        minSemitone,
        maxSemitone,
      )
      : null;

    // In Create mode, contour focus is Shift+click only.
    // This avoids conflicts with left-click node placement on/near existing lines.
    if (e.button === 0 && e.shiftKey && !e.altKey && !hitResult) {
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const hitContourVoiceId = getContourHitAtMouse(
        mouseX,
        mouseY,
        gridLeft,
        gridTopVal,
        gridWidth,
        gridHeight,
        minSemitone,
        maxSemitone,
      );

      if (hitContourVoiceId) {
        // Shift+click in Create mode always toggles membership in the focus set.
        toggleFocus(hitContourVoiceId);
        return;
      }
    }

    // ── Precedence 3: Ctrl/Cmd + Left on empty → marquee selection ──
    if (e.button === 0 && (e.ctrlKey || e.metaKey) && !e.altKey) {
      // Check if there's a node under the mouse — if yes, fall through to node selection below.
      if (!hitResult) {
        // Start marquee selection.
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        marqueeRef.current = {
          startX: mx,
          startY: my,
          currentX: mx,
          currentY: my,
          additive: e.shiftKey,  // Ctrl+Shift = additive marquee
        };
        e.preventDefault();
        return;
      }
    }

    // ── Precedence 4: Left on node → selection + audition + potential drag ──
    // Check ALL voices for a node hit (not just the selected voice).
    if (hitResult && editableVoiceId && e.button === 0) {
      const hitKey = makeNodeKey(editableVoiceId, hitResult.t16);
      const currentSelection = useAppStore.getState().createView.selectedNodeKeys;
      const isAlreadySelected = currentSelection.has(hitKey);

      // Handle selection modifiers:
      if (e.shiftKey) {
        // Shift+click now toggles selection membership (add/remove).
        toggleNodeInSelection(hitKey);
      } else if (!isAlreadySelected) {
        // Plain click on unselected node: select only this one.
        selectNode(hitKey);
      }
      // If plain click on already-selected node: keep selection (for group drag).

      // Start audition for clicked regular notes only.
      // Anchors are purely timing controls and should not audition.
      if (!hitResult.term) {
        auditionRef.current = { voiceId: editableVoiceId };
        const attackDeg = hitResult.deg ?? 0;
        const attackOct = hitResult.octave ?? 0;
        const attackSemi = hitResult.semi;

        const attack = (deg: number, octave: number, semi?: number) => {
          playbackEngine.previewSynthAttack(editableVoiceId, deg, octave, semi);
        };

        if (AudioService.isReady()) {
          attack(attackDeg, attackOct, attackSemi);
        } else {
          pendingAuditionAttackRef.current = { voiceId: editableVoiceId, deg: attackDeg, octave: attackOct, semi: attackSemi };
          void ensureAudioAndEngineReadyForPreview().then(() => {
            const pending = pendingAuditionAttackRef.current;
            if (!pending) return;
            if (auditionRef.current?.voiceId !== pending.voiceId) return;
            attack(pending.deg, pending.octave, pending.semi);
          });
        }
      } else {
        const existingAudition = auditionRef.current;
        if (existingAudition) {
          playbackEngine.previewSynthRelease(existingAudition.voiceId);
          auditionRef.current = null;
        }
        pendingAuditionAttackRef.current = null;
      }

      // Determine if this starts a single-node drag or group drag.
      // Re-read selection after modifier logic above.
      const updatedSelection = useAppStore.getState().createView.selectedNodeKeys;

      if (updatedSelection.size > 1 && updatedSelection.has(hitKey)) {
        // Multiple nodes selected and we clicked on one of them → group drag.
        groupDragRef.current = {
          startMouseX: e.clientX,
          startMouseY: e.clientY,
          lastDeltaT16: 0,
          lastDeltaSemi: 0,
        };
        placingNewNodeRef.current = null;
        return;
      }

      // Single-node drag (existing behavior for anchors and regular nodes).
      if (hitResult.term) {
        const voice = arrangement.voices.find((v) => v.id === editableVoiceId);
        const parent = voice?.nodes
          .filter((n) => !n.term && n.t16 < hitResult.t16)
          .sort((a, b) => a.t16 - b.t16)
          .pop();
        if (!parent) return;
        setDragState({ voiceId: editableVoiceId, originalT16: hitResult.t16, isDragging: true, anchorParentT16: parent.t16 });
      } else {
        setDragState({ voiceId: editableVoiceId, originalT16: hitResult.t16, isDragging: true });
      }
      placingNewNodeRef.current = null;
      return;
    }

    // ── Precedence 5: Left on empty (no modifiers) ──
    if (e.button === 0) {
      const currentSelection = useAppStore.getState().createView.selectedNodeKeys;

      if (currentSelection.size > 1) {
        // Multi-selection exists → clear only (first click cancels group selection).
        clearNodeSelection();
        return;
      }

      // If only one node was selected, clear and allow immediate placement
      // on this same click (no extra deselect click required).
      if (currentSelection.size === 1) {
        clearNodeSelection();
      }

      // No selection exists → place node (existing behavior).
      const snapped = getSnappedPointFromMouseEvent(e);
      if (!snapped) return;

      const voiceId = selectedVoiceId || arrangement.voices[0]?.id;
      if (!voiceId) return;

      if (!selectedVoiceId) {
        setSelectedVoiceId(voiceId);
      }

      hoverPreviewRef.current = { voiceId, point: snapped };

      // Start audition for the new note.
      auditionRef.current = { voiceId };
      const attack = (deg: number, octave: number, semi?: number) => {
        playbackEngine.previewSynthAttack(voiceId, deg, octave, semi);
      };

      if (AudioService.isReady()) {
        attack(snapped.deg, snapped.octave, snapped.semi);
      } else {
        pendingAuditionAttackRef.current = { voiceId, deg: snapped.deg, octave: snapped.octave, semi: snapped.semi };
        void ensureAudioAndEngineReadyForPreview().then(() => {
          const pending = pendingAuditionAttackRef.current;
          if (!pending) return;
          if (auditionRef.current?.voiceId !== pending.voiceId) return;
          attack(pending.deg, pending.octave, pending.semi);
        });
      }

      placingNewNodeRef.current = { voiceId, point: snapped };
    }
  }, [mode, arrangement, selectedVoiceId, getSnappedPointFromMouseEvent, setSelectedVoiceId, getPitchRange, getNodeHitAtMouseEvent, getAnyNodeHitAtMouseEvent, selectNode, toggleNodeInSelection, clearNodeSelection, toggleFocus, focusOnlyVoice, getContourHitAtMouse]);

  /**
   * Handle mouse move for dragging nodes (Create mode)
   * or scrubbing the timeline (Play mode).
   */
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!arrangement) return;

    // Keep Shift state in sync with the live pointer event.
    // This gives immediate cursor updates while moving the mouse.
    setIsShiftHeld(e.shiftKey);

    const pb = useAppStore.getState().playback;
    const loopEnabledNow = pb.loopEnabled;
    const loopStartNow = pb.loopStart;
    const loopEndNow = pb.loopEnd;

    // ── Loop handle hover detection (for cursor only) ──
    // We update this for both Play + Create modes.
    // IMPORTANT: only commit state updates when the boolean changes to avoid
    // forcing a React re-render on every mousemove.
    if (loopEnabledNow && !loopHandleDragRef.current) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = e.clientX - rect.left;
        const gridLeftPx = GRID_MARGIN.left;
        const gridWidthPx = rect.width - GRID_MARGIN.left - GRID_MARGIN.right;
        const pxPerTVal = followMode.pxPerT;

        // In Play mode, the camera center may differ from the playhead
        // (smart-cam static states), so read from the ref.
        const currentWorldT = followMode.pendingWorldT !== null
          ? followMode.pendingWorldT
          : getCameraCenterWorldT();

        const { loopStartX, loopEndX } = getLoopBoundaryScreenPositions({
          loopStartT: loopStartNow,
          loopEndT: loopEndNow,
          gridLeftPx,
          gridWidthPx,
          pxPerT: pxPerTVal,
          worldT: currentWorldT,
        });

        const handleHitPx = 8;
        const hovering = isMouseNearLoopHandle(mouseX, loopStartX, loopEndX, handleHitPx);

        if (hovering !== isHoveringLoopHandleRef.current) {
          isHoveringLoopHandleRef.current = hovering;
          setIsHoveringLoopHandle(hovering);
        }
      }
    } else if (!loopEnabledNow) {
      if (isHoveringLoopHandleRef.current) {
        isHoveringLoopHandleRef.current = false;
        setIsHoveringLoopHandle(false);
      }
    }

    // ── Loop handle drag: snap the dragged boundary to the nearest 16th note ──
    if (loopHandleDragRef.current && loopEnabledNow) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = e.clientX - rect.left;
        const gridLeftPx = GRID_MARGIN.left;
        const gridWidthPx = rect.width - GRID_MARGIN.left - GRID_MARGIN.right;

        const pxPerTVal = followMode.pxPerT;
        // Use the smart-cam camera center in Play mode so the drag
        // maps to the correct world time even in static camera states.
        const currentWorldT = followMode.pendingWorldT !== null
          ? followMode.pendingWorldT
          : getCameraCenterWorldT();
        const arrangementLen = arrangement.bars * arrangement.timeSig.numerator * 4;
        // Convert mouse X to time and snap to the nearest 16th note.
        const snappedT = getSnappedLoopTimeFromMouseX({
          mouseX,
          gridLeftPx,
          gridWidthPx,
          pxPerT: pxPerTVal,
          worldT: currentWorldT,
          arrangementLengthT16: arrangementLen,
        });

        if (loopHandleDragRef.current === 'start') {
          // Don't let start go past end - 1
          const newStart = Math.min(snappedT, loopEndNow - 1);
          setLoopPoints(newStart, loopEndNow);
        } else {
          // Don't let end go before start + 1
          const newEnd = Math.max(snappedT, loopStartNow + 1);
          setLoopPoints(loopStartNow, newEnd);
        }
      }
      return;
    }

    // ── Right-click horizontal pan drag (both Create and Play modes) ──
    if (panDragRef.current) {
      const dx = e.clientX - panDragRef.current.startX;

      // Dragging left → camera moves forward in time (positive delta)
      const dT = dragPixelsToTimeDelta(dx, followMode.pxPerT);
      const newCameraWorldT = Math.max(0, panDragRef.current.startCameraWorldT + dT);

      // Shared camera in both modes
      setCameraCenterWorldT(newCameraWorldT);
      return;
    }

    // ── Seek drag (Alt+left-click, both modes) ──
    if (followMode.isDraggingTimeline && seekDragRef.current) {
      const dx = e.clientX - seekDragRef.current.startX;
      // Dragging left → time moves forward (positive delta)
      const dT = dragPixelsToTimeDelta(dx, followMode.pxPerT);
      const newWorldT = Math.max(0, seekDragRef.current.startWorldT + dT);
      updatePendingWorldT(newWorldT);
      return;
    }

    // ── Play/Create modes: detect contour hover for interactive contour emphasis ──
    if ((mode === 'play' || mode === 'create') && !followMode.isDraggingTimeline) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const gridLeft = GRID_MARGIN.left;
        const gridTop = GRID_MARGIN.top;
        const gridWidth = rect.width - GRID_MARGIN.left - GRID_MARGIN.right;
        const gridHeight = rect.height - GRID_MARGIN.top - GRID_MARGIN.bottom;
        const { minSemitone, maxSemitone } = getPitchRange();

        // Rainbow-stack inspect mode: allow contour hover in both Play and Create.
        // This lets users reveal temporary split stacks just by hovering.
        const allowContourHover = true;

        // Node hit has priority over contour hover in BOTH modes.
        // If the pointer is inside a node hit-radius, suppress contour hover hint.
        const hitNode = getAnyNodeHitAtMouseEvent(
          e,
          gridLeft,
          gridTop,
          gridWidth,
          gridHeight,
          minSemitone,
          maxSemitone,
        );

        if (!allowContourHover || hitNode) {
          hoveredContourVoiceIdRef.current = null;
        } else {
          // Update the hovered contour ref — the draw loop reads this every frame
          hoveredContourVoiceIdRef.current = getContourHitAtMouse(
            mouseX, mouseY, gridLeft, gridTop, gridWidth, gridHeight, minSemitone, maxSemitone
          );
        }
      }
    }

    if (mode !== 'create') return;

    // ── Marquee drag update ──
    if (marqueeRef.current) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        marqueeRef.current.currentX = e.clientX - rect.left;
        marqueeRef.current.currentY = e.clientY - rect.top;
      }
      return; // Don't process other Create mode interactions during marquee.
    }

    // ── Group drag update ──
    if (groupDragRef.current) {
      const gd = groupDragRef.current;
      const { minSemitone, maxSemitone } = getPitchRange();
      const gridHeightPx = (containerRef.current?.getBoundingClientRect()?.height ?? 600) - GRID_MARGIN.top - GRID_MARGIN.bottom;
      const { newDeltaT16, newDeltaSemi, incrT16, incrSemi } = getGroupDragDelta({
        startMouseX: gd.startMouseX,
        startMouseY: gd.startMouseY,
        currentMouseX: e.clientX,
        currentMouseY: e.clientY,
        lastDeltaT16: gd.lastDeltaT16,
        lastDeltaSemi: gd.lastDeltaSemi,
        pxPerT: followMode.pxPerT,
        minSemitone,
        maxSemitone,
        gridHeightPx,
      });

      if (incrT16 !== 0 || incrSemi !== 0) {
        if (!hasPushedDragHistoryRef.current) {
          pushHistoryCheckpoint();
          hasPushedDragHistoryRef.current = true;
        }
        moveSelectedNodes(incrT16, incrSemi, { recordHistory: false });
        gd.lastDeltaT16 = newDeltaT16;
        gd.lastDeltaSemi = newDeltaSemi;
      }
      return; // Don't process other Create mode interactions during group drag.
    }

    const snapped = getSnappedPointFromMouseEvent(e);
    if (!snapped) {
      hoverPreviewRef.current = null;
      setIsHoveringNode(false);
      setIsHoveringSelectedNode(false);
      return;
    }

    // Determine voice to preview - use selected voice or first voice.
    const voiceId = selectedVoiceId || arrangement.voices[0]?.id;
    if (!voiceId) return;

    // If we're dragging an anchor, suppress phantom placement previews.
    if (dragState?.isDragging) {
      const voice = arrangement.voices.find((v) => v.id === dragState.voiceId);
      const originalNode = voice?.nodes.find((n) => n.t16 === dragState.originalT16);
      if (originalNode?.term) {
        hoverPreviewRef.current = null;
      }
    }

    if (!dragState?.isDragging) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const width = rect.width;
        const height = rect.height;

        const gridLeft = GRID_MARGIN.left;
        const gridTop = GRID_MARGIN.top;
        const gridWidth = width - GRID_MARGIN.left - GRID_MARGIN.right;
        const gridHeight = height - GRID_MARGIN.top - GRID_MARGIN.bottom;

        const { minSemitone, maxSemitone } = getPitchRange();
        const editableVoiceId = selectedVoiceId || arrangement.voices[0]?.id;
        const hit = editableVoiceId
          ? getNodeHitAtMouseEvent(
            e,
            editableVoiceId,
            0,
            0,
            gridLeft,
            gridTop,
            gridWidth,
            gridHeight,
            minSemitone,
            maxSemitone,
          )
          : null;
        setIsHoveringNode(!!hit);

        if (hit) {
          const hitKey = makeNodeKey(editableVoiceId, hit.t16);
          setIsHoveringSelectedNode(selectedNodeKeys.has(hitKey));
        } else {
          setIsHoveringSelectedNode(false);
        }
      }
    }

    // While Shift is held in Create mode, disable ghost placement previews.
    if (e.shiftKey && !dragState?.isDragging) {
      hoverPreviewRef.current = null;
      return;
    }

    // While a group selection is active, hide placement ghost until the group
    // is explicitly cleared by a click on empty space.
    if (selectedNodeKeys.size > 1 && !dragState?.isDragging && !placingNewNodeRef.current) {
      hoverPreviewRef.current = null;
      return;
    }

    // Update hover preview (phantom node) only when not dragging an anchor.
    if (!dragState?.isDragging) {
      hoverPreviewRef.current = { voiceId, point: snapped };
    }

    // If the mouse is held down, glide the preview synth pitch.
    // Anchors should not audition during drag.
    const draggedVoice = dragState?.isDragging
      ? arrangement.voices.find((v) => v.id === dragState.voiceId)
      : null;
    const draggedNode = dragState?.isDragging
      ? draggedVoice?.nodes.find((n) => n.t16 === dragState.originalT16)
      : null;
    const isDraggingAnchor = !!dragState?.isDragging && !!draggedNode?.term;

    if (!isDraggingAnchor && auditionRef.current?.voiceId === voiceId) {
      // If we are dragging an anchor, preview pitch should not change vertically.
      if (dragState?.isDragging) {
        const voice = arrangement.voices.find((v) => v.id === dragState.voiceId);
        const originalNode = voice?.nodes.find((n) => n.t16 === dragState.originalT16);
        if (originalNode?.term) {
          playbackEngine.previewSynthGlide(voiceId, originalNode.deg ?? 0, originalNode.octave || 0, originalNode.semi);
        } else {
          playbackEngine.previewSynthGlide(voiceId, snapped.deg, snapped.octave, snapped.semi);
        }
      } else {
        playbackEngine.previewSynthGlide(voiceId, snapped.deg, snapped.octave, snapped.semi);
      }
    }

    // If we're dragging an existing node, update it to the snapped position.
    if (dragState?.isDragging) {
      const voice = arrangement.voices.find((v) => v.id === dragState.voiceId);
      const originalNode = voice?.nodes.find((n) => n.t16 === dragState.originalT16);

      if (originalNode?.term) {
        // Anchors can move in time only (no pitch changes).
        const parentT16 = dragState.anchorParentT16;

        // Anchor must stay to the right of its parent note by at least one 16th.
        const minT16 = parentT16 !== undefined ? parentT16 + 1 : snapped.t16;

        // Anchor cannot be dragged past (or onto) the next real note after its parent.
        // Find the next non-term node after the parent note.
        const nextNoteAfterParent = voice?.nodes
          .filter((n) => !n.term && n.t16 > (parentT16 ?? 0))
          .sort((a, b) => a.t16 - b.t16)[0];
        const maxT16 = nextNoteAfterParent ? nextNoteAfterParent.t16 - 1 : Infinity;

        const clampedT16 = Math.min(Math.max(snapped.t16, minT16), maxT16);

        if (clampedT16 === dragState.originalT16) {
          return;
        }

        if (!hasPushedDragHistoryRef.current) {
          pushHistoryCheckpoint();
          hasPushedDragHistoryRef.current = true;
        }

        updateNode(
          dragState.voiceId,
          dragState.originalT16,
          clampedT16,
          originalNode.deg ?? 0,
          originalNode.octave || 0,
          true,
          originalNode.semi,
          { recordHistory: false },
        );
        setDragState({ ...dragState, originalT16: clampedT16 });
        return;
      }

      // Prevent node-overwrite on drag: keep at least one 16th-note gap from
      // the IMMEDIATE neighboring nodes around the dragged node's current time.
      //
      // Important: bounds must be based on the current node position
      // (dragState.originalT16), not the mouse-snapped target, otherwise fast
      // drags can jump across a neighbor and overwrite it.
      const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
      const otherTimes = (voice?.nodes ?? [])
        .filter((n) => n.t16 !== dragState.originalT16)
        .map((n) => n.t16)
        .sort((a, b) => a - b);

      const prev = [...otherTimes].reverse().find((t) => t < dragState.originalT16);
      const next = otherTimes.find((t) => t > dragState.originalT16);

      const minT16 = prev !== undefined ? prev + 1 : 0;
      const maxT16 = next !== undefined ? next - 1 : totalT16;
      const clampedT16 = minT16 <= maxT16
        ? Math.max(minT16, Math.min(maxT16, snapped.t16))
        : dragState.originalT16;

      const pitchUnchanged =
        (originalNode?.semi !== undefined && originalNode.semi === snapped.semi)
        || (
          originalNode?.semi === undefined
          && originalNode?.deg === snapped.deg
          && (originalNode?.octave || 0) === snapped.octave
        );

      if (clampedT16 === dragState.originalT16 && pitchUnchanged) {
        return;
      }

      if (!hasPushedDragHistoryRef.current) {
        pushHistoryCheckpoint();
        hasPushedDragHistoryRef.current = true;
      }

      updateNode(
        dragState.voiceId,
        dragState.originalT16,
        clampedT16,
        snapped.deg,
        snapped.octave,
        originalNode?.term,
        snapped.semi,
        { recordHistory: false },
      );
      setDragState({ ...dragState, originalT16: clampedT16 });
      return;
    }

    // If we're placing a NEW node, keep updating its target position until mouse-up commits.
    // (But do NOT do this while dragging an anchor.)
    if (!dragState?.isDragging && placingNewNodeRef.current?.voiceId === voiceId) {
      placingNewNodeRef.current = { voiceId, point: snapped };
    }
  }, [dragState, mode, arrangement, getSnappedPointFromMouseEvent, updateNode, selectedVoiceId, getPitchRange, getAnyNodeHitAtMouseEvent, moveSelectedNodes, followMode.pxPerT, selectedNodeKeys, pushHistoryCheckpoint]);

  /**
   * Handle mouse up to end drag.
   * In Play mode this commits the scrub (seek-on-release).
   * In Create mode this commits a new node placement, ends a node drag,
   * commits marquee selection, or ends a group drag.
   */
  const handleMouseUp = useCallback(() => {
    // ── Loop handle drag: release the boundary handle ──
    if (loopHandleDragRef.current) {
      loopHandleDragRef.current = null;
      isHoveringLoopHandleRef.current = false;
      setIsHoveringLoopHandle(false);
      return;
    }

    // ── Play mode: end a static-state pan drag (no transport change) ──
    if (panDragRef.current) {
      panDragRef.current = null;
      return;
    }

    // ── Play mode: commit the timeline scrub (seek-on-release) ──
    if (followMode.isDraggingTimeline) {
      const pending = followMode.pendingWorldT;
      if (pending !== null) {
        playbackEngine.seekWorld(pending);
        setCameraCenterWorldT(pending);
        smartCamStateRef.current = 'FOLLOW_CENTER';
        smartCamIsStaticRef.current = false;
        setSmartCamIsStatic(false);
      }
      commitTimelineDrag();
      seekDragRef.current = null;
      return;
    }

    // ── Marquee selection commit ──
    if (marqueeRef.current && arrangement) {
      const mq = marqueeRef.current;
      marqueeRef.current = null;

      // Convert the marquee rectangle (CSS px) into world time + pitch bounds.
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const gridLeftPx = GRID_MARGIN.left;
        const gridTopPx = GRID_MARGIN.top;
        const gridWidthPx = rect.width - GRID_MARGIN.left - GRID_MARGIN.right;
        const gridHeightPx = rect.height - GRID_MARGIN.top - GRID_MARGIN.bottom;

        const pxPerTVal = followMode.pxPerT;
        const currentWorldT = followMode.pendingWorldT !== null
          ? followMode.pendingWorldT
          : getCameraCenterWorldT();
        const camLeft = cameraLeftWorldT(currentWorldT, gridWidthPx, pxPerTVal);

        // Marquee bounds in CSS px (relative to container).
        const mqLeft = Math.min(mq.startX, mq.currentX);
        const mqRight = Math.max(mq.startX, mq.currentX);
        const mqTop = Math.min(mq.startY, mq.currentY);
        const mqBottom = Math.max(mq.startY, mq.currentY);

        const { minSemitone, maxSemitone } = getPitchRange();

        // Find all nodes whose screen position falls inside the marquee rect.
        const hitKeys = new Set<NodeKey>();
        const editableVoiceId = selectedVoiceId || arrangement.voices[0]?.id;
        const editableVoice = editableVoiceId
          ? arrangement.voices.find((v) => v.id === editableVoiceId)
          : null;

        if (editableVoice) {
          for (const node of editableVoice.nodes) {
            const nodeWorldT = node.t16;
            const x = gridLeftPx + worldTToScreenX(nodeWorldT, camLeft, pxPerTVal);
            const y = node.semi !== undefined
              ? semitoneToY(node.semi, minSemitone, maxSemitone, gridTopPx, gridHeightPx)
              : degreeToY(node.deg ?? 0, node.octave || 0, minSemitone, maxSemitone, gridTopPx, gridHeightPx, arrangement.scale);

            if (x >= mqLeft && x <= mqRight && y >= mqTop && y <= mqBottom) {
              hitKeys.add(makeNodeKey(editableVoice.id, node.t16));
            }
          }
        }

        if (mq.additive) {
          // Ctrl+Shift+drag: union with existing selection.
          addNodesToSelection(hitKeys);
        } else {
          // Ctrl+drag: replace selection with marquee result.
          setNodeSelection(hitKeys);
        }
      }
      return;
    }

    // ── Group drag end ──
    if (groupDragRef.current) {
      groupDragRef.current = null;
      // Stop any audition note.
      const audition = auditionRef.current;
      if (audition) {
        playbackEngine.previewSynthRelease(audition.voiceId);
        auditionRef.current = null;
      }
      pendingAuditionAttackRef.current = null;
      hasPushedDragHistoryRef.current = false;
      return;
    }

    // Commit a new node placement (if we were placing one).
    const placing = placingNewNodeRef.current;
    if (placing && mode === 'create') {
      const voice = arrangement?.voices.find((v) => v.id === placing.voiceId);
      const existingAnchorAtT = voice?.nodes.find((n) => n.t16 === placing.point.t16 && n.term);

      // If there's an anchor at this time, you must convert/delete it first.
      if (!existingAnchorAtT) {
        addNode(placing.voiceId, placing.point.t16, placing.point.deg, placing.point.octave, placing.point.semi);
      }
    }

    placingNewNodeRef.current = null;

    if (dragState?.isDragging) {
      setDragState(null);
    }

    hasPushedDragHistoryRef.current = false;

    // Stop any audition note.
    const audition = auditionRef.current;
    if (audition) {
      playbackEngine.previewSynthRelease(audition.voiceId);
      auditionRef.current = null;
    }

    pendingAuditionAttackRef.current = null;
  }, [dragState, mode, addNode, arrangement, followMode.isDraggingTimeline, followMode.pendingWorldT, commitTimelineDrag, followMode.pxPerT, getPitchRange, selectedVoiceId, setNodeSelection, addNodesToSelection]);

  // Follow-mode horizontal zoom action from the store
  const setHorizontalZoom = useAppStore((state) => state.setHorizontalZoom);
  const setPxPerT = useAppStore((state) => state.setPxPerT);
  const setMinPxPerT = useAppStore((state) => state.setMinPxPerT);
  const setFollowViewportWidthPx = useAppStore((state) => state.setFollowViewportWidthPx);
  const setZoomLevel = useAppStore((state) => state.setZoomLevel);

  /**
   * Keep the store's minPxPerT floor in sync with the current grid width and arrangement.
   * This ensures max zoom-out can show up to 2 full loops worth of time.
   * Called on mount, resize, and arrangement change.
   */
  useEffect(() => {
    const updateFloor = () => {
      if (!arrangement) return;
      const container = containerRef.current;
      if (!container) return;
      const gridW = container.getBoundingClientRect().width - GRID_MARGIN.left - GRID_MARGIN.right;
      const loopLenT = arrangement.bars * arrangement.timeSig.numerator * 4;
      if (loopLenT <= 0) return;
      // Store the true viewport width so the minimap can compute the viewport rectangle accurately.
      setFollowViewportWidthPx(gridW);

      // Allow zooming out further than "fit 1 loop" by setting the zoom-out floor to "fit 2 loops".
      setMinPxPerT(gridW / (loopLenT * 2));
    };
    updateFloor();
    window.addEventListener('resize', updateFloor);
    return () => window.removeEventListener('resize', updateFloor);
  }, [arrangement, setMinPxPerT, setFollowViewportWidthPx]);

  useEffect(() => {
    // Auto-fit on arrangement load in both Play and Create modes.
    // (Continuous "zoom while editing" behavior is handled elsewhere.)
    if (mode !== 'play' && mode !== 'create') return;
    if (!arrangement) return;
    const container = containerRef.current;
    if (!container) return;
    const gridW = container.getBoundingClientRect().width - GRID_MARGIN.left - GRID_MARGIN.right;
    const loopLenT = arrangement.bars * arrangement.timeSig.numerator * 4;
    if (gridW <= 0 || loopLenT <= 0) return;
    setPxPerT(gridW / loopLenT);
  }, [mode, arrangement?.id, setPxPerT]);

  useEffect(() => {
    if (mode !== 'play') return;
    if (!arrangement) return;

    let cancelled = false;

    const tryFit = () => {
      if (cancelled) return;
      const container = containerRef.current;
      if (!container) {
        window.requestAnimationFrame(tryFit);
        return;
      }

      const gridW = container.getBoundingClientRect().width - GRID_MARGIN.left - GRID_MARGIN.right;
      const loopLenT = arrangement.bars * arrangement.timeSig.numerator * 4;
      if (gridW <= 0 || loopLenT <= 0) {
        window.requestAnimationFrame(tryFit);
        return;
      }

      // Keep the minimap in sync with the true grid viewport width.
      setFollowViewportWidthPx(gridW);

      // Zoom-out floor: allow up to 2 loops visible.
      setMinPxPerT(gridW / (loopLenT * 2));
      setPxPerT(gridW / loopLenT);
    };

    tryFit();
    return () => {
      cancelled = true;
    };
  }, [mode, arrangement?.id, setMinPxPerT, setPxPerT, setFollowViewportWidthPx]);

  /**
   * Handle mouse wheel for horizontal zoom.
   * Scrolling up (or pinch-out) zooms in, scrolling down zooms out.
   * Uses Shift as the modifier key to avoid conflicting with browser Ctrl+scroll zoom.
   */
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!arrangement) return;

    // In Create mode we support scroll/pan/zoom without stealing left-click.
    // We treat the wheel as a navigation control and prevent the page from scrolling.
    if (mode !== 'create') {
      // Play mode:
      // - Shift+Wheel: horizontal zoom
      // - Alt+Shift+Wheel: vertical zoom
      // - Wheel: vertical pitch pan
      // - Alt+Wheel or horizontal wheel: time pan (scrub)
      if (e.shiftKey && e.altKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const next = Math.max(0.25, Math.min(6, display.zoomLevel * factor));
        setZoomLevel(next);
        return;
      }

      if (e.shiftKey) {
        e.preventDefault();
        if (e.deltaY < 0) setHorizontalZoom('in');
        if (e.deltaY > 0) setHorizontalZoom('out');
        return;
      }

      // Alt (or trackpad horizontal scroll) pans camera horizontally.
      // This enters FREE_LOOK so the smart cam stops auto-following.
      const wantsHorizontalPan = e.altKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (wantsHorizontalPan) {
        e.preventDefault();
        const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        const dT = dragPixelsToTimeDelta(delta, followMode.pxPerT);
        const currentCam = getCameraCenterWorldT();
        setCameraCenterWorldT(Math.max(0, currentCam + dT));
        // Panning enters FREE_LOOK.
        // If we were in Follow mode, switch to Smart first so FREE_LOOK can apply.
        const curCameraMode = useAppStore.getState().followMode.cameraMode;
        if (curCameraMode === 'follow') {
          setCameraMode('smart');
        }
        setFreeLook(true);
        setFreeLookReact(true);
        return;
      }

      // Default: vertical pitch pan (Play mode uses its own store).
      e.preventDefault();
      const semitonesPerWheel = 0.03;
      adjustPlayPitchPanSemitones(e.deltaY * semitonesPerWheel);
      return;
    }

    // Create mode:
    // - Wheel: vertical pan (pitch)
    // - Alt+Wheel: horizontal pan (time)
    // - Shift+Wheel: horizontal zoom
    // - Alt+Shift+Wheel: vertical zoom (pitch zoom)

    // Vertical zoom uses Alt+Shift so we don't fight the browser Ctrl+wheel zoom.
    if (e.shiftKey && e.altKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = Math.max(0.25, Math.min(6, display.zoomLevel * factor));
      setZoomLevel(next);
      return;
    }

    if (e.shiftKey) {
      e.preventDefault();
      if (e.deltaY < 0) setHorizontalZoom('in');
      if (e.deltaY > 0) setHorizontalZoom('out');
      return;
    }

    // Alt (or trackpad horizontal scroll) pans time.
    const wantsHorizontalPan = e.altKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (wantsHorizontalPan) {
      e.preventDefault();
      const dT = dragPixelsToTimeDelta(e.deltaX, followMode.pxPerT);
      const nextCam = Math.max(0, getCameraCenterWorldT() + dT);
      setCameraCenterWorldT(nextCam);
      return;
    }

    // Default: vertical pan in semitone space.
    e.preventDefault();
    const semitonesPerWheel = 0.03;
    adjustPlayPitchPanSemitones(e.deltaY * semitonesPerWheel);
  }, [arrangement, mode, setHorizontalZoom, followMode.pxPerT, adjustPlayPitchPanSemitones, display.zoomLevel, setZoomLevel]);

  // Keyboard navigation + hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't fire while typing in inputs.
      if (isEditableKeyboardTarget(e.target)) return;

      // Vertical zoom with [ and ] (works in both Play + Create)
      if (e.key === '[') {
        e.preventDefault();
        setZoomLevel(Math.max(0.25, display.zoomLevel / 1.12));
        return;
      }

      if (e.key === ']') {
        e.preventDefault();
        setZoomLevel(Math.min(6, display.zoomLevel * 1.12));
        return;
      }

      // Number keys 1-6: select the corresponding voice track (if it exists).
      // Works in both Play and Create modes.
      const numKey = parseInt(e.key, 10);
      if (numKey >= 1 && numKey <= 6 && arrangement) {
        const voiceAtIndex = arrangement.voices[numKey - 1];
        if (voiceAtIndex) {
          e.preventDefault();
          setSelectedVoiceId(voiceAtIndex.id);
          return;
        }
      }

      // Escape: clear all focus states + clear node selection (works in both Play and Create modes)
      if (e.key === 'Escape') {
        e.preventDefault();
        clearAllFocus();
        // In Create mode, also clear node selection.
        if (mode === 'create') clearNodeSelection();
        return;
      }

      // The rest of the navigation hotkeys are Create-mode only.
      if (mode !== 'create') return;

      // ── Delete / Backspace: delete all selected nodes ──
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedNodes();
        return;
      }

      // ── Ctrl/Cmd + C: copy selected nodes ──
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        copySelectedNodes();
        return;
      }

      // ── Ctrl/Cmd + X: cut selected nodes ──
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault();
        cutSelectedNodes();
        return;
      }

      // ── Ctrl/Cmd + V: paste clipboard at playhead ──
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        const playheadT16 = playbackEngine.getWorldPositionT16();
        pasteNodes(Math.round(playheadT16));
        return;
      }

      // ── Ctrl/Cmd + D: duplicate selected nodes ──
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        duplicateSelectedNodes();
        return;
      }

      // ── Ctrl/Cmd + A: select all nodes in the selected voice ──
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        if (arrangement) {
          const vid = selectedVoiceId || arrangement.voices[0]?.id;
          if (vid) {
            const voice = arrangement.voices.find(v => v.id === vid);
            if (voice) {
              const allKeys = new Set<NodeKey>(voice.nodes.map(n => makeNodeKey(vid, n.t16)));
              setNodeSelection(allKeys);
            }
          }
        }
        return;
      }

      // Horizontal pan with arrow keys (hold Shift for bigger steps)
      const bigStep = 16;
      const smallStep = 4;
      const step = e.shiftKey ? bigStep : smallStep;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSharedCameraAndMaybeSeek(getCameraCenterWorldT() - step);
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSharedCameraAndMaybeSeek(getCameraCenterWorldT() + step);
        return;
      }

      // Vertical pan with W/S (hold Shift for bigger steps)
      // Gated by mode so Play-mode panning doesn't corrupt Create-mode state.
      if (e.key.toLowerCase() === 'w') {
        e.preventDefault();
        const delta = 1 * (e.shiftKey ? 4 : 1);
        adjustPlayPitchPanSemitones(delta);
        return;
      }

      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        const delta = -1 * (e.shiftKey ? 4 : 1);
        adjustPlayPitchPanSemitones(delta);
        return;
      }

      // Horizontal zoom with +/-
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        setHorizontalZoom('in');
        return;
      }

      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setHorizontalZoom('out');
        return;
      }

      // Reset view (time + pitch pan) with 0
      if (e.key === '0') {
        e.preventDefault();
        resetCreateView();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, arrangement, setSharedCameraAndMaybeSeek, adjustPlayPitchPanSemitones, setHorizontalZoom, display.zoomLevel, setZoomLevel, setSelectedVoiceId, clearAllFocus, clearNodeSelection, deleteSelectedNodes, copySelectedNodes, cutSelectedNodes, pasteNodes, duplicateSelectedNodes, setNodeSelection, selectedVoiceId]);

  // Prevent the browser context menu when right-clicking the grid.
  // (Right-click is used for panning in Create mode.)
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
  }, []);

  /**
   * Jump to Playhead: snap the camera to the playhead and force FOLLOW mode.
   * This is the explicit "re-center and follow" action.
   */
  const jumpToPlayhead = useCallback(() => {
    const playheadWorldT = playbackEngine.getWorldPositionT16();
    // Snap camera to the playhead position.
    setCameraCenterWorldT(playheadWorldT);
    // Clear free-look so the evaluator doesn't return FREE_LOOK.
    setFreeLook(false);
    setFreeLookReact(false);
    // Recenter should always return to FOLLOW behavior.
    setCameraMode('follow');
    // Reset prevState so evaluator runs a fresh check with no stickiness.
    // After snapping, camera center = playhead and follow mode is active.
    smartCamStateRef.current = null;
    smartCamIsStaticRef.current = false;
    setSmartCamIsStatic(false);
  }, [setCameraMode]);

  // Show recenter only when it is actually needed.
  // In static smart-cam states (e.g., STATIC_LOOP), being in a static state
  // alone is not enough — if we're already centered, the pill should hide.
  const cameraDeltaT = Math.abs(getCameraCenterWorldT() - playbackEngine.getWorldPositionT16());
  const centerToleranceT = followMode.pxPerT > 0 ? (6 / followMode.pxPerT) : 0.25;
  const isCenteredOnPlayhead = cameraDeltaT <= centerToleranceT;
  const shouldShowRecenter = freeLookReact || (smartCamIsStatic && !isCenteredOnPlayhead);

  return (
    <div
      ref={containerRef}
      data-grid-container
      className={`relative w-full h-full ${className}`}
    >
      {/* ── Recenter button (Play/Create mode, static cam states or user-panned) ── */}
      {(mode === 'play' || mode === 'create') && !onlyChords && shouldShowRecenter && (
        gridOverlayRoot
          ? createPortal(
            <button
              type="button"
              onClick={jumpToPlayhead}
              className="absolute z-40 pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full
                           bg-sky-500/80 hover:bg-sky-400/90 text-white text-xs font-semibold
                           shadow-lg backdrop-blur-sm transition-colors cursor-pointer"
              style={{
                top: GRID_MARGIN.top + 4,
                left: 'calc(50% + 15px)',
                transform: 'translateX(-50%)',
              }}
              title="Re-center camera on the playhead"
            >
              {/* Simple arrow-to-center icon using SVG */}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 13V1M7 13L3 9M7 13l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Recenter
            </button>,
            gridOverlayRoot,
          )
          : (
            <button
              type="button"
              onClick={jumpToPlayhead}
              className="absolute z-40 pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full
                           bg-sky-500/80 hover:bg-sky-400/90 text-white text-xs font-semibold
                           shadow-lg backdrop-blur-sm transition-colors cursor-pointer"
              style={{
                top: GRID_MARGIN.top + 4,
                left: 'calc(50% + 15px)',
                transform: 'translateX(-50%)',
              }}
              title="Re-center camera on the playhead"
            >
              {/* Simple arrow-to-center icon using SVG */}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 13V1M7 13L3 9M7 13l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Recenter
            </button>
          )
      )}

      {/*
        Chord Track Editor (Create mode)

        We render chord blocks as HTML on top of the canvas so you can:
        - enable the chord track
        - drag resize handles
        - rename chord labels with a text input
        - delete chords
        - add chords by hovering near the top of the chord lane and clicking the split marker

        The canvas is still used to render chords in Play mode.
      */}
      {!hideChords && mode === 'create' && display.showChordTrack && arrangement && (
        <div className="absolute inset-0 z-30 pointer-events-none">
          <div
            ref={chordLaneRef}
            className="absolute pointer-events-auto overflow-hidden"
            style={{
              left: GRID_MARGIN.left,
              right: GRID_MARGIN.right,
              top: GRID_MARGIN.top - 42,
              height: 48,
            }}
            onClickCapture={(e) => {
              // If the split marker is visible, any click inside the chord lane should
              // trigger the split (even if the user clicked on a chord block).
              if (!arrangement?.chords || arrangement.chords.length === 0) return;
              if (editingChordIndex !== null) return;
              if (chordBoundaryDragRef.current) return;
              if (hoverSplitT16 === null) return;
              if (e.shiftKey) return;

              e.preventDefault();
              e.stopPropagation();
              splitChordAt(hoverSplitT16);
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            onMouseLeave={() => {
              setHoverSplitT16(null);
              setHoverSplitScreenX(null);
            }}
            onMouseMove={(e) => {
              if (!arrangement.chords || arrangement.chords.length === 0) {
                setHoverSplitT16(null);
                setHoverSplitScreenX(null);
                return;
              }
              if (editingChordIndex !== null) {
                setHoverSplitT16(null);
                setHoverSplitScreenX(null);
                return;
              }
              if (chordBoundaryDragRef.current) {
                setHoverSplitT16(null);
                setHoverSplitScreenX(null);
                return;
              }

              const rect = chordLaneRef.current?.getBoundingClientRect();
              if (!rect) {
                setHoverSplitT16(null);
                setHoverSplitScreenX(null);
                return;
              }

              // Only show the split marker when you hover very near the top of the chord lane.
              // This keeps most of the chord block body free for rename + boundary dragging.
              const visualTopOffsetPx = 12;
              const yFromVisualTop = (e.clientY - rect.top) - visualTopOffsetPx;
              const inTopHoverZone = yFromVisualTop >= -6 && yFromVisualTop <= 2;
              if (!inTopHoverZone) {
                setHoverSplitT16(null);
                setHoverSplitScreenX(null);
                return;
              }

              // Snap split preview to the same grid division that splitting uses.
              // This keeps the ghost marker position visually consistent with the
              // actual split result on click.
              const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
              const pxPerTVal = followMode.pxPerT;
              if (pxPerTVal <= 0 || totalT16 <= 0) {
                setHoverSplitT16(null);
                setHoverSplitScreenX(null);
                return;
              }

              const currentWorldT = followMode.pendingWorldT !== null
                ? followMode.pendingWorldT
                : getCameraCenterWorldT();
              const camLeft = cameraLeftWorldT(currentWorldT, rect.width, pxPerTVal);
              const screenX = e.clientX - rect.left;
              const hoverWorldT = screenXToWorldT(screenX, camLeft, pxPerTVal);
              const { tLocal, k } = resolveToCanonical(hoverWorldT, totalT16);
              const snappedT16 = Math.max(0, Math.min(totalT16, Math.round(tLocal)));

              // Keep marker on the same repeated-tile instance the mouse is over.
              const snappedWorldT = k * totalT16 + snappedT16;
              const snappedScreenX = worldTToScreenX(snappedWorldT, camLeft, pxPerTVal);

              setHoverSplitT16(snappedT16);
              setHoverSplitScreenX(snappedScreenX);
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div
              className="absolute"
              style={{
                left: 0,
                right: 0,
                top: 12,
                height: 24,
              }}
            >
              {(arrangement.chords?.length ?? 0) === 0 ? (
                <button
                  type="button"
                  className="w-full h-full rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs font-semibold"
                  onClick={(e) => {
                    e.stopPropagation();
                    enableChordTrack();
                  }}
                >
                  Enable Chord Track
                </button>
              ) : (
                <>
                  {/* Hover split marker */}
                  {hoverSplitT16 !== null && hoverSplitScreenX !== null && (
                    <div
                      className="absolute top-0 h-full"
                      style={{
                        left: hoverSplitScreenX,
                        transform: 'translateX(-50%)',
                        pointerEvents: 'none',
                      }}
                    >
                      <div className="absolute left-1/2 top-0 -translate-x-1/2 w-px h-full bg-white/25" />
                      <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full border border-white/20 bg-white/10 text-[var(--text-primary)] text-[12px] font-black flex items-center justify-center cursor-pointer">
                        +
                      </div>
                    </div>
                  )}

                  {/* Chord blocks (synced to grid camera + zoom) */}
                  {(() => {
                    const pxPerTVal = followMode.pxPerT;

                    // Width of the chord lane's visible area (same as the grid drawing width).
                    const laneWidth = (() => {
                      const laneRect = chordLaneRef.current?.getBoundingClientRect();
                      if (laneRect) return laneRect.width;
                      const containerRect = containerRef.current?.getBoundingClientRect();
                      if (!containerRect) return 0;
                      return containerRect.width - GRID_MARGIN.left - GRID_MARGIN.right;
                    })();

                    const worldT = followMode.pendingWorldT !== null
                      ? followMode.pendingWorldT
                      : getCameraCenterWorldT();

                    const camLeft = cameraLeftWorldT(worldT, laneWidth, pxPerTVal);

                    // DAW-style: no tiling — draw tile 0 only
                    const blocks: React.ReactNode[] = [];

                    for (let idx = 0; idx < arrangement.chords!.length; idx++) {
                      const chord = arrangement.chords![idx];
                      const drawWorldT = chord.t16;

                      const leftPx = worldTToScreenX(drawWorldT, camLeft, pxPerTVal);
                      const widthPx = Math.max(1, chord.duration16 * pxPerTVal);

                      // Cull blocks far outside the lane to reduce DOM work.
                      if (leftPx > laneWidth + 200 || leftPx + widthPx < -200) continue;

                      const isEditing = editingChordIndex === idx;
                      const isDiatonicChord = isChordDiatonic(chord, arrangement);

                      blocks.push(
                        <div
                          key={`${chord.t16}-${idx}`}
                          className="absolute top-0 h-full rounded-lg border border-white/10"
                          style={{
                            left: leftPx,
                            width: widthPx,
                            background: isDiatonicChord
                              ? `linear-gradient(to bottom, var(--chord-fill-top), var(--chord-fill-bottom))`
                              : `linear-gradient(to bottom, var(--chord-fill-tension-top), var(--chord-fill-tension-bottom))`,
                            borderColor: isDiatonicChord ? 'var(--chord-stroke)' : 'var(--chord-stroke-tension)',
                          }}
                          title="Shift+click to delete. Drag edges to stretch or overwrite."
                          onDoubleClick={(evt) => {
                            evt.stopPropagation();
                            setEditingChordIndex(idx);
                            setEditingChordName(chord.name);
                          }}
                          onClick={(evt) => {
                            evt.stopPropagation();
                            if (evt.shiftKey) {
                              deleteChord(idx);
                            }
                          }}
                        >
                          <div className="absolute inset-0 flex items-center justify-center px-2">
                            {isEditing ? (
                              <input
                                value={editingChordName}
                                autoFocus
                                className={`w-full bg-transparent text-center text-xs font-bold outline-none ${isDiatonicChord ? 'text-[var(--chord-text)]' : 'text-[var(--chord-text-tension)]'}`}
                                onChange={(evt) => setEditingChordName(evt.target.value)}
                                onBlur={() => commitChordNameEdit()}
                                onKeyDown={(evt) => {
                                  if (evt.key === 'Enter') {
                                    evt.preventDefault();
                                    commitChordNameEdit();
                                  }
                                  if (evt.key === 'Escape') {
                                    evt.preventDefault();
                                    setEditingChordIndex(null);
                                    setEditingChordName('');
                                  }
                                }}
                              />
                            ) : (
                              <span className={`text-xs font-bold ${isDiatonicChord ? 'text-[var(--chord-text)]' : 'text-[var(--chord-text-tension)]'}`}>
                                {chord.name}
                              </span>
                            )}
                          </div>

                          {/* Resize handles */}
                          <>
                            <button
                              type="button"
                              className="absolute left-0 top-0 h-full w-3 cursor-ew-resize bg-transparent hover:bg-white/10"
                              title="Drag to resize"
                              onMouseDown={(evt) => {
                                evt.stopPropagation();
                                chordBoundaryDragRef.current = { leftChordIndex: idx - 1 };
                              }}
                            />
                            <button
                              type="button"
                              className="absolute right-0 top-0 h-full w-3 cursor-ew-resize bg-transparent hover:bg-white/10"
                              title="Drag to resize"
                              onMouseDown={(evt) => {
                                evt.stopPropagation();
                                chordBoundaryDragRef.current = { leftChordIndex: idx };
                              }}
                            />
                          </>
                        </div>
                      );
                    }

                    return blocks;
                  })()}

                </>
              )}
            </div>
          </div>

        </div>
      )}

      {/*
        Lyrics Track Editor (Create mode)

        - Must be enabled explicitly (like chord track)
        - Tokens are locked to Voice 1 melody nodes only
        - Use "-" for split syllables, "_" for held syllables

        Render this on the same overlay layer as the chord editor (hideChords=false)
        so the lane is not cut by the vertical edge-mask used on the contour layer.
      */}
      {!hideChords && mode === 'create' && display.showLyricsTrack && arrangement && (
        <div className="absolute inset-0 z-30 pointer-events-none">
          <div
            ref={lyricLaneRef}
            className="absolute pointer-events-auto overflow-hidden"
            style={{
              left: GRID_MARGIN.left,
              right: GRID_MARGIN.right,
              bottom: 8,
              height: 34,
            }}
            title="Lyrics track for Voice 1. Use '-' to split syllables and '_' to hold a syllable."
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="absolute inset-0 rounded-lg border border-white/10 bg-black/20 backdrop-blur-[1px]">
              {!(arrangement.lyrics?.enabled ?? false) ? (
                <div className="h-full px-2 flex items-center gap-2">
                  <button
                    type="button"
                    className="h-6 px-2 rounded-md border border-white/20 bg-white/8 text-[11px] font-semibold text-[var(--text-primary)] hover:bg-white/12 disabled:opacity-45 disabled:cursor-not-allowed"
                    disabled={voice1MelodyNodes.length === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      enableLyricsTrack();
                    }}
                  >
                    Enable Lyrics Track
                  </button>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {voice1MelodyNodes.length > 0
                      ? 'Add syllables under Voice 1 melody notes.'
                      : 'Place Voice 1 melody notes first.'}
                  </span>
                </div>
              ) : (
                <>
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)]">
                    Lyrics
                  </div>

                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-6 px-2 rounded-md border border-red-400/25 bg-red-500/10 text-[10px] font-semibold text-red-200 hover:bg-red-500/16"
                    onClick={(e) => {
                      e.stopPropagation();
                      disableLyricsTrack();
                    }}
                    title="Disable lyrics track"
                  >
                    Disable
                  </button>

                  {(() => {
                    const pxPerTVal = followMode.pxPerT;
                    if (pxPerTVal <= 0) return null;

                    const connectorLines: React.ReactNode[] = [];
                    const chips: React.ReactNode[] = [];
                    for (const node of voice1MelodyNodes) {
                      if (hiddenLyricNodeTimes.has(node.t16)) continue;
                      const x = node.t16 * pxPerTVal;

                      const entry = lyricEntryByT16.get(node.t16);
                      const text = entry?.text ?? '';
                      const connectorToNext = entry?.connectorToNext;

                      // Render connector lines between this node and the next node.
                      const nextNodeT16 = voice1NextNodeT16ByT16.get(node.t16);
                      if (connectorToNext === 'dash' && nextNodeT16 !== undefined) {
                        const x2 = nextNodeT16 * pxPerTVal;

                        const left = Math.min(x, x2);
                        const right = Math.max(x, x2);
                        const mid = (left + right) / 2;
                        const dashWidth = Math.min(16, Math.max(7, (right - left) * 0.35));
                        connectorLines.push(
                          <div
                            key={`lyric-connector-dash-${node.t16}`}
                            className="absolute pointer-events-none bg-white/85"
                            style={{
                              left: mid - dashWidth / 2,
                              width: dashWidth,
                              top: '50%',
                              height: 1,
                              transform: 'translateY(0.5px)',
                            }}
                          />
                        );
                      }

                      const isEditingToken = editingLyricT16 === node.t16;
                      const editingDraftConnector = isEditingToken
                        ? parseLyricDraft(editingLyricText).connectorToNext
                        : null;

                      chips.push(
                        <div
                          key={`lyric-${node.t16}`}
                          className="absolute top-1/2"
                          style={{
                            left: x,
                            transform: 'translate(-50%, -50%)',
                          }}
                        >
                          {isEditingToken ? (
                            <div className="flex items-center gap-1">
                              <input
                                value={editingLyricText}
                                autoFocus
                                placeholder="lyric"
                                className="w-24 px-2 py-1 rounded-md text-xs text-center bg-black/50 text-[var(--text-primary)] border border-white/30 outline-none focus:border-[var(--accent-primary)]"
                                onFocus={(evt) => {
                                  // Auto-select existing text so retyping/deleting is one action.
                                  if (evt.currentTarget.value.trim().length > 0) {
                                    evt.currentTarget.select();
                                  }
                                }}
                                onChange={(evt) => {
                                  const nextValue = evt.target.value;
                                  setEditingLyricText(nextValue);

                                  const trimmedEnd = nextValue.trimEnd();
                                  if (trimmedEnd.endsWith('-')) {
                                    applyLyricConnectorAndAdvance('dash', nextValue);
                                    return;
                                  }

                                  if (trimmedEnd.endsWith('_')) {
                                    applyLyricConnectorAndAdvance('hold', nextValue);
                                  }
                                }}
                                onBlur={() => {
                                  if (editingLyricT16Ref.current !== node.t16) return;
                                  commitLyricEdit();
                                }}
                                onKeyDown={(evt) => {
                                  if (evt.key === 'Enter') {
                                    evt.preventDefault();
                                    const nextNodeT16 = getAdjacentVoice1NodeT16(node.t16, 1);
                                    commitLyricEdit(nextNodeT16);
                                    return;
                                  }

                                  if (evt.key === 'Tab') {
                                    evt.preventDefault();
                                    const direction: -1 | 1 = evt.shiftKey ? -1 : 1;
                                    const nextNodeT16 = getAdjacentVoice1NodeT16(node.t16, direction);
                                    commitLyricEdit(nextNodeT16);
                                    return;
                                  }

                                  if (evt.key === 'Escape') {
                                    evt.preventDefault();
                                    setEditingLyricT16(null);
                                    setEditingLyricText('');
                                  }
                                }}
                              />

                              {/* Quick helpers for choir-style lyric notation. */}
                              <button
                                type="button"
                                className={`h-6 w-6 rounded border text-[11px] transition-colors ${editingDraftConnector === 'dash'
                                  ? 'border-sky-300/70 bg-sky-400/25 text-sky-100'
                                  : 'border-white/15 bg-white/6 text-[var(--text-muted)] hover:bg-white/12 hover:text-[var(--text-primary)]'
                                  }`}
                                title="Split syllable to next node"
                                onMouseDown={(evt) => evt.preventDefault()}
                                onClick={(evt) => {
                                  evt.stopPropagation();
                                  handleLyricConnectorButton('dash');
                                }}
                              >
                                -
                              </button>

                              <button
                                type="button"
                                className={`h-6 w-6 rounded border text-[11px] transition-colors ${editingDraftConnector === 'hold'
                                  ? 'border-sky-300/70 bg-sky-400/25 text-sky-100'
                                  : 'border-white/15 bg-white/6 text-[var(--text-muted)] hover:bg-white/12 hover:text-[var(--text-primary)]'
                                  }`}
                                title="Hold syllable to next node"
                                onMouseDown={(evt) => evt.preventDefault()}
                                onClick={(evt) => {
                                  evt.stopPropagation();
                                  handleLyricConnectorButton('hold');
                                }}
                              >
                                _
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className={`max-w-[120px] px-2 py-1 rounded-md text-xs border transition-colors ${text
                                ? 'border-white/15 bg-white/8 text-[var(--text-primary)] hover:bg-white/14'
                                : 'border-dashed border-white/15 bg-white/4 text-[var(--text-disabled)] hover:bg-white/10'
                                }`}
                              onClick={(evt) => {
                                evt.stopPropagation();
                                if (editingLyricT16 !== null && editingLyricT16 !== node.t16) {
                                  commitLyricEdit(node.t16);
                                  return;
                                }
                                startLyricEditAt(node.t16);
                              }}
                              title={text || 'Add lyric'}
                            >
                              <span className="block truncate">{text || '·'}</span>
                            </button>
                          )}
                        </div>
                      );
                    }

                    for (const span of lyricHoldSpans) {
                      const left = Math.min(span.startT16, span.endT16) * pxPerTVal;
                      const right = Math.max(span.startT16, span.endT16) * pxPerTVal;

                      // Keep the hold line outside both lyric bubbles.
                      const bubbleInset = 22;
                      const lineStart = left + bubbleInset;
                      const lineEnd = span.endAtAnchor ? right : (right - bubbleInset);
                      const lineWidth = Math.max(0, lineEnd - lineStart);
                      if (lineWidth <= 0) continue;

                      connectorLines.push(
                        <div
                          key={`lyric-hold-span-${span.startT16}-${span.endT16}`}
                          className="absolute pointer-events-none rounded-full bg-white/85"
                          style={{
                            left: lineStart,
                            width: lineWidth,
                            top: '50%',
                            height: 2,
                            transform: 'translateY(10px)',
                          }}
                        />
                      );
                    }

                    return (
                      <div
                        ref={lyricLaneCameraTrackRef}
                        className="absolute inset-y-0 left-0 will-change-transform"
                      >
                        {connectorLines}
                        {chips}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full ${mode === 'create'
          ? (
            loopEnabled && (loopHandleDragRef.current || isHoveringLoopHandle)
              ? 'cursor-ew-resize'
              : (dragState?.isDragging
                ? 'cursor-grabbing'
                : (isShiftHeld
                  ? (isHoveringSelectedNode ? 'cursor-grab' : 'cursor-default')
                  : (isHoveringNode
                    ? 'cursor-grab'
                    : (selectedNodeKeys.size > 1 ? 'cursor-default' : 'cursor-crosshair'))))
          )
          : (
            followMode.isDraggingTimeline
              ? 'cursor-grabbing'
              : (loopEnabled && (loopHandleDragRef.current || isHoveringLoopHandle) ? 'cursor-ew-resize' : 'cursor-default')
          )
          }`}
        // Promote the canvas to its own compositor layer.
        // Without this, DOM updates from other React components (transport bar,
        // sidebar, etc.) can force the browser to re-composite the canvas's
        // layer, introducing visual stutter even when our draw is fast.
        style={{ willChange: 'transform' }}
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        onMouseLeave={() => {
          hoverPreviewRef.current = null;
          hoveredContourVoiceIdRef.current = null;
          setIsHoveringNode(false);
          setIsHoveringSelectedNode(false);
          setIsShiftHeld(false);
          isHoveringLoopHandleRef.current = false;
          setIsHoveringLoopHandle(false);
          // Cancel any in-progress marquee or group drag on mouse leave.
          marqueeRef.current = null;
          groupDragRef.current = null;
          hasPushedDragHistoryRef.current = false;
          handleMouseUp();
        }}
      />
    </div>
  );
}

export default Grid;
