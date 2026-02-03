/* ============================================================
   MUSIC UTILITIES
   
   Helper functions for musical calculations:
   - Converting scale degrees to frequencies
   - Note name parsing
   - Transposition
   ============================================================ */

/**
 * Map of note names to semitones above C.
 * Used for converting note names to numeric values.
 */
const NOTE_TO_SEMITONE: Record<string, number> = {
  'C': 0, 'C#': 1, 'Db': 1,
  'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'Fb': 4, 'E#': 5,
  'F': 5, 'F#': 6, 'Gb': 6,
  'G': 7, 'G#': 8, 'Ab': 8,
  'A': 9, 'A#': 10, 'Bb': 10,
  'B': 11, 'Cb': 11, 'B#': 0,
};

/**
 * Array of note names for converting semitones back to names.
 * Uses sharps by default.
 */
const SEMITONE_TO_NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Chromatic scale degree labels (relative to tonic).
 * Index 0 = tonic (1), index 1 = minor 2nd (b2), etc.
 */
export const CHROMATIC_LABELS = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];

/**
 * Get the chromatic label for a semitone offset from tonic.
 * @param semitoneOffset - Semitones above tonic (0-11, wraps for higher/lower octaves)
 * @returns Label like "1", "b3", "#4", etc.
 */
export function semitoneToLabel(semitoneOffset: number): string {
  // Normalize to 0-11 range
  const normalized = ((semitoneOffset % 12) + 12) % 12;
  return CHROMATIC_LABELS[normalized];
}

/**
 * Convert a scale degree + octave to semitones above the base tonic.
 * @param deg - Scale degree (1-7)
 * @param octave - Octave offset
 * @param scaleType - Scale type for degree-to-semitone mapping
 * @returns Semitones above base tonic (can be negative for lower octaves)
 */
export function degreeToSemitoneOffset(deg: number, octave: number, scaleType: string): number {
  return scaleDegreeToSemitones(deg, scaleType, octave);
}

/**
 * Scale patterns as arrays of semitone offsets from the tonic.
 * Each number represents how many semitones above the tonic that scale degree is.
 */
const SCALE_PATTERNS: Record<string, number[]> = {
  'major':            [0, 2, 4, 5, 7, 9, 11],  // 1, 2, 3, 4, 5, 6, 7
  'minor':            [0, 2, 3, 5, 7, 8, 10],  // Natural minor
  'dorian':           [0, 2, 3, 5, 7, 9, 10],
  'mixolydian':       [0, 2, 4, 5, 7, 9, 10],
  'pentatonic-major': [0, 2, 4, 7, 9],         // 5 notes: 1, 2, 3, 5, 6
  'pentatonic-minor': [0, 3, 5, 7, 10],        // 5 notes: 1, b3, 4, 5, b7
  'blues':            [0, 3, 5, 6, 7, 10],     // Minor pentatonic + blue note
  'chromatic':        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/**
 * Reference frequency for A4 (standard tuning).
 */
const A4_FREQUENCY = 440;

/**
 * MIDI note number for A4.
 */
const A4_MIDI = 69;

/**
 * Parse a note name like "C4" or "F#3" into its components.
 * @param noteName - The note name with octave (e.g., "C4", "Bb3")
 * @returns Object with note name and octave, or null if invalid
 */
export function parseNoteName(noteName: string): { note: string; octave: number } | null {
  // Match note name (letter + optional accidental) and octave number
  const match = noteName.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!match) return null;
  
  const note = match[1].charAt(0).toUpperCase() + match[1].slice(1); // Normalize case
  const octave = parseInt(match[2], 10);
  
  if (NOTE_TO_SEMITONE[note] === undefined) return null;
  
  return { note, octave };
}

/**
 * Convert a note name to its MIDI note number.
 * @param noteName - The note name with octave (e.g., "C4" = 60)
 * @returns MIDI note number, or null if invalid
 */
export function noteNameToMidi(noteName: string): number | null {
  const parsed = parseNoteName(noteName);
  if (!parsed) return null;
  
  const semitone = NOTE_TO_SEMITONE[parsed.note];
  // MIDI note = (octave + 1) * 12 + semitone
  // C4 = 60, so C-1 = 0
  return (parsed.octave + 1) * 12 + semitone;
}

/**
 * Convert a MIDI note number to a note name.
 * @param midi - MIDI note number (0-127)
 * @returns Note name with octave (e.g., "C4")
 */
export function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const semitone = midi % 12;
  return SEMITONE_TO_NOTE[semitone] + octave;
}

/**
 * Convert a MIDI note number to frequency in Hz.
 * @param midi - MIDI note number
 * @returns Frequency in Hz
 */
export function midiToFrequency(midi: number): number {
  // Formula: f = 440 * 2^((midi - 69) / 12)
  return A4_FREQUENCY * Math.pow(2, (midi - A4_MIDI) / 12);
}

/**
 * Convert a frequency to the nearest MIDI note number.
 * @param frequency - Frequency in Hz
 * @returns MIDI note number (may be fractional for off-pitch notes)
 */
export function frequencyToMidi(frequency: number): number {
  // Formula: midi = 69 + 12 * log2(f / 440)
  return A4_MIDI + 12 * Math.log2(frequency / A4_FREQUENCY);
}

/**
 * Convert a frequency to the nearest note name.
 * @param frequency - Frequency in Hz
 * @returns Note name with octave
 */
export function frequencyToNoteName(frequency: number): string {
  const midi = Math.round(frequencyToMidi(frequency));
  return midiToNoteName(midi);
}

/**
 * Convert a note name directly to frequency.
 * @param noteName - Note name with octave (e.g., "A4" = 440)
 * @returns Frequency in Hz, or null if invalid
 */
export function noteNameToFrequency(noteName: string): number | null {
  const midi = noteNameToMidi(noteName);
  if (midi === null) return null;
  return midiToFrequency(midi);
}

/**
 * Get the semitone offset for a scale degree in a given scale.
 * @param scaleDegree - Scale degree (1-7 for most scales)
 * @param scaleType - Type of scale
 * @param octaveOffset - Additional octave offset (default 0)
 * @returns Semitones above the tonic
 */
export function scaleDegreeToSemitones(
  scaleDegree: number,
  scaleType: string,
  octaveOffset: number = 0
): number {
  const pattern = SCALE_PATTERNS[scaleType] || SCALE_PATTERNS['major'];
  const scaleLength = pattern.length;
  
  // Handle degrees outside the basic scale (e.g., degree 8 = octave above 1)
  // Degree 1 = index 0, degree 2 = index 1, etc.
  const degreeIndex = scaleDegree - 1;
  const octaves = Math.floor(degreeIndex / scaleLength);
  const indexInScale = ((degreeIndex % scaleLength) + scaleLength) % scaleLength; // Handle negatives
  
  return pattern[indexInScale] + (octaves + octaveOffset) * 12;
}

/**
 * Convert a scale degree to frequency, given a tonic.
 * @param scaleDegree - Scale degree (1 = tonic)
 * @param tonic - Tonic note name (e.g., "C", "F#")
 * @param scaleType - Type of scale
 * @param baseOctave - Octave for degree 1 (default 4)
 * @param octaveOffset - Additional octave offset
 * @returns Frequency in Hz
 */
export function scaleDegreeToFrequency(
  scaleDegree: number,
  tonic: string,
  scaleType: string,
  baseOctave: number = 4,
  octaveOffset: number = 0
): number {
  // Get tonic's semitone value
  const tonicSemitone = NOTE_TO_SEMITONE[tonic];
  if (tonicSemitone === undefined) {
    console.warn(`Invalid tonic: ${tonic}, defaulting to C`);
    return scaleDegreeToFrequency(scaleDegree, 'C', scaleType, baseOctave, octaveOffset);
  }
  
  // Calculate MIDI note for the tonic at baseOctave
  const tonicMidi = (baseOctave + 1) * 12 + tonicSemitone;
  
  // Get semitone offset for this scale degree
  const semitoneOffset = scaleDegreeToSemitones(scaleDegree, scaleType, octaveOffset);
  
  // Final MIDI note
  const midi = tonicMidi + semitoneOffset;
  
  return midiToFrequency(midi);
}

/**
 * Transpose a tonic by a number of semitones.
 * @param tonic - Original tonic (e.g., "C", "F#")
 * @param semitones - Number of semitones to transpose (positive = up)
 * @returns New tonic note name
 */
export function transposeTonic(tonic: string, semitones: number): string {
  const originalSemitone = NOTE_TO_SEMITONE[tonic];
  if (originalSemitone === undefined) return tonic;
  
  const newSemitone = ((originalSemitone + semitones) % 12 + 12) % 12;
  return SEMITONE_TO_NOTE[newSemitone];
}

/**
 * Calculate the frequency range of an arrangement.
 * @param voices - Array of voices with nodes
 * @param tonic - Arrangement tonic
 * @param scaleType - Scale type
 * @param baseOctave - Base octave for degree 1
 * @returns Object with min and max frequencies
 */
export function getArrangementFrequencyRange(
  voices: Array<{ nodes: Array<{ deg: number; octave?: number }> }>,
  tonic: string,
  scaleType: string,
  baseOctave: number = 4
): { minFreq: number; maxFreq: number; minNote: string; maxNote: string } {
  let minMidi = Infinity;
  let maxMidi = -Infinity;
  
  for (const voice of voices) {
    for (const node of voice.nodes) {
      const freq = scaleDegreeToFrequency(
        node.deg,
        tonic,
        scaleType,
        baseOctave,
        node.octave || 0
      );
      const midi = frequencyToMidi(freq);
      minMidi = Math.min(minMidi, midi);
      maxMidi = Math.max(maxMidi, midi);
    }
  }
  
  return {
    minFreq: midiToFrequency(minMidi),
    maxFreq: midiToFrequency(maxMidi),
    minNote: midiToNoteName(Math.round(minMidi)),
    maxNote: midiToNoteName(Math.round(maxMidi)),
  };
}

/**
 * Suggest transposition to fit a vocal range.
 * @param arrangementRange - Min/max frequencies of arrangement
 * @param vocalRange - User's vocal range
 * @returns Suggested transposition in semitones
 */
export function suggestTransposition(
  arrangementRange: { minFreq: number; maxFreq: number },
  vocalRange: { lowFrequency: number; highFrequency: number }
): number {
  const arrMidMidi = frequencyToMidi(
    Math.sqrt(arrangementRange.minFreq * arrangementRange.maxFreq)
  );
  const vocalMidMidi = frequencyToMidi(
    Math.sqrt(vocalRange.lowFrequency * vocalRange.highFrequency)
  );
  
  // Round to nearest semitone
  return Math.round(vocalMidMidi - arrMidMidi);
}
