import { useCallback } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  RefObject,
  WheelEvent as ReactWheelEvent,
} from 'react';
import type { Arrangement } from '../../types';
import { makeNodeKey, useAppStore, type NodeKey } from '../../stores/appStore';
import { playbackEngine } from '../../services/PlaybackEngine';
import { AudioService } from '../../services/AudioService';
import {
  cameraLeftWorldT,
  dragPixelsToTimeDelta,
  worldTToScreenX,
} from '../../utils/followCamera';
import {
  getCameraCenterWorldT,
  setCameraCenterWorldT,
  setFreeLook,
} from '../../utils/cameraState';
import {
  type CameraMode,
  type SmartCamState,
} from '../../utils/smartCam';
import { degreeToY, semitoneToY } from './gridDataUtils';
import {
  getGroupDragDelta,
  getLoopBoundaryScreenPositions,
  getNearestLoopHandle,
  getSnappedLoopTimeFromMouseX,
  isMouseNearLoopHandle,
} from './gridInteractionUtils';

type DragState = {
  voiceId: string;
  originalT16: number;
  isDragging: boolean;
  anchorParentT16?: number;
};

type SnappedGridPoint = {
  t16: number;
  deg: number;
  octave: number;
  semi?: number;
};

type MarqueeState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additive: boolean;
};

type GroupDragState = {
  startMouseX: number;
  startMouseY: number;
  lastDeltaT16: number;
  lastDeltaSemi: number;
  isDragging: boolean;
};

type GridMargins = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type FollowModeSlice = {
  pxPerT: number;
  pendingWorldT: number | null;
  isDraggingTimeline: boolean;
};

type DisplaySlice = {
  zoomLevel: number;
};

type UseGridInteractionsParams = {
  arrangement: Arrangement | null;
  mode: 'play' | 'create' | string;
  display: DisplaySlice;
  followMode: FollowModeSlice;
  containerRef: RefObject<HTMLDivElement | null>;
  gridMargin: GridMargins;
  selectedVoiceId: string | null;
  selectedNodeKeys: Set<NodeKey>;
  dragState: DragState | null;
  setDragState: (state: DragState | null) => void;
  setIsHoveringNode: (hovering: boolean) => void;
  setIsHoveringSelectedNode: (hovering: boolean) => void;
  setIsShiftHeld: (held: boolean) => void;
  setIsHoveringLoopHandle: (hovering: boolean) => void;
  setSmartCamIsStatic: (value: boolean) => void;
  setFreeLookReact: (value: boolean) => void;
  setCameraMode: (mode: CameraMode) => void;
  setLoopPoints: (loopStart: number, loopEnd: number) => void;
  setSelectedVoiceId: (voiceId: string) => void;
  selectNode: (nodeKey: NodeKey) => void;
  toggleNodeInSelection: (nodeKey: NodeKey) => void;
  clearNodeSelection: () => void;
  addNodesToSelection: (nodeKeys: Set<NodeKey>) => void;
  setNodeSelection: (nodeKeys: Set<NodeKey>) => void;
  moveSelectedNodes: (
    deltaT16: number,
    deltaSemi: number,
    options?: { recordHistory?: boolean }
  ) => void;
  toggleFocus: (voiceId: string) => void;
  focusOnlyVoice: (voiceId: string) => void;
  clearAllFocus: () => void;
  startTimelineDrag: () => void;
  updatePendingWorldT: (worldT: number) => void;
  commitTimelineDrag: () => void;
  ensureAudioAndEngineReadyForPreview: () => Promise<void>;
  adjustPlayPitchPanSemitones: (deltaSemitones: number) => void;
  setHorizontalZoom: (direction: 'in' | 'out') => void;
  setZoomLevel: (value: number) => void;
  addNode: (
    voiceId: string,
    t16: number,
    deg: number,
    octave: number,
    semi?: number
  ) => void;
  updateNode: (
    voiceId: string,
    fromT16: number,
    toT16: number,
    deg: number,
    octave: number,
    term?: boolean,
    semi?: number,
    options?: { recordHistory?: boolean }
  ) => void;
  pushHistoryCheckpoint: () => void;
  getPitchRange: () => { minSemitone: number; maxSemitone: number };
  getSnappedPointFromMouseEvent: (e: ReactMouseEvent<HTMLCanvasElement>) => SnappedGridPoint | null;
  getNodeHitAtMouseEvent: (
    e: ReactMouseEvent<HTMLCanvasElement>,
    voiceId: string,
    startT16: number,
    endT16: number,
    gridLeft: number,
    gridTop: number,
    gridWidth: number,
    gridHeight: number,
    minSemitone: number,
    maxSemitone: number
  ) => any;
  getAnyNodeHitAtMouseEvent: (
    e: ReactMouseEvent<HTMLCanvasElement>,
    gridLeft: number,
    gridTop: number,
    gridWidth: number,
    gridHeight: number,
    minSemitone: number,
    maxSemitone: number,
  ) => any;
  getContourHitAtMouse: (
    mouseX: number,
    mouseY: number,
    gridLeft: number,
    gridTop: number,
    gridWidth: number,
    gridHeight: number,
    minSemitone: number,
    maxSemitone: number
  ) => string | null;
  hoverPreviewRef: MutableRefObject<{ voiceId: string; point: SnappedGridPoint } | null>;
  auditionRef: MutableRefObject<{ voiceId: string } | null>;
  placingNewNodeRef: MutableRefObject<{ voiceId: string; point: SnappedGridPoint } | null>;
  skipNextClickRef: MutableRefObject<boolean>;
  pendingAuditionAttackRef: MutableRefObject<{
    voiceId: string;
    deg: number;
    octave: number;
    semi?: number;
  } | null>;
  marqueeRef: MutableRefObject<MarqueeState | null>;
  groupDragRef: MutableRefObject<GroupDragState | null>;
  seekDragRef: MutableRefObject<{ startX: number; startWorldT: number } | null>;
  panDragRef: MutableRefObject<{ startX: number; startCameraWorldT: number } | null>;
  hasPushedDragHistoryRef: MutableRefObject<boolean>;
  loopHandleDragRef: MutableRefObject<'start' | 'end' | null>;
  isHoveringLoopHandleRef: MutableRefObject<boolean>;
  hoveredContourVoiceIdRef: MutableRefObject<string | null>;
  smartCamStateRef: MutableRefObject<SmartCamState | null>;
  smartCamIsStaticRef: MutableRefObject<boolean>;
};

type UseGridInteractionsResult = {
  handleMouseDown: (e: ReactMouseEvent<HTMLCanvasElement>) => void;
  handleMouseMove: (e: ReactMouseEvent<HTMLCanvasElement>) => void;
  handleMouseUp: () => void;
  handleWheel: (e: ReactWheelEvent<HTMLCanvasElement>) => void;
  handleContextMenu: (e: ReactMouseEvent<HTMLCanvasElement>) => void;
};

/**
 * Interaction-wiring hook for the Grid canvas.
 *
 * This isolates input callbacks from Grid.tsx while preserving the existing
 * behavior exactly (mouse drag precedence, loop-handle hit zones, focus guards,
 * and keyboard-modifier handling semantics).
 */
export function useGridInteractions({
  arrangement,
  mode,
  display,
  followMode,
  containerRef,
  gridMargin,
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
}: UseGridInteractionsParams): UseGridInteractionsResult {
  const handleMouseDown = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
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
        const gridLeftPx = gridMargin.left;
        const gridWidthPx = rect.width - gridMargin.left - gridMargin.right;

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
          const gridLeftVal = gridMargin.left;
          const gridTopVal = gridMargin.top;
          const gridWidthVal = rect.width - gridMargin.left - gridMargin.right;
          const gridHeightVal = rect.height - gridMargin.top - gridMargin.bottom;
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
            mouseX,
            mouseY,
            gridLeftVal,
            gridTopVal,
            gridWidthVal,
            gridHeightVal,
            minSemitone,
            maxSemitone,
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

    const gridLeft = gridMargin.left;
    const gridTopVal = gridMargin.top;
    const gridWidth = rect.width - gridMargin.left - gridMargin.right;
    const gridHeight = rect.height - gridMargin.top - gridMargin.bottom;
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
          additive: e.shiftKey, // Ctrl+Shift = additive marquee
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

      // Handle selection modifiers.
      // IMPORTANT: We also update hover cursor state immediately so the cursor
      // doesn't lag until the next mousemove event.
      if (e.shiftKey) {
        // Shift+click toggles selection membership (add/remove).
        toggleNodeInSelection(hitKey);

        // We can't reliably know the next selection set without reading the store.
        // So read it back immediately and update hover-selected flag.
        const nextSelection = useAppStore.getState().createView.selectedNodeKeys;
        setIsHoveringSelectedNode(nextSelection.has(hitKey));
      } else if (!isAlreadySelected) {
        // Plain click on unselected node: select only this one.
        selectNode(hitKey);
        setIsHoveringSelectedNode(true);
      } else {
        // Plain click on an already-selected node.
        setIsHoveringSelectedNode(true);
      }

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
          pendingAuditionAttackRef.current = {
            voiceId: editableVoiceId,
            deg: attackDeg,
            octave: attackOct,
            semi: attackSemi,
          };
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
          isDragging: false,
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
        setDragState({
          voiceId: editableVoiceId,
          originalT16: hitResult.t16,
          isDragging: true,
          anchorParentT16: parent.t16,
        });
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
        pendingAuditionAttackRef.current = {
          voiceId,
          deg: snapped.deg,
          octave: snapped.octave,
          semi: snapped.semi,
        };
        void ensureAudioAndEngineReadyForPreview().then(() => {
          const pending = pendingAuditionAttackRef.current;
          if (!pending) return;
          if (auditionRef.current?.voiceId !== pending.voiceId) return;
          attack(pending.deg, pending.octave, pending.semi);
        });
      }

      placingNewNodeRef.current = { voiceId, point: snapped };
    }
  }, [
    arrangement,
    clearAllFocus,
    clearNodeSelection,
    containerRef,
    ensureAudioAndEngineReadyForPreview,
    focusOnlyVoice,
    followMode.pendingWorldT,
    followMode.pxPerT,
    getAnyNodeHitAtMouseEvent,
    getContourHitAtMouse,
    getNodeHitAtMouseEvent,
    getPitchRange,
    getSnappedPointFromMouseEvent,
    gridMargin.bottom,
    gridMargin.left,
    gridMargin.right,
    gridMargin.top,
    mode,
    selectedVoiceId,
    selectNode,
    setCameraMode,
    setDragState,
    setFreeLookReact,
    setIsHoveringLoopHandle,
    setSelectedVoiceId,
    startTimelineDrag,
    toggleFocus,
    toggleNodeInSelection,
    updatePendingWorldT,
    clearNodeSelection,
    setSelectedVoiceId,
    selectNode,
  ]);

  const handleMouseMove = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
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
        const gridLeftPx = gridMargin.left;
        const gridWidthPx = rect.width - gridMargin.left - gridMargin.right;
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
        const gridLeftPx = gridMargin.left;
        const gridWidthPx = rect.width - gridMargin.left - gridMargin.right;

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
        const gridLeft = gridMargin.left;
        const gridTop = gridMargin.top;
        const gridWidth = rect.width - gridMargin.left - gridMargin.right;
        const gridHeight = rect.height - gridMargin.top - gridMargin.bottom;
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
            mouseX,
            mouseY,
            gridLeft,
            gridTop,
            gridWidth,
            gridHeight,
            minSemitone,
            maxSemitone,
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
      const gridHeightPx = (containerRef.current?.getBoundingClientRect()?.height ?? 600) - gridMargin.top - gridMargin.bottom;
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
        gd.isDragging = true;
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

        const gridLeft = gridMargin.left;
        const gridTop = gridMargin.top;
        const gridWidth = width - gridMargin.left - gridMargin.right;
        const gridHeight = height - gridMargin.top - gridMargin.bottom;

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
  }, [
    arrangement,
    containerRef,
    dragState,
    followMode.isDraggingTimeline,
    followMode.pendingWorldT,
    followMode.pxPerT,
    getAnyNodeHitAtMouseEvent,
    getContourHitAtMouse,
    getNodeHitAtMouseEvent,
    getPitchRange,
    getSnappedPointFromMouseEvent,
    gridMargin.bottom,
    gridMargin.left,
    gridMargin.right,
    gridMargin.top,
    mode,
    moveSelectedNodes,
    pushHistoryCheckpoint,
    selectedNodeKeys,
    selectedVoiceId,
    setDragState,
    setIsHoveringLoopHandle,
    setIsHoveringNode,
    setIsHoveringSelectedNode,
    setIsShiftHeld,
    setLoopPoints,
    updateNode,
    updatePendingWorldT,
  ]);

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
        const gridLeftPx = gridMargin.left;
        const gridTopPx = gridMargin.top;
        const gridWidthPx = rect.width - gridMargin.left - gridMargin.right;
        const gridHeightPx = rect.height - gridMargin.top - gridMargin.bottom;

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
  }, [
    addNode,
    addNodesToSelection,
    arrangement,
    commitTimelineDrag,
    containerRef,
    dragState,
    followMode.isDraggingTimeline,
    followMode.pendingWorldT,
    followMode.pxPerT,
    getPitchRange,
    gridMargin.bottom,
    gridMargin.left,
    gridMargin.right,
    gridMargin.top,
    mode,
    selectedVoiceId,
    setDragState,
    setIsHoveringLoopHandle,
    setNodeSelection,
    setSmartCamIsStatic,
  ]);

  const handleWheel = useCallback((e: ReactWheelEvent<HTMLCanvasElement>) => {
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
  }, [
    adjustPlayPitchPanSemitones,
    arrangement,
    display.zoomLevel,
    followMode.pxPerT,
    mode,
    setCameraMode,
    setFreeLookReact,
    setHorizontalZoom,
    setZoomLevel,
  ]);

  const handleContextMenu = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
  }, []);

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    handleContextMenu,
  };
}

export default useGridInteractions;
