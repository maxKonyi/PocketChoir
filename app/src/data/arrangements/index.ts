/* ============================================================
   SAMPLE ARRANGEMENTS
   
   A collection of sample arrangements for testing and demo.
   These are simple multi-voice harmonies to sing along with.
   ============================================================ */

import type { Arrangement } from '../../types';

/**
 * Simple two-voice warmup - parallel thirds.
 * Good for beginners to practice basic harmony.
 */
export const twoPartWarmup: Arrangement = {
  id: 'arr_001',
  title: 'Two-Part Warmup',
  description: 'Simple parallel thirds - great for beginners',
  tempo: 80,
  timeSig: { numerator: 4, denominator: 4 },
  bars: 4,
  tonic: 'C',
  scale: 'major',
  difficulty: 1,
  tags: ['beginner', 'warmup'],
  voices: [
    {
      id: 'v1',
      name: 'Voice 1 (High)',
      color: '#ff6b9d',
      nodes: [
        { t16: 0, deg: 5 },    // G - bar 1
        { t16: 8, deg: 6 },    // A
        { t16: 16, deg: 7 },   // B - bar 2
        { t16: 24, deg: 8 },   // C (octave)
        { t16: 32, deg: 7 },   // B - bar 3
        { t16: 40, deg: 6 },   // A
        { t16: 48, deg: 5 },   // G - bar 4
        { t16: 56, deg: 5, term: true }, // Hold and end
      ],
    },
    {
      id: 'v2',
      name: 'Voice 2 (Low)',
      color: '#4ecdc4',
      nodes: [
        { t16: 0, deg: 3 },    // E - bar 1
        { t16: 8, deg: 4 },    // F
        { t16: 16, deg: 5 },   // G - bar 2
        { t16: 24, deg: 6 },   // A
        { t16: 32, deg: 5 },   // G - bar 3
        { t16: 40, deg: 4 },   // F
        { t16: 48, deg: 3 },   // E - bar 4
        { t16: 56, deg: 3, term: true }, // Hold and end
      ],
    },
  ],
  chords: [
    { t16: 0, duration16: 16, name: 'C' },
    { t16: 16, duration16: 16, name: 'G' },
    { t16: 32, duration16: 16, name: 'Am' },
    { t16: 48, duration16: 16, name: 'C' },
  ],
};

/**
 * Three-voice chord progression.
 * Introduces basic triadic harmony.
 */
export const threePartChords: Arrangement = {
  id: 'arr_002',
  title: 'Three-Part Chords',
  description: 'Simple chord progression with three voices',
  tempo: 72,
  timeSig: { numerator: 4, denominator: 4 },
  bars: 4,
  tonic: 'G',
  scale: 'major',
  difficulty: 2,
  tags: ['beginner', 'chords'],
  voices: [
    {
      id: 'v1',
      name: 'Soprano',
      color: '#ff6b9d',
      nodes: [
        { t16: 0, deg: 5 },    // D
        { t16: 16, deg: 4 },   // C
        { t16: 32, deg: 3 },   // B
        { t16: 48, deg: 5 },   // D
        { t16: 60, deg: 5, term: true },
      ],
    },
    {
      id: 'v2',
      name: 'Alto',
      color: '#4ecdc4',
      nodes: [
        { t16: 0, deg: 3 },    // B
        { t16: 16, deg: 1 },   // G
        { t16: 32, deg: 1 },   // G
        { t16: 48, deg: 3 },   // B
        { t16: 60, deg: 3, term: true },
      ],
    },
    {
      id: 'v3',
      name: 'Tenor',
      color: '#ffe66d',
      nodes: [
        { t16: 0, deg: 1 },    // G
        { t16: 16, deg: 5, octave: -1 },   // D (below)
        { t16: 32, deg: 5, octave: -1 },   // D
        { t16: 48, deg: 1 },   // G
        { t16: 60, deg: 1, term: true },
      ],
    },
  ],
  chords: [
    { t16: 0, duration16: 16, name: 'G' },
    { t16: 16, duration16: 16, name: 'C' },
    { t16: 32, duration16: 16, name: 'Em' },
    { t16: 48, duration16: 16, name: 'G' },
  ],
};

/**
 * Four-part jazz voicings.
 * More complex harmony for intermediate users.
 */
export const fourPartJazz: Arrangement = {
  id: 'arr_003',
  title: 'Jazz Voicings',
  description: 'Four-part jazz chord progression with 7th chords',
  tempo: 96,
  timeSig: { numerator: 4, denominator: 4 },
  bars: 4,
  tonic: 'F',
  scale: 'major',
  difficulty: 3,
  tags: ['intermediate', 'jazz'],
  voices: [
    {
      id: 'v1',
      name: 'Voice 1',
      color: '#ff6b9d',
      nodes: [
        { t16: 0, deg: 7 },     // E (maj7)
        { t16: 16, deg: 2, octave: 1 },   // G (9th of F)
        { t16: 32, deg: 6 },    // D
        { t16: 48, deg: 5 },    // C
        { t16: 60, deg: 5, term: true },
      ],
    },
    {
      id: 'v2',
      name: 'Voice 2',
      color: '#4ecdc4',
      nodes: [
        { t16: 0, deg: 5 },     // C
        { t16: 16, deg: 5 },    // C
        { t16: 32, deg: 4 },    // Bb
        { t16: 48, deg: 3 },    // A
        { t16: 60, deg: 3, term: true },
      ],
    },
    {
      id: 'v3',
      name: 'Voice 3',
      color: '#ffe66d',
      nodes: [
        { t16: 0, deg: 3 },     // A
        { t16: 16, deg: 3 },    // A
        { t16: 32, deg: 2 },    // G
        { t16: 48, deg: 1 },    // F
        { t16: 60, deg: 1, term: true },
      ],
    },
    {
      id: 'v4',
      name: 'Voice 4',
      color: '#ff8c42',
      nodes: [
        { t16: 0, deg: 1 },     // F
        { t16: 16, deg: 7, octave: -1 },   // E
        { t16: 32, deg: 6, octave: -1 },   // D
        { t16: 48, deg: 5, octave: -1 },   // C
        { t16: 60, deg: 5, octave: -1, term: true },
      ],
    },
  ],
  chords: [
    { t16: 0, duration16: 16, name: 'Fmaj7' },
    { t16: 16, duration16: 16, name: 'Fmaj9' },
    { t16: 32, duration16: 16, name: 'Gm7' },
    { t16: 48, duration16: 16, name: 'C7' },
  ],
};

/**
 * Moving melody with harmony.
 * Features more melodic movement.
 */
export const movingMelody: Arrangement = {
  id: 'arr_004',
  title: 'Moving Melody',
  description: 'Melodic line with supporting harmony',
  tempo: 88,
  timeSig: { numerator: 4, denominator: 4 },
  bars: 4,
  tonic: 'D',
  scale: 'major',
  difficulty: 2,
  tags: ['beginner', 'melody'],
  voices: [
    {
      id: 'v1',
      name: 'Melody',
      color: '#ff6b9d',
      nodes: [
        { t16: 0, deg: 1 },
        { t16: 4, deg: 2 },
        { t16: 8, deg: 3 },
        { t16: 12, deg: 4 },
        { t16: 16, deg: 5 },
        { t16: 20, deg: 4 },
        { t16: 24, deg: 3 },
        { t16: 28, deg: 2 },
        { t16: 32, deg: 1 },
        { t16: 36, deg: 3 },
        { t16: 40, deg: 5 },
        { t16: 48, deg: 3 },
        { t16: 56, deg: 1, term: true },
      ],
    },
    {
      id: 'v2',
      name: 'Harmony',
      color: '#4ecdc4',
      nodes: [
        { t16: 0, deg: 5, octave: -1 },
        { t16: 16, deg: 1 },
        { t16: 32, deg: 5, octave: -1 },
        { t16: 48, deg: 1 },
        { t16: 56, deg: 5, octave: -1, term: true },
      ],
    },
  ],
  chords: [
    { t16: 0, duration16: 16, name: 'D' },
    { t16: 16, duration16: 16, name: 'A' },
    { t16: 32, duration16: 16, name: 'Bm' },
    { t16: 48, duration16: 16, name: 'D' },
  ],
};

/**
 * All sample arrangements exported as an array.
 */
export const sampleArrangements: Arrangement[] = [
  twoPartWarmup,
  threePartChords,
  fourPartJazz,
  movingMelody,
];

/**
 * Get an arrangement by ID.
 */
export function getArrangementById(id: string): Arrangement | undefined {
  return sampleArrangements.find((arr) => arr.id === id);
}

export default sampleArrangements;
