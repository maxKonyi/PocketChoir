/* ============================================================
   MUSIC UTILITIES
   
   Helper functions for musical calculations:
   - Converting scale degrees to frequencies
   - Note name parsing
   - Transposition
   ============================================================ */

import type { Arrangement, Node, Voice } from '../types';

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

// Major-scale spellings by tonic (including enharmonic keys) so note names
// follow key context correctly instead of always defaulting to sharps.
const MAJOR_SCALE_NOTES_BY_TONIC: Record<string, [string, string, string, string, string, string, string]> = {
  C: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  G: ['G', 'A', 'B', 'C', 'D', 'E', 'F#'],
  D: ['D', 'E', 'F#', 'G', 'A', 'B', 'C#'],
  A: ['A', 'B', 'C#', 'D', 'E', 'F#', 'G#'],
  E: ['E', 'F#', 'G#', 'A', 'B', 'C#', 'D#'],
  B: ['B', 'C#', 'D#', 'E', 'F#', 'G#', 'A#'],
  'F#': ['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#'],
  'C#': ['C#', 'D#', 'E#', 'F#', 'G#', 'A#', 'B#'],
  F: ['F', 'G', 'A', 'Bb', 'C', 'D', 'E'],
  Bb: ['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A'],
  Eb: ['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D'],
  Ab: ['Ab', 'Bb', 'C', 'Db', 'Eb', 'F', 'G'],
  Db: ['Db', 'Eb', 'F', 'Gb', 'Ab', 'Bb', 'C'],
  Gb: ['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'F'],
  Cb: ['Cb', 'Db', 'Eb', 'Fb', 'Gb', 'Ab', 'Bb'],
};

/**
 * Chromatic scale degree labels (relative to tonic).
 * Index 0 = tonic (1), index 1 = minor 2nd (b2), etc.
 */
export const CHROMATIC_LABELS = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];

/**
 * Solfege syllables for chromatic scale degrees (key-agnostic, fixed-Do approach).
 * Index 0 = tonic (Do), index 1 = minor 2nd (Ra), etc.
 * Follows the same order as CHROMATIC_LABELS: 1-b2-2-b3-3-4-#4-5-b6-6-b7-7
 */
export const SOLFEGE_LABELS = ['Do', 'Ra', 'Re', 'Me', 'Mi', 'Fa', 'Fi', 'Sol', 'Le', 'La', 'Te', 'Ti'];

type DegreeSpelling = {
  // 0-based diatonic degree index in the major scale (0=1, 1=2, ... 6=7)
  degreeIndex: number;
  // Accidental shift to apply to that diatonic degree (-1=flat, +1=sharp)
  accidentalDelta: number;
};

const DEGREE_SPELLING_BY_CHROMATIC_INDEX: DegreeSpelling[] = [
  { degreeIndex: 0, accidentalDelta: 0 },  // 1
  { degreeIndex: 1, accidentalDelta: -1 }, // b2
  { degreeIndex: 1, accidentalDelta: 0 },  // 2
  { degreeIndex: 2, accidentalDelta: -1 }, // b3
  { degreeIndex: 2, accidentalDelta: 0 },  // 3
  { degreeIndex: 3, accidentalDelta: 0 },  // 4
  { degreeIndex: 3, accidentalDelta: 1 },  // #4
  { degreeIndex: 4, accidentalDelta: 0 },  // 5
  { degreeIndex: 5, accidentalDelta: -1 }, // b6
  { degreeIndex: 5, accidentalDelta: 0 },  // 6
  { degreeIndex: 6, accidentalDelta: -1 }, // b7
  { degreeIndex: 6, accidentalDelta: 0 },  // 7
];

function normalizeTonicName(tonic: string): string {
  const trimmed = tonic.trim();
  const match = trimmed.match(/^([A-Ga-g])([#b]?)/);
  if (!match) return '';
  return `${match[1].toUpperCase()}${match[2]}`;
}

function noteAccidentalToOffset(noteName: string): number {
  let offset = 0;
  for (let i = 1; i < noteName.length; i++) {
    const ch = noteName[i];
    if (ch === '#') offset += 1;
    else if (ch === 'b') offset -= 1;
  }
  return offset;
}

function accidentalOffsetToSuffix(offset: number): string {
  if (offset > 0) return '#'.repeat(offset);
  if (offset < 0) return 'b'.repeat(Math.abs(offset));
  return '';
}

function applyAccidentalDelta(noteName: string, accidentalDelta: number): string {
  const letter = noteName.charAt(0);
  const baseOffset = noteAccidentalToOffset(noteName);
  const finalOffset = baseOffset + accidentalDelta;
  return `${letter}${accidentalOffsetToSuffix(finalOffset)}`;
}

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
 * Get the solfege syllable for a semitone offset from tonic.
 * Key-agnostic: 0 = Do, 2 = Re, 4 = Mi, etc.
 * @param semitoneOffset - Semitones above tonic (0-11, wraps for higher/lower octaves)
 * @returns Solfege syllable like "Do", "Re", "Mi", etc.
 */
export function semitoneToSolfege(semitoneOffset: number): string {
  const normalized = ((semitoneOffset % 12) + 12) % 12;
  return SOLFEGE_LABELS[normalized];
}

/**
 * Get the letter name for a semitone offset from tonic, accounting for transposition.
 * 
 * The semitone offset (0-11) follows the app convention:
 *   0=1, 1=b2, 2=2, 3=b3, 4=3, 5=4, 6=#4, 7=5, 8=b6, 9=6, 10=b7, 11=7
 * 
 * Given a tonic (e.g. "C") and a transposition (semitones), this returns the
 * actual sounding note letter name (e.g. "D", "F#", "Bb").
 * 
 * @param semitoneOffset - Semitones above tonic (wraps for higher/lower octaves)
 * @param tonic - The arrangement's tonic note name (e.g. "C", "F#")
 * @param transposition - Semitones of transposition applied to the arrangement (default 0)
 * @returns Letter name like "C", "F#", "Bb", etc.
 */
export function semitoneToLetterName(semitoneOffset: number, tonic: string, transposition: number = 0): string {
  const tonicName = normalizeTonicName(tonic);
  const tonicSemitone = NOTE_TO_SEMITONE[tonicName];
  if (tonicSemitone === undefined) return '?';

  // Convert to a chromatic degree index relative to tonic.
  const chromaticIndex = ((semitoneOffset + transposition) % 12 + 12) % 12;
  const spelling = DEGREE_SPELLING_BY_CHROMATIC_INDEX[chromaticIndex];

  // Pick a key-aware major-scale spelling table for this tonic.
  const scaleNotes = MAJOR_SCALE_NOTES_BY_TONIC[tonicName];
  if (!scaleNotes) {
    // Fallback if tonic spelling is unusual: preserve previous behavior.
    const absoluteSemitone = ((tonicSemitone + semitoneOffset + transposition) % 12 + 12) % 12;
    return SEMITONE_TO_NOTE[absoluteSemitone];
  }

  const baseDegreeNote = scaleNotes[spelling.degreeIndex];
  return applyAccidentalDelta(baseDegreeNote, spelling.accidentalDelta);
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
export const SCALE_PATTERNS: Record<string, number[]> = {
  'major': [0, 2, 4, 5, 7, 9, 11],  // 1, 2, 3, 4, 5, 6, 7
  'minor': [0, 2, 3, 5, 7, 8, 10],  // Natural minor
  'dorian': [0, 2, 3, 5, 7, 9, 10],
  'mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'pentatonic-major': [0, 2, 4, 7, 9],         // 5 notes: 1, 2, 3, 5, 6
  'pentatonic-minor': [0, 3, 5, 7, 10],        // 5 notes: 1, b3, 4, 5, b7
  'blues': [0, 3, 5, 6, 7, 10],     // Minor pentatonic + blue note
  'chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/**
 * Reference frequency for A4 (standard tuning).
 */
export const A4_FREQUENCY = 440;

/**
 * MIDI note number for A4.
 */
export const A4_MIDI = 69;

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
        node.deg ?? 0,
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
 * Auto-fit transpose outcome labels used by store/UI.
 */
export type AutoFitTransposeOutcome = 'auto-fit' | 'best-fit' | 'no-good-solution';

/**
 * Per-candidate range stats.
 */
export interface AutoFitRangeStats {
  minPitch: number;
  maxPitch: number;
  maxLowBelow: number;
  maxHighAbove: number;
  pctLowBelow: number;
  pctHighAbove: number;
}

/**
 * Per-candidate mud stats.
 */
export interface AutoFitMudStats {
  mudOk: boolean;
  violationCount: number;
  worstViolation: number;
}

/**
 * Full evaluation stats for one transposition value.
 */
export interface AutoFitCandidateStats {
  t: number;
  range: AutoFitRangeStats;
  mud: AutoFitMudStats;
}

/**
 * Return value for the new beta auto-fit transposition evaluator.
 */
export interface AutoFitTransposeResult {
  outcome: AutoFitTransposeOutcome;
  tBest: number | null;
  stats: {
    userLowMidi: number;
    userHighMidi: number;
    arrangementMinMidi: number;
    arrangementMaxMidi: number;
    arrangementSpan: number;
    userSpan: number;
    spanGap: number;
    sampleCount: number;
    mudSafeCandidateCount: number;
    fullFitCandidateCount: number;
    chosen: AutoFitCandidateStats | null;
  };
}

/**
 * Centralized tuning/config values for beta auto-fit transpose.
 *
 * Keep all thresholds in ONE place so product tuning is easy.
 */
export const AUTO_FIT_TRANSPOSE_CONFIG = {
  // Candidate search bounds.
  minTranspose: -48,
  maxTranspose: 48,

  // Timeline sampling resolution for analysis.
  sampleCount: 128,

  // MIDI constants used by the mud rule.
  midiFloors: {
    G2: 43,
    E2: 40,
    D2: 38,
  },

  // Cost weights when no full fit exists.
  bestFitWeights: {
    maxLowBelow: 100,
    maxHighAbove: 30,
    pctLowBelow: 10,
    pctHighAbove: 3,
    absTranspose: 0.5,
  },

  // Heuristics for Outcome C (no good auto-apply).
  noGoodSolution: {
    spanGapAtLeast: 12,
    bothEdgesFarAtLeast: 6,
  },
} as const;

/**
 * True when an arrangement's `semi` values are absolute offsets from C4.
 * Imported MIDI arrangements use this mode.
 */
function isAbsoluteSemiArrangement(arrangement: Arrangement): boolean {
  return Array.isArray(arrangement.tags) && arrangement.tags.includes('midi-import');
}

/**
 * Convert one arrangement node to MIDI at transpose=0.
 */
function nodeToMidi(node: Node, arrangement: Arrangement): number {
  if (node.semi !== undefined) {
    const baseMidi = isAbsoluteSemiArrangement(arrangement)
      ? 60 // C4 reference for MIDI-import absolute semitone mode
      : (noteNameToMidi(`${arrangement.tonic}4`) ?? 60);
    return baseMidi + node.semi;
  }

  const freq = scaleDegreeToFrequency(
    node.deg ?? 0,
    arrangement.tonic,
    arrangement.scale,
    4,
    node.octave || 0
  );
  return frequencyToMidi(freq);
}

/**
 * Return the currently active pitch MIDI values for all voices at a sample time.
 *
 * We mirror playback semantics:
 * - most recent node at/before time is active
 * - `term` node = silence until next real node
 */
function getActivePitchesAtTime(
  voices: Voice[],
  arrangement: Arrangement,
  sampleT16: number,
  transposeSemitones: number
): number[] {
  const pitches: number[] = [];

  for (const voice of voices) {
    let activeNode: Node | null = null;

    for (const node of voice.nodes) {
      if (node.t16 <= sampleT16) {
        activeNode = node;
      } else {
        break;
      }
    }

    if (!activeNode || activeNode.term) continue;
    pitches.push(nodeToMidi(activeNode, arrangement) + transposeSemitones);
  }

  return pitches;
}

/**
 * Return the base MIDI floor for mud checks by simple interval class.
 */
function getMudBaseFloorMidi(simpleIntervalClass: number): number | null {
  const { G2, E2, D2 } = AUTO_FIT_TRANSPOSE_CONFIG.midiFloors;

  if (simpleIntervalClass === 0 || simpleIntervalClass === 7) return null;
  if (simpleIntervalClass === 1 || simpleIntervalClass === 2) return G2;
  if (simpleIntervalClass === 3 || simpleIntervalClass === 4) return G2;
  if (simpleIntervalClass === 5 || simpleIntervalClass === 6) return E2;
  if (simpleIntervalClass === 8 || simpleIntervalClass === 9) return D2;
  if (simpleIntervalClass === 10 || simpleIntervalClass === 11) return E2;

  return null;
}

/**
 * Evaluate one transpose candidate.
 */
function evaluateTransposeCandidate(
  arrangement: Arrangement,
  userLowMidi: number,
  userHighMidi: number,
  transposeSemitones: number,
  sampleCount: number
): AutoFitCandidateStats {
  const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;

  let minPitch = Infinity;
  let maxPitch = -Infinity;
  let lowExceededSamples = 0;
  let highExceededSamples = 0;

  let mudViolationCount = 0;
  let mudWorstViolation = 0;

  for (let i = 0; i < sampleCount; i++) {
    const sampleT16 = (i / sampleCount) * totalT16;
    const activePitches = getActivePitchesAtTime(arrangement.voices, arrangement, sampleT16, transposeSemitones);
    if (activePitches.length === 0) continue;

    let sampleMin = Infinity;
    let sampleMax = -Infinity;
    let sampleHasLowViolation = false;
    let sampleHasHighViolation = false;

    for (const pitch of activePitches) {
      sampleMin = Math.min(sampleMin, pitch);
      sampleMax = Math.max(sampleMax, pitch);
      if (pitch < userLowMidi) sampleHasLowViolation = true;
      if (pitch > userHighMidi) sampleHasHighViolation = true;
    }

    minPitch = Math.min(minPitch, sampleMin);
    maxPitch = Math.max(maxPitch, sampleMax);
    if (sampleHasLowViolation) lowExceededSamples += 1;
    if (sampleHasHighViolation) highExceededSamples += 1;

    if (activePitches.length < 2) continue;

    // Mud checker only needs the two lowest active voices at this time.
    const sorted = [...activePitches].sort((a, b) => a - b);
    const p0 = sorted[0];
    const p1 = sorted[1];
    const d = Math.round(p1 - p0);
    if (d === 0) continue;

    const oct = Math.floor(d / 12);
    const simpleClass = ((d % 12) + 12) % 12;
    const baseFloorMidi = getMudBaseFloorMidi(simpleClass);
    if (baseFloorMidi === null) continue;

    // Compound interval rule: one octave lower floor per extra octave spacing.
    const requiredBassMin = baseFloorMidi - 12 * oct;
    if (p0 < requiredBassMin) {
      mudViolationCount += 1;
      mudWorstViolation = Math.max(mudWorstViolation, requiredBassMin - p0);
    }
  }

  // Guard empty/silent arrangements from Infinity math.
  if (!Number.isFinite(minPitch) || !Number.isFinite(maxPitch)) {
    minPitch = userLowMidi;
    maxPitch = userLowMidi;
  }

  const maxLowBelow = Math.max(0, userLowMidi - minPitch);
  const maxHighAbove = Math.max(0, maxPitch - userHighMidi);
  const pctLowBelow = (lowExceededSamples / sampleCount) * 100;
  const pctHighAbove = (highExceededSamples / sampleCount) * 100;

  return {
    t: transposeSemitones,
    range: {
      minPitch,
      maxPitch,
      maxLowBelow,
      maxHighAbove,
      pctLowBelow,
      pctHighAbove,
    },
    mud: {
      mudOk: mudViolationCount === 0,
      violationCount: mudViolationCount,
      worstViolation: mudWorstViolation,
    },
  };
}

/**
 * Pick the candidate with smallest absolute transpose movement.
 */
function pickSmallestMovement(candidates: AutoFitCandidateStats[]): AutoFitCandidateStats {
  return candidates.reduce((best, candidate) => {
    const bestAbs = Math.abs(best.t);
    const candidateAbs = Math.abs(candidate.t);
    if (candidateAbs < bestAbs) return candidate;
    if (candidateAbs > bestAbs) return best;
    return candidate.t < best.t ? candidate : best;
  });
}

/**
 * Cost function used for best-fit (when full fit is impossible).
 */
function getBestFitCost(candidate: AutoFitCandidateStats): number {
  const w = AUTO_FIT_TRANSPOSE_CONFIG.bestFitWeights;
  return (
    w.maxLowBelow * candidate.range.maxLowBelow
    + w.maxHighAbove * candidate.range.maxHighAbove
    + w.pctLowBelow * candidate.range.pctLowBelow
    + w.pctHighAbove * candidate.range.pctHighAbove
    + w.absTranspose * Math.abs(candidate.t)
  );
}

/**
 * Beta evaluator that picks an auto-fit transposition from arrangement + user range.
 */
export function evaluateAutoFitTranspose(
  userRange: { lowFrequency: number; highFrequency: number },
  arrangement: Arrangement
): AutoFitTransposeResult {
  const sampleCount = AUTO_FIT_TRANSPOSE_CONFIG.sampleCount;
  const userLowMidi = frequencyToMidi(userRange.lowFrequency);
  const userHighMidi = frequencyToMidi(userRange.highFrequency);

  const allCandidates: AutoFitCandidateStats[] = [];
  for (let t = AUTO_FIT_TRANSPOSE_CONFIG.minTranspose; t <= AUTO_FIT_TRANSPOSE_CONFIG.maxTranspose; t += 1) {
    allCandidates.push(
      evaluateTransposeCandidate(arrangement, userLowMidi, userHighMidi, t, sampleCount)
    );
  }

  const originalStats = allCandidates.find((candidate) => candidate.t === 0) ?? allCandidates[0];
  const arrangementMinMidi = originalStats.range.minPitch;
  const arrangementMaxMidi = originalStats.range.maxPitch;
  const arrangementSpan = arrangementMaxMidi - arrangementMinMidi;
  const userSpan = userHighMidi - userLowMidi;
  const spanGap = arrangementSpan - userSpan;

  const mudSafeCandidates = allCandidates.filter((candidate) => candidate.mud.mudOk);
  const fullFitCandidates = mudSafeCandidates.filter(
    (candidate) => candidate.range.maxLowBelow === 0 && candidate.range.maxHighAbove === 0
  );

  const statsBase = {
    userLowMidi,
    userHighMidi,
    arrangementMinMidi,
    arrangementMaxMidi,
    arrangementSpan,
    userSpan,
    spanGap,
    sampleCount,
    mudSafeCandidateCount: mudSafeCandidates.length,
    fullFitCandidateCount: fullFitCandidates.length,
  };

  // Outcome C trigger #1: no mud-safe candidates at all.
  if (mudSafeCandidates.length === 0) {
    return {
      outcome: 'no-good-solution',
      tBest: null,
      stats: {
        ...statsBase,
        chosen: null,
      },
    };
  }

  const chosen = fullFitCandidates.length > 0
    ? pickSmallestMovement(fullFitCandidates)
    : mudSafeCandidates.reduce((best, candidate) => (
      getBestFitCost(candidate) < getBestFitCost(best) ? candidate : best
    ));

  // Outcome C trigger #2: arrangement span exceeds user range by >= 12 semitones.
  const spanTooWide = spanGap >= AUTO_FIT_TRANSPOSE_CONFIG.noGoodSolution.spanGapAtLeast;

  // Outcome C trigger #3: even best mud-safe choice is far outside both edges.
  const farOutsideBothEdges = (
    chosen.range.maxLowBelow >= AUTO_FIT_TRANSPOSE_CONFIG.noGoodSolution.bothEdgesFarAtLeast
    && chosen.range.maxHighAbove >= AUTO_FIT_TRANSPOSE_CONFIG.noGoodSolution.bothEdgesFarAtLeast
  );

  if (spanTooWide || farOutsideBothEdges) {
    return {
      outcome: 'no-good-solution',
      tBest: null,
      stats: {
        ...statsBase,
        chosen,
      },
    };
  }

  const isFullFit = chosen.range.maxLowBelow === 0 && chosen.range.maxHighAbove === 0;
  return {
    outcome: isFullFit ? 'auto-fit' : 'best-fit',
    tBest: chosen.t,
    stats: {
      ...statsBase,
      chosen,
    },
  };
}

/**
 * Suggest a transposition that tries to fit the ENTIRE arrangement range
 * (lowest to highest note) inside the user's vocal range.
 *
 * @param arrangementRange - Min/max frequencies of arrangement
 * @param vocalRange - User's vocal range
 * @returns Suggested transposition in semitones
 */
export function suggestTranspositionToFitRange(
  arrangementRange: { minFreq: number; maxFreq: number },
  vocalRange: { lowFrequency: number; highFrequency: number }
): number {
  const arrMinMidi = frequencyToMidi(arrangementRange.minFreq);
  const arrMaxMidi = frequencyToMidi(arrangementRange.maxFreq);
  const userMinMidi = frequencyToMidi(vocalRange.lowFrequency);
  const userMaxMidi = frequencyToMidi(vocalRange.highFrequency);

  // If the arrangement already fits, no transposition needed.
  if (arrMinMidi >= userMinMidi && arrMaxMidi <= userMaxMidi) {
    return 0;
  }

  // Compute the set of semitone shifts that would make BOTH edges fit.
  // We want:
  //   arrMinMidi + shift >= userMinMidi  -> shift >= userMinMidi - arrMinMidi
  //   arrMaxMidi + shift <= userMaxMidi  -> shift <= userMaxMidi - arrMaxMidi
  const minShift = Math.ceil(userMinMidi - arrMinMidi);
  const maxShift = Math.floor(userMaxMidi - arrMaxMidi);

  // If there is an overlap interval, pick the shift closest to 0.
  if (minShift <= maxShift) {
    if (0 < minShift) return minShift;
    if (0 > maxShift) return maxShift;
    return 0;
  }

  // If it can't fully fit, choose the shift that minimizes the worst edge violation.
  // We'll check a reasonable window of shifts and pick the best.
  let bestShift = 0;
  let bestScore = Infinity;

  for (let shift = -24; shift <= 24; shift++) {
    const shiftedMin = arrMinMidi + shift;
    const shiftedMax = arrMaxMidi + shift;

    const lowViolation = Math.max(0, userMinMidi - shiftedMin);
    const highViolation = Math.max(0, shiftedMax - userMaxMidi);

    const score = Math.max(lowViolation, highViolation);

    // Prefer smaller absolute transpositions when scores tie.
    if (score < bestScore || (score === bestScore && Math.abs(shift) < Math.abs(bestShift))) {
      bestScore = score;
      bestShift = shift;
    }
  }

  return bestShift;
}

