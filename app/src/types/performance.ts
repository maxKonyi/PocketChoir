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
  startPositionMs?: number; // Timeline position where this recording started
  earlyFadeMs?: number;     // Milliseconds of early count-in to fade in
}
