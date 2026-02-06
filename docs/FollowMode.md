## Follow-Mode Scrolling Timeline Spec (Updated, Final)

### Goal

Implement a **follow-mode only** timeline where the **playhead is always centered and stationary**, and the **grid + arrangement contours + user pitch traces** scroll right-to-left beneath it. The arrangement is a **fixed-length loop** rendered as an **infinite tiled timeline forward in time** with no visual jump at loop boundaries. A **minimap** shows the whole arrangement as **compressed contour previews (correct colors)** plus a **wrapping viewport rectangle**.

No audio waveforms. Minimap does not show chord blocks.

---

# 1) Core Requirements

## 1.1 Follow Mode Only

* There is **no** static mode. The main view always follows the transport/playback position.

## 1.2 Static Centered Playhead

* Draw a vertical playhead line at:

  * `playheadX = viewportWidth / 2`
* The playhead never moves.

## 1.3 Right-to-Left Scrolling

* As playback time increases, content moves left under the playhead.

## 1.4 Forward-Only Infinite Tiled Looping

Tiling is **continuous forward in time** only:

* For times **at or after the true beginning** (see hard limit below), the loop repeats seamlessly forever.
* Tiling applies to:

  * Grid (bar/beat lines)
  * Arrangement contour lines + nodes
  * User pitch traces (recorded)
* No audio waveforms (none displayed).

---

# 2) Time Model (Agnostic)

Use one consistent internal time unit `T` everywhere (ticks/16ths/beats/seconds—implementation choice).

Definitions:

* `loopLengthT`: duration of the arrangement loop in units `T` (fixed)
* `worldT`: transport time in units `T` (monotonic during playback; can be seeked, but **not below 0**)
* `loopT = worldT mod loopLengthT` for minimap and loop-relative mapping (see mod rules below)

Hard limit:

* `worldT` is **clamped** to `worldT >= 0`.
* If user scrubs backward past 0, it stops at 0 (hard limit).

---

# 3) Camera / Viewport Model

## 3.1 Visible Duration

Horizontal zoom defines `pxPerT` (pixels per time unit):

* `visibleDurationT = viewportWidth / pxPerT`

## 3.2 Camera (Follow Mode)

Camera is always derived from `worldT`:

* `cameraLeftWorldT = worldT - (visibleDurationT / 2)`
* Since `worldT >= 0`, `cameraLeftWorldT` may become negative at early times; **do not render negative-time tiles** (see tiling rules).

## 3.3 Mapping time → screen X

For any event at `eventWorldT`:

* `xScreen = (eventWorldT - cameraLeftWorldT) * pxPerT`

At the playhead:

* `eventWorldT == worldT` maps to `xScreen == viewportWidth/2`.

---

# 4) Tiling Rules (Forward-Only, Seamless)

## 4.1 Canonical Arrangement Range

Arrangement content (contours, chord timing if used, etc.) is authored once on:

* `[0, loopLengthT)`

## 4.2 Drawing Tiles Needed for the Viewport

Define viewport time window:

* `viewStart = cameraLeftWorldT`
* `viewEnd = cameraLeftWorldT + visibleDurationT`

**Forward-only rendering rule:**

* Do not render any tiled content for `tDrawWorld < 0`.
* At early times, the left side of the viewport may show “empty space” before time 0.

Compute tile indices that intersect the visible range, clamped to start at tile 0:

* `kStart = max(0, floor(viewStart / loopLengthT) - 1)`
* `kEnd   = max(0, floor(viewEnd   / loopLengthT) + 1)`

For each tile `k in [kStart..kEnd]`:

* For each arrangement event at local time `tLocal`:

  * `tDrawWorld = tLocal + k * loopLengthT`
  * If `tDrawWorld < 0`, skip (should only happen if k=0 and tLocal<0, which should not exist).
  * Draw using `tDrawWorld`.

This produces seamless forward looping with no visual jump when crossing multiples of `loopLengthT`.

---

# 5) Grid Behavior (Keep Current Look, Add Motion)

Requirement: the grid should look exactly as it does now; it just scrolls.

Implementation:

* Render the same bar/beat/subdivision grid lines, but in **world time** using the same `xScreen` mapping.
* Use level-of-detail rules so the grid is not overly dense:

### Grid Level-of-Detail (LOD)

* **High zoom:** subdivisions + beats + bars (current look)
* **Medium zoom:** beats + bars
* **Low zoom:** bars only

Styling for each line type (subdivision/beat/bar) must match current styling.

---

# 6) Loop Start Demarcation (“True Beginning” / Bar 1 Marker)

Define:

* **LoopStartT = 0** (true beginning of the arrangement)

Requirement:

* User must clearly see LoopStart approaching near the end of each repetition.

Implementation:

* Draw a distinctive **Loop Start Marker** at:

  * `t = k * loopLengthT` for every rendered tile `k >= 0`
* This marker must be more prominent than normal bar lines (thicker/brighter and/or labeled).
* It should be visually consistent with the existing grid style, but clearly distinct.

---

# 7) Zoom Requirements

## 7.1 Horizontal Zoom

* Changes `pxPerT`.
* Must anchor around the playhead time:

  * When zoom changes, `worldT` stays under the playhead; recompute `cameraLeftWorldT` from the same `worldT`.

Horizontal zoom affects:

* grid spacing density
* contour spacing
* pitch trace spacing
* minimap viewport rectangle width

## 7.2 Vertical Zoom

* Changes `pxPerPitchUnit` (row height / pitch scaling).
* Vertical zoom affects:

  * pitch grid row spacing
  * contour vertical positions
  * pitch trace vertical positions
* Does not affect time mapping.

---

# 8) Scrubbing / Pan Behavior (Seek on Release)

Requirement change: dragging should not continuously seek audio; only seek when released.

## 8.1 Main View Drag

* Dragging horizontally pans the timeline visually (changes a “pending seek time”), but transport is not updated until release.

Behavior:

1. On drag start:

   * Capture `dragStartWorldT = worldT`.
2. During drag:

   * Convert pixel delta to time delta:

     * **Dragging left moves time forward**:

       * `dT = (-dxPixels) / pxPerT`
     * `pendingWorldT = clamp(dragStartWorldT + dT, min=0)`
   * Render the view using `pendingWorldT` (i.e., camera follows pending).
   * Audio/transport does **not** seek yet.
3. On drag release:

   * Set transport `worldT = pendingWorldT` (seek once).
   * Resume normal follow rendering from transport.

If playback is running:

* Playback continues during drag (audio not seeking), but visuals show the pending position.
* On release, audio/transport seeks once to match the displayed position.

(If this feels confusing in practice, the alternative is to pause audio during drag; but current spec keeps audio playing and seeks on release.)

---

# 9) Minimap Spec (Contours Only + Wrapping Viewport)

## 9.1 Minimap Content

* Shows exactly one loop: `[0, loopLengthT)`
* Shows compressed contour previews for all tracks/voices:

  * correct per-track colors
  * no opacity reduction
  * deterministic z-order (fixed track order)

Compression/performance:

* Allow decimation/simplification as needed, but keep overall contour shape recognizable.

## 9.2 Viewport Rectangle

Represents the main view’s visible window in loop-relative space.

* `rectWidth = minimapWidth * (visibleDurationT / loopLengthT)`
* If `visibleDurationT >= loopLengthT`, show a full-width rectangle (covers whole minimap).

Position:

* Center corresponds to `loopT` of the current displayed time:

  * If user is dragging, use `pendingWorldT` for the minimap position.
  * Otherwise use transport `worldT`.

Wrapping requirement:

* If rectangle extends past the right edge, split into two rectangles:

  * right-side remainder at end
  * left-side remainder at start
* Same if it extends past the left edge.

## 9.3 Minimap Interaction (Seek on Release)

Minimap interaction follows the same seek-on-release behavior:

* During drag: update `pendingWorldT` visually (main view and minimap reflect pending).
* On release: seek transport to the chosen time.

Click:

* Set `pendingWorldT` immediately and then seek transport immediately (click is effectively “release instantly”).

---

# 10) Create Mode Interaction with Tiled Rendering (Canonical Mapping)

Tiled visuals are not separate data. Only one canonical instance of each authored object exists.

Rules:

* Canonical contour nodes/events are stored with:

  * stable IDs
  * local times `tLocal ∈ [0, loopLengthT)`
* Rendering shows visual copies across tiles (`tDrawWorld = tLocal + k*loopLengthT`), but interactions must resolve back to canonical objects.

Interaction mapping:

* If the user clicks a visual copy in tile `k`, resolve it to the canonical object by ID (preferred) or by:

  * `tLocal = tDrawWorld - k*loopLengthT` (must land in `[0, loopLengthT)`)

Create mode must support editing regardless of which tile copy was clicked.

---

# 11) Recording Pitch Traces (Strict Rules)

## 11.1 One Trace per Track, Exactly One Loop Long

* Each track can have **one** recorded pitch trace with duration exactly `loopLengthT`.
* Once recorded, that trace is tiled across all future repetitions.

## 11.2 Recording Always Starts at True Beginning

When record is pressed:

* The timeline **always resets to worldT = 0**.
* A count-in runs from there.
* Recording begins from the true beginning and stops automatically at loop end.

Critical constraints:

* Recording cannot start from a seeked position.
* Recording cannot start in later tiles/repetitions.
* Recording ends exactly at `worldT = loopLengthT`.

## 11.3 After Recording Ends

At loop end:

* Recording stops automatically.
* App transitions into playback of:

  * the recorded audio file (if audio exists in the system)
  * the recorded pitch trace
* The recorded pitch trace is now rendered as a tiled element forever forward in time.

---

# 12) Acceptance Criteria (Must Pass)

1. Playhead is centered and stationary at all times.
2. Grid, contours, and recorded pitch traces scroll right-to-left during playback.
3. Forward looping is seamless: no visual jump at loop boundaries.
4. LoopStart marker at `t = k*loopLengthT` is clearly distinct and visible approaching.
5. Horizontal zoom anchors around playhead time (no time drift under playhead).
6. Vertical zoom affects pitch only.
7. Scrub/drag left moves time forward; scrub/drag right moves time backward; hard limit at worldT=0.
8. Scrubbing is seek-on-release: visuals follow pending position; transport/audio seek only on release.
9. Minimap shows compressed contour previews with correct colors and fixed ordering (no opacity reduction).
10. Minimap viewport rectangle width matches zoom and wraps/splits correctly.
11. Minimap drag is seek-on-release; click seeks immediately.
12. Create mode interactions on any tiled copy correctly edit the canonical data.
13. Recording always resets to worldT=0, records exactly one loop, then tiles on playback; cannot record from seeked positions.

---
