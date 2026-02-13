/* ============================================================
   CAMERA STATE — Single Source of Truth

   Module-level mutable state for the camera center position.
   Every component that needs to know "where is the camera?"
   reads from here — main grid, chord overlay, minimap,
   loop handle hit-testing, etc.

   This eliminates the old dual-source problem where the main
   grid used a local ref and the chord overlay used a throttled
   store value, causing the two layers to "swim" apart.

   WHY module-level (not React state or Zustand)?
   - The camera updates every animation frame (~60fps).
   - React state updates at that rate cause unnecessary re-renders.
   - A plain mutable variable is the fastest possible read/write.
   - Every component's RAF loop can read it synchronously.
   ============================================================ */

/* ── Camera center (horizontal, world-time 16th notes) ── */

// The single authoritative horizontal camera position.
// All drawing code reads this value to determine what's visible.
let _cameraCenterWorldT = 0;

/**
 * Get the current camera center in world time (16th notes).
 * Called every frame by every drawing component.
 */
export function getCameraCenterWorldT(): number {
  return _cameraCenterWorldT;
}

/**
 * Set the camera center in world time (16th notes).
 * Called by the animation loop, pan gestures, and jump-to-playhead.
 * Clamped to >= 0 (you can't scroll before the start of the arrangement).
 */
export function setCameraCenterWorldT(value: number): void {
  _cameraCenterWorldT = Math.max(0, value);
}

/* ── Free Look flag ── */

// True when the user has manually panned the camera away from the
// auto-follow position.  While true, the smart cam won't fight the
// user by snapping back to the playhead.  Cleared by "Jump to Playhead"
// or by pressing Play.
let _freeLook = false;

/**
 * Is the camera currently in "free look" (user-panned) mode?
 */
export function isFreeLook(): boolean {
  return _freeLook;
}

/**
 * Enter or exit free look mode.
 * - `true`:  user has panned; camera stays put.
 * - `false`: camera returns to auto-follow behavior.
 */
export function setFreeLook(value: boolean): void {
  _freeLook = value;
}
