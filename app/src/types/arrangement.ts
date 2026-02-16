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
  deg?: number;     // Scale degree (1-7 for basic scale, can extend for chromatic). Required unless `semi` is provided.
  octave?: number;  // Octave offset from default (0 = default, -1 = down, +1 = up)
  semi?: number;    // Optional: chromatic semitone offset from tonic (0 = tonic). If set, this overrides deg/octave.
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
 * One lyric token attached to a specific melody node in Voice 1.
 *
 * `text` stores exactly what should render under that node.
 * Connector visuals (split dashes / hold lines) are stored separately in
 * `connectorToNext`, not embedded in this text.
 * Examples:
 * - "Wel"
 * - "come"
 * - "ther"
 */
export interface LyricEntry {
  t16: number;      // Time of the Voice 1 node this lyric belongs to
  text: string;     // Word/syllable text for this node
  connectorToNext?: LyricConnector; // Optional visual connector from this node to the next node
}

/**
 * Visual connector from one lyric token to the next melody node.
 *
 * - 'dash' = split-syllable connector (e.g. Wel - come)
 * - 'hold' = sustained-syllable line (e.g. To_____)
 */
export type LyricConnector = 'dash' | 'hold';

/**
 * Optional lyrics track.
 *
 * - `enabled=false` means this arrangement has no notated lyrics.
 * - `enabled=true` means lyrics are attached to Voice 1 nodes via `entries`.
 */
export interface LyricsTrack {
  enabled: boolean;
  entries: LyricEntry[];
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
  lyrics?: LyricsTrack;         // Optional lyrics track attached to Voice 1 nodes
  
  // Metadata
  difficulty?: number;          // Difficulty rating (1-5)
  tags?: string[];              // Tags for categorization
  author?: string;              // Creator name
  createdAt?: string;           // ISO date string
}
