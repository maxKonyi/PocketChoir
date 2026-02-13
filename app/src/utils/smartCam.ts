/* ============================================================
   SMART CAMERA STATE MACHINE

   Pure functions for the "Smart Cam" system that decides how the
   camera (horizontal scroll position) behaves relative to the
   playhead and loop region.

   ── Camera Modes (user-facing) ──
   1. Smart (default) – follow playhead; auto-zoom & static when
      loop is enabled; free-look on user pan.
   2. Follow           – always follow/center playhead.
   3. Static           – camera never auto-follows; user pans freely.

   ── Smart-Cam States (internal) ──
   FOLLOW_CENTER  Playhead near center → locked follow (default).
   STATIC_LOOP    Loop enabled → camera holds still (auto-zoomed to loop).
   FREE_LOOK      User panned away → static until Recenter / play restart.

   ── Input rules ──
   Right-click + drag always pans the camera (both modes).
   Alt + left-drag always seeks the playhead (both modes).
   Panning in smart/follow enters FREE_LOOK / switches to static mode.
   Recenter pill exits FREE_LOOK and returns to auto-follow.
   ============================================================ */

/* ------------------------------------------------------------
   Constants
   ------------------------------------------------------------ */

/**
 * Padding factor for the auto-zoom-to-loop feature.
 * When the loop is enabled in Smart mode, the viewport zooms to
 * fit the loop with this proportion of extra space on each side.
 * 0.1 = 10% padding on each side.
 */
export const LOOP_ZOOM_PADDING = 0.1;

/* ------------------------------------------------------------
   Camera Mode (user-facing)
   ------------------------------------------------------------ */

/**
 * The three user-selectable camera behaviours.
 * Stored in the app store; read by the smart-cam evaluator.
 */
export type CameraMode = 'smart' | 'follow' | 'static';

/* ------------------------------------------------------------
   State type
   ------------------------------------------------------------ */

/**
 * All possible internal smart-cam states.
 *
 * FOLLOW_CENTER – camera tracks the playhead (default).
 * STATIC_LOOP   – loop enabled in smart mode; camera holds still.
 * FREE_LOOK     – user panned away; camera static until Recenter.
 */
export type SmartCamState =
  | 'FOLLOW_CENTER'            // Playhead near center (locked follow)
  | 'STATIC_LOOP'              // Loop on → camera holds still (auto-zoomed to loop)
  | 'FREE_LOOK';               // User panned away; camera static until Recenter / play restart

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */

/**
 * Returns true when the camera is in a static (non-following) state.
 * In these states the playhead can drift off-screen and the
 * "Recenter" affordance should be visible.
 */
export function isStaticState(state: SmartCamState): boolean {
  return state === 'STATIC_LOOP' || state === 'FREE_LOOK';
}

/**
 * Returns true when the camera is actively following the playhead.
 */
export function isFollowState(state: SmartCamState): boolean {
  return state === 'FOLLOW_CENTER';
}

/* ------------------------------------------------------------
   Evaluate: determine the camera state from current conditions
   ------------------------------------------------------------ */

/**
 * Parameters needed to evaluate the smart-cam state.
 *
 * All pixel values are in CSS pixels (not device pixels).
 * All time values are in 16th-note units.
 */
export interface SmartCamInput {
  /** User-selected camera mode (smart / follow / static). */
  cameraMode: CameraMode;
  /** True if user has panned away in a follow/smart state. */
  freeLook: boolean;
  /** Is the practice-loop region enabled? */
  loopEnabled: boolean;
  /** Current camera center in world time (16th notes). */
  cameraCenterWorldT: number;
  /** Current playhead position in world time (16th notes). */
  playheadWorldT: number;
}

/**
 * Evaluate the smart-cam state given the current conditions.
 *
 * This is a PURE function — no side effects.  Call it every frame
 * (or whenever conditions change) to get the current state.
 */
export function evaluateSmartCamState(input: SmartCamInput): SmartCamState {
  const { cameraMode, freeLook, loopEnabled } = input;

  // ── Camera mode overrides ──

  // Static mode: always FREE_LOOK (user controls everything).
  if (cameraMode === 'static') {
    return 'FREE_LOOK';
  }

  // Follow mode: always follow the playhead — no automatic static switching.
  // Panning while in Follow mode changes cameraMode to 'static' (handled by
  // the pan handlers), so if we reach here the user hasn't panned.
  if (cameraMode === 'follow') {
    return 'FOLLOW_CENTER';
  }

  // ── Smart mode logic below ──

  // Free Look: user panned away while in Smart mode.
  // Stays in FREE_LOOK until cleared by play-restart or Recenter pill.
  if (freeLook) {
    return 'FREE_LOOK';
  }

  // Loop enabled → static loop (we auto-zoomed to fit on enable).
  if (loopEnabled) {
    return 'STATIC_LOOP';
  }

  // Default: follow the playhead.
  return 'FOLLOW_CENTER';
}

/* ------------------------------------------------------------
   Step: advance the camera center for one animation frame
   ------------------------------------------------------------ */

/**
 * Result of a single smart-cam step.
 */
export interface SmartCamStepResult {
  /** The state after this step. */
  state: SmartCamState;
  /** The new camera center (world time, 16th notes). */
  cameraCenterWorldT: number;
}

/**
 * Given the current state and conditions, compute the new camera
 * center for this animation frame.
 *
 * Call this once per requestAnimationFrame tick while playing.
 *
 * @param prevCameraCenter - the camera center from the previous frame
 * @param input            - current conditions (playhead, loop, viewport, etc.)
 */
export function stepSmartCam(
  prevCameraCenter: number,
  input: SmartCamInput,
): SmartCamStepResult {
  // Evaluate state using the PREVIOUS camera center (that's the position
  // the user currently sees on screen).
  const evalInput: SmartCamInput = { ...input, cameraCenterWorldT: prevCameraCenter };
  const state = evaluateSmartCamState(evalInput);

  switch (state) {
    // ── Static states: camera stays exactly where it was ──
    case 'STATIC_LOOP':
    case 'FREE_LOOK': {
      return { state, cameraCenterWorldT: prevCameraCenter };
    }

    // ── Follow: camera snaps to playhead ──
    case 'FOLLOW_CENTER': {
      return { state, cameraCenterWorldT: input.playheadWorldT };
    }

    default:
      return { state, cameraCenterWorldT: input.playheadWorldT };
  }
}

/* ------------------------------------------------------------
   Off-screen playhead snap (follow states only)
   ------------------------------------------------------------ */

/**
 * If the playhead is off-screen AND we are in a follow state,
 * snap the camera so the playhead is centered.
 *
 * In static / free-look / transition states this is a no-op
 * (returns the camera unchanged).
 *
 * @returns the (possibly snapped) camera center
 */
export function snapIfPlayheadOffscreen(
  state: SmartCamState,
  cameraCenterWorldT: number,
  playheadWorldT: number,
  viewportWidthPx: number,
  pxPerT: number,
): number {
  // Static and free-look states never auto-snap.
  if (isStaticState(state)) return cameraCenterWorldT;

  if (pxPerT <= 0 || viewportWidthPx <= 0) return cameraCenterWorldT;

  const visibleDurationT = viewportWidthPx / pxPerT;
  const camLeft = cameraCenterWorldT - visibleDurationT / 2;
  const camRight = cameraCenterWorldT + visibleDurationT / 2;

  // Is playhead off-screen by a meaningful amount?
  // We apply a small margin so tiny single-frame excursions don't cause a snap.
  const marginT = 16 / pxPerT; // 16px margin
  if (playheadWorldT < camLeft - marginT || playheadWorldT > camRight + marginT) {
    // Snap camera so playhead is centered.
    return playheadWorldT;
  }

  return cameraCenterWorldT;
}
