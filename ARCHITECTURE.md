# HarmonySinging App Architecture Guide

*This document helps AI assistants quickly understand the app structure and locate relevant files for debugging and development.*

## 🏗️ High-Level Architecture

**HarmonySinging** is a React + TypeScript web app for learning harmony singing through guided arrangements. Users can play pre-made arrangements or create their own, recording their voice and getting real-time pitch feedback.

### Core Technologies
- **Frontend**: React 18 + TypeScript + Vite
- **State Management**: Zustand (centralized store with localStorage persistence)
- **Audio**: Web Audio API + custom audio services
- **Styling**: TailwindCSS with CSS-in-JS for dynamic theming
- **Canvas**: HTML5 Canvas for music notation visualization

---

## 📁 Directory Structure

```
app/src/
├── components/          # React UI components
│   ├── grid/           # Main music notation grid (largest component)
│   ├── modals/         # All modal dialogs
│   ├── sidebar/        # Voice controls sidebar
│   ├── topbar/         # Top navigation bar
│   ├── transport/      # Playback controls
│   └── ui/             # Reusable UI components
├── services/           # Business logic and audio engines
├── stores/             # Zustand state management
├── hooks/              # Custom React hooks
├── utils/              # Pure utility functions
├── types/              # TypeScript type definitions
└── data/               # Static data and presets
```

---

## 🎯 Core Components & Their Responsibilities

### Main App Layout
**File**: `App.tsx`
- **Purpose**: Root component that orchestrates the entire application
- **Key Features**: 
  - Audio initialization and playback engine management
  - Global keyboard shortcuts (Space for play/pause/stop recording)
  - Middle-mouse camera panning
  - Undo/redo system
  - Modal and overlay coordination
- **When to modify**: Global layout changes, new keyboard shortcuts, audio system integration

### Music Grid (The Heart of the App)
**File**: `components/grid/Grid.tsx` (2,268 lines - largest component)
- **Purpose**: Main canvas displaying music notation, pitch contours, and user interactions
- **Key Features**:
  - Real-time pitch visualization during recording
  - Node creation, editing, and dragging in Create mode
  - Contour line rendering with rainbow prismatic effects for stacked voices
  - Playhead animation and camera following
  - Lyrics and chord track rendering
- **Recent Refactoring**: Split into multiple utility modules (see `grid_refactor_plan.md`)
- **When to modify**: Music notation bugs, visual rendering issues, interaction problems

**Grid Support Files**:
- `gridDataUtils.ts` - Pure data processing for lyrics, chords, pitch calculations
- `gridContourUtils.ts` - Contour stacking, rainbow rendering, voice overlap logic
- `gridInteractionUtils.ts` - Mouse interaction, hit testing, node selection
- `gridCanvasRenderers.ts` - Canvas drawing functions extracted from Grid.tsx
- `useGridRenderer.ts` - Hook managing canvas rendering orchestration
- `useGridInteractions.ts` - Hook handling all user interactions
- `useGridPlaybackCamera.ts` - Hook managing camera movement during playback
- `index.ts` - Grid module exports

### Voice Controls Sidebar
**File**: `components/sidebar/VoiceSidebar.tsx`
- **Purpose**: Per-voice controls for volume, mute, solo, recording arm
- **When to modify**: Voice mixer functionality, recording workflow

### CreateArrangementModal
**File**: `components/modals/CreateArrangementModal.tsx`
- **Purpose**: New arrangement creation and metadata editing
- **Key Features**:
  - MIDI file upload and parsing
  - Track selection and issue review modal
  - Auto-population of arrangement parameters from MIDI (tempo, time signature, key, scale, bars)
  - Voice creation from selected MIDI tracks (up to 6 voices)
- **When to modify**: MIDI import workflow, arrangement creation UI

### MidiImportPreview
**File**: `utils/midiImport.ts`
- **Purpose**: Parse MIDI files and convert tracks to app-compatible voice data
- **Key Features**:
  - Binary MIDI parsing (header, track chunks, meta events, note on/off)
  - MIDI key signature detection (Meta 0x59) with major/minor mode
  - Best-guess key detection when signature is missing (pitch-class duration scoring)
  - Monophonic track validation and percussion channel filtering
  - Conversion to Node[] with chromatic semitone offsets (relative to C4)
  - Preview metadata for UI review (issues, selectable tracks)
- **When to modify**: MIDI parsing bugs, key detection heuristics, track validation rules

### Transport Bar
**File**: `components/transport/TransportBar.tsx`
- **Purpose**: Play/pause/stop controls, tempo, loop, metronome
- **When to modify**: Playback controls, tempo handling

---

## 🔧 Services Layer (Business Logic)

### PlaybackEngine (Most Critical Service)
**File**: `services/PlaybackEngine.ts`
- **Purpose**: Core audio playback engine that drives the entire app
- **Key Features**:
  - Manages multiple voice synthesis
  - Handles recorded vocal playback
  - Provides timing callbacks for UI synchronization
  - Manages loop points, tempo, transposition
  - **MIDI Import Mode**: For arrangements tagged `midi-import`, treats `node.semi` as absolute from C4 (not tonic-relative), so key changes re-label grid without transposing imported pitches
- **When to modify**: Playback timing issues, audio synchronization problems, loop behavior, MIDI import pitch handling

### AudioService
**File**: `services/AudioService.ts`
- **Purpose**: Low-level Web Audio API management
- **Key Features**: Audio context initialization, master volume, reverb
- **When to modify**: Audio system initialization, global audio effects

### MicrophoneService
**File**: `services/MicrophoneService.ts`
- **Purpose**: Microphone input handling and recording management
- **When to modify**: Recording issues, microphone permissions

### PitchDetector
**File**: `services/PitchDetector.ts`
- **Purpose**: Real-time pitch detection from microphone input
- **When to modify**: Pitch detection accuracy, real-time performance

### SynthVoice
**File**: `services/SynthVoice.ts`
- **Purpose**: Individual voice synthesis using Web Audio API oscillators
- **When to modify**: Voice synthesis quality, instrument sounds

### LibraryService
**File**: `services/LibraryService.ts`
- **Purpose**: Arrangement library management (import/export)
- **When to modify**: File handling, arrangement persistence

---

## 🗄️ State Management (Zustand Store)

### Main Store
**File**: `stores/appStore.ts` (2,851 lines)
- **Purpose**: Centralized state for the entire application
- **Key State Slices**:
  - `arrangement` - Current musical arrangement
  - `playback` - Play/pause state, position, loop settings
  - `voiceStates` - Per-voice mixer settings
  - `recordings` - Map of voiceId → recorded audio blobs
  - `display` - UI settings (zoom, colors, track visibility)
  - `followMode` - Camera and timeline behavior
- **Persistence**: User settings automatically saved to localStorage
- **When to modify**: New state fields, state migration, persistence logic

---

## 🎵 Types System

### Core Types
**File**: `types/arrangement.ts`
- `Node` - Single pitch point in a voice (supports `deg`/`octave` or absolute `semi` offsets)
- `Voice` - Complete voice with nodes and color
- `Arrangement` - Full musical arrangement with multiple voices
- `Chord` - Chord track entries
- `LyricEntry` - Lyrics attached to Voice 1 nodes
- **MIDI Import Tags**: Arrangements created from MIDI are tagged `midi-import` to enable absolute semitone handling

### Audio Types
**File**: `types/performance.ts`
- `Recording` - Recorded audio with metadata and pitch trace
- `PitchPoint` - Real-time pitch data points

**File**: `types/audio.ts`
- `PlaybackState` - Current playback status
- `MicrophoneState` - Microphone input settings
- `AudioInputDevice` - Available audio devices
- `CountInSettings` - Recording count-in configuration
- `PitchDetectionSettings` - Pitch detection parameters
- `VocalRange` - User's vocal range for transposition

---

## 🎨 UI Components

### Modals (All in `components/modals/`)
- `LibraryModal.tsx` - Browse/load arrangements
- `MixerModal.tsx` - Advanced mixing controls
- `MicSetupModal.tsx` - Microphone configuration
- `DisplaySettingsModal.tsx` - Visual preferences (including scale-degree vs voice coloring)
- `CreateArrangementModal.tsx` - New arrangement creation with MIDI import
- `PresetBrowser.tsx` - Browse arrangement presets
- `MidiReviewModal.tsx` - Track selection and issue review for MIDI imports

### Reusable UI (`components/ui/`)
- `Button.tsx` - Styled button component
- `Panel.tsx` - Glass-morphism panels
- `Slider.tsx` - Custom slider controls
- `ConfirmDialog.tsx` - Confirmation dialogs

---

## 🔍 Common Debugging Scenarios

### 🎵 Audio/Playback Issues
**Check these files in order**:
1. `services/PlaybackEngine.ts` - Core playback logic
2. `services/AudioService.ts` - Audio context issues
3. `App.tsx` - Playback state synchronization
4. `stores/appStore.ts` - State management issues

### 🎤 Recording Problems
**Check these files**:
1. `services/MicrophoneService.ts` - Microphone handling
2. `services/PitchDetector.ts` - Pitch detection
3. `hooks/useRecording.ts` - Recording workflow
4. `App.tsx` - Recording state management

### 🎨 Visual/Grid Rendering Issues
**Check these files**:
1. `components/grid/Grid.tsx` - Main canvas rendering
2. `components/grid/gridCanvasRenderers.ts` - Drawing functions (including scale-degree coloring)
3. `components/grid/gridContourUtils.ts` - Contour calculations
4. `components/grid/gridDataUtils.ts` - Data processing
5. `utils/colors.ts` - Scale-degree color mapping (`SCALE_DEGREE_COLOR_MAP`)

### 🖱️ Interaction Problems
**Check these files**:
1. `components/grid/gridInteractionUtils.ts` - Hit testing and selection
2. `components/grid/useGridInteractions.ts` - Interaction orchestration
3. `components/grid/Grid.tsx` - Event handlers

### 📱 UI/Layout Issues
**Check these files**:
1. `App.tsx` - Main layout and component orchestration
2. Specific component files (sidebar, transport, etc.)
3. CSS classes and Tailwind utilities

---

## 🚀 Performance Considerations

### Critical Performance Files
- `App.tsx` - Throttles position updates to prevent 60fps re-renders
- `components/grid/Grid.tsx` - Canvas optimization, render loop management
- `services/PlaybackEngine.ts` - Audio callback efficiency
- `stores/appStore.ts` - State subscription optimization

### Performance Patterns
- **Selective Store Subscriptions**: Components only subscribe to specific store slices
- **Canvas Batching**: Drawing operations are batched for efficiency
- **Throttled Updates**: Position updates throttled to ~30fps during playback
- **Blob Caching**: Audio recordings cached to prevent re-decoding

---

## 🔄 Data Flow

### Playback Flow
1. User presses play → `App.tsx` handles state change
2. `PlaybackEngine` starts audio synthesis
3. Engine emits position callbacks → `App.tsx` updates store
4. Store update triggers `Grid.tsx` re-render → Playhead moves
5. Camera follows playhead via `useGridPlaybackCamera`

### Recording Flow
1. User arms voice and presses record → `useRecording` hook
2. `MicrophoneService` captures audio → `PitchDetector` analyzes pitch
3. Pitch data stored in real-time → `Grid.tsx` renders live pitch trace
4. User stops recording → Audio blob saved to store
5. `PlaybackEngine` syncs recording for immediate playback

### Editing Flow
1. User interacts with grid → `useGridInteractions` handles events
2. State changes applied to store → Optimized updates trigger re-renders
3. `PlaybackEngine` updates with new arrangement data
4. Canvas re-renders with updated visual state

---

## 📝 Development Guidelines

### Code Organization
- **Pure Functions**: Keep utility functions in `utils/` directory
- **Type Safety**: All data structures have TypeScript definitions
- **Component Splitting**: Large components split into focused hooks/modules
- **Service Layer**: Business logic separated from UI components

### State Management
- **Single Source of Truth**: All state in Zustand store
- **Immutable Updates**: Never mutate state directly
- **Selective Subscriptions**: Components only subscribe to needed state
- **Persistence**: User settings auto-save to localStorage

### Performance
- **Canvas Optimization**: Minimize draw calls, use efficient rendering
- **React Optimization**: Use useCallback, useMemo, and proper key props
- **Audio Performance**: Keep audio callbacks fast and efficient
- **Memory Management**: Clean up audio resources and event listeners

---

## 🎯 Quick Reference for Common Tasks

### Adding New Voice Features
1. Update `types/arrangement.ts` for new voice properties
2. Modify `stores/appStore.ts` voice state management
3. Update `components/sidebar/VoiceSidebar.tsx` UI
4. Handle in `services/PlaybackEngine.ts` for audio

### Adding New Visual Features
1. Update `types/` for new data structures
2. Add rendering logic to `components/grid/gridCanvasRenderers.ts`
3. Handle interaction in `components/grid/gridInteractionUtils.ts`
4. Update display settings in `stores/appStore.ts`

### Adding MIDI Import Features
1. Extend MIDI parsing in `utils/midiImport.ts`
2. Update preview UI in `components/modals/CreateArrangementModal.tsx`
3. Handle new metadata in arrangement creation flow
4. Test with various MIDI file formats and edge cases

### Debugging Audio Issues
1. Check browser console for Web Audio API errors
2. Verify `AudioService` initialization
3. Check `PlaybackEngine` state and callbacks
4. Ensure proper cleanup in component unmounts

---

## 📚 Additional Documentation

- `docs/harmony_singing_app_product_brief.md` - Product requirements and user stories
- `docs/grid_refactor_plan.md` - Detailed Grid component refactoring progress
- `docs/FollowMode.md` - Camera and timeline behavior documentation
- `docs/testing_workflow.md` - Testing procedures and guidelines

---

## 🎹 MIDI Import & Key-Aware Features (New)

### MIDI Import Workflow
1. **Upload**: User selects `.mid` file in CreateArrangementModal
2. **Parse**: `midiImport.ts` extracts tempo, time signature, key signature (if any), and tracks
3. **Detect Key**: If no key signature, best-guess from pitch distribution
4. **Validate**: Filter out polyphonic/percussion tracks, report issues
5. **Review**: Modal shows track list with issues, allows selection (max 6)
6. **Import**: Selected tracks become voices with `Node[]` using `semi` offsets

### Key-Aware Scale-Degree Coloring
- **Problem**: Scale-degree colors were fixed to C, so changing key shifted colors
- **Solution**: All scale-degree color mapping now offsets by arrangement tonic
- **Files**: `gridCanvasRenderers.ts` (contours), `useGridRenderer.ts` (nodes)
- **Result**: Tonic (1) is always blue in any key

### MIDI Import Pitch Stability
- **Tag**: Arrangements from MIDI are tagged `midi-import`
- **Behavior**: `node.semi` treated as absolute from C4, not tonic-relative
- **Effect**: Changing tonic in setup modal re-labels grid without transposing imported pitches
- **Files**: `PlaybackEngine.ts` (audio), `useGridRenderer.ts` (labels)

---

*This architecture document is maintained alongside the codebase. Update it when making significant structural changes.*
