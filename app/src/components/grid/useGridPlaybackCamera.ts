import { useEffect } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { useAppStore } from '../../stores/appStore';
import { playbackEngine } from '../../services/PlaybackEngine';
import {
  evaluateSmartCamState,
  isStaticState,
  snapIfPlayheadOffscreen,
  stepSmartCam,
  type SmartCamState,
} from '../../utils/smartCam';
import {
  getCameraCenterWorldT,
  isFreeLook,
  setCameraCenterWorldT,
  setFreeLook,
} from '../../utils/cameraState';

/**
 * Input contract for the playback-camera RAF hook.
 *
 * This hook owns one responsibility:
 * - advance smooth visual world-time
 * - step Smart Cam state every animation frame
 * - trigger canvas draw via `drawRef.current()`
 *
 * It deliberately does NOT own React event handlers or JSX.
 */
type UseGridPlaybackCameraParams = {
  drawRef: MutableRefObject<() => void>;
  visualWorldTRef: MutableRefObject<number | null>;
  lastFlashTriggerWorldT16Ref: MutableRefObject<number | null>;
  nodeFlashStartMsRef: MutableRefObject<Map<string, number>>;
  smartCamStateRef: MutableRefObject<SmartCamState | null>;
  smartCamIsStaticRef: MutableRefObject<boolean>;
  setSmartCamIsStatic: (next: boolean) => void;
  setFreeLookReact: (next: boolean) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  gridMarginLeft: number;
  gridMarginRight: number;
  onlyChords: boolean;
};

/**
 * Encapsulate the frame loop that drives:
 * 1) smoothed visual playhead time
 * 2) Smart Cam stepping
 * 3) frame-by-frame canvas redraw
 */
export function useGridPlaybackCamera({
  drawRef,
  visualWorldTRef,
  lastFlashTriggerWorldT16Ref,
  nodeFlashStartMsRef,
  smartCamStateRef,
  smartCamIsStaticRef,
  setSmartCamIsStatic,
  setFreeLookReact,
  containerRef,
  gridMarginLeft,
  gridMarginRight,
  onlyChords,
}: UseGridPlaybackCameraParams): void {
  useEffect(() => {
    let animationId: number;

    // ── RAF-anchor state for smooth visual world time ──
    // We store a fixed anchor point (RAF timestamp + engine worldT) and compute the
    // visual position each frame as:
    //   visualWorldT = anchorWorldT + (ts - anchorRafTs) * t16PerMs
    // Because (ts - anchorRafTs) changes by exactly the frame gap each tick, the
    // resulting position is perfectly smooth (no audio-clock noise).
    let anchorRafTs: number | null = null; // RAF timestamp at anchor point (ms)
    let anchorWorldT = 0;                  // Engine worldT at anchor point (t16)
    let anchorT16PerMs = 0;                // Sixteenth notes per millisecond at anchor
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
          ? rect.width - gridMarginLeft - gridMarginRight
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

        const stateWhilePaused = evaluateSmartCamState({
          cameraMode: curFm.cameraMode,
          freeLook: isFreeLook(),
          loopEnabled: curPb.loopEnabled,
          cameraCenterWorldT: getCameraCenterWorldT(),
          playheadWorldT,
        });

        // Keep smartCamStateRef in sync even while paused so the play-start
        // effect reads the correct state (e.g., if loop was toggled while paused).
        smartCamStateRef.current = stateWhilePaused;

        const nowStatic = isStaticState(stateWhilePaused);
        if (nowStatic !== smartCamIsStaticRef.current) {
          smartCamIsStaticRef.current = nowStatic;
          setSmartCamIsStatic(nowStatic);
        }
      }
      // (Create mode is handled separately inside draw() — unchanged.)

      drawRef.current();
      animationId = window.requestAnimationFrame(animate);
    };

    animationId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationId);
    };
  }, [
    containerRef,
    drawRef,
    gridMarginLeft,
    gridMarginRight,
    lastFlashTriggerWorldT16Ref,
    nodeFlashStartMsRef,
    onlyChords,
    setFreeLookReact,
    setSmartCamIsStatic,
    smartCamIsStaticRef,
    smartCamStateRef,
    visualWorldTRef,
  ]);
}

export default useGridPlaybackCamera;
