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
import { degreeToSemitoneOffset, midiToFrequency, noteNameToMidi } from '../../utils/music';
import { generateGridLines } from '../../utils/timing';
import { playbackEngine, type NodeEvent } from '../../services/PlaybackEngine';
import { AudioService } from '../../services/AudioService';
import {
  type LyricUiEntry,
  type LyricHoldSpan,
  parseLyricDraft,
  formatLyricDraft,
  hasAnchorBetween,
  buildLyricHoldSpans,
  getCssVar,
  semitoneToY,
  degreeToY,
} from './gridDataUtils';
import {
  type ContourStackLookup,
  buildContourSegmentStackLookup,
} from './gridContourUtils.ts';
import {
  getContourHitAtMouseVoiceId,
  isEditableKeyboardTarget,
} from './gridInteractionUtils';
import { cameraLeftWorldT, resolveToCanonical, screenXToWorldT, worldTToScreenX } from '../../utils/followCamera';
import { quantizeT16 } from '../../utils/timing';
import {
  type SmartCamState,
  LOOP_ZOOM_PADDING,
} from '../../utils/smartCam';
import {
  getCameraCenterWorldT,
  setCameraCenterWorldT,
  setFreeLook,
} from '../../utils/cameraState';
import { useGridRenderer } from './useGridRenderer';
import { useGridPlaybackCamera } from './useGridPlaybackCamera';
import { useGridInteractions } from './useGridInteractions';
import GridChordLaneEditor from './GridChordLaneEditor';
import GridLyricLaneEditor from './GridLyricLaneEditor';

/* ------------------------------------------------------------
   Types
   ------------------------------------------------------------ */

interface GridProps {
  arrangement: Arrangement | null;
  className?: string;
  hideChords?: boolean;
  onlyChords?: boolean;
  unisonDialKitParams?: ReturnType<typeof import('./UnisonContourDialKit').useUnisonContourDialKit>;
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
  onlyChords = false,
  unisonDialKitParams
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
  const setGridDivision = useAppStore((state) => state.setGridDivision);

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
    isDragging: boolean;    // True once we have actually moved nodes in this gesture
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

  /**
   * Re-apply the Smart-Cam loop framing behavior on demand.
   *
   * This is the exact same flow used when loop is first enabled in Smart mode:
   * 1) zoom to fit full loop (+ padding),
   * 2) center camera on loop,
   * 3) clear free-look so state returns to STATIC_LOOP.
   */
  const showLoopInSmartCam = useCallback(() => {
    const state = useAppStore.getState();
    const curPb = state.playback;
    const loopDuration = curPb.loopEnd - curPb.loopStart;

    if (loopDuration <= 0) return;

    // Compute target horizontal zoom so the full loop fits with side padding.
    const rect = containerRef.current?.getBoundingClientRect();
    const gridW = rect
      ? rect.width - GRID_MARGIN.left - GRID_MARGIN.right
      : state.followMode.viewportWidthPx;

    if (gridW > 0) {
      const paddedDuration = loopDuration * (1 + 2 * LOOP_ZOOM_PADDING);
      const targetPxPerT = gridW / paddedDuration;
      state.setPxPerT(targetPxPerT);
    }

    // Center camera on the loop midpoint.
    const loopCenter = (curPb.loopStart + curPb.loopEnd) / 2;
    setCameraCenterWorldT(loopCenter);

    // Exit free-look and explicitly mark static-loop state.
    setFreeLook(false);
    setFreeLookReact(false);
    smartCamStateRef.current = 'STATIC_LOOP';
    smartCamIsStaticRef.current = true;
    setSmartCamIsStatic(true);
  }, [setSmartCamIsStatic]);

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

    // Clear free-look and snap to playhead so Smart mode resumes following.
    // We do NOT promote to 'follow' mode — Smart mode handles follow itself.
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
      showLoopInSmartCam();
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
  }, [mode, loopEnabled, showLoopInSmartCam]);

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
  const disableChordTrack = useAppStore((state) => state.disableChordTrack);
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
  // DOM ref for the inner camera-tracking div inside the chord lane.
  // We apply translateX every RAF frame so chord blocks follow the camera
  // exactly like the lyric lane does, without waiting for a React re-render.
  const chordLaneCameraTrackRef = useRef<HTMLDivElement | null>(null);

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

  // DevControls updates grid colors by mutating CSS variables at runtime.
  // Because we memoize `cssColors`, we need a tiny signal to re-read the CSS vars
  // when the DevControls sliders change.
  const [cssVarRevision, setCssVarRevision] = useState(0);
  useEffect(() => {
    const onCssVarsUpdated = () => setCssVarRevision((v) => v + 1);
    window.addEventListener('grid-css-vars-updated', onCssVarsUpdated);
    return () => window.removeEventListener('grid-css-vars-updated', onCssVarsUpdated);
  }, []);

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
  }, [theme, display, cssVarRevision]);

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

  // Keep the DOM-based Create-mode chord lane continuously synced to the camera.
  // Uses the same RAF approach as the lyric lane: camera position lives in a
  // mutable module ref, so we must poll it every frame rather than relying on
  // React re-renders.
  useEffect(() => {
    if (mode !== 'create') return;
    if (!display.showChordTrack) return;
    if (!(arrangement?.chords && arrangement.chords.length > 0)) return;

    let rafId = 0;

    const updateChordTrackTransform = () => {
      const laneEl = chordLaneRef.current;
      const trackEl = chordLaneCameraTrackRef.current;
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
          // chord block edges stay pixel-aligned with the grid lines.
          const dpr = window.devicePixelRatio || 1;
          const camLeftSnapped = display.snapCameraToPixels
            ? (Math.round(camLeft * pxPerTVal * dpr) / dpr) / pxPerTVal
            : camLeft;
          const translateX = worldTToScreenX(0, camLeftSnapped, pxPerTVal);

          trackEl.style.transform = `translateX(${translateX}px)`;
        }
      }

      rafId = window.requestAnimationFrame(updateChordTrackTransform);
    };

    rafId = window.requestAnimationFrame(updateChordTrackTransform);
    return () => window.cancelAnimationFrame(rafId);
  }, [
    mode,
    display.showChordTrack,
    arrangement?.chords,
    display.snapCameraToPixels,
    followMode.viewportWidthPx,
    followMode.pxPerT,
    followMode.pendingWorldT,
  ]);

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

    const quantized = quantizeT16(tLocal, useAppStore.getState().createView.gridDivision);
    return Math.max(0, Math.min(totalT16, quantized));
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
    const rawT16 = Math.max(0, Math.min(totalT16, clickWorldT));
    const t16 = quantizeT16(rawT16, useAppStore.getState().createView.gridDivision);

    const relativeY = (clampedY - gridTop) / gridHeight;
    const rawSemitone = maxSemitone - relativeY * (maxSemitone - minSemitone);

    // Always allow chromatic placement (no modifier required).
    const chromaticSemitone = Math.round(rawSemitone);
    return { t16, deg: 1, octave: 0, semi: chromaticSemitone };
  }, [arrangement, getPitchRange, followMode.pxPerT, followMode.pendingWorldT]);

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

  /**
   * Main drawing function.
   */
  const draw = useGridRenderer({
    canvasRef,
    canvasMetricsRef,
    updateCanvasMetrics,
    arrangement,
    cssColors,
    getPitchRange,
    followModePxPerT: followMode.pxPerT,
    followModePendingWorldT: followMode.pendingWorldT,
    visualWorldTRef,
    display,
    hideChords,
    onlyChords,
    mode,
    isPlaying,
    loopEnabled,
    voiceStates,
    recordings,
    isRecording,
    livePitchTrace,
    livePitchTraceVoiceId,
    contourStackLookup,
    selectedVoiceId,
    hoveredContourVoiceIdRef,
    shadowMaskCanvasRef,
    shadowCompositeCanvasRef,
    dragState,
    nodeFlashStartMsRef,
    transposition,
    voice1MelodyNodes,
    lyricEntryByT16,
    lyricHoldSpans,
    hiddenLyricNodeTimes,
    memoizedGridLines,
    hoverPreviewRef,
    marqueeRef,
    unisonDialKitParams,
  });

  // Keep the latest draw() in a ref so the RAF loop never needs to restart.
  // Restarting the RAF effect on every state change can leak multiple loops,
  // which shows up as flicker (different stale closures drawing alternating frames).
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  // Animation loop + Smart Cam stepping are now isolated in a dedicated hook.
  // This keeps Grid focused on orchestration and JSX composition.
  useGridPlaybackCamera({
    drawRef,
    visualWorldTRef,
    lastFlashTriggerWorldT16Ref,
    nodeFlashStartMsRef,
    smartCamStateRef,
    smartCamIsStaticRef,
    setSmartCamIsStatic,
    setFreeLookReact,
    containerRef,
    gridMarginLeft: GRID_MARGIN.left,
    gridMarginRight: GRID_MARGIN.right,
    onlyChords,
  });

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

  // Follow-mode horizontal zoom action from the store
  const setHorizontalZoom = useAppStore((state) => state.setHorizontalZoom);
  const setPxPerT = useAppStore((state) => state.setPxPerT);
  const setMinPxPerT = useAppStore((state) => state.setMinPxPerT);
  const setFollowViewportWidthPx = useAppStore((state) => state.setFollowViewportWidthPx);
  const setZoomLevel = useAppStore((state) => state.setZoomLevel);

  const {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    handleContextMenu,
  } = useGridInteractions({
    arrangement,
    mode,
    display,
    followMode,
    containerRef,
    gridMargin: GRID_MARGIN,
    selectedVoiceId,
    selectedNodeKeys,
    dragState,
    setDragState,
    setIsHoveringNode,
    setIsHoveringSelectedNode,
    setIsShiftHeld,
    setIsHoveringLoopHandle,
    setSmartCamIsStatic,
    setFreeLookReact,
    setCameraMode,
    setLoopPoints,
    setSelectedVoiceId,
    selectNode,
    toggleNodeInSelection,
    clearNodeSelection,
    addNodesToSelection,
    setNodeSelection,
    moveSelectedNodes,
    toggleFocus,
    focusOnlyVoice,
    clearAllFocus,
    startTimelineDrag,
    updatePendingWorldT,
    commitTimelineDrag,
    ensureAudioAndEngineReadyForPreview,
    adjustPlayPitchPanSemitones,
    setHorizontalZoom,
    setZoomLevel,
    addNode,
    updateNode,
    pushHistoryCheckpoint,
    getPitchRange,
    getSnappedPointFromMouseEvent,
    getNodeHitAtMouseEvent,
    getAnyNodeHitAtMouseEvent,
    getContourHitAtMouse,
    hoverPreviewRef,
    auditionRef,
    placingNewNodeRef,
    skipNextClickRef,
    pendingAuditionAttackRef,
    marqueeRef,
    groupDragRef,
    seekDragRef,
    panDragRef,
    hasPushedDragHistoryRef,
    loopHandleDragRef,
    isHoveringLoopHandleRef,
    hoveredContourVoiceIdRef,
    smartCamStateRef,
    smartCamIsStaticRef,
  });

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

  // Keyboard navigation + hotkeys
  useEffect(() => {
    // App mounts a second Grid for chord/lyric overlay (onlyChords=true).
    // That overlay should not register global hotkeys, otherwise key presses
    // are handled twice (toggle on + toggle off in the same keydown).
    if (onlyChords) {
      return;
    }

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

      // Toggle grid division (16th vs triplet) with 't'
      if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        const currentDivision = useAppStore.getState().createView.gridDivision;
        setGridDivision(currentDivision === '16th' ? 'triplet' : '16th');
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
  }, [onlyChords, mode, arrangement, setSharedCameraAndMaybeSeek, adjustPlayPitchPanSemitones, setHorizontalZoom, display.zoomLevel, setZoomLevel, setSelectedVoiceId, clearAllFocus, clearNodeSelection, deleteSelectedNodes, copySelectedNodes, cutSelectedNodes, pasteNodes, duplicateSelectedNodes, setNodeSelection, selectedVoiceId, setGridDivision]);

  /**
   * Jump to Playhead: snap the camera to the playhead and resume following.
   * Stays in Smart mode if the user is already in Smart mode — only switches
   * to Follow if the user was in Static mode (where Smart cam is disabled).
   */
  const jumpToPlayhead = useCallback(() => {
    const playheadWorldT = playbackEngine.getWorldPositionT16();
    // Snap camera to the playhead position.
    setCameraCenterWorldT(playheadWorldT);
    // Clear free-look so the evaluator doesn't return FREE_LOOK.
    setFreeLook(false);
    setFreeLookReact(false);
    // Only switch to Follow if the user is in Static mode (which has no auto-follow).
    // Smart mode already has follow logic — just clearing free-look is enough.
    const currentCameraMode = useAppStore.getState().followMode.cameraMode;
    if (currentCameraMode === 'static') {
      setCameraMode('smart');
    }
    // Reset prevState so evaluator runs a fresh check with no stickiness.
    smartCamStateRef.current = null;
    smartCamIsStaticRef.current = false;
    setSmartCamIsStatic(false);
  }, [setCameraMode]);

  // Show recenter only when it is actually needed.
  // In static smart-cam states (e.g., STATIC_LOOP), being in a static state
  // alone is not enough — if we're already centered, the pill should hide.
  const cameraCenterWorldT = getCameraCenterWorldT();
  const playheadWorldT = playbackEngine.getWorldPositionT16();
  const cameraDeltaT = Math.abs(cameraCenterWorldT - playheadWorldT);
  const centerToleranceT = followMode.pxPerT > 0 ? (6 / followMode.pxPerT) : 0.25;
  const isCenteredOnPlayhead = cameraDeltaT <= centerToleranceT;

  // Special case requested by UX:
  // In Smart Cam + Loop mode, this pill should represent "show loop framing"
  // (not "center playhead"). So visibility is based on whether the loop frame
  // (zoom + center) is currently active.
  const isSmartLoopContext = (followMode.cameraMode === 'smart') && loopEnabled;
  let isShowingLoopFrame = false;
  if (isSmartLoopContext) {
    const pb = useAppStore.getState().playback;
    const loopDuration = pb.loopEnd - pb.loopStart;
    if (loopDuration > 0) {
      const loopCenter = (pb.loopStart + pb.loopEnd) / 2;
      const isCenteredOnLoop = Math.abs(cameraCenterWorldT - loopCenter) <= centerToleranceT;

      const rect = containerRef.current?.getBoundingClientRect();
      const gridW = rect
        ? rect.width - GRID_MARGIN.left - GRID_MARGIN.right
        : useAppStore.getState().followMode.viewportWidthPx;

      if (gridW > 0) {
        const paddedDuration = loopDuration * (1 + 2 * LOOP_ZOOM_PADDING);
        const targetPxPerT = gridW / paddedDuration;
        // Small tolerance avoids tiny float drift from keeping the pill visible.
        const zoomDeltaRatio = targetPxPerT > 0
          ? Math.abs(followMode.pxPerT - targetPxPerT) / targetPxPerT
          : 0;
        const isZoomAtLoopFit = zoomDeltaRatio <= 0.03;
        isShowingLoopFrame = isCenteredOnLoop && isZoomAtLoopFit;
      } else {
        isShowingLoopFrame = isCenteredOnLoop;
      }
    }
  }

  const shouldShowRecenter = isSmartLoopContext
    ? (freeLookReact || !isShowingLoopFrame)
    : (freeLookReact || (smartCamIsStatic && !isCenteredOnPlayhead));

  const recenterPillLabel = isSmartLoopContext ? 'Show loop' : 'Recenter';
  const recenterPillTitle = isSmartLoopContext
    ? 'Show the full loop in view'
    : 'Re-center camera on the playhead';
  const handleRecenterPill = isSmartLoopContext ? showLoopInSmartCam : jumpToPlayhead;

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
              onClick={handleRecenterPill}
              className="absolute z-40 pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full
                           bg-sky-500/80 hover:bg-sky-400/90 text-white text-xs font-semibold
                           shadow-lg backdrop-blur-sm transition-colors cursor-pointer"
              style={{
                top: GRID_MARGIN.top + 4,
                left: 'calc(50% + 15px)',
                transform: 'translateX(-50%)',
              }}
              title={recenterPillTitle}
            >
              {/* Simple arrow-to-center icon using SVG */}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 13V1M7 13L3 9M7 13l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {recenterPillLabel}
            </button>,
            gridOverlayRoot,
          )
          : (
            <button
              type="button"
              onClick={handleRecenterPill}
              className="absolute z-40 pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full
                           bg-sky-500/80 hover:bg-sky-400/90 text-white text-xs font-semibold
                           shadow-lg backdrop-blur-sm transition-colors cursor-pointer"
              style={{
                top: GRID_MARGIN.top + 4,
                left: 'calc(50% + 15px)',
                transform: 'translateX(-50%)',
              }}
              title={recenterPillTitle}
            >
              {/* Simple arrow-to-center icon using SVG */}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 13V1M7 13L3 9M7 13l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {recenterPillLabel}
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
        <GridChordLaneEditor
          arrangement={arrangement}
          gridMarginLeft={GRID_MARGIN.left}
          gridMarginRight={GRID_MARGIN.right}
          gridMarginTop={GRID_MARGIN.top}
          chordLaneRef={chordLaneRef}
          chordLaneCameraTrackRef={chordLaneCameraTrackRef}
          chordBoundaryDragRef={chordBoundaryDragRef}
          followModePxPerT={followMode.pxPerT}
          followModePendingWorldT={followMode.pendingWorldT}
          gridDivision={useAppStore.getState().createView.gridDivision}
          editingChordIndex={editingChordIndex}
          setEditingChordIndex={setEditingChordIndex}
          editingChordName={editingChordName}
          setEditingChordName={setEditingChordName}
          hoverSplitT16={hoverSplitT16}
          setHoverSplitT16={setHoverSplitT16}
          hoverSplitScreenX={hoverSplitScreenX}
          setHoverSplitScreenX={setHoverSplitScreenX}
          enableChordTrack={enableChordTrack}
          splitChordAt={splitChordAt}
          deleteChord={deleteChord}
          disableChordTrack={disableChordTrack}
          commitChordNameEdit={commitChordNameEdit}
        />
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
        <GridLyricLaneEditor
          arrangement={arrangement}
          gridMarginLeft={GRID_MARGIN.left}
          gridMarginRight={GRID_MARGIN.right}
          lyricLaneRef={lyricLaneRef}
          lyricLaneCameraTrackRef={lyricLaneCameraTrackRef}
          voice1MelodyNodes={voice1MelodyNodes}
          hiddenLyricNodeTimes={hiddenLyricNodeTimes}
          lyricEntryByT16={lyricEntryByT16}
          voice1NextNodeT16ByT16={voice1NextNodeT16ByT16}
          lyricHoldSpans={lyricHoldSpans}
          editingLyricT16={editingLyricT16}
          setEditingLyricT16={setEditingLyricT16}
          editingLyricText={editingLyricText}
          setEditingLyricText={setEditingLyricText}
          editingLyricT16Ref={editingLyricT16Ref}
          followModePxPerT={followMode.pxPerT}
          enableLyricsTrack={enableLyricsTrack}
          disableLyricsTrack={disableLyricsTrack}
          applyLyricConnectorAndAdvance={applyLyricConnectorAndAdvance}
          commitLyricEdit={commitLyricEdit}
          getAdjacentVoice1NodeT16={getAdjacentVoice1NodeT16}
          handleLyricConnectorButton={handleLyricConnectorButton}
          startLyricEditAt={startLyricEditAt}
        />
      )}

      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full ${mode === 'create'
          ? (
            loopEnabled && (loopHandleDragRef.current || isHoveringLoopHandle)
              ? 'cursor-ew-resize'
              : ((dragState?.isDragging || !!groupDragRef.current?.isDragging)
                ? 'cursor-grabbing'
                : (isHoveringSelectedNode
                  ? 'cursor-grab'
                  : (isHoveringNode
                    ? 'cursor-pointer'
                    : (isShiftHeld
                      ? 'cursor-default'
                      : (selectedNodeKeys.size > 1 ? 'cursor-default' : 'cursor-crosshair')))))
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
