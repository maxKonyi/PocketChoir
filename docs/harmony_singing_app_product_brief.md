# Harmony Singing App — Product Brief

## 1) Concept

A music app that helps people **learn to sing and understand harmony by doing**: users listen to a short multi‑voice harmony “arrangement,” then **record themselves singing each part** while being guided by a **visual contour grid** and synth playback. Finished takes can be **saved** and eventually **shared** as audio/video.

**MVP delivery format:** a **web app** (desktop-first).

- If the web app is successful, we will explore porting to a **native desktop app** and adding **mobile** support.

The app also supports (later) a **Create** workflow where users make new arrangements either by drawing contour lines or singing them in, then share them in an online library.

---

## 2) Implementation Constraints (MVP)

### 2.1 Platform & Stack

- Build the MVP as a **desktop-first web app**.
- Recommended stack: **React + TypeScript + Vite** (or equivalent modern SPA stack).

### 2.2 Audio

- Use the **Web Audio API** for synthesis, playback, mixing, and routing.
- Keep synth reference tones simple and stable (basic waveforms + envelope).

### 2.3 Pitch Detection (User Recording)

- Use a proven browser pitch detector approach (e.g., autocorrelation/YIN-style).
- Prioritize **stability** over ultra-low latency.
- Apply smoothing and confidence gating to reduce jitter and suppress noise-induced jumps.

---

## 3) Primary Goals

1. **Fun first**: immediate, satisfying “sing + hear a cool harmony” experience.
2. **Beautiful & shareable**: exported playback should look and sound polished.
3. **Accessible to non‑theorists**: can be used with *zero* theory knowledge.
4. **Expandable for musicians**: optional theory overlays (chords, labels, analysis).

---

## 4) Target Users

- **Casual singers** who love harmonies but don’t read music.
- **Singers with some training** who want structured harmony practice.
- **Musicians/composers** who want to study arranging and harmony motion.

---

## 5) Core Interaction Model

### 4.1 The Grid (Main Visual)

- **X-axis = time** (bars + subdivisions).
- **Y-axis = pitch** (mapped to a scale; labels optional).
- Target harmony is defined by **discrete nodes** (scale steps) in MVP.
- **Rhythmic grid is mandatory in MVP**, with a maximum resolution of **16th notes**.
- **Contour timing model (authoring + playback):**
  - A **node** is placed at a time position (grid division) with a pitch.
  - A note’s **duration is implied** by the horizontal span from one node to the next.
  - A node can be marked as a **termination point** (phrase end):
    - The previous note ends at the termination node’s time.
    - The contour phrase stops there.
    - The next node placed starts a **new phrase/segment**.
  - **Rests** are represented by gaps between phrases and/or gaps in time before the next phrase begins.
  - If a node is added on a rhythmic division already occupied by a node, the existing node is **replaced**, and the contour connections update accordingly.
  - Later: grid can be optional to allow rubato-style performance where the user chooses the final loop endpoint.
- Each harmony voice is a **colored contour line** with **nodes** at rhythmic positions.
- Playback can be:
  - Zoomed out to see the whole arrangement.
  - Zoomed in so the grid **scrolls right-to-left** during playback.
- A **playhead** sits at the center (or fixed position), where notes trigger.

### 4.2 Listening & Practice Tools

- Harmony lines play back with **simple, rounded synth tones**.
- User can **solo/mute** any voice, adjust **levels**, set **loop points**, and change **playback speed**.

### 4.3 Recording & Feedback

- User selects a target voice (e.g., “Soprano / Voice 1”).
- App gives **count-in**, then records over the loop.
- While recording, the user’s pitch is drawn as a **live pitch trace** on the same grid:
  - **Target/blueprint contours:** steady straight segments between nodes, with a subtle Bezier-style curve as the line approaches the next node.
  - **User recording trace:** fully continuous curve.
- Recording stops at loop end.
- User repeats for 1–6 voices.

### 4.4 Playback of Results

- User can mute synths and hear **only their recorded voices**.
- Basic mix controls for user vocals: **volume, pan, reverb** per voice.
- Scoring is **out of MVP**.
  - Later: scoring can consider **intonation + rhythm**, with selectable **strictness** levels.

---

## 6) Modes

### 5.1 Play / Perform / Record Mode (Core)

User selects an arrangement (a “level”), listens, records each part, mixes, saves.

### 5.2 Create Mode (Later; may be needed internally)

Two creation inputs:

1. **Draw** contour lines on the grid (mouse/finger).
2. **Sing to create**: record voice → convert to contour nodes → user edits.

Create mode produces a reusable “arrangement file” that can be:

- Saved locally.
- Uploaded to an online library (later).

---

## 7) Content Structure

### 6.1 Levels / Path

A guided path from:

- **2‑part simple harmony** → up to
- **6‑part dense/jazz harmony**

Large library target: 100+ curated arrangements.

### 6.2 Arrangement Length

- Typical: **4 bars** (could be longer; keep short for replay/looping).

---

## 8) UI / Layout (Desktop Baseline)

### 8.0 MVP Defaults

- Default arrangement length: **4 bars**
- Default tempo multiplier options: **0.5 / 0.75 / 1.0**
- Default grid view: show **bars + 16ths**, labels **off**
- Default visible voices: show all voices in the arrangement (typical early levels: **2–4**)
- Default count-in: **1 bar** (or 4 clicks)

### 7.1 Top Bar (Global)

- Mode selector: Play / Create
- Input device selector + input gain
- Global display settings (labels on/off, chord track on/off, etc.)
- Library button (local)
- Online library button (later)

### 7.2 Center (Main Grid)

- Contour lines (synth “target”)
- Recorded pitch traces (user)
- Optional chord blocks track above grid

### 7.3 Transport Bar (Under Grid)

- Play/Pause
- Loop on/off + loop region controls
- Zoom level
- Tempo multiplier (playback speed)
- Possibly count‑in setting

### 7.4 Left Session Sidebar (Per‑Session)

Per voice (both target synth and user vocal):

- Record enable (for user vocals)
- Mute / Solo
- Clear / delete take
- Quick level control (or open mini menu)

### 7.5 Mixer

- Dedicated “Mixer” button opens a panel:
  - Volume / pan / reverb per user vocal
  - Volume per synth voice
  - Quick mute/solo all

---

## 9) Phone UI Considerations (Later)

- MVP is **desktop-first web app** (no mobile UI).
- When phone support is added, the app will be **vertical-first**.
- Same conceptual zones, but stacked:
  - Top: global controls
  - Middle: grid dominates
  - Bottom: transport + record controls
  - Voice controls: swipeable drawer / collapsible list / floating panel

---

## 10) Display Modes (Accessibility → Theory)

A spectrum from “no theory required” to “fully labeled analysis.”

### 9.1 Minimal

- No pitch labels.
- Pure contour + audio.

### 9.2 Intermediate

- Optional scale degree / solfège labels.

### 9.3 Maximal

- Chord blocks + chord names.
- Note labels per node (configurable):
  - Scale degree
  - Solfège
  - Note names (tonic‑relative or chord‑root‑relative)

---

## 11) Saving, Library, Sharing

### 11.1 Save (Local)

Saving an arrangement performance stores:

- Which arrangement was used
- All recorded vocal tracks
- User mix settings
- Completion status

**MVP save format:**

- Store performances in **IndexedDB** (preferred for audio blobs and larger data).
- Optionally allow a simple **“Download .json/.zip”** later; not required for MVP.

### 11.2 Export (Later)

- **Audio export**: mixed vocal performance (optionally with synths).
- **Video export (share mode)**: a “clean playback” view (no controls) showing the grid animation + audio.

### 11.3 Online (Later)

- Browse user-made arrangements
- Preview quickly
- Download into personal library
- Rate/tag
- Remix/edit and re-upload

---

## 12) Vocal Range & Transposition

Global setting: **user vocal range**.

- Arrangements can be **auto-transposed** into suitable keys.
- **All pitch labels and scale-degree labels are always relative to the chosen tonic**, and the tonic **moves with transposition** (e.g., an arrangement authored in C transposed to F will display labels in F).
- MVP transposition rule: **global transpose only**.
- If notes remain out of range:
  - Warn the user and **suggest changing the transposition**
  - User can still proceed and choose whether to attempt that line or not

---

## 13) Audio / Recording Requirements (High Level)

- Select microphone input + sensitivity.
- Option: monitor self while recording (on/off).
- Pitch tracking in real time to draw user trace.
- Pitch-trace rendering should be **responsive** but may include a small amount of latency.
- Apply smoothing and stability controls to avoid:
  - Erratic jitter
  - Sudden large pitch jumps caused by background noise / low confidence frames
- Recording is loop-bounded and aligned to timeline.

---

## 14) MVP Scope

### 14.0 MVP User Flow (Canonical)

1. Choose an arrangement (level) from the local library.
2. Press play and listen once (optionally solo/mute target voices).
3. Choose a voice to record and arm it.
4. Press record → receive count-in → record one loop pass.
5. Review playback (toggle target synth vs your recording).
6. Repeat recording for additional voices.
7. Adjust simple mix (levels + reverb) and **save** the performance.

### MVP Must Have

- **Desktop-first web app** Play/Record mode
- A small curated set of arrangements (e.g., 10–20 for testing)
- Grid display with target contours
  - Discrete nodes (scale steps)
  - Mandatory rhythmic grid up to 16th-note resolution
  - Duration implied by node-to-node spacing
  - Termination points to end phrases; phrases can restart later
  - Node replacement if a new node is placed on an occupied division
- Synth playback per voice (mute/solo)
- Looping + tempo multiplier + zoom + play/pause
- Record user audio per voice with count-in
- Real-time pitch trace visualization
  - Responsive with slight allowable latency
  - Smoothing and stability to prevent jitter and noise-driven leaps
- Basic playback of recorded voices
- Basic per-voice volume + reverb (simple)
- Local save/load of performances
- **Minimal internal authoring tools** (for you):
  - Grid with configurable length, tempo, and key
  - Click to place nodes on the grid
  - **Double-click** a node to mark it as a **termination point** (ends the current phrase)
  - Phrase breaks can be created **at any point** during authoring
  - Placing a node on an already-occupied rhythmic division **replaces** the existing node and updates the contour connections

### MVP Nice-to-Have

- Cleaner mixer UI
- Better arrangement browser

### Later / Post-MVP

- Scoring (intonation + rhythm, selectable strictness)
- Export (audio/video)
- Phone UI (vertical-first)
- Full Create mode for users
- Online library (upload/download/rate)
- Video recording of the singer (camera overlay)
- Auto-harmonize tools (generate harmony lines/chords)
- Advanced theory labeling and analysis tools

---

## 15) Data Model (Conceptual)

### 15.0 Canonical Arrangement JSON Example (Minimal)

```json
{
  "id": "arr_001",
  "title": "Two-Part Warmup",
  "timeSig": "4/4",
  "tempo": 96,
  "bars": 4,
  "tonic": "C",
  "scale": "major",
  "voices": [
    {
      "id": "v1",
      "name": "Voice 1",
      "color": "#ff6b6b",
      "nodes": [
        {"t16": 0,  "deg": 1},
        {"t16": 4,  "deg": 2},
        {"t16": 8,  "deg": 3, "term": true},
        {"t16": 12, "deg": 5},
        {"t16": 16, "deg": 4}
      ]
    },
    {
      "id": "v2",
      "name": "Voice 2",
      "color": "#4dabf7",
      "nodes": [
        {"t16": 0,  "deg": 5},
        {"t16": 8,  "deg": 6},
        {"t16": 16, "deg": 5}
      ]
    }
  ]
}
```

Notes:

- `t16` is time in **16th-note steps** from arrangement start.
- Each node’s **duration is implied** by the next node in the same phrase.
- A node with `term: true` is a **termination point**; the next node starts a new phrase (gap implies rest).
- Placing a node at an already-used `t16` replaces that node.

---

### Arrangement

### Arrangement

- Tempo, time signature
- Key/tonic (authoring tonic)
- Length (bars, beats)
- Optional chord track (chords + durations)
- Voices: 1–6
  - For each voice: an ordered list of **nodes**
    - time position (grid division)
    - pitch (discrete scale step)
    - flags: optional **termination** marker
  - Phrases/segments are derived from termination markers and/or explicit phrase breaks.
  - Note durations are derived from node-to-node spans within each phrase.
  - Rests are represented by gaps between phrases and/or time gaps before the next node/phrase.
  - Voice metadata (name, color)
- Display defaults (optional)

### Performance

- Arrangement reference + transposition
- Effective tonic/key after transposition (derived)
- For each voice: recorded audio + pitch trace data
- Mixer settings (vol/pan/reverb)
- Completion metadata (date, attempts, etc.)

---

## 16) One-Paragraph Summary

A harmony‑singing app where users learn harmony by recording themselves on multiple parts of short arrangements. The app shows each voice as a colored contour line on a time‑vs‑pitch grid, plays synth reference lines, and overlays the user’s live pitch trace during recording. Users loop sections, slow playback, solo/mute parts, then mix and **save** polished performances locally. Later, the app adds **export** (audio/video), phone support (vertical-first), and user-created harmonies shared through an online library of singable harmony “levels.”

