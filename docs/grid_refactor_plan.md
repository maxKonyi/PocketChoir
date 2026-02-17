# Grid.tsx Refactor Plan (Non-Behavioral)

## Purpose

Break `app/src/components/grid/Grid.tsx` into smaller, focused modules **without changing functionality**.

## Safety Rules (must always hold)

- No visual behavior changes.
- No interaction behavior changes.
- No store contract/API changes.
- Only move code and wire imports/exports.
- Build must pass after each phase.
- If a phase fails verification, stop and fix before continuing.

## Inspection Summary

`Grid.tsx` currently combines many responsibilities in one file:

1. Data/format utilities (lyrics parsing, chord checks, pitch helpers).
2. Contour geometry + stacking utilities.
3. Main React component state wiring and store subscriptions.
4. Heavy canvas drawing pipeline (`draw`, contour render, pitch trace render).
5. Complex interaction handlers (mouse/keyboard, drag modes, focus, selection).
6. Overlay UI rendering (chord lane + lyrics lane editors).
7. Animation and camera loops (RAF timing, smart cam, visual world-time sync).

This is a correct implementation, but very large and hard to maintain safely in one file.

## Proposed Target Structure

Under `app/src/components/grid/`:

- `Grid.tsx` (orchestration + JSX composition)
- `gridDataUtils.ts` (lyric/chord/pitch pure helpers)
- `gridContourUtils.ts` (contour stacking + prism helpers)
- `gridCanvasRenderers.ts` (drawVoiceContour + drawPitchTrace)
- `gridInteractionUtils.ts` (pure/shared event math helpers only)
- `gridTypes.ts` (shared local interfaces/types used by multiple modules)

> Note: We will move only when behavior-preserving and low risk. If a module split adds risk, we keep code in `Grid.tsx` for now.

## Phase Checklist

### Phase 0 — Baseline + map

- [x] Inspect `Grid.tsx` thoroughly and map major responsibility boundaries.
- [x] Create this working plan/checklist document.

### Phase 1 — Extract pure data utilities (lowest risk)

- [x] Create `gridDataUtils.ts`.
- [x] Move lyric draft/hold helpers into `gridDataUtils.ts`.
- [x] Move CSS color helper and chord-diatonic helper into `gridDataUtils.ts`.
- [x] Move semitone/pitch-Y helpers into `gridDataUtils.ts`.
- [x] Update `Grid.tsx` imports and remove duplicated in-file definitions.
- [x] Verify `npm run build` passes.

### Phase 2 — Extract contour geometry utilities

- [x] Create `gridContourUtils.ts`.
- [x] Move contour stack types + builders + gradient helpers (pure functions only).
- [x] Update `Grid.tsx` to import these helpers/types.
- [x] Verify `npm run build` passes.

### Phase 3 — Extract canvas renderer functions

- [x] Move `drawVoiceContour` and `drawPitchTrace` into `gridCanvasRenderers.ts`.
- [x] Keep signatures explicit; pass all dependencies as arguments.
- [x] Keep stroke/fill ordering exactly the same.
- [x] Verify `npm run build` passes.

### Phase 4 — Reduce event-handler density safely

- [x] Extract small pure helper functions used by mouse/keyboard handlers.
- [x] Keep React hooks (`useCallback`, `useEffect`) in `Grid.tsx`.
- [x] Verify drag/selection/focus paths unchanged.
- [x] Verify `npm run build` passes.

### Phase 5 — Optional final cleanup

- [x] Normalize file naming + exports through `grid/index.ts` if needed (no additional index changes were necessary).
- [x] Remove any dead imports/types.
- [x] Final build verification.

## Verification Protocol Per Phase

1. Make one focused move set.
2. Compile (`npm run build`).
3. If compile fails, fix immediately before next move.
4. Update checklist status in this file.

## Progress Log

- **Phase 1 completed**: extracted pure data utilities into `gridDataUtils.ts` and rewired `Grid.tsx` imports. Build passes.
- **Phase 2 completed**: extracted contour geometry/stacking/prism helpers into `gridContourUtils.ts` and rewired `Grid.tsx` imports. Build passes.
- **Phase 3 completed**: extracted `drawVoiceContour` + `drawPitchTrace` into `gridCanvasRenderers.ts` and rewired all call sites in `Grid.tsx`. Build passes.
- **Phase 4 completed**: extracted interaction helpers into `gridInteractionUtils.ts` (`pointToSegmentDistanceSq`, contour hit-testing helper, loop-handle helpers, editable-target guard) and rewired handler call sites in `Grid.tsx`. Build passes.
- **Phase 5 completed**: removed remaining dead handler imports/deps, validated current grid index exports, and re-ran final build verification.
- **Follow-up accuracy pass completed**: extracted group-drag delta math into `gridInteractionUtils.ts` (`getGroupDragDelta`), rewired `Grid.tsx` group-drag handler, and re-verified build/lint status for grid files.
