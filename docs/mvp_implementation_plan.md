# Harmony Singing App — MVP Implementation Plan

## Overview

This document outlines the step-by-step plan to build the Minimum Viable Product (MVP) of the Harmony Singing App. The app helps users learn to sing harmony by recording themselves over synth-guided arrangements displayed on a visual pitch grid.

**Tech Stack:**
- **Framework:** React + TypeScript + Vite
- **Styling:** TailwindCSS
- **Audio:** Web Audio API
- **Storage:** IndexedDB (via idb library)
- **Icons:** Lucide React

---

## Phase 1: Project Setup & Foundation ✅ COMPLETE

### 1.1 Initialize Project
- [x] Create Vite project with React + TypeScript template
- [x] Install dependencies:
  - TailwindCSS for styling
  - Lucide React for icons
  - idb for IndexedDB wrapper
- [x] Set up folder structure:
  ```
  src/
  ├── components/        # Reusable UI components
  │   ├── ui/           # Basic UI elements (buttons, sliders, etc.)
  │   ├── grid/         # Grid and contour visualization
  │   ├── transport/    # Playback controls
  │   ├── sidebar/      # Voice controls sidebar
  │   └── mixer/        # Mixer panel
  ├── hooks/            # Custom React hooks
  ├── services/         # Audio, pitch detection, storage
  ├── stores/           # State management
  ├── types/            # TypeScript type definitions
  ├── utils/            # Helper functions
  ├── data/             # Sample arrangements
  └── styles/           # Global styles
  ```

### 1.2 Define Core TypeScript Types
- [x] `Arrangement` type (id, title, tempo, bars, tonic, scale, voices)
- [x] `Voice` type (id, name, color, nodes)
- [x] `Node` type (t16, deg, term?)
- [x] `Performance` type (arrangement reference, recordings, mixer settings)
- [x] `Recording` type (voiceId, audioBlob, pitchTrace)

### 1.3 Set Up Global Styling
- [x] Configure TailwindCSS with custom theme colors:
  - Deep purple/pink gradient backgrounds (cosmic vibe from AI mockup)
  - Neon accent colors for voice lines (pink, blue, green, yellow, orange, purple)
  - Semi-transparent panel backgrounds
  - Glow effects for active elements
- [x] Create base component styles (buttons, panels, sliders)

---

## Phase 2: Core Audio Infrastructure ✅ COMPLETE

### 2.1 Audio Context & Routing
- [x] Create `AudioService` class to manage Web Audio API
- [x] Set up master audio graph:
  ```
  [Synth Voices] ──┬──> [Master Gain] ──> [Destination]
  [User Vocals] ───┘
  ```
- [x] Implement per-voice gain nodes for volume control
- [x] Add simple reverb using Tone.Reverb (global reverb send) — *Implemented (more advanced than planned)*

### 2.2 Synthesizer
- [x] Create `SynthVoice` class for playing reference tones
- [x] Use basic waveforms (sine/triangle) with ADSR envelope for smooth, rounded tones
- [x] Support for:
  - Playing a note at a specific frequency
  - Gliding between notes (portamento)
  - Note-off with release envelope

### 2.3 Microphone Input & Recording
- [x] Request microphone permission
- [x] Create `MicrophoneService` for:
  - Device enumeration (list available mics)
  - Input gain control
  - Starting/stopping recording
  - Capturing audio as Blob for storage

### 2.4 Pitch Detection
- [x] Implement pitch detection using autocorrelation (YIN-style algorithm)
- [x] Apply smoothing to reduce jitter:
  - Moving average filter
  - Confidence gating (ignore low-confidence detections)
  - Hysteresis to prevent rapid jumps
- [x] Output: continuous stream of (time, frequency, confidence) data

---

## Phase 3: Data Layer & State Management ✅ MOSTLY COMPLETE

### 3.1 Arrangement Data
- [x] Create 5+ sample arrangements in JSON format — *5 built-ins + auto-import from imported/*.json*
- [x] Start simple: 2-voice arrangements, then progress to 4-6 voices
- [x] Include variety:
  - Simple parallel motion
  - Contrary motion
  - Chord-based harmony
  - Different tempos and keys

### 3.2 State Management
- [x] Create React context or Zustand store for:
  - Current arrangement
  - Playback state (playing, position, tempo multiplier, loop points)
  - Recording state (armed voice, recording in progress)
  - Mixer state (per-voice volume, mute, solo)
  - Display settings (labels, zoom level)

### 3.3 IndexedDB Storage — *Deferred to post-MVP*
- [ ] Set up database schema:
  - `performances` store (saved user performances)
  - `settings` store (user preferences)
- [ ] Implement CRUD operations for performances:
  - Save performance (arrangement + recordings + mixer settings)
  - Load performance list
  - Load single performance
  - Delete performance

---

## Phase 4: Grid Visualization (Core Feature) ✅ COMPLETE

### 4.1 Grid Canvas Component
- [x] Create main `<Grid>` component using HTML Canvas or SVG
- [x] Render:
  - Background with vertical beat/subdivision lines
  - Horizontal pitch reference lines (subtle, degree 1 highlighted)
  - Optional chord labels above grid (blocks touch end-to-end)

### 4.2 Contour Line Rendering
- [x] Draw target contour lines for each voice:
  - Straight horizontal segments between nodes
  - Colored based on voice assignment
  - Glowing effect (drop shadow or multiple strokes)
- [x] Render nodes as circles at each pitch point
  - Show scale degree number inside node

### 4.3 User Pitch Trace
- [x] Overlay real-time pitch trace during recording
- [x] Draw as continuous line (reflecting actual pitch)
- [x] Use semi-transparent color matching the target voice
- [x] After recording: keep trace visible for comparison

### 4.4 Playhead
- [x] Draw vertical playhead line at current position
- [x] Smooth animation during playback (reads directly from PlaybackEngine)
- [x] Moving playhead on static grid

### 4.5 Zoom & Scroll
- [x] Implement zoom controls (zoom in/out)
- [x] Vertical zoom auto-adjusts to show all notes with 3 degrees padding
- [ ] When zoomed in: grid scrolls with playback — *Deferred*

---

## Phase 5: UI Components ✅ MOSTLY COMPLETE

### 5.1 Top Bar
- [x] **Level/Preset selector:** Button that opens arrangement library
- [x] **Mic Setup button:** Opens mic selection and gain controls
- [x] **Display button:** Toggle labels, chord track, etc.
- [x] **Play | Create toggle:** Mode selector (Create mode placeholder)
- [x] **Theme selector:** Switch between visual themes

### 5.2 Left Sidebar (Voice Controls)
- [x] **Arrangement info:** Shows key, tempo in TopBar
- [x] **Per-voice controls (V1-V6):**
  - Record arm button (red dot when armed)
  - Mute button (M)
  - Solo button (S)
  - Delete/clear recording button (trash icon)
  - Visual indicator: recorded vs. empty
- [x] **CLEAR button:** Clear all recordings

### 5.3 Transport Bar
- [x] **Play/Pause button:** Main playback toggle
- [x] **Loop toggle:** Enable/disable looping
- [x] **Speed selector:** 0.5x / 0.75x / 1.0x tempo multiplier
- [x] **Zoom controls:** Zoom in/out buttons
- [x] **Record button:** Start recording (click voice name in sidebar, not transport) — *Implemented via VoiceSidebar*
- [x] **Position display:** Shows current Bar:Beat
- [x] **Go to start button:** Reset position

### 5.4 Mixer Panel ✅ IMPLEMENTED
- [x] **Mixer button** in top bar opens mixer panel
- [x] Per-voice controls:
  - Volume slider
  - Pan knob (left/center/right)
  - Mute/Solo (synced with sidebar)
- [x] Separate sections for synth voices and recorded vocals
- [x] Master output level and global reverb

### 5.5 Arrangement Library Modal
- [x] Grid/list of available arrangements
- [x] Show: title, number of voices, difficulty indicator
- [x] Click to load arrangement
- [ ] Later: search/filter

### 5.6 Save/Load Performance Modal — *Deferred*
- [ ] **Save:** Enter name, save current performance
- [ ] **Load:** List saved performances, click to load
- [ ] **Delete:** Remove saved performance

---

## Phase 6: Playback Engine ✅ COMPLETE

### 6.1 Timeline & Scheduling
- [x] Create `PlaybackEngine` class
- [x] Convert arrangement nodes to scheduled synth events
- [x] Handle:
  - Play/pause
  - Loop (seamless restart at loop point)
  - Tempo multiplier (0.5x, 0.75x, 1.0x)
  - Position seeking (click on grid to jump) — *Basic support*

### 6.2 Synth Voice Playback
- [x] Schedule note-on/note-off events for each synth voice
- [x] Convert scale degree + tonic → actual frequency
- [x] Handle phrase termination nodes (silence until next phrase)
- [x] Respect mute/solo states

### 6.3 Recorded Vocal Playback ✅ IMPLEMENTED
- [x] Load recorded audio blobs into AudioBufferSourceNodes
- [x] Sync playback with timeline
- [x] Apply per-voice effects (volume, pan, mute/solo)
- [x] Respect mute/solo states

---

## Phase 7: Recording Flow ✅ MOSTLY COMPLETE

### 7.1 Record Preparation
- [x] User arms a voice (clicks record button on V1-V6)
- [x] Show visual feedback (voice highlighted, record indicator)
- [x] Check microphone is available

### 7.2 Count-In
- [x] When user presses main Record button:
  - Play 1-bar count-in (4 clicks at tempo) — *Implemented in PlaybackEngine*
  - [x] Show visual count-in overlay (large countdown number)

### 7.3 Recording Loop
- [x] Start recording audio from microphone
- [x] Start pitch detection, draw live trace on grid
- [x] Play synth voices (so user can sing along)
- [x] At end of loop: stop recording automatically (with option to keep playing)

### 7.4 Post-Recording
- [x] Store pitch trace data (in-session only)
- [x] Update UI to show recording exists for that voice
- [x] User can immediately play back or re-record
- [x] Recordings cleared on arrangement change

---

## Phase 8: Transposition & Vocal Range ✅ MOSTLY IMPLEMENTED

### 8.1 Vocal Range Settings
- [x] UI to set user's vocal range (low note, high note) — *In MicSetupModal*
- [x] Pitch detection assistance for setting range
- [x] Store in user preferences (session storage)

### 8.2 Auto-Transposition
- [x] Analyze arrangement to find its pitch range
- [x] Calculate optimal transposition to fit user's range
- [x] Apply global transpose (shift all notes by N semitones)
- [x] Update displayed tonic/key accordingly
- [x] Show notification when auto-transposition is applied

### 8.3 Out-of-Range Warning
- [ ] If notes still fall outside user's range after transposition:
  - Highlight problem notes on grid
  - Show warning message
  - Let user proceed anyway or adjust transposition

---

## Phase 9: Internal Authoring Tools (Create Mode) ✅ COMPLETE

This enables creating new arrangements within the app.

### 9.1 Basic Authoring Mode
- [x] Toggle into "Create" mode via button in TopBar
- [x] Modal UI for setting arrangement parameters: title, tempo, key, scale, bars, time signature
- [x] Add/remove voices in modal (up to 6)
- [x] Voice selector in sidebar shows "EDIT" mode with edit icon

### 9.2 Node Editing
- [x] Click on grid to place a node at that time/pitch position
- [x] Shift+click on existing node to remove it
- [x] Placing node on occupied time position replaces existing node
- [x] Nodes display scale degree number inside circle
- [x] Voice lines connect nodes with glow effect
- [x] Double-click a node to toggle termination point
- [x] Drag nodes to move them (time and pitch)

### 9.3 Export Arrangement
- [x] Export arrangement as JSON file (download button in Create mode)
- [ ] Save to library — *Needs in-app save workflow (currently export + import folder)*

### 9.4 Grid Enhancements
- [x] Chromatic (semitone-based) grid display with labels (1, b2, 2, b3, 3, 4, #4, 5, b6, 6, b7, 7)
- [x] Vertical zoom functionality (zoom in/out affects pitch range)
- [x] Tonic and octave lines highlighted for orientation

---

## Phase 10: Polish & Visual Design ✅ MOSTLY COMPLETE

### 10.1 Visual Theme (Cosmic/Dreamy Aesthetic)
- [x] Deep purple-to-pink gradient background
- [ ] Subtle particle/star animation in background
- [x] Glowing neon lines for contours
- [x] Semi-transparent frosted glass panels
- [x] Smooth animations and transitions
- [x] Hover and active states with glow effects
- [x] Multiple theme options (Cosmic, Default, Minimal, Sunset, Ocean)

### 10.2 Responsive Layout
- [ ] Target: Desktop screens (1280px+ width)
- [ ] Flexible grid that uses available space
- [ ] Collapsible sidebar option for smaller screens

### 10.3 Loading & Error States
- [ ] Loading spinner while arrangement loads
- [ ] Error messages for mic permission denied
- [ ] Confirmation dialogs for destructive actions (clear recordings)

### 10.4 Accessibility Basics
- [ ] Keyboard navigation for main controls
- [ ] Focus indicators
- [ ] Sufficient color contrast for text

---

## Phase 11: Testing & Sample Content

### 11.1 Sample Arrangements
- [ ] Create 10-15 arrangements covering:
  - 2-voice simple (beginner)
  - 3-voice (intermediate)
  - 4-voice (advanced)
  - Various keys and tempos
- [ ] Test each arrangement for playability

### 11.2 Manual Testing Checklist
- [ ] Playback works correctly at all speeds
- [ ] Recording captures audio and pitch correctly
- [ ] Pitch trace displays smoothly without excessive jitter
- [ ] Mute/solo works for all voices
- [ ] Mixer controls work
- [ ] Save/load performances work
- [ ] Transposition works
- [ ] UI is responsive and animations smooth

### 11.3 Browser Testing
- [ ] Chrome (primary target)
- [ ] Firefox
- [ ] Edge
- [ ] Safari (if possible; note: Web Audio quirks)

---

## Milestone Summary

| Milestone | Description | Est. Effort |
|-----------|-------------|-------------|
| **M1** | Project setup, types, basic UI shell | 2-3 days |
| **M2** | Audio infrastructure (synth, mic, pitch detection) | 4-5 days |
| **M3** | Grid visualization with contour lines | 3-4 days |
| **M4** | Playback engine (timeline, synth scheduling) | 2-3 days |
| **M5** | Recording flow (count-in, capture, pitch trace) | 3-4 days |
| **M6** | UI components (transport, sidebar, mixer) | 3-4 days |
| **M7** | Save/load (IndexedDB) | 1-2 days |
| **M8** | Transposition & vocal range | 1-2 days |
| **M9** | Internal authoring tools | 2-3 days |
| **M10** | Visual polish & testing | 3-4 days |
| **M11** | Sample content creation | 2-3 days |

**Total Estimated Time:** 26-37 days (varies based on experience and complexity encountered)

---

## Technical Risks & Mitigations

### Risk 1: Pitch Detection Accuracy
- **Issue:** Browser pitch detection can be noisy/unreliable
- **Mitigation:** Use well-tested algorithm (YIN), heavy smoothing, confidence thresholds

### Risk 2: Audio Latency
- **Issue:** Web Audio can have perceptible latency
- **Mitigation:** Accept small latency in pitch trace (visual feedback); compensate for recording offset in playback

### Risk 3: Cross-Browser Audio
- **Issue:** Safari/iOS have quirks with Web Audio
- **Mitigation:** Focus on Chrome/Firefox for MVP; address Safari issues later

### Risk 4: Performance (Rendering)
- **Issue:** Grid with many elements + real-time pitch trace could be slow
- **Mitigation:** Use Canvas for grid (not DOM elements); throttle pitch trace updates; optimize redraws

---

## File Structure Reference

```
HarmonySinging/
├── docs/
│   ├── harmony_singing_app_product_brief.md
│   └── mvp_implementation_plan.md (this file)
├── reference_images/
│   ├── harmony_app_sketch.png
│   └── harmony_app_AI_mockup.png
└── app/                          # Main application code
    ├── index.html
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── tsconfig.json
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── index.css
        ├── components/
        │   ├── ui/
        │   │   ├── Button.tsx
        │   │   ├── Slider.tsx
        │   │   ├── Panel.tsx
        │   │   └── Modal.tsx
        │   ├── grid/
        │   │   ├── Grid.tsx
        │   │   ├── ContourLine.tsx
        │   ├── transport/
        │   │   └── TransportBar.tsx
        │   ├── sidebar/
        │   │   └── VoiceSidebar.tsx
        │   ├── topbar/
        │   │   └── TopBar.tsx
        │   ├── modals/
        │   │   ├── LibraryModal.tsx
        │   │   ├── MicSetupModal.tsx
        │   │   ├── RangeSetupModal.tsx
        │   │   ├── DisplaySettingsModal.tsx
        │   │   ├── CreateArrangementModal.tsx
        │   │   └── MixerModal.tsx
        ├── hooks/
        │   ├── useAudio.ts
        │   ├── usePitchDetection.ts
        │   ├── useRecording.ts
        │   └── usePlayback.ts
        ├── services/
        │   ├── AudioService.ts
        │   ├── SynthVoice.ts
        │   ├── MicrophoneService.ts
        │   ├── PitchDetector.ts
        │   ├── PlaybackEngine.ts
        │   └── StorageService.ts
        ├── stores/
        │   └── appStore.ts
        ├── types/
        │   ├── arrangement.ts
        │   ├── performance.ts
        │   └── audio.ts
        ├── utils/
        │   ├── music.ts          # Scale/frequency calculations
        │   ├── timing.ts         # Beat/bar calculations
        │   └── colors.ts         # Voice color definitions
        └── data/
            └── arrangements/
                ├── index.ts
                ├── arr_001_two_part_warmup.json
                ├── arr_002_simple_thirds.json
                └── ... (more arrangements)
```

---

## Next Steps

1. **Review this plan** and ask questions about any unclear items
2. **Set up the project** (Phase 1)
3. **Build iteratively** — get basic audio working, then grid, then full flow
4. **Test frequently** — especially audio/pitch detection early

---

*Document created: February 2, 2026*
*Last updated: February 6, 2026*
