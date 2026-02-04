/* ============================================================
   AUDIO TYPES
   
   These types define audio-related structures for the app.
   Includes microphone info, playback state, etc.
   ============================================================ */

/**
 * Information about an available audio input device.
 */
export interface AudioInputDevice {
  deviceId: string;   // Browser-assigned device ID
  label: string;      // Human-readable device name
  isDefault: boolean; // Whether this is the system default
}

/**
 * Current state of microphone input.
 */
export interface MicrophoneState {
  available: boolean;       // Whether we have mic permission
  devices: AudioInputDevice[]; // List of available input devices
  selectedDeviceId: string | null; // Currently selected device
  inputGain: number;        // Input gain/sensitivity (0-2, 1 = normal)
  monitoring: boolean;      // Whether to play mic input back to user
  isRecording: boolean;     // Whether currently recording
}

/**
 * Playback transport state.
 */
export interface PlaybackState {
  isPlaying: boolean;       // Whether playback is active
  isRecording: boolean;     // Whether recording is active
  position: number;         // Current position in 16th-note steps
  positionMs: number;       // Current position in milliseconds
  loopEnabled: boolean;     // Whether looping is enabled
  loopStart: number;        // Loop start position in 16th-note steps
  loopEnd: number;          // Loop end position in 16th-note steps
  tempoMultiplier: number;  // Playback speed multiplier (0.5, 0.75, 1.0)
  metronomeEnabled: boolean; // Whether the metronome click is active during playback
}

/**
 * Count-in settings before recording.
 */
export interface CountInSettings {
  enabled: boolean;         // Whether count-in is enabled
  bars: number;             // Number of bars to count in (typically 1)
  audible: boolean;         // Whether to play click sounds
  visual: boolean;          // Whether to show visual countdown
}

/**
 * Settings for real-time pitch detection.
 */
export interface PitchDetectionSettings {
  minFrequency: number;     // Minimum detectable frequency (Hz)
  maxFrequency: number;     // Maximum detectable frequency (Hz)
  smoothingFactor: number;  // How much to smooth pitch values (0-1)
  confidenceThreshold: number; // Minimum confidence to show pitch (0-1)
  updateInterval: number;   // How often to update pitch (ms)
}

/**
 * User's vocal range settings for transposition.
 */
export interface VocalRange {
  lowNote: string;          // Lowest comfortable note (e.g., "C3")
  highNote: string;         // Highest comfortable note (e.g., "G5")
  lowFrequency: number;     // Low note frequency in Hz
  highFrequency: number;    // High note frequency in Hz
}
