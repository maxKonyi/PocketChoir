/* ============================================================
   PERFORMANCE TYPES
   
   These types define user recordings and saved performances.
   A performance is a user's recorded takes over an arrangement.
   ============================================================ */

/**
 * A single pitch detection data point.
 * Used to store the user's pitch trace for visualization.
 */
export interface PitchPoint {
  time: number;       // Time in milliseconds from recording start
  frequency: number;  // Detected pitch frequency in Hz (0 = silence/undetected)
  confidence: number; // Detection confidence (0-1)
}

/**
 * A recorded take for a single voice.
 * Contains both the audio and the pitch trace data.
 */
export interface Recording {
  voiceId: string;          // Which voice this recording is for
  audioBlob: Blob;          // The raw audio recording
  pitchTrace: PitchPoint[]; // Array of pitch detection points
  recordedAt: string;       // ISO date string when recorded
  duration: number;         // Duration in milliseconds
}

/**
 * Mixer settings for a single voice track.
 * Controls how the voice sounds in playback.
 */
export interface VoiceMixerSettings {
  voiceId: string;    // Which voice these settings apply to
  volume: number;     // Volume level (0-1)
  pan: number;        // Stereo pan (-1 = left, 0 = center, 1 = right)
  reverb: number;     // Reverb send amount (0-1)
  muted: boolean;     // Whether this voice is muted
  solo: boolean;      // Whether this voice is soloed
}

/**
 * Settings for a synth (reference) voice track.
 * Simpler than vocal mix settings.
 */
export interface SynthMixerSettings {
  voiceId: string;    // Which voice this synth plays
  volume: number;     // Volume level (0-1)
  muted: boolean;     // Whether this synth is muted
  solo: boolean;      // Whether this synth is soloed
}

/**
 * Complete mixer state for a performance.
 * Contains settings for both synths and user recordings.
 */
export interface MixerState {
  synthSettings: SynthMixerSettings[];   // One per arrangement voice
  vocalSettings: VoiceMixerSettings[];   // One per recorded voice
  masterVolume: number;                   // Master output volume (0-1)
}

/**
 * A saved performance (user's session with recordings).
 * This is what gets saved to IndexedDB.
 */
export interface Performance {
  id: string;                   // Unique identifier
  name: string;                 // User-given name for this performance
  arrangementId: string;        // Which arrangement this is for
  transposition: number;        // Semitones transposed from original key
  
  recordings: Recording[];      // User's recorded takes (one per voice)
  mixerState: MixerState;       // Mixer settings
  
  createdAt: string;            // ISO date string when first created
  updatedAt: string;            // ISO date string when last modified
  
  // Optional metadata
  completed?: boolean;          // Whether all voices have been recorded
  notes?: string;               // User notes about this performance
}

/**
 * Simplified performance info for list display.
 * Used in saved performances list without loading audio blobs.
 */
export interface PerformanceInfo {
  id: string;
  name: string;
  arrangementId: string;
  arrangementTitle?: string;    // Looked up from arrangement
  recordedVoiceCount: number;   // How many voices have recordings
  totalVoiceCount: number;      // Total voices in arrangement
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}
