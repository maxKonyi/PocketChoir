/* ============================================================
   APP STORE
   
   Central state management using Zustand.
   Contains all application state: arrangement, playback, recording, etc.
   ============================================================ */

import { create } from 'zustand';
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
}

/**
 * Complete application state.
 */
interface AppState {
  // Current arrangement
  arrangement: Arrangement | null;
  transposition: number;        // Semitones to transpose
  
  // Voice states (one per voice in arrangement)
  voiceStates: VoiceState[];
  
  // Playback state
  playback: PlaybackState;
  
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
  
  // UI state
  isLibraryOpen: boolean;
  isMixerOpen: boolean;
  isMicSetupOpen: boolean;
  isRangeSetupOpen: boolean;
  isDisplaySettingsOpen: boolean;
  isSaveLoadOpen: boolean;
}

/**
 * Actions that can modify the state.
 */
interface AppActions {
  // Arrangement
  setArrangement: (arrangement: Arrangement | null) => void;
  setTransposition: (semitones: number) => void;
  
  // Voice controls
  setVoiceSynthVolume: (voiceId: string, volume: number) => void;
  setVoiceSynthMuted: (voiceId: string, muted: boolean) => void;
  setVoiceSynthSolo: (voiceId: string, solo: boolean) => void;
  setVoiceVocalVolume: (voiceId: string, volume: number) => void;
  setVoiceVocalMuted: (voiceId: string, muted: boolean) => void;
  setVoiceVocalSolo: (voiceId: string, solo: boolean) => void;
  setVoiceVocalPan: (voiceId: string, pan: number) => void;
  setVoiceVocalReverb: (voiceId: string, reverb: number) => void;
  
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
};

const initialMicrophoneState: MicrophoneState = {
  available: false,
  devices: [],
  selectedDeviceId: null,
  inputGain: 1.0,
  monitoring: false,
  isRecording: false,
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
  glowIntensity: 1,
};

const initialState: AppState = {
  arrangement: null,
  transposition: 0,
  voiceStates: [],
  playback: initialPlaybackState,
  armedVoiceId: null,
  recordings: new Map(),
  livePitchTrace: [],
  microphoneState: initialMicrophoneState,
  countIn: initialCountIn,
  vocalRange: initialVocalRange,
  display: initialDisplaySettings,
  theme: 'default',
  mode: 'play',
  isLibraryOpen: false,
  isMixerOpen: false,
  isMicSetupOpen: false,
  isRangeSetupOpen: false,
  isDisplaySettingsOpen: false,
  isSaveLoadOpen: false,
};

/* ------------------------------------------------------------
   Store Creation
   ------------------------------------------------------------ */

export const useAppStore = create<AppState & AppActions>((set, get) => ({
  ...initialState,

  // -- Arrangement --
  setArrangement: (arrangement) => {
    set({ arrangement, transposition: 0 });
    if (arrangement) {
      get().initializeVoiceStates(arrangement.voices);
      // Set loop end to arrangement length
      const totalSixteenths = arrangement.bars * 16; // Assuming 4/4
      set((state) => ({
        playback: { ...state.playback, loopEnd: totalSixteenths },
      }));
    }
  },
  
  setTransposition: (semitones) => set({ transposition: semitones }),

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
    voiceStates: state.voiceStates.map((v) =>
      v.voiceId === voiceId ? { ...v, vocalReverb: Math.max(0, Math.min(1, reverb)) } : v
    ),
  })),

  // -- Recording --
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
  setVocalRange: (range) => set((state) => ({
    vocalRange: { ...state.vocalRange, ...range },
  })),

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

  // -- Utility --
  initializeVoiceStates: (voices) => {
    const voiceStates: VoiceState[] = voices.map((voice) => ({
      voiceId: voice.id,
      synthVolume: 0.5,
      synthMuted: false,
      synthSolo: false,
      isArmed: false,
      hasRecording: false,
      vocalVolume: 0.8,
      vocalMuted: false,
      vocalSolo: false,
      vocalPan: 0,
      vocalReverb: 0.3,
    }));
    set({ voiceStates, recordings: new Map(), livePitchTrace: [] });
  },
  
  reset: () => set(initialState),
}));

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
