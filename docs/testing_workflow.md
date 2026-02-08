# Testing Workflow (When You Make Big Changes)

This is a practical checklist you can run through after refactors, performance work, or anything that touches core systems like playback, recording, grid drawing, or state.

## 1) Before you run the app (fast sanity)

- **Pull latest + confirm branch**
  - Make sure you’re on the branch you expect (example: `audit-fixes`).

- **TypeScript type-check (catches many mistakes)**
  - Run from the `app/` folder:
    - `npx tsc --noEmit`
  - Expected result:
    - No errors.

- **Build (catches bundling/import issues)**
  - Run from the `app/` folder:
    - `npm run build`
  - Expected result:
    - Build succeeds.

## 2) Start the app

- Run from the `app/` folder:
  - `npm run dev`
- Open the URL it prints (usually `http://localhost:5173`).

## 3) “Smoke Test” (2–3 minutes)

Goal: quickly confirm the app didn’t fundamentally break.

- **Page loads**
  - No white screen.
  - No obvious layout break.

- **Open DevTools Console**
  - Press `F12` in the browser.
  - Check the **Console** tab.
  - Expected result:
    - No repeating errors.

- **Select an arrangement**
  - Make sure the grid renders.
  - Move your mouse over the grid.

- **Press Play / Stop**
  - Playback starts.
  - Playback stops.
  - Playhead moves.

If anything fails here, stop and fix before doing deeper tests.

## 4) Core Feature Tests (10–15 minutes)

### A) Grid rendering & interaction

- **Grid lines look correct**
  - Bar lines vs beat lines are visible.
  - Tonic line (scale degree 1) is visible.

- **Zoom / display settings (if you changed display code)**
  - Open Display Settings.
  - Change grid opacity / glow intensity.
  - Confirm the grid updates and doesn’t flicker.

- **Performance sanity**
  - While playing, the grid should feel smooth.
  - If you see stutters, check Console for warnings.

### B) Mixer / mute / solo behavior

- **Mute a synth voice**
  - That voice’s contour should visually dim (if that’s the intended behavior).

- **Solo a voice**
  - Other voices should behave consistently (muted/quieted depending on the design).

### C) Microphone setup (permissions + devices)

- **Open Mic Setup**
  - Confirm the modal opens.

- **Grant mic permission (if prompted)**
  - If your browser asks, allow microphone.

- **Device list refresh**
  - Click refresh
  - Confirm the list updates (and no errors appear).

- **Volume meter moves**
  - Speak or sing.
  - Confirm the meter responds.

### D) Recording workflow (most important)

- **Arm a voice** (if your UI requires it)
- **Record a short take** (3–5 seconds)
  - Confirm recording starts.
  - Confirm recording stops.

- **Playback the recorded take**
  - Confirm you can hear it.
  - Confirm the recorded pitch trace appears.

- **Try a second recording**
  - This catches “stale state” bugs where the first recording works but the second fails.

## 5) Regression “Edge Cases” (only when relevant)

Run these when your change touched the related area.

- **Looping enabled**
  - Enable looping.
  - Play for a while.
  - Confirm there are no jumps/glitches at the loop boundary.

- **Switch arrangements while stopped**
  - Confirm the grid updates.

- **Switch arrangements while playing** (if supported)
  - Confirm it doesn’t crash.

- **Theme switching** (if you changed CSS variables / theme code)
  - Switch themes.
  - Confirm colors update.

## 6) Pre-commit checklist

Before committing:

- **Type-check**
  - `npx tsc --noEmit`

- **Build**
  - `npm run build`

- **Quick smoke test again**
  - Start the app, load, play/stop.

- **Keep commits small when possible**
  - If something breaks, smaller commits make it easier to find the cause.

## 7) If something breaks: a simple debugging routine

- **Step 1: Check the Console**
  - Look for the first error (often the real cause).

- **Step 2: Undo/disable the last change (temporarily)**
  - This confirms whether your last edit caused it.

- **Step 3: Re-run `npx tsc --noEmit`**
  - Type errors often point directly to the broken import/type.

- **Step 4: Reproduce with the smallest steps**
  - Example: “Open app → click play → crash”.
  - Write those steps down; it makes fixing much easier.
