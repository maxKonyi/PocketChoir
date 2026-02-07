# Audit Fixes Progress

Branch: `audit-fixes`

## Priority Fixes

| # | ID | Description | Status |
|---|-----|-------------|--------|
| 1 | 3E | PitchDetector.recordingStartTime not cleared on stop() | ✅ |
| 2 | 3A | Out-of-bounds t16:64 in sixPartStressTest arrangement | ✅ |
| 3 | 3B | Hardcoded time sig in TransportBar formatPosition | ✅ |
| 4 | 3F | Stray ctx.stroke() after chord text in Grid.tsx | ✅ |
| 5 | 4A | CSS vars read 15x every frame at 60fps in Grid.tsx | ✅ |
| 6 | 4B | generateGridLines() re-created every frame in Grid.tsx | ✅ |
| 7 | 4D | sixteenthDurationMs called per trace point in inner loop | ✅ |
| 8 | 1A | Delete dead file utils/pitch.ts | ✅ |
| 9 | 1G | Remove orphaned RangeSetupModal + store state | ✅ |
| 10 | 3D | SynthVoice pan/filter missing for 4 of 6 voices | ✅ |

## Additional Cleanup (Lower Priority)

| ID | Description | Status |
|----|-------------|--------|
| 1C | Unused color utility functions in utils/colors.ts | ⬜ |
| 1D | Unused timing utility functions in utils/timing.ts | ⬜ |
| 1E | Unused suggestTransposition() in utils/music.ts | ⬜ |
| 1F | Unused createPitchDetector() factory | ⬜ |
| 1H | Unused type definitions in types/ | ⬜ |
| 2A | semitoneOffsetToY wrapper does nothing in Grid.tsx | ⬜ |
| 2B | Duplicate hexToRgb in DevControls.tsx | ⬜ |
| 2C | Duplicate anySoloActive computation in Grid.tsx draw loop | ⬜ |
| 2D | Pointless snapSemitoneToScaleMemo useCallback in Grid.tsx | ⬜ |
| 3C | MicSetupModal missing useEffect dependency | ⬜ |
| 5C | eslint-disable left in MicSetupModal.tsx | ⬜ |
| 5D | Duplicate section header comment in TransportBar.tsx | ✅ |

## Legend
- ⬜ Not started
- 🔧 In progress
- ✅ Done
