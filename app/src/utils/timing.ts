/* ============================================================
   TIMING UTILITIES
   
   Helper functions for musical timing calculations:
   - Converting between time units (bars, beats, 16ths, milliseconds)
   - Tempo calculations
   ============================================================ */

import type { TimeSignature } from '../types';

export type GridDivision = '16th' | 'triplet';

/**
 * Snap a raw t16 value to the nearest grid division.
 * @param rawT16 - Raw time in 16th notes
 * @param division - The grid division to snap to
 * @returns Quantized time in 16th notes
 */
export function quantizeT16(rawT16: number, division: GridDivision): number {
  if (division === '16th') {
    return Math.round(rawT16);
  } else if (division === 'triplet') {
    // 1 beat = 4 sixteenths. Triplets divide a beat into 3.
    // 1 triplet = 4/3 sixteenths.
    const triplets = rawT16 / (4 / 3);
    const snappedTriplets = Math.round(triplets);
    const snappedT16 = snappedTriplets * (4 / 3);
    // Round to 4 decimal places to avoid float precision issues in keys
    return Number(snappedT16.toFixed(4));
  }
  return Math.round(rawT16);
}

/**
 * Check if two t16 values are effectively equal (handling float precision)
 */
export function isT16Equal(t1: number, t2: number): boolean {
  return Math.abs(t1 - t2) < 0.001;
}

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
 * Get the total number of 16th notes in an arrangement.
 * @param bars - Number of bars
 * @param timeSig - Time signature
 * @returns Total number of 16th notes
 */
export function arrangementTotalSixteenths(bars: number, timeSig: TimeSignature): number {
  return bars * sixteenthsPerBar(timeSig);
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
