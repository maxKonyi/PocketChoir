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
  zoomLevel: number;            // 1 = fit all, higher = zoomed in
  glowIntensity: number;        // 0-2, multiplier for glow effects
  gridOpacity: number;          // 0-1, opacity of grid elements
  backgroundVideo: string;      // Current background video path (or 'none')
  backgroundBlur: number;       // Blur amount in px
  backgroundBrightness: number; // 0-1 brightness
}



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
  isRangeSetupOpen: boolean;
  isDisplaySettingsOpen: boolean;
  isSaveLoadOpen: boolean;
  isCreateModalOpen: boolean;
}

/**
 * Actions that can modify the state.
 */
interface AppActions {
  // Arrangement
  setArrangement: (arrangement: Arrangement | null) => void;
  setTransposition: (semitones: number) => void;

  // Auto-transpose helper
  // Calculates a transposition based on the current arrangement + vocal range.
  // If `announce` is true, it also sets a short-lived UI notice.
  applyAutoTranspositionIfPossible: (announce: boolean) => void;

  // Create mode - node editing
  addNode: (voiceId: string, t16: number, deg: number, octave?: number) => void;
  removeNode: (voiceId: string, t16: number) => void;
  updateNode: (voiceId: string, oldT16: number, newT16: number, deg: number, octave?: number, term?: boolean) => void;
  setSelectedVoiceId: (voiceId: string | null) => void;

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
  setLivePitchTrace: (trace: PitchPoint[]) => void;
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

  // Theme
  setTheme: (theme: ThemeName) => void;

  // Mode
  setMode: (mode: 'play' | 'create') => void;

  // UI modals
  setLibraryOpen: (open: boolean) => void;
  setMixerOpen: (open: boolean) => void;
  setMicSetupOpen: (open: boolean) => void;
  setRangeSetupOpen: (open: boolean) => void;
  setDisplaySettingsOpen: (open: boolean) => void;
  setSaveLoadOpen: (open: boolean) => void;
  setCreateModalOpen: (open: boolean) => void;

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
  gridOpacity: 1.0,
  backgroundVideo: '/src/data/backgrounds/Forest1.mp4',
  backgroundBlur: 4,
  backgroundBrightness: 0.6,
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
  isRangeSetupOpen: false,
  isDisplaySettingsOpen: false,
  isSaveLoadOpen: false,
  isCreateModalOpen: false,
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

  // -- Arrangement --
  setArrangement: (arrangement) => {
    // Clear recordings and armed voice when changing arrangement
    set({
      arrangement,
      transposition: 0,
      recordings: new Map(),
      livePitchTrace: [],
      armedVoiceId: null,
    });
    if (arrangement) {
      get().initializeVoiceStates(arrangement.voices);
      // Set loop end to arrangement length and reset position
      const totalSixteenths = arrangement.bars * 16; // Assuming 4/4
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
  addNode: (voiceId, t16, deg, octave = 0) => set((state) => {
    if (!state.arrangement) return state;

    // Find and update the voice
    const updatedVoices = state.arrangement.voices.map((voice) => {
      if (voice.id !== voiceId) return voice;

      // Remove any existing node at this t16, then add new one
      const filteredNodes = voice.nodes.filter((n) => n.t16 !== t16);
      const newNode = { t16, deg, octave };
      const newNodes = [...filteredNodes, newNode].sort((a, b) => a.t16 - b.t16);

      return { ...voice, nodes: newNodes };
    });

    return {
      arrangement: { ...state.arrangement, voices: updatedVoices },
    };
  }),

  removeNode: (voiceId, t16) => set((state) => {
    if (!state.arrangement) return state;

    const updatedVoices = state.arrangement.voices.map((voice) => {
      if (voice.id !== voiceId) return voice;
      return {
        ...voice,
        nodes: voice.nodes.filter((n) => n.t16 !== t16),
      };
    });

    return {
      arrangement: { ...state.arrangement, voices: updatedVoices },
    };
  }),

  updateNode: (voiceId, oldT16, newT16, deg, octave = 0, term = false) => set((state) => {
    if (!state.arrangement) return state;

    const updatedVoices = state.arrangement.voices.map((voice) => {
      if (voice.id !== voiceId) return voice;

      // Remove old node, add updated one
      const filteredNodes = voice.nodes.filter((n) => n.t16 !== oldT16 && n.t16 !== newT16);
      const updatedNode = { t16: newT16, deg, octave, ...(term ? { term: true } : {}) };
      const newNodes = [...filteredNodes, updatedNode].sort((a, b) => a.t16 - b.t16);

      return { ...voice, nodes: newNodes };
    });

    return {
      arrangement: { ...state.arrangement, voices: updatedVoices },
    };
  }),

  setSelectedVoiceId: (voiceId) => set({ selectedVoiceId: voiceId }),

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
  })),

  setLivePitchTrace: (trace) => set({ livePitchTrace: trace }),

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

  // -- Theme --
  setTheme: (theme) => set({ theme }),

  // -- Mode --
  setMode: (mode) => set({ mode }),

  // -- UI Modals --
  setLibraryOpen: (open) => set({ isLibraryOpen: open }),
  setMixerOpen: (open) => set({ isMixerOpen: open }),
  setMicSetupOpen: (open) => set({ isMicSetupOpen: open }),
  setRangeSetupOpen: (open) => set({ isRangeSetupOpen: open }),
  setDisplaySettingsOpen: (open) => set({ isDisplaySettingsOpen: open }),
  setSaveLoadOpen: (open) => set({ isSaveLoadOpen: open }),
  setCreateModalOpen: (open) => set({ isCreateModalOpen: open }),

  // -- Utility --
  initializeVoiceStates: (voices) => {
    // Keep default panning consistent with the reference synth defaults in SynthVoice.
    // Index mapping: Soprano=0, Alto=1, Tenor=2, Bass=3 (and extra voices default center).
    const getDefaultPanForIndex = (voiceIndex: number): number => {
      if (voiceIndex === 1) return -0.8;
      if (voiceIndex === 2) return 0.8;
      return 0;
    };

    const voiceStates: VoiceState[] = voices.map((voice, index) => ({
      voiceId: voice.id,
      synthVolume: 0.5,
      synthMuted: false,
      synthSolo: false,
      synthPan: getDefaultPanForIndex(index),
      isArmed: false,
      hasRecording: false,
      vocalVolume: 0.8,
      vocalMuted: false,
      vocalSolo: false,
      vocalPan: getDefaultPanForIndex(index),
      vocalReverb: 0.3,
    }));
    set({ voiceStates, recordings: new Map(), livePitchTrace: [] });
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
