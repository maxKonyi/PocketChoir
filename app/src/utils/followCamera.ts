/* ============================================================
   FOLLOW-MODE CAMERA UTILITIES

   Pure math functions for the scrolling follow-mode timeline.
   These convert between world time, screen pixels, and tile indices.

   Key concepts:
   - T = time unit (16th notes, matching the rest of the app)
   - worldT: monotonically increasing time (never resets on loop)
   - loopT: worldT mod loopLengthT (position within one loop cycle)
   - pxPerT: horizontal zoom (pixels per 16th note)
   - The playhead is always at the horizontal center of the viewport.
   ============================================================ */

/* ------------------------------------------------------------
   Camera / Viewport
   ------------------------------------------------------------ */

/**
 * How many time units (T) are visible across the viewport width.
 * @param viewportWidth - width of the drawing area in CSS pixels
 * @param pxPerT - pixels per time unit (horizontal zoom)
 */
export function visibleDurationT(viewportWidth: number, pxPerT: number): number {
  // Guard against zero / negative zoom
  if (pxPerT <= 0) return viewportWidth;
  return viewportWidth / pxPerT;
}

/**
 * The world-time value at the left edge of the viewport.
 * May be negative when worldT is small (meaning we're near the start).
 * @param worldT - current world time (monotonic)
 * @param viewportWidth - width of the drawing area
 * @param pxPerT - pixels per time unit
 */
export function cameraLeftWorldT(worldT: number, viewportWidth: number, pxPerT: number): number {
  return worldT - visibleDurationT(viewportWidth, pxPerT) / 2;
}

/**
 * Convert a world-time event to an X pixel on screen.
 * At the playhead (eventWorldT === worldT) this returns viewportWidth / 2.
 * @param eventWorldT - the event's world time
 * @param camLeftWorldT - camera left edge in world time (from cameraLeftWorldT())
 * @param pxPerT - pixels per time unit
 */
export function worldTToScreenX(eventWorldT: number, camLeftWorldT: number, pxPerT: number): number {
  return (eventWorldT - camLeftWorldT) * pxPerT;
}

/**
 * Convert a screen X pixel back to world time.
 * Useful for scrubbing / click-to-seek.
 * @param screenX - X position in CSS pixels
 * @param camLeftWorldT - camera left edge in world time
 * @param pxPerT - pixels per time unit
 */
export function screenXToWorldT(screenX: number, camLeftWorldT: number, pxPerT: number): number {
  if (pxPerT <= 0) return camLeftWorldT;
  return camLeftWorldT + screenX / pxPerT;
}

/* ------------------------------------------------------------
   Tiling
   ------------------------------------------------------------ */

/**
 * Compute the range of tile indices [kStart, kEnd] that overlap the viewport.
 * Forward-only: kStart is clamped to >= 0 so we never render negative-time tiles.
 *
 * @param viewStart - world time at left edge of viewport
 * @param viewEnd   - world time at right edge of viewport
 * @param loopLengthT - duration of one loop in time units
 * @returns [kStart, kEnd] inclusive range of tile indices to iterate
 */
export function getTileRange(
  viewStart: number,
  viewEnd: number,
  loopLengthT: number
): [number, number] {
  if (loopLengthT <= 0) return [0, 0];

  // We add a 1-tile margin on each side so partial tiles at the edges are drawn.
  const kStart = Math.max(0, Math.floor(viewStart / loopLengthT) - 1);
  const kEnd   = Math.max(0, Math.floor(viewEnd   / loopLengthT) + 1);

  return [kStart, kEnd];
}

/**
 * Convert a local event time (within the canonical arrangement [0, loopLengthT))
 * to a world-time draw position for a specific tile.
 * Returns null if the result would be negative (before the hard time-zero limit).
 *
 * @param tLocal - event time within the canonical arrangement
 * @param k - tile index (0 = first loop, 1 = second, …)
 * @param loopLengthT - duration of one loop
 */
export function tileLocalToWorldT(tLocal: number, k: number, loopLengthT: number): number | null {
  const tDrawWorld = tLocal + k * loopLengthT;
  // Hard limit: never draw before worldT = 0
  if (tDrawWorld < 0) return null;
  return tDrawWorld;
}

/* ------------------------------------------------------------
   Minimap helpers
   ------------------------------------------------------------ */

/**
 * Compute the viewport rectangle width on the minimap.
 * If the visible duration exceeds one full loop, clamp to full minimap width.
 *
 * @param minimapWidth - total minimap width in pixels
 * @param visDurationT - visible duration in time units
 * @param loopLengthT  - loop length in time units
 */
export function minimapRectWidth(minimapWidth: number, visDurationT: number, loopLengthT: number): number {
  if (loopLengthT <= 0) return minimapWidth;
  const w = minimapWidth * (visDurationT / loopLengthT);
  return Math.min(w, minimapWidth);
}

/**
 * Compute the loop-relative time for minimap positioning.
 * @param worldT - current world time
 * @param loopLengthT - loop length
 */
export function worldTToLoopT(worldT: number, loopLengthT: number): number {
  if (loopLengthT <= 0) return 0;
  return ((worldT % loopLengthT) + loopLengthT) % loopLengthT;
}

/**
 * Given a click on the minimap, convert it to a world-time value
 * that preserves the current loop count (so clicking doesn't jump
 * to a different loop iteration).
 *
 * @param minimapX - click X position on the minimap (CSS px)
 * @param minimapWidth - total minimap width in pixels
 * @param loopLengthT - loop length in time units
 * @param currentWorldT - current world time (to derive loop count)
 */
export function minimapXToWorldT(
  minimapX: number,
  minimapWidth: number,
  loopLengthT: number,
  currentWorldT: number
): number {
  if (minimapWidth <= 0 || loopLengthT <= 0) return currentWorldT;

  // Where in the loop did they click? (0 to loopLengthT)
  const clickLoopT = (minimapX / minimapWidth) * loopLengthT;

  // Keep the same loop iteration
  const currentLoopCount = Math.floor(currentWorldT / loopLengthT);
  return Math.max(0, currentLoopCount * loopLengthT + clickLoopT);
}

/* ------------------------------------------------------------
   Grid Level-of-Detail (LOD)
   ------------------------------------------------------------ */

/**
 * Determine which grid line types to show at the current zoom level.
 * Returns an object telling the renderer which levels are visible.
 *
 * @param pxPerT - current horizontal zoom (pixels per 16th note)
 */
export function getGridLOD(pxPerT: number): {
  showSubdivisions: boolean;   // individual 16th note lines
  showBeats: boolean;          // beat lines (every 4 sixteenths in 4/4)
  showBars: boolean;           // bar lines (always shown)
} {
  // These thresholds are tuned so the grid never gets too dense.
  // At very low zoom (wide view), only bar lines show.
  // As you zoom in, beat lines appear, then subdivisions.
  return {
    showBars: true,                       // always visible
    showBeats: pxPerT >= 1.5,             // show beats when reasonably zoomed
    showSubdivisions: pxPerT >= 6,        // show 16th lines only when zoomed in
  };
}

/* ------------------------------------------------------------
   Scrub / Drag helpers
   ------------------------------------------------------------ */

/**
 * Convert a horizontal pixel drag delta into a time delta.
 * Dragging LEFT moves time FORWARD (positive dT).
 *
 * @param dxPixels - pixel movement (negative = dragged left)
 * @param pxPerT - pixels per time unit
 */
export function dragPixelsToTimeDelta(dxPixels: number, pxPerT: number): number {
  if (pxPerT <= 0) return 0;
  // Spec: dragging left moves forward → dT = -dxPixels / pxPerT
  return -dxPixels / pxPerT;
}

/* ------------------------------------------------------------
   Create-mode canonical mapping
   ------------------------------------------------------------ */

/**
 * Given a world-time click position, resolve it to the canonical local time
 * within [0, loopLengthT).
 *
 * @param clickWorldT - the world time where the user clicked
 * @param loopLengthT - duration of one loop
 * @returns { tLocal, k } where tLocal is in [0, loopLengthT) and k is the tile index
 */
export function resolveToCanonical(
  clickWorldT: number,
  loopLengthT: number
): { tLocal: number; k: number } {
  if (loopLengthT <= 0) return { tLocal: clickWorldT, k: 0 };
  const k = Math.floor(clickWorldT / loopLengthT);
  const tLocal = clickWorldT - k * loopLengthT;
  return { tLocal, k };
}
