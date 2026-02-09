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
  Voice,
  PlaybackState,
  MicrophoneState,
  Recording,
  PitchPoint,
  CountInSettings,
  VocalRange,
} from '../types';
import type { ThemeName } from '../utils/colors';
import { getArrangementFrequencyRange, noteNameToFrequency, suggestTranspositionToFitRange } from '../utils/music';
import { DEFAULT_VOICE_COLORS } from '../utils/colors';

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
  showChordTrack: boolean;      // Show chord labels above grid
  showScaleDegrees: boolean;    // Show numbers on nodes
  showPitchLabels: boolean;     // Show note names
  labelFormat: 'degree' | 'solfege' | 'noteName';
  zoomLevel: number;            // 1 = fit all, higher = zoomed in (vertical / pitch zoom)
  glowIntensity: number;        // 0-2, multiplier for glow effects
  gridOpacity: number;          // 0-1, opacity of grid elements
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
}

/**
 * When editing an arrangement's parameters, these are the supported fields.
 * (We intentionally keep this scoped to the essentials: title, tempo, length, key, scale, time signature.)
 */
export type ArrangementParamsUpdate = {
  title: string;
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
 * Complete application state.
 */
interface AppState {
  // Current arrangement
  arrangement: Arrangement | null;
  transposition: number;        // Semitones to transpose

  // A short-lived UI message for auto-transposition events.
  // (Shown after you close the mic modal or pick a new arrangement.)
  autoTranspositionNotice: string | null;

  // Voice states (one per voice in arrangement)
  voiceStates: VoiceState[];

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

  // Helpers (Chord Track)
  getTotalT16: (arrangement: Arrangement) => number;
  createDefaultChordTrack: (arrangement: Arrangement) => Chord[];
  normalizeChordTrack: (chords: Chord[], totalT16: number) => Chord[];

  // Auto-transpose helper
  // Calculates a transposition based on the current arrangement + vocal range.
  // If `announce` is true, it also sets a short-lived UI notice.
  applyAutoTranspositionIfPossible: (announce: boolean) => void;

  // Create mode - node editing
  addNode: (voiceId: string, t16: number, deg: number, octave?: number, semi?: number) => void;
  removeNode: (voiceId: string, t16: number) => void;
  updateNode: (voiceId: string, oldT16: number, newT16: number, deg: number, octave?: number, term?: boolean, semi?: number) => void;
  setSelectedVoiceId: (voiceId: string | null) => void;

  // Create mode - chord track editing
  enableChordTrack: () => void;
  disableChordTrack: () => void;
  setChordName: (chordIndex: number, name: string) => void;
  splitChordAt: (t16: number) => void;
  resizeChordBoundary: (leftChordIndex: number, newBoundaryT16: number) => void;
  deleteChord: (chordIndex: number) => void;

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
  startTimelineDrag: () => void;
  updatePendingWorldT: (worldT: number) => void;
  commitTimelineDrag: () => void;
  cancelTimelineDrag: () => void;
  startMinimapDrag: () => void;
  commitMinimapDrag: () => void;
  cancelMinimapDrag: () => void;

  // Create-mode navigation
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
  setCreateModalMode: (mode: 'create' | 'edit') => void;

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
  loopEnabled: true,
  loopStart: 0,
  loopEnd: 64,           // Default 4 bars in 4/4 = 64 sixteenths
  tempoMultiplier: 1.0,
  metronomeEnabled: false,
};

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
  showChordTrack: true,
  showScaleDegrees: true,
  showPitchLabels: false,
  labelFormat: 'degree',
  zoomLevel: 1,
  glowIntensity: 0,
  gridOpacity: 0.6,
  backgroundVideo: '/src/data/backgrounds/Forest1.mp4',
  backgroundBlur: 4,
  backgroundBrightness: 0.6,
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
};

const initialCreateViewState: CreateViewState = {
  cameraWorldT: 0,
  pitchPanSemitones: 0,
};



const initialState: AppState = {
  arrangement: null,
  transposition: 0,
  autoTranspositionNotice: null,
  voiceStates: [],
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
  history: [],
  future: [],
  canUndo: false,
  canRedo: false,
  followMode: initialFollowModeState,
  createView: initialCreateViewState,
  createModalMode: 'create',
};

/* ------------------------------------------------------------
   Store Creation with Persistence
   ------------------------------------------------------------ */

// Storage key for localStorage
const STORAGE_KEY = 'harmony-singing-settings';

// State that should be persisted (user settings only)
type PersistedState = Pick<AppState,
  | 'voiceStates'      // Mixer: per-voice volume, pan, mute, solo, reverb
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
    // Clear recordings and armed voice when changing arrangement
    set({
      arrangement,
      transposition: 0,
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

      if (normalizedChords) {
        arrangement = { ...arrangement, chords: normalizedChords };
        set({ arrangement });
      }

      // In Create mode, always default the editor to the first available voice.
      // This prevents stale selection from a previous arrangement (e.g. selecting Voice 3
      // when the new arrangement only has Voice 1).
      const firstVoiceId = arrangement.voices[0]?.id ?? null;
      set({ selectedVoiceId: firstVoiceId });

      get().initializeVoiceStates(arrangement.voices);
      // Set loop end to arrangement length and reset position
      const totalSixteenths = arrangement.bars * arrangement.timeSig.numerator * 4;
      set((state) => ({
        playback: {
          ...state.playback,
          loopEnd: totalSixteenths,
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

  applyAutoTranspositionIfPossible: (announce) => {
    const arrangement = get().arrangement;
    const vocalRange = get().vocalRange;

    // Nothing to do if we don't have an arrangement loaded.
    if (!arrangement) return;

    const arrangementRange = getArrangementFrequencyRange(
      arrangement.voices,
      arrangement.tonic,
      arrangement.scale
    );

    // Prefer the stored frequencies (they are kept in sync in setVocalRange).
    const userRange = {
      lowFrequency: vocalRange.lowFrequency,
      highFrequency: vocalRange.highFrequency,
    };

    const suggested = suggestTranspositionToFitRange(arrangementRange, userRange);

    set({ transposition: suggested });

    if (!announce) return;

    const msg = suggested === 0
      ? 'Arrangement fits your vocal range — no transposition needed.'
      : `Arrangement auto-transposed by ${suggested > 0 ? '+' : ''}${suggested} semitones to fit your range.`;

    set({ autoTranspositionNotice: msg });
    window.setTimeout(() => {
      // Only clear if nothing newer has replaced it.
      if (get().autoTranspositionNotice === msg) {
        set({ autoTranspositionNotice: null });
      }
    }, 4500);
  },

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
      const newNode = { t16, deg, octave, ...(semi !== undefined ? { semi } : {}) };
      const newNodes = [...filteredNodes, newNode].sort((a, b) => a.t16 - b.t16);

      return { ...voice, nodes: newNodes };
    });

    return {
      ...historyUpdate,
      arrangement: { ...state.arrangement, voices: updatedVoices },
    };
  }),

  removeNode: (voiceId, t16) => set((state) => {
    if (!state.arrangement) return state;

    const historyUpdate = prepareHistoryUpdate(state);
    if (!historyUpdate) return state;

    const updatedVoices = state.arrangement.voices.map((voice) => {
      if (voice.id !== voiceId) return voice;

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
        return {
          ...voice,
          nodes: voice.nodes.filter((n) => n.t16 !== t16 && (attachedAnchorT16 === null || n.t16 !== attachedAnchorT16)),
        };
      }

      return {
        ...voice,
        nodes: voice.nodes.filter((n) => n.t16 !== t16),
      };
    });

    return {
      ...historyUpdate,
      arrangement: { ...state.arrangement, voices: updatedVoices },
    };
  }),

  updateNode: (voiceId, oldT16, newT16, deg, octave = 0, term = false, semi) => set((state) => {
    if (!state.arrangement) return state;

    const historyUpdate = prepareHistoryUpdate(state);
    if (!historyUpdate) return state;

    const updatedVoices = state.arrangement.voices.map((voice) => {
      if (voice.id !== voiceId) return voice;

      // Locate the node being updated so we can keep track of any anchor it drives.
      const originalNode = voice.nodes.find((n) => n.t16 === oldT16);
      if (!originalNode) {
        return voice;
      }

      // Start from the list without the original node (and without any accidental duplicate at newT16).
      const nodesWithoutTarget = voice.nodes.filter((n) => n.t16 !== oldT16 && n.t16 !== newT16);

      const updatedNode = {
        t16: newT16,
        deg,
        octave,
        ...(semi !== undefined ? { semi } : {}),
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

    return {
      arrangement: { ...state.arrangement, voices: updatedVoices },
    };
  }),

  setSelectedVoiceId: (voiceId) => set({ selectedVoiceId: voiceId }),

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

    const nextArrangement: Arrangement = {
      ...prev,
      title: update.title,
      tempo: nextTempo,
      tonic: update.tonic,
      scale: update.scale,
      bars: nextBars,
      timeSig: { numerator: nextTimeSigNum, denominator: nextTimeSigDen },
      voices: nextVoices,
      chords: nextChords,
    };

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
    const snappedT16 = Math.round(t16);

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

    const snappedBoundary = Math.round(newBoundaryT16);
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

  setLoopEnabled: (enabled) => set((state) => ({
    playback: { ...state.playback, loopEnabled: enabled },
  })),

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

  resetCreateView: () => set({ createView: initialCreateViewState }),

  // -- Theme --
  setTheme: (theme) => set({ theme }),

  // -- Mode --
  setMode: (mode) => set((state) => {
    if (mode === 'create') {
      return {
        mode,

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
  setCreateModalMode: (mode) => set({ createModalMode: mode }),

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
      // Only persist user settings, not transient state
      partialize: (state): PersistedState => ({
        voiceStates: state.voiceStates,
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
