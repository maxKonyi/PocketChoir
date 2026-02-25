/* ============================================================
   APP STORE
   
   Central state management using Zustand.
   Contains all application state: arrangement, playback, recording, etc.
   User settings are persisted to localStorage.
   ============================================================ */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Arrangement,
  Chord,
  LyricConnector,
  LyricEntry,
  LyricsTrack,
  Voice,
  Node as ArrangementNode,
  PlaybackState,
  MicrophoneState,
  Recording,
  PitchPoint,
  CountInSettings,
  VocalRange,
} from '../types';
import type { ThemeName } from '../utils/colors';
import { evaluateAutoFitTranspose, noteNameToFrequency, degreeToSemitoneOffset } from '../utils/music';
import { DEFAULT_VOICE_COLORS, normalizeHexColor } from '../utils/colors';
import type { CameraMode } from '../utils/smartCam';
import { quantizeT16, isT16Equal, type GridDivision } from '../utils/timing';

/* ------------------------------------------------------------
   State Types
   ------------------------------------------------------------ */

/**
 * Per-voice state that tracks both synth and recording status.
 */
interface VoiceState {
  voiceId: string;

  // Synth state
  synthVolume: number;      // 0-1
  synthMuted: boolean;
  synthSolo: boolean;
  synthPan: number;         // -1 to 1

  // Recording state
  isArmed: boolean;         // Ready to record
  hasRecording: boolean;    // Has a recording
  vocalVolume: number;      // 0-1
  vocalMuted: boolean;
  vocalSolo: boolean;
  vocalPan: number;         // -1 to 1
  vocalReverb: number;      // 0-1
}

/**
 * Display settings for the grid and labels.
 */
interface DisplaySettings {
  showMinimap: boolean;         // Show/hide the minimap (overview strip above the grid)
  showChordTrack: boolean;      // Show chord labels above grid
  showLyricsTrack: boolean;     // Show lyrics lane (create + play)
  showNoteLabels: boolean;      // Show labels on nodes (degree, solfege, or note name)
  labelFormat: 'degree' | 'solfege' | 'noteName';
  noteSize: number;             // 0.5-2.0, scale factor for node circles and their labels
  lineThickness: number;        // 0.25-4.0, scale factor for contour line stroke width
  zoomLevel: number;            // 1 = fit all, higher = zoomed in (vertical / pitch zoom)
  glowIntensity: number;        // 0-2, multiplier for glow effects
  gridOpacity: number;          // 0-1, opacity of grid elements
  snapCameraToPixels: boolean;  // Snap camera to device pixels (less shimmer, more micro-lurch)
  contourColorMode: 'voice' | 'scaleDegree'; // Color lines by voice or by scale degree
  backgroundVideo: string;      // Current background video path (or 'none')
  backgroundBlur: number;       // Blur amount in px
  backgroundBrightness: number; // 0-1 brightness
}

/**
 * Follow-mode timeline state.
 * Controls horizontal zoom, scrub/drag, and the scrolling camera.
 */
interface FollowModeState {
  pxPerT: number;                  // Pixels per 16th note (horizontal zoom). Higher = more zoomed in.
  minPxPerT: number;               // Floor for pxPerT so max zoom-out is limited (computed by Grid).
  viewportWidthPx: number;         // Actual drawable width of the main grid (CSS px, margins removed). Used by minimap to compute the viewport correctly.
  pendingWorldT: number | null;    // During a drag/scrub, the pending seek position. null = not dragging.
  isDraggingTimeline: boolean;     // True while the user is dragging the main timeline view.
  isDraggingMinimap: boolean;      // True while the user is dragging inside the minimap.
  cameraMode: CameraMode;         // User-selected camera behaviour: 'smart' | 'follow' | 'static'.
  pitchPanSemitones: number;       // Play-mode vertical pan offset (semitones). Separate from Create mode's.
  cameraFollowResetCount: number;  // Incremented when the restart button is pressed. Grid watches this to reset camera to follow.
}

/**
 * A unique identifier for a node within a voice.
 * Format: "voiceId:t16" — used for selection and clipboard.
 */
export type NodeKey = string;

/** Helper to create a NodeKey from voiceId + t16. */
export const makeNodeKey = (voiceId: string, t16: number): NodeKey => `${voiceId}:${t16}`;

/** Helper to parse a NodeKey back into { voiceId, t16 }. */
export const parseNodeKey = (key: NodeKey): { voiceId: string; t16: number } => {
  const idx = key.lastIndexOf(':');
  return { voiceId: key.slice(0, idx), t16: Number(key.slice(idx + 1)) };
};

/**
 * A copied node for the clipboard (stores enough info to paste).
 */
interface ClipboardNode {
  voiceId: string;  // Original voice
  t16: number;      // Original time
  deg: number;
  octave: number;
  semi?: number;
  term?: boolean;
}

/**
 * Create-mode view state.
 *
 * Create mode needs independent navigation (pan/scroll + zoom) that does NOT
 * steal left-click away from node placement/editing.
 */
interface CreateViewState {
  cameraWorldT: number;          // Camera center position in world-time (16th notes, monotonic)
  pitchPanSemitones: number;     // Vertical pan offset (semitones relative to the arrangement anchor)
  gridDivision: GridDivision;    // Current grid quantization division

  // ── Selection state ──
  selectedNodeKeys: Set<NodeKey>;   // Currently selected node keys ("voiceId:t16")
  clipboard: ClipboardNode[];       // Nodes copied via Ctrl+C / Ctrl+X
}

/**
 * When editing an arrangement's parameters, these are the supported fields.
 * (We intentionally keep this scoped to the essentials: title, tempo, length, key, scale, time signature.)
 */
export type ArrangementParamsUpdate = {
  title: string;
  description?: string;
  difficulty?: number;
  tempo: number;
  tonic: string;
  scale: Arrangement['scale'];
  bars: number;
  timeSig: { numerator: number; denominator: number };
};



interface ArrangementSnapshot {
  arrangement: Arrangement;
  voiceStates: VoiceState[];
  selectedVoiceId: string | null;
}



/**
 * Maximum number of voices/tracks supported in the arranger UI.
 * Keeping this as a shared constant lets the modal and sidebar stay in sync.
 */
export const MAX_VOICES = 6;

const HISTORY_LIMIT = 100;

/**
 * Return the default stereo pan for a voice index.
 * Matches the spread used by the SynthVoice factory so the mix feels balanced.
 */
const getDefaultPanForIndex = (voiceIndex: number): number => {
  if (voiceIndex === 1) return -0.8;
  if (voiceIndex === 2) return 0.8;
  return 0;
};

/**
 * Create a hydrated VoiceState entry for a given voice.
 */
const createVoiceState = (voiceId: string, voiceIndex: number): VoiceState => ({
  voiceId,
  synthVolume: 0.5,
  synthMuted: false,
  synthSolo: false,
  synthPan: getDefaultPanForIndex(voiceIndex),
  isArmed: false,
  hasRecording: false,
  vocalVolume: 0.8,
  vocalMuted: false,
  vocalSolo: false,
  vocalPan: getDefaultPanForIndex(voiceIndex),
  vocalReverb: 0.3,
});

/**
 * Generate a unique voice ID that does not conflict with existing voices.
 */
const generateVoiceId = (existingVoices: Voice[]): string => {
  const existingIds = new Set(existingVoices.map((voice) => voice.id));
  let counter = existingVoices.length + 1;
  let candidate = `v${counter}`;

  while (existingIds.has(candidate)) {
    counter += 1;
    candidate = `v${counter}`;
  }

  return candidate;
};

/**
 * Lightweight deep clone helper used for history snapshots.
 */
const clone = <T>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const createSnapshot = (state: AppState): ArrangementSnapshot | null => {
  if (!state.arrangement) return null;
  return {
    arrangement: clone(state.arrangement),
    voiceStates: clone(state.voiceStates),
    selectedVoiceId: state.selectedVoiceId,
  };
};

const prepareHistoryUpdate = (state: AppState) => {
  const snapshot = createSnapshot(state);
  if (!snapshot) return null;
  const nextHistory = [...state.history, snapshot];
  if (nextHistory.length > HISTORY_LIMIT) {
    nextHistory.shift();
  }
  return {
    history: nextHistory,
    future: [],
    canUndo: true,
    canRedo: false,
  } as Pick<AppState, 'history' | 'future' | 'canUndo' | 'canRedo'>;
};

const applySnapshot = (snapshot: ArrangementSnapshot) => ({
  arrangement: clone(snapshot.arrangement),
  voiceStates: clone(snapshot.voiceStates),
  selectedVoiceId: snapshot.selectedVoiceId,
});

/**
 * Return all regular (non-anchor) melody nodes from Voice 1.
 * Lyrics are only allowed to attach to these nodes.
 */
const getVoice1MelodyNodes = (arrangement: Arrangement): ArrangementNode[] => {
  const voice1 = arrangement.voices[0];
  if (!voice1) return [];
  return voice1.nodes
    .filter((node) => !node.term)
    .sort((a, b) => a.t16 - b.t16);
};

/**
 * Build a fast lookup of valid Voice 1 melody-node times.
 */
const getVoice1MelodyNodeTimeSet = (arrangement: Arrangement): Set<number> => {
  return new Set(getVoice1MelodyNodes(arrangement).map((node) => node.t16));
};

type LyricPayload = {
  text: string;
  connectorToNext?: LyricConnector;
};

/**
 * Allow only known lyric connector values.
 */
const normalizeLyricConnector = (value: unknown): LyricConnector | undefined => {
  if (value === 'dash' || value === 'hold') return value;
  return undefined;
};

/**
 * Normalize one lyric payload.
 *
 * Backward compatibility:
 * Older saved data may encode connector intent by trailing text symbols:
 * - "Wel-"   -> text "Wel" + connector "dash"
 * - "ther___" -> text "ther" + connector "hold"
 */
const normalizeLyricPayload = (rawText: unknown, rawConnector: unknown): LyricPayload => {
  let text = String(rawText ?? '').trim();
  let connector = normalizeLyricConnector(rawConnector);

  if (!connector) {
    if (/_+$/.test(text)) {
      connector = 'hold';
      text = text.replace(/_+$/, '').trimEnd();
    } else if (/-+$/.test(text)) {
      connector = 'dash';
      text = text.replace(/-+$/, '').trimEnd();
    }
  }

  return {
    text,
    ...(connector ? { connectorToNext: connector } : {}),
  };
};

/**
 * A lyric row is meaningful if it has either visible text OR a connector.
 */
const hasLyricPayloadContent = (payload: LyricPayload): boolean => {
  return payload.text.length > 0 || payload.connectorToNext !== undefined;
};

/**
 * Normalize a lyrics track so it always follows these rules:
 * - entries are attached only to existing Voice 1 melody nodes
 * - entry text is trimmed
 * - legacy suffixes ("-", "___") are migrated into connector metadata
 * - connectors exist only when a following Voice 1 node exists
 * - there is at most one entry per t16
 * - entries are sorted by time
 */
const normalizeLyricsTrack = (
  lyrics: LyricsTrack | undefined,
  arrangement: Arrangement
): LyricsTrack => {
  const voice1Nodes = getVoice1MelodyNodes(arrangement);
  const validTimes = new Set(voice1Nodes.map((node) => node.t16));

  // Connector is legal only when there is a next Voice 1 melody node.
  const hasNextNodeByT16 = new Set<number>();
  for (let i = 0; i < voice1Nodes.length - 1; i++) {
    hasNextNodeByT16.add(voice1Nodes[i].t16);
  }

  const merged = new Map<number, LyricPayload>();

  for (const entry of lyrics?.entries ?? []) {
    if (!Number.isFinite(entry.t16)) continue;

    let matchedT16: number | undefined;
    for (const valid of validTimes) {
      if (isT16Equal(valid, entry.t16)) {
        matchedT16 = valid;
        break;
      }
    }
    if (matchedT16 === undefined) continue;

    const payload = normalizeLyricPayload(entry.text, entry.connectorToNext);
    const connectorToNext = hasNextNodeByT16.has(matchedT16)
      ? payload.connectorToNext
      : undefined;

    const normalizedPayload: LyricPayload = {
      text: payload.text,
      ...(connectorToNext ? { connectorToNext } : {}),
    };

    if (!hasLyricPayloadContent(normalizedPayload)) continue;
    merged.set(matchedT16, normalizedPayload);
  }

  const entries: LyricEntry[] = [...merged.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t16, payload]) => ({
      t16,
      text: payload.text,
      ...(payload.connectorToNext ? { connectorToNext: payload.connectorToNext } : {}),
    }));

  return {
    enabled: lyrics?.enabled ?? false,
    entries,
  };
};

/**
 * Move lyric entries alongside moved Voice 1 melody nodes.
 *
 * `moveMap` maps old node t16 -> new node t16.
 */
const remapLyricsEntries = (
  entries: LyricEntry[],
  moveMap: Map<number, number>,
  validTimes: Set<number>
): LyricEntry[] => {
  const movedFrom = new Set(moveMap.keys());
  const result = new Map<number, LyricPayload>();

  // First keep entries that were not moved.
  for (const entry of entries) {
    if (movedFrom.has(entry.t16)) continue;
    if (!validTimes.has(entry.t16)) continue;
    const payload = normalizeLyricPayload(entry.text, entry.connectorToNext);
    if (!hasLyricPayloadContent(payload)) continue;
    result.set(entry.t16, payload);
  }

  // Then apply moved entries so moved notes win on collisions.
  for (const entry of entries) {
    const mappedT16 = moveMap.get(entry.t16);
    if (mappedT16 === undefined) continue;
    if (!validTimes.has(mappedT16)) continue;
    const payload = normalizeLyricPayload(entry.text, entry.connectorToNext);
    if (!hasLyricPayloadContent(payload)) continue;
    result.set(mappedT16, payload);
  }

  return [...result.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t16, payload]) => ({
      t16,
      text: payload.text,
      ...(payload.connectorToNext ? { connectorToNext: payload.connectorToNext } : {}),
    }));
};

/**
 * Return a copy of the arrangement with a normalized lyrics track.
 */
const withNormalizedLyricsTrack = (arrangement: Arrangement): Arrangement => {
  return {
    ...arrangement,
    lyrics: normalizeLyricsTrack(arrangement.lyrics, arrangement),
  };
};

/**
 * Complete application state.
 */
interface AppState {
  // Current arrangement
  arrangement: Arrangement | null;
  transposition: number;        // Semitones to transpose

  // Pending auto-transposition confirmation modal payload.
  // When present, UI should ask whether to keep the transposed key or reset to original.
  autoTranspositionPrompt: {
    semitones: number;
    title: string;
    message: string;
    details: string[];
  } | null;

  // Voice states (one per voice in arrangement)
  voiceStates: VoiceState[];

  // User-customized voice colors keyed by voice ID (e.g., v1, v2).
  // We keep this separate so colors can persist across app reloads.
  voiceColorOverrides: Record<string, string>;

  // Playback state
  playback: PlaybackState;

  // Global Mix
  globalVolume: number;         // 0-1
  globalReverb: number;         // 0-1

  // Recording
  armedVoiceId: string | null;  // Which voice is armed for recording
  recordings: Map<string, Recording>; // voiceId -> recording
  livePitchTrace: PitchPoint[]; // Current recording's pitch trace
  livePitchTraceVoiceId: string | null; // Which voice the live trace belongs to

  // Microphone
  microphoneState: MicrophoneState;

  // Count-in settings
  countIn: CountInSettings;

  // Vocal range for transposition
  vocalRange: VocalRange;

  // Display settings
  display: DisplaySettings;

  // Theme
  theme: ThemeName;

  // App mode
  mode: 'play' | 'create';
  selectedVoiceId: string | null;  // Voice selected for editing in create mode

  // UI state
  isLibraryOpen: boolean;
  isMixerOpen: boolean;
  isMicSetupOpen: boolean;
  isDisplaySettingsOpen: boolean;
  isSaveLoadOpen: boolean;
  isCreateModalOpen: boolean;
  isHelpOpen: boolean;

  // History (undo/redo)
  history: ArrangementSnapshot[];
  future: ArrangementSnapshot[];
  canUndo: boolean;
  canRedo: boolean;

  // Follow-mode timeline
  followMode: FollowModeState;

  // Create-mode navigation view
  createView: CreateViewState;

  // Create arrangement modal
  // - 'create': create a new arrangement
  // - 'edit': edit params of the currently loaded arrangement (while in Create mode)
  createModalMode: 'create' | 'edit';

  // If non-null, the currently edited arrangement came from My Library and
  // should overwrite this library item on save.
  editingLibraryItemId: string | null;
}

/**
 * Actions that can modify the state.
 */
interface AppActions {
  // Arrangement
  setArrangement: (arrangement: Arrangement | null) => void;
  setTransposition: (semitones: number) => void;
  addVoiceTrack: () => void;

  // History controls
  undo: () => void;
  redo: () => void;
  // Push a single undo checkpoint without changing arrangement data.
  // Grid drag handlers use this once at drag-start so all intermediate drag
  // frames can be history-suppressed and undo still returns to pre-drag state.
  pushHistoryCheckpoint: () => void;

  // Helpers (Chord Track)
  getTotalT16: (arrangement: Arrangement) => number;
  createDefaultChordTrack: (arrangement: Arrangement) => Chord[];
  normalizeChordTrack: (chords: Chord[], totalT16: number) => Chord[];

  // Auto-transpose helper
  // Calculates a transposition based on the current arrangement + vocal range.
  // If `prompt` is true and a non-zero shift is needed, it opens a confirmation modal.
  applyAutoTranspositionIfPossible: (prompt: boolean) => void;
  dismissAutoTranspositionPrompt: () => void;

  // Create mode - node editing
  addNode: (voiceId: string, t16: number, deg: number, octave?: number, semi?: number) => void;
  removeNode: (voiceId: string, t16: number) => void;
  updateNode: (
    voiceId: string,
    oldT16: number,
    newT16: number,
    deg: number,
    octave?: number,
    term?: boolean,
    semi?: number,
    options?: { recordHistory?: boolean }
  ) => void;
  setSelectedVoiceId: (voiceId: string | null) => void;

  // Create mode - node selection
  selectNode: (key: NodeKey) => void;                     // Click: select one (clears others)
  addNodeToSelection: (key: NodeKey) => void;             // Shift+click: add one to selection
  toggleNodeInSelection: (key: NodeKey) => void;          // Ctrl+click: toggle one in selection
  clearNodeSelection: () => void;                          // Clear all selected nodes
  setNodeSelection: (keys: Set<NodeKey>) => void;         // Replace selection with a new set
  addNodesToSelection: (keys: Set<NodeKey>) => void;      // Union new keys into selection

  // Create mode - clipboard
  copySelectedNodes: () => void;                           // Ctrl+C
  cutSelectedNodes: () => void;                            // Ctrl+X
  pasteNodes: (playheadT16: number) => void;               // Ctrl+V — paste at playhead
  duplicateSelectedNodes: () => void;                      // Ctrl+D

  // Create mode - bulk operations
  deleteSelectedNodes: () => void;                         // Delete/Backspace
  moveSelectedNodes: (
    deltaT16: number,
    deltaSemitones: number,
    options?: { recordHistory?: boolean }
  ) => void;  // Group drag

  // Create mode - voice management
  renameVoice: (voiceId: string, newName: string) => void;
  setVoiceColor: (voiceId: string, color: string) => void;
  clearVoiceNodes: (voiceId: string) => void;
  clearAllVoiceNodes: () => void;

  // Create mode - chord track editing
  enableChordTrack: () => void;
  disableChordTrack: () => void;
  setChordName: (chordIndex: number, name: string) => void;
  splitChordAt: (t16: number) => void;
  resizeChordBoundary: (leftChordIndex: number, newBoundaryT16: number) => void;
  deleteChord: (chordIndex: number) => void;

  // Create mode - lyrics track editing
  enableLyricsTrack: () => void;
  disableLyricsTrack: () => void;
  setLyricEntry: (
    t16: number,
    text: string,
    options?: { connectorToNext?: LyricConnector | null }
  ) => void;

  // Create mode - arrangement parameter editing
  updateArrangementParams: (update: ArrangementParamsUpdate) => void;

  // Voice controls
  setVoiceSynthVolume: (voiceId: string, volume: number) => void;
  setVoiceSynthMuted: (voiceId: string, muted: boolean) => void;
  setVoiceSynthSolo: (voiceId: string, solo: boolean) => void;
  setVoiceSynthPan: (voiceId: string, pan: number) => void;
  setVoiceVocalVolume: (voiceId: string, volume: number) => void;
  setVoiceVocalMuted: (voiceId: string, muted: boolean) => void;
  setVoiceVocalSolo: (voiceId: string, solo: boolean) => void;
  setVoiceVocalPan: (voiceId: string, pan: number) => void;
  setVoiceVocalReverb: (voiceId: string, reverb: number) => void;

  // Focus (replaces per-track solo buttons)
  // "Focus" solos BOTH synth and vocal for a voice simultaneously.
  // Clicking a contour line can either replace focus (single-focus) or toggle
  // membership (multi-focus via Shift+click).
  toggleFocus: (voiceId: string) => void;
  focusOnlyVoice: (voiceId: string) => void;
  clearAllFocus: () => void;
  cleanupFocusForExistingContours: () => void;

  // Global Mix
  setGlobalVolume: (volume: number) => void;
  setGlobalReverb: (reverb: number) => void;

  // Recording
  armVoice: (voiceId: string | null) => void;
  addRecording: (voiceId: string, recording: Recording) => void;
  clearRecording: (voiceId: string) => void;
  clearAllRecordings: () => void;
  setLivePitchTrace: (trace: PitchPoint[], voiceId?: string | null) => void;
  addPitchPoint: (point: PitchPoint) => void;

  // Playback
  setPlaying: (playing: boolean) => void;
  setRecording: (recording: boolean) => void;
  setPosition: (t16: number) => void;
  setPositionMs: (ms: number) => void;
  setLoopEnabled: (enabled: boolean) => void;
  setLoopPoints: (start: number, end: number) => void;
  setTempoMultiplier: (multiplier: number) => void;
  setMetronomeEnabled: (enabled: boolean) => void;

  // Microphone
  setMicrophoneState: (state: Partial<MicrophoneState>) => void;

  // Count-in
  setCountIn: (settings: Partial<CountInSettings>) => void;

  // Vocal range
  setVocalRange: (range: Partial<VocalRange>) => void;

  // Display
  setDisplaySettings: (settings: Partial<DisplaySettings>) => void;
  setZoomLevel: (zoom: number) => void;

  // Follow-mode timeline
  setPxPerT: (pxPerT: number) => void;
  setMinPxPerT: (minPxPerT: number) => void;
  setFollowViewportWidthPx: (viewportWidthPx: number) => void;
  setHorizontalZoom: (direction: 'in' | 'out') => void;
  setCameraMode: (mode: CameraMode) => void;
  startTimelineDrag: () => void;
  updatePendingWorldT: (worldT: number) => void;
  commitTimelineDrag: () => void;
  cancelTimelineDrag: () => void;
  startMinimapDrag: () => void;
  commitMinimapDrag: () => void;
  cancelMinimapDrag: () => void;

  // Camera follow reset (used by restart button to signal Grid)
  triggerCameraFollowReset: () => void;

  // Play-mode vertical pan (separate from Create mode)
  setPlayPitchPanSemitones: (semitones: number) => void;
  adjustPlayPitchPanSemitones: (deltaSemitones: number) => void;
  setGridDivision: (division: GridDivision) => void;

  // Create mode - navigation
  setCreateCameraWorldT: (worldT: number) => void;
  adjustCreateCameraWorldT: (deltaWorldT: number) => void;
  setCreatePitchPanSemitones: (semitones: number) => void;
  adjustCreatePitchPanSemitones: (deltaSemitones: number) => void;
  resetCreateView: () => void;

  // Theme
  setTheme: (theme: ThemeName) => void;

  // Mode
  setMode: (mode: 'play' | 'create') => void;

  // UI modals
  setLibraryOpen: (open: boolean) => void;
  setMixerOpen: (open: boolean) => void;
  setMicSetupOpen: (open: boolean) => void;
  setDisplaySettingsOpen: (open: boolean) => void;
  setSaveLoadOpen: (open: boolean) => void;
  setCreateModalOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  setCreateModalMode: (mode: 'create' | 'edit') => void;
  setEditingLibraryItemId: (itemId: string | null) => void;

  // Utility
  initializeVoiceStates: (voices: Voice[]) => void;
  reset: () => void;
}

/* ------------------------------------------------------------
   Initial State
   ------------------------------------------------------------ */

const initialPlaybackState: PlaybackState = {
  isPlaying: false,
  isRecording: false,
  position: 0,
  positionMs: 0,
  loopEnabled: false,     // Loop OFF by default — one-shot play through the arrangement
  loopStart: 0,
  loopEnd: 64,           // Default 4 bars in 4/4 = 64 sixteenths (reset per arrangement)
  tempoMultiplier: 1.0,
  metronomeEnabled: false,
};

/**
 * Compute the default practice-loop end point for an arrangement.
 *
 * Rule requested by product behavior:
 * - Default loop = first 4 bars
 * - If arrangement is shorter than 4 bars, loop the whole arrangement
 */
function getDefaultLoopEndT16(arrangement: Arrangement): number {
  const totalSixteenths = arrangement.bars * arrangement.timeSig.numerator * 4;
  const firstFourBarsSixteenths = 4 * arrangement.timeSig.numerator * 4;
  return Math.max(0, Math.min(totalSixteenths, firstFourBarsSixteenths));
}

const initialMicrophoneState: MicrophoneState = {
  available: false,
  devices: [],
  selectedDeviceId: null,
  inputGain: 1.0,
  monitoring: false,
  isRecording: false,
  lowLatencyPitch: false,
  recordingLagMs: 0,
  recordingLagIsManual: false,
};

const initialCountIn: CountInSettings = {
  enabled: true,
  bars: 1,
  audible: true,
  visual: true,
};

const initialVocalRange: VocalRange = {
  lowNote: 'C3',
  highNote: 'C5',
  lowFrequency: 130.81,  // C3
  highFrequency: 523.25, // C5
};

const initialDisplaySettings: DisplaySettings = {
  showMinimap: false,
  showChordTrack: true,
  showLyricsTrack: true,
  showNoteLabels: true,
  labelFormat: 'degree',
  noteSize: 1.0,
  lineThickness: 1.0,
  zoomLevel: 1,
  glowIntensity: 0.0,
  gridOpacity: 0.0,
  snapCameraToPixels: false,
  contourColorMode: 'voice',
  backgroundVideo: '/src/data/backgrounds/Tree1(loop).mp4',
  backgroundBlur: 0,
  backgroundBrightness: 1.0,
};

// Default follow-mode state.
// pxPerT = 10 means each 16th note is 10px wide.
// For a 4-bar arrangement in 4/4 (64 sixteenths), that's 640px total per loop.
const initialFollowModeState: FollowModeState = {
  pxPerT: 10,
  minPxPerT: 0.5,
  viewportWidthPx: 0,
  pendingWorldT: null,
  isDraggingTimeline: false,
  isDraggingMinimap: false,
  cameraMode: 'smart',              // Default camera mode: Smart (auto follow/static)
  pitchPanSemitones: 0,             // Play-mode vertical pan offset (separate from Create mode)
  cameraFollowResetCount: 0,        // Incremented by restart button so Grid resets camera to follow
};

const initialCreateViewState: CreateViewState = {
  cameraWorldT: 0,
  pitchPanSemitones: 0,
  gridDivision: '16th',
  selectedNodeKeys: new Set(),
  clipboard: [],
};



const initialState: AppState = {
  arrangement: null,
  transposition: 0,
  autoTranspositionPrompt: null,
  voiceStates: [],
  voiceColorOverrides: {},
  playback: initialPlaybackState,
  globalVolume: 0.8,
  globalReverb: 0.2,
  armedVoiceId: null,
  recordings: new Map(),
  livePitchTrace: [],
  livePitchTraceVoiceId: null,
  microphoneState: initialMicrophoneState,
  countIn: initialCountIn,
  vocalRange: initialVocalRange,
  display: initialDisplaySettings,
  theme: 'default',
  mode: 'play',
  selectedVoiceId: null,
  isLibraryOpen: false,
  isMixerOpen: false,
  isMicSetupOpen: false,
  isDisplaySettingsOpen: false,
  isSaveLoadOpen: false,
  isCreateModalOpen: false,
  isHelpOpen: false,
  history: [],
  future: [],
  canUndo: false,
  canRedo: false,
  followMode: initialFollowModeState,
  createView: initialCreateViewState,
  createModalMode: 'create',
  editingLibraryItemId: null,
};

/* ------------------------------------------------------------
   Store Creation with Persistence
   ------------------------------------------------------------ */

// Storage key for localStorage
const STORAGE_KEY = 'harmony-singing-settings';

// State that should be persisted (user settings only)
type PersistedState = Pick<AppState,
  | 'voiceStates'      // Mixer: per-voice volume, pan, mute, solo, reverb
  | 'voiceColorOverrides' // User-picked voice colors from sidebar/mixer color picker
  | 'globalVolume'     // Mixer: global volume
  | 'globalReverb'     // Mixer: global reverb
  | 'microphoneState'  // Mic: device, gain, monitoring, lag compensation
  | 'countIn'          // Count-in settings
  | 'vocalRange'       // Vocal range for auto-transposition
  | 'display'          // Display/styling settings
  | 'theme'            // Theme preference
>;

export const useAppStore = create<AppState & AppActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      // -- Helpers (Chord Track) --

      /**
       * Total length of the arrangement timeline in 16th-note steps.
       * Example: 4 bars of 4/4 = 4 * (4 beats) * (4 sixteenths per beat) = 64.
       */
      getTotalT16: (arrangement: Arrangement): number => {
        return arrangement.bars * arrangement.timeSig.numerator * 4;
      },

      /**
       * Create one chord per bar as the default chord track.
       * We use "C" as the starter label (user can rename).
       */
      createDefaultChordTrack: (arrangement: Arrangement): Chord[] => {
        const barLength16 = arrangement.timeSig.numerator * 4;
        const chords: Chord[] = [];
        for (let bar = 0; bar < arrangement.bars; bar++) {
          chords.push({
            t16: bar * barLength16,
            duration16: barLength16,
            name: 'C',
          });
        }
        return chords;
      },

      /**
       * Normalize a chord list so it always covers the full timeline with no gaps.
       * This is the core rule for the chord editor.
       */
      normalizeChordTrack: (chords: Chord[], totalT16: number): Chord[] => {
        const sorted = [...chords]
          .filter((c) => c.duration16 > 0)
          .sort((a, b) => a.t16 - b.t16);

        if (sorted.length === 0) return [];

        // Rebuild as a contiguous set of segments starting at 0.
        const normalized: Chord[] = [];
        let cursor = 0;

        for (let i = 0; i < sorted.length; i++) {
          const chord = sorted[i];
          const dur = Math.max(1, Math.round(chord.duration16));
          normalized.push({
            ...chord,
            t16: cursor,
            duration16: dur,
          });
          cursor += dur;
        }

        // Force the last chord to end exactly at totalT16.
        const last = normalized[normalized.length - 1];
        const overshoot = cursor - totalT16;
        if (overshoot !== 0) {
          last.duration16 = Math.max(1, last.duration16 - overshoot);
        }

        // If we still don't hit totalT16 (because durations were tiny), pad the last chord.
        const end = last.t16 + last.duration16;
        if (end < totalT16) {
          last.duration16 += totalT16 - end;
        }

        // If we still overshoot, clamp again.
        const end2 = last.t16 + last.duration16;
        if (end2 > totalT16) {
          last.duration16 = Math.max(1, last.duration16 - (end2 - totalT16));
        }

        return normalized;
      },

      // -- Arrangement --
      setArrangement: (arrangement) => {
        const savedVoiceColorOverrides = get().voiceColorOverrides;

        // Clear recordings and armed voice when changing arrangement
        set({
          arrangement,
          editingLibraryItemId: null,
          transposition: 0,
          autoTranspositionPrompt: null,
          recordings: new Map(),
          livePitchTrace: [],
          livePitchTraceVoiceId: null,
          armedVoiceId: null,
          // Reset navigation/view state so a new arrangement starts "fresh".
          // Horizontal zoom will be auto-fit by the Grid once it can measure the viewport.
          followMode: {
            ...get().followMode,
            pxPerT: initialFollowModeState.pxPerT,
            minPxPerT: initialFollowModeState.minPxPerT,
            viewportWidthPx: initialFollowModeState.viewportWidthPx,
            pendingWorldT: null,
            isDraggingTimeline: false,
            isDraggingMinimap: false,
          },
          createView: initialCreateViewState,
          display: { ...get().display, zoomLevel: 1 },
          history: [],
          future: [],
          canUndo: false,
          canRedo: false,
        });
        if (arrangement) {
          // Ensure any chord track we load covers the full timeline with no gaps.
          // (This is especially important for imported JSON arrangements.)
          const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
          const normalizedChords = arrangement.chords && arrangement.chords.length > 0
            ? get().normalizeChordTrack(arrangement.chords, totalT16)
            : arrangement.chords;

          // Always normalize lyrics too so imported JSON cannot contain floating
          // lyric entries that point to missing/non-melody nodes.
          arrangement = {
            ...arrangement,
            voices: arrangement.voices.map((voice) => {
              // If this voice has a saved custom color, restore it on load.
              const savedColor = savedVoiceColorOverrides[voice.id];
              const normalizedSavedColor = savedColor ? normalizeHexColor(savedColor) : null;
              if (!normalizedSavedColor) return voice;
              return { ...voice, color: normalizedSavedColor };
            }),
            ...(normalizedChords !== undefined ? { chords: normalizedChords } : {}),
            lyrics: normalizeLyricsTrack(arrangement.lyrics, arrangement),
          };
          set({ arrangement });

          // In Create mode, always default the editor to the first available voice.
          // This prevents stale selection from a previous arrangement (e.g. selecting Voice 3
          // when the new arrangement only has Voice 1).
          const firstVoiceId = arrangement.voices[0]?.id ?? null;
          set({ selectedVoiceId: firstVoiceId });

          get().initializeVoiceStates(arrangement.voices);
          // Reset transport + default loop range for this arrangement.
          // Default loop is first 4 bars, or the full arrangement if shorter.
          const defaultLoopEnd = getDefaultLoopEndT16(arrangement);
          set((state) => ({
            playback: {
              ...state.playback,
              loopEnabled: false,       // Every new arrangement starts in one-shot mode
              loopStart: 0,
              loopEnd: defaultLoopEnd,
              position: 0,
              isPlaying: false,
              isRecording: false,
            },
          }));
        }

        // After picking a new arrangement, try to auto-transpose it to match the user's range.
        // We announce here because selecting a new arrangement is one of the requested triggers.
        get().applyAutoTranspositionIfPossible(true);
      },

      setTransposition: (semitones) => set({ transposition: semitones }),

      addVoiceTrack: () => set((state) => {
        // Guard: must have an arrangement loaded to add a track.
        if (!state.arrangement) return state;
        // Respect the global track cap so the UI and synth engine stay in sync.
        if (state.arrangement.voices.length >= MAX_VOICES) return state;

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        const newVoiceIndex = state.arrangement.voices.length;
        const newVoiceId = generateVoiceId(state.arrangement.voices);
        const palette = DEFAULT_VOICE_COLORS[newVoiceIndex % DEFAULT_VOICE_COLORS.length];

        // Build the hydrated arrangement voice entry with empty nodes.
        const newVoice: Voice = {
          id: newVoiceId,
          name: `Voice ${newVoiceIndex + 1}`,
          color: palette.color,
          nodes: [],
        };

        const updatedArrangement: Arrangement = {
          ...state.arrangement,
          voices: [...state.arrangement.voices, newVoice],
        };

        return {
          ...historyUpdate,
          arrangement: updatedArrangement,
          voiceStates: [...state.voiceStates, createVoiceState(newVoiceId, newVoiceIndex)],
          selectedVoiceId: state.mode === 'create' ? newVoiceId : state.selectedVoiceId,
        };
      }),

      // Replace the current focus set with one voice.
      // This is the plain-click contour behavior (single-focus).
      focusOnlyVoice: (voiceId) => set((state) => {
        // Ignore unknown voice IDs (e.g., stale events).
        const hasVoice = state.voiceStates.some(v => v.voiceId === voiceId);
        if (!hasVoice) return state;

        return {
          voiceStates: state.voiceStates.map(v => ({
            ...v,
            synthSolo: v.voiceId === voiceId,
            vocalSolo: v.voiceId === voiceId,
          })),
        };
      }),

      undo: () => set((state) => {
        if (!state.canUndo || state.history.length === 0) return state;
        const snapshot = state.history[state.history.length - 1];
        const previousHistory = state.history.slice(0, -1);
        const currentSnapshot = createSnapshot(state);
        const nextFuture = currentSnapshot
          ? [currentSnapshot, ...state.future].slice(0, HISTORY_LIMIT)
          : state.future;

        return {
          ...applySnapshot(snapshot),
          history: previousHistory,
          future: nextFuture,
          canUndo: previousHistory.length > 0,
          canRedo: true,
        };
      }),

      redo: () => set((state) => {
        if (!state.canRedo || state.future.length === 0) return state;
        const snapshot = state.future[0];
        const remainingFuture = state.future.slice(1);
        const currentSnapshot = createSnapshot(state);
        if (!currentSnapshot) return state;

        const nextHistory = [...state.history, currentSnapshot];
        if (nextHistory.length > HISTORY_LIMIT) {
          nextHistory.shift();
        }

        return {
          ...applySnapshot(snapshot),
          history: nextHistory,
          future: remainingFuture,
          canUndo: nextHistory.length > 0,
          canRedo: remainingFuture.length > 0,
        };
      }),

      // Push one undo checkpoint without mutating arrangement data.
      // This is used by drag interactions to store the "before drag" state once.
      pushHistoryCheckpoint: () => set((state) => {
        if (!state.arrangement) return state;

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        return {
          ...historyUpdate,
        };
      }),

      applyAutoTranspositionIfPossible: (prompt) => {
        const arrangement = get().arrangement;
        const vocalRange = get().vocalRange;

        // Nothing to do if we don't have an arrangement loaded.
        if (!arrangement) return;

        // Prefer the stored frequencies (they are kept in sync in setVocalRange).
        const userRange = {
          lowFrequency: vocalRange.lowFrequency,
          highFrequency: vocalRange.highFrequency,
        };

        const evaluation = evaluateAutoFitTranspose(userRange, arrangement);
        const chosen = evaluation.stats.chosen;

        // Outcome C keeps original key (0) and still explains why auto-fit was skipped.
        if (evaluation.outcome === 'no-good-solution') {
          const details: string[] = [];
          details.push(`Arrangement span: ${evaluation.stats.arrangementSpan.toFixed(1)} st`);
          details.push(`Your range span: ${evaluation.stats.userSpan.toFixed(1)} st`);
          details.push(`Mud-safe transpose options found: ${evaluation.stats.mudSafeCandidateCount}`);

          set({
            transposition: 0,
            autoTranspositionPrompt: prompt
              ? {
                  semitones: 0,
                  title: 'Auto-fit was not applied',
                  message: 'This arrangement is far outside your range, so Auto-fit kept the original key. You can still transpose manually if you want.',
                  details,
                }
              : null,
          });
          return;
        }

        // Safety fallback: if evaluator returns A/B without a chosen candidate, do nothing.
        if (!chosen || evaluation.tBest === null) {
          set({ transposition: 0, autoTranspositionPrompt: null });
          return;
        }

        const details: string[] = [];
        if (chosen.range.maxLowBelow > 0) {
          details.push(`Lowest note is ${chosen.range.maxLowBelow.toFixed(1)} semitones below your low note.`);
        }
        if (chosen.range.maxHighAbove > 0) {
          details.push(`Highest note is ${chosen.range.maxHighAbove.toFixed(1)} semitones above your high note.`);
        }

        const isAutoFit = evaluation.outcome === 'auto-fit';
        const semitoneText = `${evaluation.tBest > 0 ? '+' : ''}${evaluation.tBest}`;
        const title = isAutoFit ? 'Auto-fit transposition applied' : 'Best-fit transposition applied';
        const message = isAutoFit
          ? `Auto-fit transposed by ${semitoneText} semitones to fit your range.`
          : `Best fit transposed by ${semitoneText} semitones, but some notes are outside your range.`;

        // Stage A/B transposition immediately. Modal lets user keep or revert.
        set({
          transposition: evaluation.tBest,
          autoTranspositionPrompt: prompt
            ? {
                semitones: evaluation.tBest,
                title,
                message,
                details,
              }
            : null,
        });
      },

      dismissAutoTranspositionPrompt: () => set({ autoTranspositionPrompt: null }),

      // -- Create Mode - Node Editing --
      addNode: (voiceId, t16, deg, octave = 0, semi) => set((state) => {
        if (!state.arrangement) return state;

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        // Find and update the voice
        const updatedVoices = state.arrangement.voices.map((voice) => {
          if (voice.id !== voiceId) return voice;

          // Remove any existing node at this t16, then add new one
          const filteredNodes = voice.nodes.filter((n) => n.t16 !== t16);
          const newNode: ArrangementNode = { t16, deg, octave, ...(semi !== undefined ? { semi } : {}) };
          let newNodes: ArrangementNode[] = [...filteredNodes, newNode].sort((a, b) => a.t16 - b.t16);

          // ── Fix orphaned anchors ──
          // After inserting the new node, any anchor (term=true) in this node's
          // "held segment" must update its pitch to match.
          // The held segment spans from this node's t16 up to the NEXT non-term node.
          const nextNonTerm = newNodes
            .filter((n) => !n.term && n.t16 > t16)
            .sort((a, b) => a.t16 - b.t16)[0];
          const segmentEnd = nextNonTerm ? nextNonTerm.t16 : Infinity;

          newNodes = newNodes.map((n) => {
            // Only update anchors that sit inside this node's held segment.
            if (n.term && n.t16 > t16 && n.t16 < segmentEnd) {
              return {
                ...n,
                deg,
                octave,
                ...(semi !== undefined ? { semi } : {}),
              };
            }
            return n;
          });

          return { ...voice, nodes: newNodes };
        });

        return {
          ...historyUpdate,
          arrangement: withNormalizedLyricsTrack({ ...state.arrangement, voices: updatedVoices }),
        };
      }),

      removeNode: (voiceId, t16) => set((state) => {
        if (!state.arrangement) return state;

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        const updatedVoices = state.arrangement.voices.map((voice) => {
          if (voice.id !== voiceId) return voice;

          // Helper: anchors (term=true) are only valid if they have a real note before them.
          // This guarantees we never keep orphaned anchors after any delete path.
          const pruneOrphanAnchors = (nodes: ArrangementNode[]): ArrangementNode[] => {
            const sorted = [...nodes].sort((a, b) => a.t16 - b.t16);
            let seenRealNote = false;
            const cleaned: ArrangementNode[] = [];
            for (const node of sorted) {
              if (!node.term) {
                seenRealNote = true;
                cleaned.push(node);
                continue;
              }
              if (seenRealNote) {
                cleaned.push(node);
              }
            }
            return cleaned;
          };

          // If the node being removed is a "real" note, we also remove its attached anchor
          // (the first termination node after it, up to the next real note).
          // This prevents leaving behind an orphaned anchor that still affects phrase logic.
          const nodeToRemove = voice.nodes.find((n) => n.t16 === t16);
          if (nodeToRemove && !nodeToRemove.term) {
            const nextNonTerm = voice.nodes
              .filter((n) => !n.term && n.t16 > t16)
              .sort((a, b) => a.t16 - b.t16)[0];

            const attachedAnchor = voice.nodes
              .filter((n) => n.term && n.t16 > t16 && (!nextNonTerm || n.t16 < nextNonTerm.t16))
              .sort((a, b) => a.t16 - b.t16)[0];

            const attachedAnchorT16 = attachedAnchor ? attachedAnchor.t16 : null;
            const nodesAfterRemoval = voice.nodes.filter(
              (n) => n.t16 !== t16 && (attachedAnchorT16 === null || n.t16 !== attachedAnchorT16),
            );
            return {
              ...voice,
              nodes: pruneOrphanAnchors(nodesAfterRemoval),
            };
          }

          const nodesAfterRemoval = voice.nodes.filter((n) => n.t16 !== t16);
          return {
            ...voice,
            nodes: pruneOrphanAnchors(nodesAfterRemoval),
          };
        });

        return {
          ...historyUpdate,
          arrangement: withNormalizedLyricsTrack({ ...state.arrangement, voices: updatedVoices }),
        };
      }),

      updateNode: (voiceId, oldT16, newT16, deg, octave = 0, term = false, semi, options) => set((state) => {
        if (!state.arrangement) return state;

        const shouldRecordHistory = options?.recordHistory ?? true;
        const historyUpdate = shouldRecordHistory ? prepareHistoryUpdate(state) : null;
        if (shouldRecordHistory && !historyUpdate) return state;

        const updatedVoices = state.arrangement.voices.map((voice) => {
          if (voice.id !== voiceId) return voice;

          // Locate the node being updated so we can keep track of any anchor it drives.
          const originalNode = voice.nodes.find((n) => n.t16 === oldT16);
          if (!originalNode) {
            return voice;
          }

          // Start from the list without the original node (and without any accidental duplicate at newT16).
          const nodesWithoutTarget = voice.nodes.filter((n) => n.t16 !== oldT16 && n.t16 !== newT16);

          // If we're updating/creating an anchor (term === true), it MUST inherit the pitch
          // from the previous real note so it never appears on the wrong row.
          const anchorParent = term
            ? voice.nodes
              .filter((n) => !n.term && n.t16 < newT16)
              .sort((a, b) => a.t16 - b.t16)
              .pop()
            : null;

          // If there's no previous real note, we cannot create a valid anchor.
          if (term && !anchorParent) {
            return voice;
          }

          // If there's already an anchor between the previous note and this time,
          // this note is the FIRST note of a phrase and must NOT become an anchor.
          if (term && anchorParent) {
            // IMPORTANT: ignore the anchor currently being moved (oldT16),
            // otherwise dragging an anchor forward always looks like there's
            // an existing phrase-break anchor in the path.
            const hasPhraseBreak = nodesWithoutTarget.some(
              (n) => n.term && n.t16 > anchorParent.t16 && n.t16 < newT16,
            );
            if (hasPhraseBreak) {
              return voice;
            }
          }

          const resolvedDeg = anchorParent ? (anchorParent.deg ?? 0) : deg;
          const resolvedOctave = anchorParent ? (anchorParent.octave ?? 0) : octave;
          const resolvedSemi = anchorParent ? anchorParent.semi : semi;

          const updatedNode = {
            t16: newT16,
            deg: resolvedDeg,
            octave: resolvedOctave,
            ...(resolvedSemi !== undefined ? { semi: resolvedSemi } : {}),
            ...(term ? { term: true } : {}),
          };

          let newNodes = [...nodesWithoutTarget, updatedNode];

          // If we're moving a "real" note (term === false), keep its associated anchor (if any) in sync.
          if (!term) {
            // Determine the next real note after the original position.
            const nextNonTermAfterOriginal = voice.nodes
              .filter((n) => !n.term && n.t16 > oldT16)
              .sort((a, b) => a.t16 - b.t16)[0];

            // Find the anchor that belonged to this note (first term between the note and the next note).
            const attachedAnchor = voice.nodes
              .filter((n) => n.term && n.t16 > oldT16 && (!nextNonTermAfterOriginal || n.t16 < nextNonTermAfterOriginal.t16))
              .sort((a, b) => a.t16 - b.t16)[0];

            if (attachedAnchor) {
              // Remove the old anchor instance before we re-add it in its new position.
              newNodes = newNodes.filter((n) => n.t16 !== attachedAnchor.t16);

              const holdOffset = attachedAnchor.t16 - oldT16;
              const desiredMin = newT16 + 1; // Anchor must remain at least one 16th to the right of the parent note.
              let desiredT16 = newT16 + holdOffset;
              desiredT16 = Math.max(desiredT16, desiredMin);

              // Prevent the anchor from running into the next note (if one exists) after the move.
              const nextNonTermAfterNew = newNodes
                .filter((n) => !n.term && n.t16 > newT16)
                .sort((a, b) => a.t16 - b.t16)[0];
              if (nextNonTermAfterNew) {
                desiredT16 = Math.min(desiredT16, nextNonTermAfterNew.t16 - 1);
              }

              const updatedAnchor = {
                t16: desiredT16,
                deg,
                octave,
                ...(semi !== undefined ? { semi } : {}),
                term: true,
              };

              newNodes.push(updatedAnchor);
            }
          }

          const sortedNodes = newNodes.sort((a, b) => a.t16 - b.t16);
          return { ...voice, nodes: sortedNodes };
        });

        const voice1Id = state.arrangement.voices[0]?.id;
        const previousLyrics = normalizeLyricsTrack(state.arrangement.lyrics, state.arrangement);

        let nextArrangement: Arrangement = { ...state.arrangement, voices: updatedVoices };

        // If a Voice 1 melody node moved, move its lyric with it.
        if (voiceId === voice1Id && !term) {
          const moveMap = new Map<number, number>([[oldT16, newT16]]);
          const validTimes = getVoice1MelodyNodeTimeSet(nextArrangement);
          nextArrangement = {
            ...nextArrangement,
            lyrics: {
              enabled: previousLyrics.enabled,
              entries: remapLyricsEntries(previousLyrics.entries, moveMap, validTimes),
            },
          };
          nextArrangement = withNormalizedLyricsTrack(nextArrangement);
        } else {
          nextArrangement = withNormalizedLyricsTrack(nextArrangement);
        }

        return {
          ...(historyUpdate ?? {}),
          arrangement: nextArrangement,
        };
      }),

      // Editing voice changes should reset node selection so selection never
      // spans an old voice after switching edit target.
      setSelectedVoiceId: (voiceId) => set((state) => ({
        selectedVoiceId: voiceId,
        createView: {
          ...state.createView,
          selectedNodeKeys: new Set(),
        },
      })),

      // -- Create Mode - Node Selection --

      /** Click a node: select only that node (clears previous selection). */
      selectNode: (key) => set((state) => ({
        createView: {
          ...state.createView,
          selectedNodeKeys: new Set([key]),
        },
      })),

      /** Shift+click a node: add it to the current selection. */
      addNodeToSelection: (key) => set((state) => {
        const next = new Set(state.createView.selectedNodeKeys);
        next.add(key);
        return { createView: { ...state.createView, selectedNodeKeys: next } };
      }),

      /** Ctrl/Cmd+click a node: toggle it in/out of selection. */
      toggleNodeInSelection: (key) => set((state) => {
        const next = new Set(state.createView.selectedNodeKeys);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return { createView: { ...state.createView, selectedNodeKeys: next } };
      }),

      /** Clear all selected nodes. */
      clearNodeSelection: () => set((state) => ({
        createView: {
          ...state.createView,
          selectedNodeKeys: new Set(),
        },
      })),

      /** Replace selection with an entirely new set of keys. */
      setNodeSelection: (keys) => set((state) => ({
        createView: {
          ...state.createView,
          selectedNodeKeys: new Set(keys),
        },
      })),

      /** Union new keys into the existing selection (for additive marquee). */
      addNodesToSelection: (keys) => set((state) => {
        const next = new Set(state.createView.selectedNodeKeys);
        for (const k of keys) next.add(k);
        return { createView: { ...state.createView, selectedNodeKeys: next } };
      }),

      // -- Create Mode - Clipboard --

      /** Copy selected nodes to clipboard. */
      copySelectedNodes: () => set((state) => {
        if (!state.arrangement) return state;
        const selected = state.createView.selectedNodeKeys;
        if (selected.size === 0) return state;

        const clipboardNodes: ClipboardNode[] = [];
        for (const key of selected) {
          const { voiceId, t16 } = parseNodeKey(key);
          const voice = state.arrangement.voices.find(v => v.id === voiceId);
          if (!voice) continue;
          const node = voice.nodes.find(n => n.t16 === t16);
          if (!node) continue;
          clipboardNodes.push({
            voiceId,
            t16: node.t16,
            deg: node.deg ?? 0,
            octave: node.octave ?? 0,
            ...(node.semi !== undefined ? { semi: node.semi } : {}),
            ...(node.term ? { term: true } : {}),
          });
        }

        return {
          createView: { ...state.createView, clipboard: clipboardNodes },
        };
      }),

      /** Cut selected nodes: copy to clipboard then delete. */
      cutSelectedNodes: () => {
        // First copy, then delete.
        get().copySelectedNodes();
        get().deleteSelectedNodes();
      },

      /** Paste clipboard nodes at the given playhead position. */
      pasteNodes: (playheadT16) => set((state) => {
        if (!state.arrangement) return state;
        const cb = state.createView.clipboard;
        if (cb.length === 0) return state;

        const targetVoiceId = state.selectedVoiceId ?? state.arrangement.voices[0]?.id;
        if (!targetVoiceId) return state;

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        // Find the earliest time in the clipboard to use as offset anchor.
        const minT16 = Math.min(...cb.map(n => n.t16));
        const totalT16 = state.arrangement.bars * state.arrangement.timeSig.numerator * 4;

        // Build one list of nodes to add to the CURRENT editable voice.
        // This lets users copy from one voice, switch Edit to another voice,
        // and paste there.
        const additions: typeof cb = [];
        for (const cn of cb) {
          const newT16 = cn.t16 - minT16 + playheadT16;
          // Clamp to arrangement bounds.
          if (newT16 < 0 || newT16 > totalT16) continue;
          additions.push({ ...cn, voiceId: targetVoiceId, t16: newT16 });
        }

        // Apply additions to voices.
        const updatedVoices = state.arrangement.voices.map(voice => {
          if (voice.id !== targetVoiceId || additions.length === 0) return voice;

          let newNodes = [...voice.nodes];
          for (const cn of additions) {
            // Remove any existing node at this t16 first.
            newNodes = newNodes.filter(n => n.t16 !== cn.t16);
            newNodes.push({
              t16: cn.t16,
              deg: cn.deg,
              octave: cn.octave,
              ...(cn.semi !== undefined ? { semi: cn.semi } : {}),
              ...(cn.term ? { term: true } : {}),
            });
          }
          newNodes.sort((a, b) => a.t16 - b.t16);
          return { ...voice, nodes: newNodes };
        });

        // Select the newly pasted nodes.
        const newSelection = new Set<NodeKey>();
        for (const cn of additions) {
          if (cn.t16 >= 0 && cn.t16 <= totalT16) {
            newSelection.add(makeNodeKey(targetVoiceId, cn.t16));
          }
        }

        return {
          ...(historyUpdate ?? {}),
          arrangement: withNormalizedLyricsTrack({ ...state.arrangement, voices: updatedVoices }),
          createView: { ...state.createView, selectedNodeKeys: newSelection },
        };
      }),

      /** Duplicate selected nodes (paste a copy offset by +4 sixteenths). */
      duplicateSelectedNodes: () => {
        // Copy first, then paste with a small time offset.
        get().copySelectedNodes();
        const cb = get().createView.clipboard;
        if (cb.length === 0) return;
        const minT16 = Math.min(...cb.map(n => n.t16));
        // Paste 4 sixteenths after the earliest copied node.
        get().pasteNodes(minT16 + 4);
      },

      // -- Create Mode - Bulk Operations --

      /** Delete all selected nodes (Delete/Backspace key). */
      deleteSelectedNodes: () => set((state) => {
        if (!state.arrangement) return state;
        const selected = state.createView.selectedNodeKeys;
        if (selected.size === 0) return state;

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        // Build a set of (voiceId, t16) pairs to remove.
        const toRemove = new Map<string, Set<number>>();
        for (const key of selected) {
          const { voiceId, t16 } = parseNodeKey(key);
          if (!toRemove.has(voiceId)) toRemove.set(voiceId, new Set());
          toRemove.get(voiceId)!.add(t16);
        }

        const updatedVoices = state.arrangement.voices.map(voice => {
          const times = toRemove.get(voice.id);
          if (!times || times.size === 0) return voice;
          return {
            ...voice,
            nodes: voice.nodes.filter(n => !times.has(n.t16)),
          };
        });

        return {
          ...historyUpdate,
          arrangement: withNormalizedLyricsTrack({ ...state.arrangement, voices: updatedVoices }),
          createView: { ...state.createView, selectedNodeKeys: new Set() },
        };
      }),

      /**
       * Move all selected nodes by a delta in time and pitch (semitones).
       * Used for group dragging.
       */
      moveSelectedNodes: (deltaT16, deltaSemitones, options) => set((state) => {
        if (!state.arrangement) return state;
        const selected = state.createView.selectedNodeKeys;
        if (selected.size === 0) return state;

        const shouldRecordHistory = options?.recordHistory ?? true;
        const historyUpdate = shouldRecordHistory ? prepareHistoryUpdate(state) : null;
        if (shouldRecordHistory && !historyUpdate) return state;

        const totalT16 = state.arrangement.bars * state.arrangement.timeSig.numerator * 4;
        const voice1Id = state.arrangement.voices[0]?.id ?? null;
        const lyricMoveMap = new Map<number, number>();

        // Parse selected keys into a lookup.
        const selectedLookup = new Map<string, Set<number>>();
        for (const key of selected) {
          const { voiceId, t16 } = parseNodeKey(key);
          if (!selectedLookup.has(voiceId)) selectedLookup.set(voiceId, new Set());
          selectedLookup.get(voiceId)!.add(t16);
        }

        // Track new keys for the moved nodes.
        const newSelection = new Set<NodeKey>();

        const updatedVoices = state.arrangement.voices.map(voice => {
          const selectedTimes = selectedLookup.get(voice.id);
          if (!selectedTimes || selectedTimes.size === 0) return voice;

          // Expand movement set so each selected REAL note drags its attached
          // anchor with it (first term node before the next real note).
          // This prevents anchors from being left behind during group drags.
          const timesToMove = new Set(selectedTimes);
          for (const t16 of selectedTimes) {
            const selectedNode = voice.nodes.find((n) => n.t16 === t16);
            if (!selectedNode || selectedNode.term) continue;

            const nextNonTerm = voice.nodes
              .filter((n) => !n.term && n.t16 > t16)
              .sort((a, b) => a.t16 - b.t16)[0];

            const attachedAnchor = voice.nodes
              .filter((n) => n.term && n.t16 > t16 && (!nextNonTerm || n.t16 < nextNonTerm.t16))
              .sort((a, b) => a.t16 - b.t16)[0];

            if (attachedAnchor) {
              timesToMove.add(attachedAnchor.t16);
            }
          }

          const movedNodes: typeof voice.nodes = [];
          const movedNodeMeta: Array<{ fromT16: number; toT16: number; isAutoMovedAnchor: boolean; isAnchor: boolean }> = [];
          const stationaryNodes: typeof voice.nodes = [];

          for (const node of voice.nodes) {
            if (timesToMove.has(node.t16)) {
              const newT16 = Math.max(0, Math.min(totalT16, node.t16 + deltaT16));
              // For pitch: shift the semitone value if present, otherwise shift deg/octave.
              let newNode;
              if (node.semi !== undefined) {
                newNode = { ...node, t16: newT16, semi: node.semi + deltaSemitones };
              } else {
                // Convert deg/octave to semitone, shift, store as semi after a group move.
                const currentSemi = degreeToSemitoneOffset(node.deg ?? 0, node.octave ?? 0, state.arrangement!.scale);
                newNode = { ...node, t16: newT16, semi: currentSemi + deltaSemitones, deg: undefined, octave: undefined };
              }
              movedNodes.push(newNode);
              movedNodeMeta.push({
                fromT16: node.t16,
                toT16: newT16,
                isAutoMovedAnchor: !!node.term && !selectedTimes.has(node.t16),
                isAnchor: !!node.term,
              });

              // Lyrics follow moved Voice 1 melody nodes.
              if (voice.id === voice1Id && !node.term && selectedTimes.has(node.t16)) {
                lyricMoveMap.set(node.t16, newT16);
              }

              // Preserve selection membership only for nodes that were actually
              // selected by the user; auto-moved attached anchors should move
              // visually but should not become selected automatically.
              if (selectedTimes.has(node.t16)) {
                newSelection.add(makeNodeKey(voice.id, newT16));
              }
            } else {
              stationaryNodes.push(node);
            }
          }

          // Remove stationary nodes at collision positions, then merge.
          // Exception: if the collision is caused by an AUTO-moved anchor,
          // keep the stationary node and drop only that anchor movement.
          // This avoids deleting real notes when their attached anchors hit
          // boundaries during group drags.
          const movedTimes = new Set(movedNodes.map(n => n.t16));
          const filtered = stationaryNodes.filter((n) => {
            if (!movedTimes.has(n.t16)) return true;
            const hasAutoMovedAnchorCollision = movedNodeMeta.some(
              (m) => m.toT16 === n.t16 && m.isAutoMovedAnchor,
            );
            if (hasAutoMovedAnchorCollision) return true;
            return false;
          });

          const filteredMovedNodes = movedNodes.filter((n) => {
            if (!n.term) return true;
            const movedMeta = movedNodeMeta.find((m) => m.toT16 === n.t16 && m.isAnchor);
            if (!movedMeta || !movedMeta.isAutoMovedAnchor) return true;
            const collidesWithStationary = stationaryNodes.some((s) => s.t16 === n.t16 && s.t16 !== movedMeta.fromT16);
            return !collidesWithStationary;
          });

          const merged = [...filtered, ...filteredMovedNodes].sort((a, b) => a.t16 - b.t16);
          return { ...voice, nodes: merged };
        });

        const previousLyrics = normalizeLyricsTrack(state.arrangement.lyrics, state.arrangement);
        let nextArrangement: Arrangement = { ...state.arrangement, voices: updatedVoices };

        if (lyricMoveMap.size > 0) {
          const validTimes = getVoice1MelodyNodeTimeSet(nextArrangement);
          nextArrangement = {
            ...nextArrangement,
            lyrics: {
              enabled: previousLyrics.enabled,
              entries: remapLyricsEntries(previousLyrics.entries, lyricMoveMap, validTimes),
            },
          };
          nextArrangement = withNormalizedLyricsTrack(nextArrangement);
        } else {
          nextArrangement = withNormalizedLyricsTrack(nextArrangement);
        }

        return {
          ...historyUpdate,
          arrangement: nextArrangement,
          createView: { ...state.createView, selectedNodeKeys: newSelection },
        };
      }),

      // -- Create Mode - Voice Management --

      // Rename a voice track (updates the arrangement voice name).
      renameVoice: (voiceId, newName) => set((state) => {
        if (!state.arrangement) return state;
        const trimmed = newName.trim();
        if (!trimmed) return state; // Don't allow empty names

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        const updatedVoices = state.arrangement.voices.map((voice) =>
          voice.id === voiceId ? { ...voice, name: trimmed } : voice
        );

        return {
          ...historyUpdate,
          arrangement: withNormalizedLyricsTrack({ ...state.arrangement, voices: updatedVoices }),
        };
      }),

      // Set a voice color from the sidebar/mixer color picker.
      // We validate and normalize the hex so rendering remains consistent.
      setVoiceColor: (voiceId, color) => set((state) => {
        if (!state.arrangement) return state;

        const normalizedColor = normalizeHexColor(color);
        if (!normalizedColor) return state;

        const targetVoice = state.arrangement.voices.find((voice) => voice.id === voiceId);
        if (!targetVoice) return state;
        if (targetVoice.color === normalizedColor && state.voiceColorOverrides[voiceId] === normalizedColor) {
          return state;
        }

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        const updatedVoices = state.arrangement.voices.map((voice) =>
          voice.id === voiceId ? { ...voice, color: normalizedColor } : voice
        );

        return {
          ...historyUpdate,
          arrangement: { ...state.arrangement, voices: updatedVoices },
          voiceColorOverrides: {
            ...state.voiceColorOverrides,
            [voiceId]: normalizedColor,
          },
        };
      }),

      // Clear all nodes from a single voice track.
      clearVoiceNodes: (voiceId) => set((state) => {
        if (!state.arrangement) return state;

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        const updatedVoices = state.arrangement.voices.map((voice) =>
          voice.id === voiceId ? { ...voice, nodes: [] } : voice
        );

        return {
          ...historyUpdate,
          arrangement: withNormalizedLyricsTrack({ ...state.arrangement, voices: updatedVoices }),
        };
      }),

      // Clear all nodes from ALL voice tracks.
      clearAllVoiceNodes: () => set((state) => {
        if (!state.arrangement) return state;

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        const updatedVoices = state.arrangement.voices.map((voice) => ({
          ...voice,
          nodes: [],
        }));

        return {
          ...historyUpdate,
          arrangement: withNormalizedLyricsTrack({ ...state.arrangement, voices: updatedVoices }),
        };
      }),

      // -- Create Mode - Lyrics Track Editing --

      /**
       * Enable the lyrics track.
       *
       * We keep any existing valid entries and only flip `enabled` to true.
       */
      enableLyricsTrack: () => set((state) => {
        if (!state.arrangement) return state;

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        const normalized = normalizeLyricsTrack(state.arrangement.lyrics, state.arrangement);
        return {
          ...historyUpdate,
          arrangement: {
            ...state.arrangement,
            lyrics: {
              ...normalized,
              enabled: true,
            },
          },
        };
      }),

      /**
       * Disable the lyrics track and clear all lyric entries.
       */
      disableLyricsTrack: () => set((state) => {
        if (!state.arrangement) return state;

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        return {
          ...historyUpdate,
          arrangement: {
            ...state.arrangement,
            lyrics: {
              enabled: false,
              entries: [],
            },
          },
        };
      }),

      /**
       * Set/replace one lyric token for a Voice 1 melody node.
       *
       * - Stores visible text and optional connector metadata in one history step.
       * - If both text and connector are empty, the entry is removed.
       */
      setLyricEntry: (t16, text, options) => set((state) => {
        if (!state.arrangement) return state;

        const lyrics = normalizeLyricsTrack(state.arrangement.lyrics, state.arrangement);
        if (!lyrics.enabled) return state;

        const voice1Nodes = getVoice1MelodyNodes(state.arrangement);
        const validTimes = new Set(voice1Nodes.map((node) => node.t16));
        const snappedT16 = quantizeT16(t16, state.createView.gridDivision);
        if (!validTimes.has(snappedT16)) return state;

        const existingEntry = lyrics.entries.find((entry) => isT16Equal(entry.t16, snappedT16));
        const existingPayload = normalizeLyricPayload(existingEntry?.text, existingEntry?.connectorToNext);
        const normalizedInput = normalizeLyricPayload(text, undefined);

        const hasConnectorOverride = options !== undefined
          && Object.prototype.hasOwnProperty.call(options, 'connectorToNext');
        const requestedConnector = hasConnectorOverride
          ? normalizeLyricConnector(options?.connectorToNext)
          : normalizedInput.connectorToNext;

        const nodeIndex = voice1Nodes.findIndex((node) => isT16Equal(node.t16, snappedT16));
        const hasNextNode = nodeIndex >= 0 && nodeIndex < voice1Nodes.length - 1;

        const nextPayload: LyricPayload = {
          text: normalizedInput.text,
          ...(hasNextNode && requestedConnector ? { connectorToNext: requestedConnector } : {}),
        };

        // Skip no-op edits so we don't spam undo history when the user simply
        // opens/closes a lyric input without changing anything.
        const sameText = nextPayload.text === existingPayload.text;
        const sameConnector = nextPayload.connectorToNext === existingPayload.connectorToNext;
        if (sameText && sameConnector) return state;

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        const nextEntriesMap = new Map<number, LyricPayload>(
          lyrics.entries.map((entry) => {
            const payload = normalizeLyricPayload(entry.text, entry.connectorToNext);
            return [entry.t16, payload];
          })
        );

        if (!hasLyricPayloadContent(nextPayload)) {
          nextEntriesMap.delete(snappedT16);
        } else {
          nextEntriesMap.set(snappedT16, nextPayload);
        }

        const nextEntries: LyricEntry[] = [...nextEntriesMap.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([entryT16, payload]) => ({
            t16: entryT16,
            text: payload.text,
            ...(payload.connectorToNext ? { connectorToNext: payload.connectorToNext } : {}),
          }));

        const nextArrangement = withNormalizedLyricsTrack({
          ...state.arrangement,
          lyrics: {
            enabled: true,
            entries: nextEntries,
          },
        });

        return {
          ...historyUpdate,
          arrangement: nextArrangement,
        };
      }),

      // -- Create Mode - Chord Track Editing --

      /**
       * Enable chord track by generating a default set of one chord per bar.
       */
      enableChordTrack: () => set((state) => {
        if (!state.arrangement) return state;
        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;
        const totalT16 = state.arrangement.bars * state.arrangement.timeSig.numerator * 4;
        const defaults = get().createDefaultChordTrack(state.arrangement);
        return {
          ...historyUpdate,
          arrangement: {
            ...state.arrangement,
            chords: get().normalizeChordTrack(defaults, totalT16),
          },
        };
      }),

      /**
       * Disable chord track by removing all chord blocks.
       * The UI will show the "Enable Chord Track" button again.
       */
      disableChordTrack: () => set((state) => {
        if (!state.arrangement) return state;
        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;
        return {
          ...historyUpdate,
          arrangement: {
            ...state.arrangement,
            chords: [],
          },
        };
      }),

      /**
       * Update arrangement parameters while staying in Create mode.
       *
       * IMPORTANT:
       * - We do NOT call setArrangement() here because that resets voice states/recordings/history.
       * - We keep voice nodes, but clamp any nodes that fall beyond the new arrangement length.
       * - If a chord track exists, we normalize it so it covers the new full timeline.
       */
      updateArrangementParams: (update) => set((state) => {
        if (!state.arrangement) return state;

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        const prev = state.arrangement;
        const nextBars = Math.max(1, Math.min(32, Math.round(update.bars)));
        const nextTempo = Math.max(40, Math.min(240, Math.round(update.tempo)));
        const nextTimeSigNum = Math.max(2, Math.min(12, Math.round(update.timeSig.numerator)));
        const nextTimeSigDen = update.timeSig.denominator;
        const nextTotalT16 = nextBars * nextTimeSigNum * 4;

        const nextVoices: Voice[] = prev.voices.map((v) => ({
          ...v,
          nodes: v.nodes.filter((n) => n.t16 <= nextTotalT16),
        }));

        let nextChords = prev.chords;
        if (nextChords && nextChords.length > 0) {
          nextChords = get().normalizeChordTrack(nextChords, nextTotalT16);
        }

        let nextArrangement: Arrangement = {
          ...prev,
          title: update.title,
          description: update.description !== undefined ? update.description : prev.description,
          difficulty: update.difficulty !== undefined ? update.difficulty : prev.difficulty,
          tempo: nextTempo,
          tonic: update.tonic,
          scale: update.scale,
          bars: nextBars,
          timeSig: { numerator: nextTimeSigNum, denominator: nextTimeSigDen },
          voices: nextVoices,
          chords: nextChords,
        };

        // Keep lyrics attached only to surviving Voice 1 nodes after timeline changes.
        nextArrangement = withNormalizedLyricsTrack(nextArrangement);

        const nextPosition = Math.max(0, Math.min(state.playback.position, nextTotalT16));

        return {
          ...historyUpdate,
          arrangement: nextArrangement,
          playback: {
            ...state.playback,
            loopEnd: nextTotalT16,
            position: nextPosition,
          },
        };
      }),

      /**
       * Rename a chord label.
       */
      setChordName: (chordIndex, name) => set((state) => {
        if (!state.arrangement) return state;
        const chords = state.arrangement.chords || [];
        if (chordIndex < 0 || chordIndex >= chords.length) return state;

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        const updated = chords.map((c, idx) => idx === chordIndex ? { ...c, name } : c);
        return {
          ...historyUpdate,
          arrangement: {
            ...state.arrangement,
            chords: updated,
          },
        };
      }),

      /**
       * Split a chord at a given time, creating a new chord segment to the right.
       * The new segment uses the default name "C".
       */
      splitChordAt: (t16) => set((state) => {
        if (!state.arrangement) return state;
        const chords = state.arrangement.chords || [];
        if (chords.length === 0) return state;

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        const totalT16 = state.arrangement.bars * state.arrangement.timeSig.numerator * 4;
        const snappedT16 = quantizeT16(t16, state.createView.gridDivision);

        // Minimum length of any chord segment (in 16ths).
        const minDur16 = 1;

        // Helper: insert a new chord by stealing `minDur16` from a donor chord.
        const insertChordAtIndex = (insertIndex: number, donorIndex: number) => {
          const donor = chords[donorIndex];
          if (!donor || donor.duration16 <= minDur16) return null;

          const updatedDonor: Chord = { ...donor, duration16: donor.duration16 - minDur16 };
          const newChord: Chord = { t16: 0, duration16: minDur16, name: 'C' };

          const next = [...chords];
          next[donorIndex] = updatedDonor;
          next.splice(insertIndex, 0, newChord);
          return next;
        };

        // If you Shift+click right at the very start/end, we still want to create a chord.
        // We do this by inserting a 1/16th chord at the edge.
        if (snappedT16 <= 0) {
          const next = insertChordAtIndex(0, 0);
          if (!next) return state;
          return {
            ...historyUpdate,
            arrangement: {
              ...state.arrangement,
              chords: get().normalizeChordTrack(next, totalT16),
            },
          };
        }

        if (snappedT16 >= totalT16) {
          const next = insertChordAtIndex(chords.length, chords.length - 1);
          if (!next) return state;
          return {
            ...historyUpdate,
            arrangement: {
              ...state.arrangement,
              chords: get().normalizeChordTrack(next, totalT16),
            },
          };
        }

        // Clamp for the "split inside a chord" case.
        const clampedT16 = Math.max(1, Math.min(totalT16 - 1, snappedT16));

        const idx = chords.findIndex((c) => clampedT16 > c.t16 && clampedT16 < c.t16 + c.duration16);
        if (idx === -1) {
          // If you click exactly on a boundary, insert a small chord segment at that boundary.
          // Example: boundary between chord i-1 and i is represented by chords[i].t16.
          const boundaryRightIndex = chords.findIndex((c) => c.t16 === clampedT16);
          if (boundaryRightIndex === -1) return state;

          const next = insertChordAtIndex(boundaryRightIndex, boundaryRightIndex);
          if (!next) return state;

          return {
            ...historyUpdate,
            arrangement: {
              ...state.arrangement,
              chords: get().normalizeChordTrack(next, totalT16),
            },
          };
        }

        const chord = chords[idx];
        const leftDur = clampedT16 - chord.t16;
        const rightDur = (chord.t16 + chord.duration16) - clampedT16;
        if (leftDur < 1 || rightDur < 1) return state;

        const left: Chord = { ...chord, duration16: leftDur };
        const right: Chord = { ...chord, t16: clampedT16, duration16: rightDur, name: 'C' };

        const next = [...chords.slice(0, idx), left, right, ...chords.slice(idx + 1)];
        return {
          ...historyUpdate,
          arrangement: {
            ...state.arrangement,
            chords: get().normalizeChordTrack(next, totalT16),
          },
        };
      }),

      /**
       * Resize the boundary between two neighboring chords.
       * `leftChordIndex` is the index of the chord on the left side of the boundary.
       */
      resizeChordBoundary: (leftChordIndex, newBoundaryT16) => set((state) => {
        if (!state.arrangement) return state;
        const chords = state.arrangement.chords || [];
        if (leftChordIndex < 0 || leftChordIndex >= chords.length - 1) return state;

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        const totalT16 = state.arrangement.bars * state.arrangement.timeSig.numerator * 4;

        const left = chords[leftChordIndex];
        const right = chords[leftChordIndex + 1];
        const leftStart = left.t16;
        const rightEnd = right.t16 + right.duration16;

        const snappedBoundary = quantizeT16(newBoundaryT16, state.createView.gridDivision);
        const minDur16 = 1;

        if (snappedBoundary <= leftStart) {
          // Delete the left chord and let the right chord extend over it.
          const remaining = chords.filter((_, idx) => idx !== leftChordIndex);
          const mergedRight: Chord = { ...right, t16: leftStart, duration16: rightEnd - leftStart };
          remaining[leftChordIndex] = mergedRight;
          return {
            ...historyUpdate,
            arrangement: {
              ...state.arrangement,
              chords: get().normalizeChordTrack(remaining, totalT16),
            },
          };
        }

        if (snappedBoundary >= rightEnd) {
          // Delete the right chord and extend the left chord through it.
          const remaining = chords.filter((_, idx) => idx !== leftChordIndex + 1);
          const mergedLeft: Chord = { ...left, duration16: rightEnd - leftStart };
          remaining[leftChordIndex] = mergedLeft;
          return {
            ...historyUpdate,
            arrangement: {
              ...state.arrangement,
              chords: get().normalizeChordTrack(remaining, totalT16),
            },
          };
        }

        const minBoundary = leftStart + minDur16;
        const maxBoundary = rightEnd - minDur16;
        const boundary = Math.max(minBoundary, Math.min(maxBoundary, snappedBoundary));

        const updatedLeft: Chord = { ...left, duration16: boundary - leftStart };
        const updatedRight: Chord = { ...right, t16: boundary, duration16: rightEnd - boundary };

        const next = chords.map((c, idx) => {
          if (idx === leftChordIndex) return updatedLeft;
          if (idx === leftChordIndex + 1) return updatedRight;
          return c;
        });

        return {
          ...historyUpdate,
          arrangement: {
            ...state.arrangement,
            chords: get().normalizeChordTrack(next, totalT16),
          },
        };
      }),

      /**
       * Delete a chord segment.
       * The neighbor chord expands to cover the deleted time so there are no gaps.
       */
      deleteChord: (chordIndex) => set((state) => {
        if (!state.arrangement) return state;
        const chords = state.arrangement.chords || [];
        if (chordIndex < 0 || chordIndex >= chords.length) return state;

        const historyUpdate = prepareHistoryUpdate(state);
        if (!historyUpdate) return state;

        const totalT16 = state.arrangement.bars * state.arrangement.timeSig.numerator * 4;

        // If there is only one chord, deleting it disables the chord track.
        if (chords.length === 1) {
          return {
            ...historyUpdate,
            arrangement: {
              ...state.arrangement,
              chords: [],
            },
          };
        }

        const target = chords[chordIndex];
        const remaining = chords.filter((_, idx) => idx !== chordIndex);

        if (chordIndex > 0) {
          // Expand the previous chord.
          const prevIndex = chordIndex - 1;
          const prev = remaining[prevIndex];
          remaining[prevIndex] = { ...prev, duration16: prev.duration16 + target.duration16 };
        } else {
          // Expand the new first chord and shift it to start at 0.
          const first = remaining[0];
          remaining[0] = { ...first, t16: 0, duration16: first.duration16 + target.duration16 };
        }

        return {
          ...historyUpdate,
          arrangement: {
            ...state.arrangement,
            chords: get().normalizeChordTrack(remaining, totalT16),
          },
        };
      }),

      // -- Voice Controls --
      setVoiceSynthVolume: (voiceId, volume) => set((state) => ({
        voiceStates: state.voiceStates.map((v) =>
          v.voiceId === voiceId ? { ...v, synthVolume: Math.max(0, Math.min(1, volume)) } : v
        ),
      })),

      setVoiceSynthMuted: (voiceId, muted) => set((state) => ({
        voiceStates: state.voiceStates.map((v) =>
          v.voiceId === voiceId ? { ...v, synthMuted: muted } : v
        ),
      })),

      setVoiceSynthSolo: (voiceId, solo) => set((state) => ({
        voiceStates: state.voiceStates.map((v) =>
          v.voiceId === voiceId ? { ...v, synthSolo: solo } : v
        ),
      })),

      setVoiceSynthPan: (voiceId, pan) => set((state) => ({
        voiceStates: state.voiceStates.map((v) =>
          v.voiceId === voiceId ? { ...v, synthPan: Math.max(-1, Math.min(1, pan)) } : v
        ),
      })),

      setVoiceVocalVolume: (voiceId, volume) => set((state) => ({
        voiceStates: state.voiceStates.map((v) =>
          v.voiceId === voiceId ? { ...v, vocalVolume: Math.max(0, Math.min(1, volume)) } : v
        ),
      })),

      setVoiceVocalMuted: (voiceId, muted) => set((state) => ({
        voiceStates: state.voiceStates.map((v) =>
          v.voiceId === voiceId ? { ...v, vocalMuted: muted } : v
        ),
      })),

      setVoiceVocalSolo: (voiceId, solo) => set((state) => ({
        voiceStates: state.voiceStates.map((v) =>
          v.voiceId === voiceId ? { ...v, vocalSolo: solo } : v
        ),
      })),

      setVoiceVocalPan: (voiceId, pan) => set((state) => ({
        voiceStates: state.voiceStates.map((v) =>
          v.voiceId === voiceId ? { ...v, vocalPan: Math.max(-1, Math.min(1, pan)) } : v
        ),
      })),

      setVoiceVocalReverb: (voiceId, reverb) => set((state) => ({
        voiceStates: state.voiceStates.map(vs =>
          vs.voiceId === voiceId ? { ...vs, vocalReverb: reverb } : vs
        )
      })),

      // -- Focus (combined synth+vocal solo toggle) --
      // Clicking a contour line toggles "focus" for that voice.
      // Focus means both synthSolo AND vocalSolo are set to true.
      // If already focused, clicking again removes the focus.
      toggleFocus: (voiceId) => set((state) => {
        const vs = state.voiceStates.find(v => v.voiceId === voiceId);
        if (!vs) return state;

        // If this voice is already focused (both solos on), turn it off.
        const isFocused = vs.synthSolo && vs.vocalSolo;
        const newSolo = !isFocused;

        return {
          voiceStates: state.voiceStates.map(v =>
            v.voiceId === voiceId
              ? { ...v, synthSolo: newSolo, vocalSolo: newSolo }
              : v
          ),
        };
      }),

      // Clear all focus: remove all solo states from every voice.
      // Triggered by Escape or explicit clear actions.
      clearAllFocus: () => set((state) => ({
        voiceStates: state.voiceStates.map(v => ({
          ...v,
          synthSolo: false,
          vocalSolo: false,
        })),
      })),

      // Keep focus/solo state valid after arrangement mutations.
      // If a focused voice is deleted or has no nodes (no contour), clear its focus.
      // This prevents "stuck muted" states where solo is active but nothing is focusable.
      cleanupFocusForExistingContours: () => set((state) => {
        const arrangement = state.arrangement;
        if (!arrangement) return state;

        const focusableVoiceIds = new Set(
          arrangement.voices
            .filter((voice) => voice.nodes.length > 0)
            .map((voice) => voice.id)
        );

        let didChange = false;
        const nextVoiceStates = state.voiceStates.map((vs) => {
          if (focusableVoiceIds.has(vs.voiceId)) return vs;

          if (!vs.synthSolo && !vs.vocalSolo) return vs;

          didChange = true;
          return {
            ...vs,
            synthSolo: false,
            vocalSolo: false,
          };
        });

        if (!didChange) return state;
        return { voiceStates: nextVoiceStates };
      }),

      // Global Mix
      setGlobalVolume: (volume) => set({ globalVolume: volume }),
      setGlobalReverb: (reverb) => set({ globalReverb: reverb }),

      // Recording
      armVoice: (voiceId) => set({ armedVoiceId: voiceId }),

      addRecording: (voiceId, recording) => set((state) => {
        const newRecordings = new Map(state.recordings);
        newRecordings.set(voiceId, recording);
        return {
          recordings: newRecordings,
          voiceStates: state.voiceStates.map((v) =>
            v.voiceId === voiceId ? { ...v, hasRecording: true } : v
          ),
        };
      }),

      clearRecording: (voiceId) => set((state) => {
        const newRecordings = new Map(state.recordings);
        newRecordings.delete(voiceId);
        return {
          recordings: newRecordings,
          voiceStates: state.voiceStates.map((v) =>
            v.voiceId === voiceId ? { ...v, hasRecording: false } : v
          ),
        };
      }),

      clearAllRecordings: () => set((state) => ({
        recordings: new Map(),
        voiceStates: state.voiceStates.map((v) => ({ ...v, hasRecording: false })),
        livePitchTrace: [],
        livePitchTraceVoiceId: null,
      })),

      setLivePitchTrace: (trace, voiceId) => set((state) => ({
        livePitchTrace: trace,
        // If voiceId is explicitly provided, always use it (even if trace is empty —
        // this is how startRecording "tags" the trace before data arrives).
        // If voiceId is NOT provided: keep the existing value when trace has data,
        // clear it when trace is emptied (recording finished).
        livePitchTraceVoiceId: voiceId !== undefined
          ? voiceId
          : (trace.length === 0 ? null : state.livePitchTraceVoiceId),
      })),

      addPitchPoint: (point) => set((state) => ({
        livePitchTrace: [...state.livePitchTrace, point],
      })),

      // -- Playback --
      setPlaying: (playing) => set((state) => ({
        playback: { ...state.playback, isPlaying: playing },
      })),

      setMetronomeEnabled: (enabled: boolean) => set((state) => ({
        playback: { ...state.playback, metronomeEnabled: enabled },
      })),

      setRecording: (recording) => set((state) => ({
        playback: { ...state.playback, isRecording: recording },
      })),

      setPosition: (t16) => set((state) => ({
        playback: { ...state.playback, position: t16 },
      })),

      setPositionMs: (ms) => set((state) => ({
        playback: { ...state.playback, positionMs: ms },
      })),

      setLoopEnabled: (enabled) => set((state) => {
        // When turning loop ON, ensure the loop range is valid for the current arrangement.
        // If the range is missing/invalid, seed it with the default (first 4 bars or shorter).
        if (enabled && state.arrangement) {
          const totalSixteenths = state.arrangement.bars * state.arrangement.timeSig.numerator * 4;
          const defaultLoopEnd = getDefaultLoopEndT16(state.arrangement);
          const currentStart = state.playback.loopStart;
          const currentEnd = state.playback.loopEnd;
          const hasValidRange = currentStart >= 0 && currentEnd > currentStart && currentEnd <= totalSixteenths;

          return {
            playback: {
              ...state.playback,
              loopEnabled: enabled,
              loopStart: hasValidRange ? currentStart : 0,
              loopEnd: hasValidRange ? currentEnd : defaultLoopEnd,
            },
          };
        }

        return {
          playback: { ...state.playback, loopEnabled: enabled },
        };
      }),

      setLoopPoints: (start, end) => set((state) => ({
        playback: { ...state.playback, loopStart: start, loopEnd: end },
      })),

      setTempoMultiplier: (multiplier) => set((state) => ({
        playback: { ...state.playback, tempoMultiplier: multiplier },
      })),

      // -- Microphone --
      setMicrophoneState: (newState) => set((state) => ({
        microphoneState: { ...state.microphoneState, ...newState },
      })),

      // -- Count-in --
      setCountIn: (settings) => set((state) => ({
        countIn: { ...state.countIn, ...settings },
      })),

      // -- Vocal Range --
      setVocalRange: (range) => set((state) => {
        const nextRange: VocalRange = { ...state.vocalRange, ...range };

        // Keep note-name and frequency fields in sync.
        // This ensures transposition suggestions work even when you set notes via the mic modal.
        if (range.lowNote) {
          nextRange.lowFrequency = noteNameToFrequency(range.lowNote) ?? nextRange.lowFrequency;
        }
        if (range.highNote) {
          nextRange.highFrequency = noteNameToFrequency(range.highNote) ?? nextRange.highFrequency;
        }

        return {
          vocalRange: nextRange,
        };
      }),

      // -- Display --
      setDisplaySettings: (settings) => set((state) => ({
        display: { ...state.display, ...settings },
      })),

      setZoomLevel: (zoom) => set((state) => ({
        display: { ...state.display, zoomLevel: zoom },
      })),

      // -- Follow-mode timeline --

      /**
       * Set the exact horizontal zoom value (pixels per 16th note).
       */
      setPxPerT: (pxPerT) => set((state) => ({
        followMode: { ...state.followMode, pxPerT: Math.max(0.5, Math.min(60, pxPerT)) },
      })),

      /**
       * Update the minimum pxPerT floor (set by the Grid on resize).
       * Also clamp current pxPerT upward if it's below the new floor.
       */
      setMinPxPerT: (minPxPerT) => set((state) => {
        const clamped = Math.max(minPxPerT, state.followMode.pxPerT);
        return { followMode: { ...state.followMode, minPxPerT, pxPerT: clamped } };
      }),

      /**
       * Store the actual drawable width of the main grid.
       *
       * We keep this in the store so other components (like the minimap) can
       * compute the camera viewport correctly without guessing based on zoom floors.
       */
      setFollowViewportWidthPx: (viewportWidthPx) => set((state) => ({
        followMode: {
          ...state.followMode,
          viewportWidthPx: Math.max(0, viewportWidthPx),
        },
      })),

      setHorizontalZoom: (direction) => set((state) => {
        const factor = direction === 'in' ? 1.15 : 1 / 1.15;
        const floor = state.followMode.minPxPerT;
        const next = Math.max(floor, Math.min(60, state.followMode.pxPerT * factor));
        return { followMode: { ...state.followMode, pxPerT: next } };
      }),

      /**
       * Set the user-selected camera mode (smart / follow / static).
       */
      setCameraMode: (mode) => set((state) => ({
        followMode: { ...state.followMode, cameraMode: mode },
      })),

      /**
       * Increment the camera follow reset counter.
       * The restart button calls this so Grid.tsx can watch the counter
       * and reset the camera to follow mode.
       */
      triggerCameraFollowReset: () => set((state) => ({
        followMode: {
          ...state.followMode,
          cameraFollowResetCount: state.followMode.cameraFollowResetCount + 1,
        },
      })),

      /**
       * Begin a scrub/drag gesture on the main timeline.
       */
      startTimelineDrag: () => set((state) => ({
        followMode: { ...state.followMode, isDraggingTimeline: true },
      })),

      /**
       * Update the pending seek position while dragging.
       * The grid renders using this value instead of the transport worldT.
       */
      updatePendingWorldT: (worldT) => set((state) => ({
        followMode: { ...state.followMode, pendingWorldT: Math.max(0, worldT) },
      })),

      /**
       * Commit the drag: seek the transport to the pending position, then clear drag state.
       */
      commitTimelineDrag: () => set((state) => {
        // The actual seek is handled by the component that calls this
        // (it reads pendingWorldT and calls playbackEngine.seekWorld).
        return {
          followMode: {
            ...state.followMode,
            isDraggingTimeline: false,
            pendingWorldT: null,
          },
        };
      }),

      /**
       * Cancel the drag without seeking.
       */
      cancelTimelineDrag: () => set((state) => ({
        followMode: {
          ...state.followMode,
          isDraggingTimeline: false,
          pendingWorldT: null,
        },
      })),

      /**
       * Begin a drag gesture on the minimap.
       */
      startMinimapDrag: () => set((state) => ({
        followMode: { ...state.followMode, isDraggingMinimap: true },
      })),

      /**
       * Commit the minimap drag: seek the transport to the pending position.
       */
      commitMinimapDrag: () => set((state) => ({
        followMode: {
          ...state.followMode,
          isDraggingMinimap: false,
          pendingWorldT: null,
        },
      })),

      /**
       * Cancel the minimap drag without seeking.
       */
      cancelMinimapDrag: () => set((state) => ({
        followMode: {
          ...state.followMode,
          isDraggingMinimap: false,
          pendingWorldT: null,
        },
      })),

      // -- Play-mode vertical pan (separate from Create) --

      setPlayPitchPanSemitones: (semitones) => set((state) => {
        const clamped = Math.max(-72, Math.min(72, semitones));
        return { followMode: { ...state.followMode, pitchPanSemitones: clamped } };
      }),

      adjustPlayPitchPanSemitones: (deltaSemitones) => set((state) => {
        const next = state.followMode.pitchPanSemitones + deltaSemitones;
        const clamped = Math.max(-72, Math.min(72, next));
        return { followMode: { ...state.followMode, pitchPanSemitones: clamped } };
      }),

      // -- Create-mode navigation --

      setCreateCameraWorldT: (worldT) => set((state) => {
        const clampedMin = 0;

        // In one-shot mode we clamp to the end of the arrangement so you can't pan forever.
        const totalT16 = state.arrangement
          ? state.arrangement.bars * state.arrangement.timeSig.numerator * 4
          : 0;
        const clampedMax = state.playback.loopEnabled ? Number.POSITIVE_INFINITY : totalT16;

        const next = Math.max(clampedMin, Math.min(clampedMax, worldT));
        return { createView: { ...state.createView, cameraWorldT: next } };
      }),

      adjustCreateCameraWorldT: (deltaWorldT) => set((state) => {
        const current = state.createView.cameraWorldT;
        const next = current + deltaWorldT;

        const clampedMin = 0;
        const totalT16 = state.arrangement
          ? state.arrangement.bars * state.arrangement.timeSig.numerator * 4
          : 0;
        const clampedMax = state.playback.loopEnabled ? Number.POSITIVE_INFINITY : totalT16;

        const clamped = Math.max(clampedMin, Math.min(clampedMax, next));
        return { createView: { ...state.createView, cameraWorldT: clamped } };
      }),

      setCreatePitchPanSemitones: (semitones) => set((state) => {
        const clamped = Math.max(-72, Math.min(72, semitones));
        return { createView: { ...state.createView, pitchPanSemitones: clamped } };
      }),

      adjustCreatePitchPanSemitones: (deltaSemitones) => set((state) => {
        const next = state.createView.pitchPanSemitones + deltaSemitones;
        const clamped = Math.max(-72, Math.min(72, next));
        return { createView: { ...state.createView, pitchPanSemitones: clamped } };
      }),

      setGridDivision: (division) => set((state) => ({
        createView: { ...state.createView, gridDivision: division }
      })),

      resetCreateView: () => set({ createView: initialCreateViewState }),

      // -- Theme --
      setTheme: (theme) => set({ theme }),

      // -- Mode --
      setMode: (mode) => set((state) => {
        if (mode === 'create') {
          return {
            mode,
            // In Create mode, always edit in the arrangement's original key
            // (Play mode can still use auto-transposition for singing comfort).
            transposition: 0,

            // Create mode defaults:
            // - One-shot (no looping)
            // - Slightly higher grid opacity for composition
            playback: {
              ...state.playback,
              loopEnabled: false,
            },
            display: {
              ...state.display,
              gridOpacity: 0.75,
            },

            // Reset the vertical pan so the pitch view starts centered.
            createView: {
              ...state.createView,
              pitchPanSemitones: 0,
            },
          };
        }

        // Switching to Play mode should feel like starting fresh:
        // - playhead back to the beginning
        // - zoom back to a sensible "fit" baseline
        // - clear any in-progress scrubs
        return {
          mode,

          playback: {
            ...state.playback,
            isPlaying: false,
            isRecording: false,
            position: 0,
            positionMs: 0,
            loopEnabled: true,
          },

          // Reset follow-mode drag state and snap horizontal zoom back to the fit floor.
          // (The Grid keeps minPxPerT up to date based on viewport width + arrangement length.)
          followMode: {
            ...state.followMode,
            pendingWorldT: null,
            isDraggingTimeline: false,
            isDraggingMinimap: false,
            pxPerT: state.followMode.minPxPerT,
          },

          // Reset vertical zoom to default.
          display: {
            ...state.display,
            gridOpacity: 0.6,
            zoomLevel: 1,
          },
        };
      }),

      // -- UI Modals --
      setLibraryOpen: (open) => set({ isLibraryOpen: open }),
      setMixerOpen: (open) => set({ isMixerOpen: open }),
      setMicSetupOpen: (open) => set({ isMicSetupOpen: open }),
      setDisplaySettingsOpen: (open) => set({ isDisplaySettingsOpen: open }),
      setSaveLoadOpen: (open) => set({ isSaveLoadOpen: open }),
      setCreateModalOpen: (open) => set({ isCreateModalOpen: open }),
      setHelpOpen: (open) => set({ isHelpOpen: open }),
      setCreateModalMode: (mode) => set({ createModalMode: mode }),
      setEditingLibraryItemId: (itemId) => set({ editingLibraryItemId: itemId }),

      // -- Utility --
      initializeVoiceStates: (voices) => {
        const voiceStates: VoiceState[] = voices.map((voice, index) =>
          createVoiceState(voice.id, index)
        );
        set({ voiceStates, recordings: new Map(), livePitchTrace: [], livePitchTraceVoiceId: null });
      },

      reset: () => set(initialState),
    }),
    {
      name: STORAGE_KEY,
      // IMPORTANT:
      // We deep-merge nested user-settings objects so when we add new fields
      // (like display.showMinimap) older saved settings don't erase the new defaults.
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<PersistedState> | undefined) ?? {};
        const next = {
          ...currentState,
          ...persisted,
        } as AppState & AppActions;

        return {
          ...next,
          display: {
            ...currentState.display,
            ...(persisted.display ?? {}),
          },
          microphoneState: {
            ...currentState.microphoneState,
            ...(persisted.microphoneState ?? {}),
          },
          countIn: {
            ...currentState.countIn,
            ...(persisted.countIn ?? {}),
          },
          vocalRange: {
            ...currentState.vocalRange,
            ...(persisted.vocalRange ?? {}),
          },
        };
      },
      // Only persist user settings, not transient state
      partialize: (state): PersistedState => ({
        voiceStates: state.voiceStates,
        voiceColorOverrides: state.voiceColorOverrides,
        globalVolume: state.globalVolume,
        globalReverb: state.globalReverb,
        microphoneState: state.microphoneState,
        countIn: state.countIn,
        vocalRange: state.vocalRange,
        display: state.display,
        theme: state.theme,
      }),
    }
  )
);

/* ------------------------------------------------------------
   Selector Hooks (for convenience)
   ------------------------------------------------------------ */

/**
 * Get the current arrangement.
 */
export const useArrangement = () => useAppStore((state) => state.arrangement);

/**
 * Get playback state.
 * @deprecated Do NOT use — subscribes to the ENTIRE playback object.
 * setPosition() fires ~30fps, creating a new object each time, which
 * forces 30fps re-renders in any component that uses this hook.
 * Instead, subscribe to individual fields: useAppStore(s => s.playback.isPlaying)
 */
export const usePlayback = () => useAppStore((state) => state.playback);

/**
 * Get voice states.
 */
export const useVoiceStates = () => useAppStore((state) => state.voiceStates);

/**
 * Get a specific voice state.
 */
export const useVoiceState = (voiceId: string) =>
  useAppStore((state) => state.voiceStates.find((v) => v.voiceId === voiceId));

/**
 * Get the armed voice ID.
 */
export const useArmedVoiceId = () => useAppStore((state) => state.armedVoiceId);

/**
 * Get display settings.
 */
export const useDisplaySettings = () => useAppStore((state) => state.display);

/**
 * Get current theme.
 */
export const useTheme = () => useAppStore((state) => state.theme);
