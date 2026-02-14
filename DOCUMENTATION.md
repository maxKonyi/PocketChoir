# Harmony Singing App Documentation

This document provides a comprehensive overview of the Harmony Singing application, covering both the user experience and the underlying technical architecture.

---

## 1. User Experience & High-Level Overview

### The Visual Vibe & Aesthetic
The Harmony Singing App features a **modern, immersive, and "liquid-glass" aesthetic**. The UI is designed to feel organic and fluid, moving away from the rigid, clinical look of traditional DAW (Digital Audio Workstation) software.
- **Glassmorphism**: Panels and controls use semi-transparent "glass" effects with backdrop blurs, allowing the ambient background (often a subtle video) to bleed through.
- **Organic Distortions**: Custom SVG filters (like the "liquid-glass" filter) create a wavy, underwater-like distortion on certain UI elements, emphasizing the fluid nature of singing and sound.
- **Dynamic Themes**: The entire color palette shifts with the selected theme (Midnight, Ember, Ocean, etc.), changing accent glows, text colors, and grid highlights to match the musical mood.

### The Grid: Melodic Contour Lines
The heart of the experience is the **Grid Visualizer**. Instead of discrete blocks, music is represented as **Melodic Contour Lines**:
- **Continuous Flow**: Notes are rendered as flowing paths, making it easy to visualize the "shape" of a melody—how it leaps, slides, and resolves.
- **Vocal-Centric Visualization**: The vertical axis is mapped to pitch (semitones), while the horizontal axis is time. This creates a direct mapping between the physical effort of singing higher/lower and the visual movement on the screen.
- **Real-Time Trace Overlay**: As you sing, your voice creates a live "ink" trace that dances over the target contour. This provides instant, visceral feedback on your pitch accuracy and vibrato.
- **The Minimap**: A condensed, high-level view of the entire song's contour sits at the top, allowing for quick navigation and a sense of "where you are" in the overall harmonic structure.

### User Journey
1.  **Selection**: The user starts by choosing an arrangement from the **Library**.
2.  **Preparation**: The user sets their vocal range in the **Mic Setup**, which allows the app to automatically transpose arrangements to a comfortable key.
3.  **Practice (Play Mode)**: The user listens to the "Synth" guide voices. A scrolling playhead moves across the grid, highlighting the notes to be sung.
4.  **Recording**: The user selects a specific voice (e.g., Soprano, Alto, Tenor, Bass) and records their vocal performance. A real-time pitch trace appears on the grid.
5.  **Refinement**: Using the **Mixer**, the user can balance the volumes of the guide synths and their own recorded vocals, add reverb, or solo specific parts.

---

## 2. Technical Implementation Summary

### Tech Stack
-   **Frontend**: React (TypeScript) + Vite
-   **State Management**: Zustand (with deep persistence for arrangements and recordings)
-   **Styling**: Tailwind CSS + Framer Motion (animations) + Custom SVG Filters
-   **Audio Engine**: Web Audio API

### Core Architecture & Low-Level Services
The app is built around a **Singleton Service Pattern**, ensuring consistent state across the audio thread:

1.  **`AudioService.ts` (The Foundation)**: 
    - Manages the global `AudioContext` and the primary signal chain.
    - Implements a master bus with gain control and a global convolution reverb.
    - Handles the initialization handshake required by modern browsers (user interaction guard).

2.  **`PlaybackEngine.ts` (The Timing Brain)**:
    - **Clock Management**: Uses a high-precision look-ahead scheduler for triggering synth notes and audio buffers.
    - **Position Sync**: Drives the `requestAnimationFrame` loop that provides the store with ~60fps position updates for the UI.
    - **Voice Management**: Orchestrates multiple `SynthVoice` instances and `AudioBufferSourceNodes` for recorded vocals.
    - **Looping Logic**: Handles seamless wrap-around logic for the playhead and scheduled events.

3.  **`PitchDetector.ts` (Low-Level DSP)**:
    - Implements pitch detection using the `Pitchy` library combined with custom autocorrelation logic.
    - Analyzes incoming `Float32Array` buffers from the microphone in real-time.
    - Converts raw frequency (Hz) into fractional MIDI notes for the UI's pitch-trace system.

4.  **`MicrophoneService.ts`**:
    - Wraps `MediaDevices.getUserMedia` and manages `AudioWorklet` or `ScriptProcessor` nodes for low-latency audio capture.
    - Emits high-frequency events containing both the raw audio samples and the detected pitch metadata.

5.  **`LibraryService.ts`**:
    - Manages persistence using `IndexedDB` (via the `idb` library).
    - Handles the serialization/deserialization of complex arrangement objects and audio Blobs.

### Key Data Flow & Performance
-   **Store Architecture**: The Zustand store is split into several "slices" but unified into a single state tree. 
-   **Performance Optimization**: 
    - **Throttled Subscriptions**: The root `App.tsx` component uses specific selectors to avoid re-rendering on every position update.
    - **Canvas-Based Rendering**: The Grid and Minimap utilize HTML5 Canvas for drawing thousands of contour points and traces efficiently.
    - **Blob Caching**: Recorded audio is stored as Blobs; the app uses a `useRef` cache to track which Blobs have been decoded into `AudioBuffers` to prevent redundant CPU usage.
    - **Lag Compensation**: A specialized `recordingLagMs` parameter is subtracted from the start time of recorded buffers to account for system-level audio latency, ensuring perfect sync between voices.

### AI Agent "Cheatsheet"
-   **Entry Point**: `@/app/src/App.tsx`
-   **Main Store**: `@/app/src/stores/appStore.ts`
-   **Audio Logic**: Look at `@/app/src/services/PlaybackEngine.ts`
-   **UI Components**: Divided into `@/app/src/components/grid` (visualizer) and `@/app/src/components/sidebar/transport/topbar` (controls).
-   **Hooks**: `useRecording.ts` encapsulates the complex state machine of starting/stopping recordings, handling count-ins, and cleaning up audio resources.
