/* ============================================================
   TIMING UTILITIES
   
   Helper functions for musical timing calculations:
   - Converting between time units (bars, beats, 16ths, milliseconds)
   - Tempo calculations
   ============================================================ */

import type { TimeSignature } from '../types';

/**
 * Calculate how many 16th notes are in one bar.
 * @param timeSig - Time signature
 * @returns Number of 16th notes per bar
 */
export function sixteenthsPerBar(timeSig: TimeSignature): number {
  // In 4/4: 4 quarter notes × 4 sixteenths = 16
  // In 3/4: 3 quarter notes × 4 sixteenths = 12
  // In 6/8: 6 eighth notes × 2 sixteenths = 12
  const sixteenthsPerBeat = 16 / timeSig.denominator;
  return timeSig.numerator * sixteenthsPerBeat;
}

/**
 * Calculate how many 16th notes are in one beat.
 * @param timeSig - Time signature
 * @returns Number of 16th notes per beat
 */
export function sixteenthsPerBeat(timeSig: TimeSignature): number {
  // In x/4 time: 4 sixteenths per beat (quarter note)
  // In x/8 time: 2 sixteenths per beat (eighth note)
  return 16 / timeSig.denominator;
}

/**
 * Calculate the duration of one 16th note in milliseconds.
 * @param tempo - Tempo in BPM (beats per minute)
 * @param timeSig - Time signature
 * @returns Duration of one 16th note in milliseconds
 */
export function sixteenthDurationMs(tempo: number, timeSig: TimeSignature): number {
  // Duration of one beat in ms = 60000 / tempo
  // Duration of one 16th = beat duration / sixteenths per beat
  const beatDurationMs = 60000 / tempo;
  const sixteenthsInBeat = sixteenthsPerBeat(timeSig);
  return beatDurationMs / sixteenthsInBeat;
}

/**
 * Convert a position in 16th notes to milliseconds.
 * @param t16 - Position in 16th note steps
 * @param tempo - Tempo in BPM
 * @param timeSig - Time signature
 * @returns Position in milliseconds
 */
export function t16ToMs(t16: number, tempo: number, timeSig: TimeSignature): number {
  return t16 * sixteenthDurationMs(tempo, timeSig);
}

/**
 * Convert a position in milliseconds to 16th notes.
 * @param ms - Position in milliseconds
 * @param tempo - Tempo in BPM
 * @param timeSig - Time signature
 * @returns Position in 16th note steps
 */
export function msToT16(ms: number, tempo: number, timeSig: TimeSignature): number {
  return ms / sixteenthDurationMs(tempo, timeSig);
}

/**
 * Convert a position in 16th notes to bar number (0-indexed).
 * @param t16 - Position in 16th note steps
 * @param timeSig - Time signature
 * @returns Bar number (0-indexed)
 */
export function t16ToBar(t16: number, timeSig: TimeSignature): number {
  return Math.floor(t16 / sixteenthsPerBar(timeSig));
}

/**
 * Convert a position in 16th notes to beat within the bar (0-indexed).
 * @param t16 - Position in 16th note steps
 * @param timeSig - Time signature
 * @returns Beat number within the bar (0-indexed)
 */
export function t16ToBeat(t16: number, timeSig: TimeSignature): number {
  const positionInBar = t16 % sixteenthsPerBar(timeSig);
  return Math.floor(positionInBar / sixteenthsPerBeat(timeSig));
}

/**
 * Convert a position in 16th notes to a formatted time string.
 * Format: "Bar.Beat.Sixteenth" (all 1-indexed for display)
 * @param t16 - Position in 16th note steps
 * @param timeSig - Time signature
 * @returns Formatted position string (e.g., "1.1.1", "2.3.2")
 */
export function t16ToDisplayString(t16: number, timeSig: TimeSignature): string {
  const bar = t16ToBar(t16, timeSig) + 1; // 1-indexed
  const positionInBar = t16 % sixteenthsPerBar(timeSig);
  const beat = Math.floor(positionInBar / sixteenthsPerBeat(timeSig)) + 1;
  const sixteenthInBeat = (positionInBar % sixteenthsPerBeat(timeSig)) + 1;
  
  return `${bar}.${beat}.${sixteenthInBeat}`;
}

/**
 * Get the total duration of an arrangement in milliseconds.
 * @param bars - Number of bars
 * @param tempo - Tempo in BPM
 * @param timeSig - Time signature
 * @returns Total duration in milliseconds
 */
export function arrangementDurationMs(
  bars: number,
  tempo: number,
  timeSig: TimeSignature
): number {
  const totalSixteenths = bars * sixteenthsPerBar(timeSig);
  return t16ToMs(totalSixteenths, tempo, timeSig);
}

/**
 * Get the total number of 16th notes in an arrangement.
 * @param bars - Number of bars
 * @param timeSig - Time signature
 * @returns Total number of 16th notes
 */
export function arrangementTotalSixteenths(bars: number, timeSig: TimeSignature): number {
  return bars * sixteenthsPerBar(timeSig);
}

/**
 * Apply a tempo multiplier to get effective tempo.
 * @param baseTempo - Original tempo in BPM
 * @param multiplier - Speed multiplier (e.g., 0.5, 0.75, 1.0)
 * @returns Effective tempo in BPM
 */
export function applyTempoMultiplier(baseTempo: number, multiplier: number): number {
  return baseTempo * multiplier;
}

/**
 * Quantize a position to the nearest grid division.
 * @param t16 - Position in 16th note steps
 * @param gridDivision - Grid division (1 = 16th, 2 = 8th, 4 = quarter, etc.)
 * @returns Quantized position in 16th note steps
 */
export function quantizeToGrid(t16: number, gridDivision: number = 1): number {
  return Math.round(t16 / gridDivision) * gridDivision;
}

/**
 * Generate an array of grid line positions for rendering.
 * @param bars - Number of bars
 * @param timeSig - Time signature
 * @returns Array of objects describing each grid line
 */
export function generateGridLines(
  bars: number,
  timeSig: TimeSignature
): Array<{ t16: number; type: 'bar' | 'beat' | 'subdivision' }> {
  const lines: Array<{ t16: number; type: 'bar' | 'beat' | 'subdivision' }> = [];
  const totalSixteenths = arrangementTotalSixteenths(bars, timeSig);
  const sixteenthsInBar = sixteenthsPerBar(timeSig);
  const sixteenthsInBeat = sixteenthsPerBeat(timeSig);
  
  for (let t16 = 0; t16 <= totalSixteenths; t16++) {
    if (t16 % sixteenthsInBar === 0) {
      lines.push({ t16, type: 'bar' });
    } else if (t16 % sixteenthsInBeat === 0) {
      lines.push({ t16, type: 'beat' });
    } else {
      lines.push({ t16, type: 'subdivision' });
    }
  }
  
  return lines;
}
