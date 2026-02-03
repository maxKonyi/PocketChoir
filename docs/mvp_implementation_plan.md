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

## Phase 1: Project Setup & Foundation

### 1.1 Initialize Project
- [ ] Create Vite project with React + TypeScript template
- [ ] Install dependencies:
  - TailwindCSS for styling
  - Lucide React for icons
  - idb for IndexedDB wrapper
- [ ] Set up folder structure:
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
- [ ] `Arrangement` type (id, title, tempo, bars, tonic, scale, voices)
- [ ] `Voice` type (id, name, color, nodes)
- [ ] `Node` type (t16, deg, term?)
- [ ] `Performance` type (arrangement reference, recordings, mixer settings)
- [ ] `Recording` type (voiceId, audioBlob, pitchTrace)

### 1.3 Set Up Global Styling
- [ ] Configure TailwindCSS with custom theme colors:
  - Deep purple/pink gradient backgrounds (cosmic vibe from AI mockup)
  - Neon accent colors for voice lines (pink, blue, green, yellow, orange, purple)
  - Semi-transparent panel backgrounds
  - Glow effects for active elements
- [ ] Create base component styles (buttons, panels, sliders)

---

## Phase 2: Core Audio Infrastructure

### 2.1 Audio Context & Routing
- [ ] Create `AudioService` class to manage Web Audio API
- [ ] Set up master audio graph:
  ```
  [Synth Voices] ──┬──> [Master Gain] ──> [Destination]
  [User Vocals] ───┘
  ```
- [ ] Implement per-voice gain nodes for volume control
- [ ] Add simple reverb using ConvolverNode (or basic delay-based reverb)

### 2.2 Synthesizer
- [ ] Create `SynthVoice` class for playing reference tones
- [ ] Use basic waveforms (sine/triangle) with ADSR envelope for smooth, rounded tones
- [ ] Support for:
  - Playing a note at a specific frequency
  - Gliding between notes (portamento)
  - Note-off with release envelope

### 2.3 Microphone Input & Recording
- [ ] Request microphone permission
- [ ] Create `MicrophoneService` for:
  - Device enumeration (list available mics)
  - Input gain control
  - Starting/stopping recording
  - Capturing audio as Blob for storage

### 2.4 Pitch Detection
- [ ] Implement pitch detection using autocorrelation (YIN-style algorithm)
- [ ] Apply smoothing to reduce jitter:
  - Moving average filter
  - Confidence gating (ignore low-confidence detections)
  - Hysteresis to prevent rapid jumps
- [ ] Output: continuous stream of (time, frequency, confidence) data

---

## Phase 3: Data Layer & State Management

### 3.1 Arrangement Data
- [ ] Create 10-15 sample arrangements in JSON format
- [ ] Start simple: 2-voice arrangements, then progress to 4-6 voices
- [ ] Include variety:
  - Simple parallel motion
  - Contrary motion
  - Chord-based harmony
  - Different tempos and keys

### 3.2 State Management
- [ ] Create React context or Zustand store for:
  - Current arrangement
  - Playback state (playing, position, tempo multiplier, loop points)
  - Recording state (armed voice, recording in progress)
  - Mixer state (per-voice volume, mute, solo)
  - Display settings (labels, zoom level)

### 3.3 IndexedDB Storage
- [ ] Set up database schema:
  - `performances` store (saved user performances)
  - `settings` store (user preferences)
- [ ] Implement CRUD operations for performances:
  - Save performance (arrangement + recordings + mixer settings)
  - Load performance list
  - Load single performance
  - Delete performance

---

## Phase 4: Grid Visualization (Core Feature)

### 4.1 Grid Canvas Component
- [ ] Create main `<Grid>` component using HTML Canvas or SVG
- [ ] Render:
  - Background with vertical beat/subdivision lines
  - Horizontal pitch reference lines (subtle)
  - Optional chord labels above grid

### 4.2 Contour Line Rendering
- [ ] Draw target contour lines for each voice:
  - Straight horizontal segments between nodes
  - Subtle curve/transition approaching next node
  - Colored based on voice assignment
  - Glowing effect (drop shadow or multiple strokes)
- [ ] Render nodes as circles at each pitch point
  - Optional: show scale degree number inside node

### 4.3 User Pitch Trace
- [ ] Overlay real-time pitch trace during recording
- [ ] Draw as continuous, slightly wavy line (reflecting actual pitch)
- [ ] Use semi-transparent color matching the target voice
- [ ] After recording: keep trace visible for comparison

### 4.4 Playhead
- [ ] Draw vertical playhead line at current position
- [ ] Smooth animation during playback
- [ ] Option: fixed playhead with scrolling grid, or moving playhead on static grid

### 4.5 Zoom & Scroll
- [ ] Implement zoom controls (zoom in/out)
- [ ] When zoomed in: grid scrolls with playback
- [ ] When zoomed out: see entire arrangement

---

## Phase 5: UI Components

### 5.1 Top Bar
- [ ] **Level/Preset selector:** Button that opens arrangement library
- [ ] **Range button:** Opens vocal range settings (for transposition)
- [ ] **Mic Setup button:** Opens mic selection and gain controls
- [ ] **Display button:** Toggle labels, chord track, etc.
- [ ] **Play | Create toggle:** Mode selector (Create mode disabled for MVP, just a placeholder)

### 5.2 Left Sidebar (Voice Controls)
- [ ] **Tempo display:** Show current tempo (read-only for MVP)
- [ ] **Key display:** Show current key
- [ ] **Per-voice controls (V1-V6):**
  - Record arm button (red dot when armed)
  - Mute button (M)
  - Solo button (S)
  - Delete/clear recording button (trash icon)
  - Visual indicator: recorded vs. empty
- [ ] **CLEAR button:** Clear all recordings

### 5.3 Transport Bar
- [ ] **Play/Pause button:** Main playback toggle
- [ ] **Loop toggle:** Enable/disable looping
- [ ] **Speed selector:** 0.5x / 0.75x / 1.0x tempo multiplier
- [ ] **Zoom controls:** Zoom in/out buttons
- [ ] **Record button:** Start recording (only when a voice is armed)

### 5.4 Mixer Panel
- [ ] **Mixer button** in top bar or sidebar opens mixer panel
- [ ] Per-voice controls:
  - Volume slider
  - Pan knob (optional, simple left/center/right)
  - Reverb send slider
  - Mute/Solo (synced with sidebar)
- [ ] Separate sections for synth voices and recorded vocals
- [ ] Master output level

### 5.5 Arrangement Library Modal
- [ ] Grid/list of available arrangements
- [ ] Show: title, number of voices, difficulty indicator
- [ ] Click to load arrangement
- [ ] Later: search/filter

### 5.6 Save/Load Performance Modal
- [ ] **Save:** Enter name, save current performance
- [ ] **Load:** List saved performances, click to load
- [ ] **Delete:** Remove saved performance

---

## Phase 6: Playback Engine

### 6.1 Timeline & Scheduling
- [ ] Create `PlaybackEngine` class
- [ ] Convert arrangement nodes to scheduled synth events
- [ ] Handle:
  - Play/pause
  - Loop (seamless restart at loop point)
  - Tempo multiplier (0.5x, 0.75x, 1.0x)
  - Position seeking (click on grid to jump)

### 6.2 Synth Voice Playback
- [ ] Schedule note-on/note-off events for each synth voice
- [ ] Convert scale degree + tonic → actual frequency
- [ ] Handle phrase termination nodes (silence until next phrase)
- [ ] Respect mute/solo states

### 6.3 Recorded Vocal Playback
- [ ] Load recorded audio blobs into AudioBufferSourceNodes
- [ ] Sync playback with timeline
- [ ] Apply per-voice effects (volume, reverb)
- [ ] Respect mute/solo states

---

## Phase 7: Recording Flow

### 7.1 Record Preparation
- [ ] User arms a voice (clicks record button on V1-V6)
- [ ] Show visual feedback (voice highlighted, record indicator)
- [ ] Check microphone is available

### 7.2 Count-In
- [ ] When user presses main Record button:
  - Play 1-bar count-in (4 clicks at tempo)
  - Show visual count-in on grid
  - Optional: show countdown overlay (4, 3, 2, 1)

### 7.3 Recording Loop
- [ ] Start recording audio from microphone
- [ ] Start pitch detection, draw live trace on grid
- [ ] Play synth voices (so user can sing along)
- [ ] At end of loop: stop recording automatically

### 7.4 Post-Recording
- [ ] Store recorded audio blob
- [ ] Store pitch trace data
- [ ] Update UI to show recording exists for that voice
- [ ] User can immediately play back or re-record

---

## Phase 8: Transposition & Vocal Range

### 8.1 Vocal Range Settings
- [ ] UI to set user's vocal range (low note, high note)
- [ ] Store in user preferences

### 8.2 Auto-Transposition
- [ ] Analyze arrangement to find its pitch range
- [ ] Calculate optimal transposition to fit user's range
- [ ] Apply global transpose (shift all notes by N semitones)
- [ ] Update displayed tonic/key accordingly

### 8.3 Out-of-Range Warning
- [ ] If notes still fall outside user's range after transposition:
  - Highlight problem notes on grid
  - Show warning message
  - Let user proceed anyway or adjust transposition

---

## Phase 9: Internal Authoring Tools (For Content Creation)

This is for you (the developer/content creator) to make arrangements, not exposed to end users in MVP.

### 9.1 Basic Authoring Mode
- [ ] Toggle into "Create" mode
- [ ] Set arrangement parameters: tempo, key, bars, time signature
- [ ] Add/remove voices

### 9.2 Node Editing
- [ ] Click on grid to place a node at that time/pitch position
- [ ] Double-click a node to mark it as termination point
- [ ] Click existing node to select it, delete key to remove
- [ ] Drag node to move it (optional)
- [ ] Placing node on occupied time position replaces existing node

### 9.3 Export Arrangement
- [ ] Export arrangement as JSON file
- [ ] Copy to clipboard for easy pasting into app's data folder

---

## Phase 10: Polish & Visual Design

### 10.1 Visual Theme (Cosmic/Dreamy Aesthetic)
- [ ] Deep purple-to-pink gradient background
- [ ] Subtle particle/star animation in background
- [ ] Glowing neon lines for contours
- [ ] Semi-transparent frosted glass panels
- [ ] Smooth animations and transitions
- [ ] Hover and active states with glow effects

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
        │   │   ├── PitchTrace.tsx
        │   │   ├── Playhead.tsx
        │   │   └── ChordTrack.tsx
        │   ├── transport/
        │   │   └── TransportBar.tsx
        │   ├── sidebar/
        │   │   ├── VoiceSidebar.tsx
        │   │   └── VoiceControl.tsx
        │   ├── mixer/
        │   │   └── MixerPanel.tsx
        │   ├── topbar/
        │   │   └── TopBar.tsx
        │   └── modals/
        │       ├── LibraryModal.tsx
        │       ├── MicSetupModal.tsx
        │       ├── RangeModal.tsx
        │       └── SaveLoadModal.tsx
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
*Last updated: February 2, 2026*
