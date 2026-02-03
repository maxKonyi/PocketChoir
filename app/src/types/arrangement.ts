/* ============================================================
   ARRANGEMENT TYPES
   
   These types define the structure of musical arrangements.
   An arrangement is a multi-voice harmony that users sing along to.
   ============================================================ */

/**
 * A single node in a voice contour line.
 * Nodes define pitch points at specific times in the arrangement.
 */
export interface Node {
  t16: number;      // Time position in 16th-note steps from start (0 = beginning)
  deg: number;      // Scale degree (1-7 for basic scale, can extend for chromatic)
  octave?: number;  // Octave offset from default (0 = default, -1 = down, +1 = up)
  term?: boolean;   // If true, this node ends the current phrase (next node starts new phrase)
}

/**
 * A single voice in an arrangement.
 * Each voice has its own color and sequence of nodes.
 */
export interface Voice {
  id: string;       // Unique identifier for this voice (e.g., "v1", "v2")
  name: string;     // Display name (e.g., "Soprano", "Voice 1")
  color: string;    // CSS color for rendering this voice's contour line
  nodes: Node[];    // Array of pitch nodes defining the melody
}

/**
 * Time signature definition.
 * Most arrangements use 4/4 but we support others.
 */
export interface TimeSignature {
  numerator: number;    // Beats per bar (e.g., 4 in 4/4)
  denominator: number;  // Note value that gets one beat (e.g., 4 = quarter note)
}

/**
 * A chord in the optional chord track.
 * Chords are displayed above the grid for reference.
 */
export interface Chord {
  t16: number;      // Start time in 16th-note steps
  duration16: number; // Duration in 16th-note steps
  name: string;     // Chord name to display (e.g., "Gm7", "C9")
  root?: number;    // Root scale degree (optional, for analysis)
  quality?: string; // Chord quality (optional, e.g., "maj7", "min", "dim")
}

/**
 * Scale type for the arrangement.
 * Determines which pitches are available.
 */
export type ScaleType = 
  | 'major' 
  | 'minor' 
  | 'dorian' 
  | 'mixolydian' 
  | 'pentatonic-major'
  | 'pentatonic-minor'
  | 'blues'
  | 'chromatic';

/**
 * Full arrangement definition.
 * This is the main data structure for a singable harmony.
 */
export interface Arrangement {
  id: string;                   // Unique identifier
  title: string;                // Display title
  description?: string;         // Optional description
  
  // Timing
  tempo: number;                // Beats per minute (BPM)
  timeSig: TimeSignature;       // Time signature
  bars: number;                 // Total length in bars
  
  // Pitch/Key
  tonic: string;                // Tonic note name (e.g., "C", "F#", "Bb")
  scale: ScaleType;             // Scale type
  
  // Content
  voices: Voice[];              // Array of voice parts (1-6 voices)
  chords?: Chord[];             // Optional chord track for display
  
  // Metadata
  difficulty?: number;          // Difficulty rating (1-5)
  tags?: string[];              // Tags for categorization
  author?: string;              // Creator name
  createdAt?: string;           // ISO date string
}

/**
 * Simplified arrangement info for library display.
 * Used in list views without loading full arrangement data.
 */
export interface ArrangementInfo {
  id: string;
  title: string;
  description?: string;
  voiceCount: number;
  bars: number;
  tempo: number;
  difficulty?: number;
  tags?: string[];
}
