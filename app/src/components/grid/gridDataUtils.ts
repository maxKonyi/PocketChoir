import type { Arrangement, Chord, LyricConnector } from '../../types';
import { degreeToSemitoneOffset, noteNameToMidi, SCALE_PATTERNS } from '../../utils/music';

export type LyricUiEntry = {
  text: string;
  connectorToNext?: LyricConnector;
};

export type LyricHoldSpan = {
  startT16: number;
  endT16: number;
  endAtAnchor: boolean;
};

/**
 * Parse one lyric draft into clean text + optional connector metadata.
 *
 * Editing convenience:
 * - trailing '-' means "split syllable to next node"
 * - trailing '_' means "hold syllable to next node"
 */
export function parseLyricDraft(
  rawText: string,
  connectorHint?: LyricConnector
): LyricUiEntry {
  let text = String(rawText ?? '').trim();
  let connector = connectorHint;

  if (!connector) {
    if (/_+$/.test(text)) {
      connector = 'hold';
      text = text.replace(/_+$/, '').trimEnd();
    } else if (/-+$/.test(text)) {
      connector = 'dash';
      text = text.replace(/-+$/, '').trimEnd();
    }
  }

  return {
    text,
    ...(connector ? { connectorToNext: connector } : {}),
  };
}

/**
 * Convert one stored lyric entry into the editing draft string.
 * We show connector markers while editing so users can remove them by backspace.
 */
export function formatLyricDraft(entry: LyricUiEntry | undefined): string {
  if (!entry) return '';
  if (entry.connectorToNext === 'dash') return `${entry.text}-`;
  if (entry.connectorToNext === 'hold') return `${entry.text}_`;
  return entry.text;
}

/**
 * Keep canonical local lyric times (0..loopLength) visually locked to whatever
 * world-time loop copy is currently nearest to the camera.
 *
 * This makes lyric chips/labels scroll exactly with smart/follow/static camera
 * behavior even when world time has advanced beyond the first loop copy.
 */
export function localT16ToNearestWorldT(localT16: number, loopLengthT: number, referenceWorldT: number): number {
  if (loopLengthT <= 0) return localT16;

  const approxK = Math.floor(referenceWorldT / loopLengthT);
  let bestWorldT = localT16 + Math.max(0, approxK) * loopLengthT;
  let bestDistance = Math.abs(bestWorldT - referenceWorldT);

  for (let k = Math.max(0, approxK - 1); k <= approxK + 1; k++) {
    if (k < 0) continue;
    const candidateWorldT = localT16 + k * loopLengthT;
    const candidateDistance = Math.abs(candidateWorldT - referenceWorldT);
    if (candidateDistance < bestDistance) {
      bestWorldT = candidateWorldT;
      bestDistance = candidateDistance;
    }
  }

  return bestWorldT;
}

/**
 * True when an anchor (term node) lies between two melody nodes.
 *
 * We treat anchor time as a hard lyric-hold break.
 */
export function hasAnchorBetween(anchorTimes: number[], fromT16: number, toT16: number): boolean {
  return anchorTimes.some((anchorT16) => anchorT16 > fromT16 && anchorT16 <= toT16);
}

/**
 * Build anchor-aware hold spans from lyric connector metadata.
 *
 * Hold behavior rules:
 * - A hold on node N always includes the FULL duration of node N+1.
 * - Additional hold markers on following nodes continue the same line.
 * - Anchor points always stop the hold line.
 */
export function buildLyricHoldSpans(
  melodyNodeTimes: number[],
  anchorTimes: number[],
  lyricByT16: Map<number, LyricUiEntry>,
  loopLengthT: number
): LyricHoldSpan[] {
  const spans: LyricHoldSpan[] = [];
  if (melodyNodeTimes.length < 2 || loopLengthT <= 0) return spans;

  const boundaryAfterNode = (nodeIndex: number): { boundaryT16: number; endsAtAnchor: boolean } => {
    const nodeT16 = melodyNodeTimes[nodeIndex];
    const nextMelodyT16 = nodeIndex < melodyNodeTimes.length - 1
      ? melodyNodeTimes[nodeIndex + 1]
      : loopLengthT;

    let boundary = nextMelodyT16;
    let endsAtAnchor = false;
    for (const anchorT16 of anchorTimes) {
      if (anchorT16 > nodeT16 && anchorT16 < boundary) {
        boundary = anchorT16;
        endsAtAnchor = true;
        break;
      }
    }
    return { boundaryT16: boundary, endsAtAnchor };
  };

  for (let i = 0; i < melodyNodeTimes.length - 1; i++) {
    const startT16 = melodyNodeTimes[i];
    const entry = lyricByT16.get(startT16);
    if (entry?.connectorToNext !== 'hold') continue;

    // Do not start a duplicate span in the middle of an already-continuing hold.
    if (i > 0) {
      const prevT16 = melodyNodeTimes[i - 1];
      const prevEntry = lyricByT16.get(prevT16);
      if (prevEntry?.connectorToNext === 'hold' && !hasAnchorBetween(anchorTimes, prevT16, startT16)) {
        continue;
      }
    }

    // Base rule: include the full duration of the following melody node.
    const firstBoundary = boundaryAfterNode(i + 1);
    let endT16 = firstBoundary.boundaryT16;
    let endAtAnchor = firstBoundary.endsAtAnchor;

    // Continue extending while subsequent nodes explicitly request hold continuation.
    let cursor = i + 1;
    while (cursor < melodyNodeTimes.length - 1) {
      const cursorEntry = lyricByT16.get(melodyNodeTimes[cursor]);
      if (cursorEntry?.connectorToNext !== 'hold') break;

      const candidateBoundary = boundaryAfterNode(cursor + 1);
      const candidateEndT16 = candidateBoundary.boundaryT16;
      if (candidateEndT16 <= endT16) break;

      endT16 = candidateEndT16;
      endAtAnchor = candidateBoundary.endsAtAnchor;
      cursor += 1;
    }

    if (endT16 > startT16) {
      spans.push({ startT16, endT16, endAtAnchor });
    }
  }

  return spans;
}

/**
 * Get CSS variable value from the document.
 */
export function getCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Lighten a CSS color toward white.
 *
 * This is used for the playback "flash" effect on contour nodes.
 * Supported inputs:
 * - "#rrggbb"
 * - "rgb(r,g,b)"
 * - "rgba(r,g,b,a)"
 */
export function lightenCssColorTowardWhite(color: string, amount01: number): string {
  const amount = Math.max(0, Math.min(1, amount01));

  // #rrggbb
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const lr = Math.round(r + (255 - r) * amount);
      const lg = Math.round(g + (255 - g) * amount);
      const lb = Math.round(b + (255 - b) * amount);
      return `rgb(${lr}, ${lg}, ${lb})`;
    }
    return color;
  }

  // rgb(...) / rgba(...)
  const m = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)$/i);
  if (m) {
    const r = Math.max(0, Math.min(255, parseInt(m[1], 10)));
    const g = Math.max(0, Math.min(255, parseInt(m[2], 10)));
    const b = Math.max(0, Math.min(255, parseInt(m[3], 10)));
    const a = m[4] !== undefined ? Math.max(0, Math.min(1, parseFloat(m[4]))) : null;
    const lr = Math.round(r + (255 - r) * amount);
    const lg = Math.round(g + (255 - g) * amount);
    const lb = Math.round(b + (255 - b) * amount);
    return a === null ? `rgb(${lr}, ${lg}, ${lb})` : `rgba(${lr}, ${lg}, ${lb}, ${a})`;
  }

  // Fallback (named colors, hsl, etc.)
  return color;
}

/**
 * Extract the root note (letter + accidental) from a chord name.
 */
function parseChordRoot(chordName: string): string | null {
  const match = chordName.match(/^([A-Ga-g][#b]?)/);
  if (!match) return null;
  const root = match[1];
  return root.charAt(0).toUpperCase() + (root.charAt(1) || '').replace('b', 'b').replace('#', '#');
}

/**
 * Convert a bare note name to a semitone index (0-11).
 */
function getNoteSemitone(noteName: string): number | null {
  const midi = noteNameToMidi(`${noteName}4`);
  if (midi === null) return null;
  return ((midi % 12) + 12) % 12;
}

/**
 * Determine whether a chord belongs to the current scale/tonic.
 */
export function isChordDiatonic(chord: Chord, arrangement: Arrangement): boolean {
  if (!arrangement?.tonic) return true;

  // Prefer explicit scale-degree roots when available
  if (typeof chord.root === 'number') {
    return chord.root >= 1 && chord.root <= 7;
  }

  const rootNote = parseChordRoot(chord.name);
  const tonicNote = arrangement.tonic;
  if (!rootNote || !tonicNote) return true;

  const chordSemitone = getNoteSemitone(rootNote);
  const tonicSemitone = getNoteSemitone(tonicNote);
  if (chordSemitone === null || tonicSemitone === null) return true;

  const interval = ((chordSemitone - tonicSemitone) % 12 + 12) % 12;
  const scalePattern = SCALE_PATTERNS[arrangement.scale] || SCALE_PATTERNS['major'];
  return scalePattern.includes(interval);
}

/**
 * Convert a semitone offset to a Y position on the grid.
 * Higher pitches = lower Y values (top of canvas)
 * @param semitone - Semitones above base tonic (can be negative)
 * @param minSemitone - Minimum semitone shown on grid
 * @param maxSemitone - Maximum semitone shown on grid
 */
export function semitoneToY(
  semitone: number,
  minSemitone: number,
  maxSemitone: number,
  gridTop: number,
  gridHeight: number
): number {
  const range = maxSemitone - minSemitone;
  if (range === 0) return gridTop + gridHeight / 2;

  // Normalize to 0-1 (inverted so higher pitch = lower Y)
  const normalized = (semitone - minSemitone) / range;

  // Map to grid area
  return gridTop + gridHeight * (1 - normalized);
}

/**
 * Convert a scale degree + octave to Y position using semitones.
 * This bridges the old node format to the new semitone grid.
 */
export function degreeToY(
  degree: number,
  octaveOffset: number,
  minSemitone: number,
  maxSemitone: number,
  gridTop: number,
  gridHeight: number,
  scaleType: string
): number {
  // Convert degree to semitone offset from tonic
  const semitone = degreeToSemitoneOffset(degree, octaveOffset, scaleType);
  return semitoneToY(semitone, minSemitone, maxSemitone, gridTop, gridHeight);
}
