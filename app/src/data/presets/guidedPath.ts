/* ============================================================
  GUIDED PATH PRESETS

  Curated learning journey for harmony singers.
  The progression follows common teaching order used in choir training:
  - start with unison and simple intervals,
  - then add rhythmic and melodic independence,
  - then build to triads, SATB writing, and jazz extensions.

  Every arrangement includes a chord track.
  Lyrics are intentionally omitted in this stock set.
  ============================================================ */

import type { Arrangement } from '../../types';
import type { GuidedStage } from '../../types/library';

/* ============================================================
   STAGE 1 — FIRST STEPS (2 Voices)
   Unison, thirds, echo entries, and contrary motion.
   ============================================================ */

const stage1Arrangements: Arrangement[] = [
  {
    id: 'gp_1_1',
    title: 'Unison Compass',
    description: 'Both voices sing one shared melody to lock pitch center and timing.',
    tempo: 74,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'C',
    scale: 'major',
    difficulty: 1,
    tags: ['beginner', 'unison', 'intonation'],
    voices: [
      {
        id: 'v1', name: 'Leader', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 8, deg: 2 }, { t16: 16, deg: 3 },
          { t16: 24, deg: 4 }, { t16: 32, deg: 5 }, { t16: 40, deg: 4 },
          { t16: 48, deg: 3 }, { t16: 56, deg: 2 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v2', name: 'Partner', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 8, deg: 2 }, { t16: 16, deg: 3 },
          { t16: 24, deg: 4 }, { t16: 32, deg: 5 }, { t16: 40, deg: 4 },
          { t16: 48, deg: 3 }, { t16: 56, deg: 2 }, { t16: 60, deg: 1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'C' },
      { t16: 16, duration16: 16, name: 'F' },
      { t16: 32, duration16: 16, name: 'G' },
      { t16: 48, duration16: 16, name: 'C' },
    ],
  },
  {
    id: 'gp_1_2',
    title: 'Thirds in Motion',
    description: 'Parallel thirds train blend while keeping each line singable.',
    tempo: 80,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'G',
    scale: 'major',
    difficulty: 1,
    tags: ['beginner', 'thirds', 'blend'],
    voices: [
      {
        id: 'v1', name: 'Upper Voice', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 8, deg: 4 }, { t16: 16, deg: 5 },
          { t16: 24, deg: 6 }, { t16: 32, deg: 5 }, { t16: 40, deg: 4 },
          { t16: 48, deg: 3 }, { t16: 56, deg: 2 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v2', name: 'Lower Voice', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 8, deg: 2 }, { t16: 16, deg: 3 },
          { t16: 24, deg: 4 }, { t16: 32, deg: 3 }, { t16: 40, deg: 2 },
          { t16: 48, deg: 1 }, { t16: 56, deg: 7, octave: -1 }, { t16: 60, deg: 1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'G' },
      { t16: 16, duration16: 16, name: 'C' },
      { t16: 32, duration16: 16, name: 'D' },
      { t16: 48, duration16: 16, name: 'G' },
    ],
  },
  {
    id: 'gp_1_3',
    title: 'Echo Entries',
    description: 'Voice 2 answers one bar later to practice clear listening and entrances.',
    tempo: 84,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'D',
    scale: 'major',
    difficulty: 1,
    tags: ['beginner', 'call-response', 'timing'],
    voices: [
      {
        id: 'v1', name: 'Caller', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 4, deg: 2 }, { t16: 8, deg: 3 }, { t16: 12, deg: 5, term: true },
          { t16: 32, deg: 5 }, { t16: 36, deg: 4 }, { t16: 40, deg: 3 }, { t16: 44, deg: 2, term: true },
        ],
      },
      {
        id: 'v2', name: 'Echo', color: '#4ecdc4',
        nodes: [
          { t16: 16, deg: 1 }, { t16: 20, deg: 2 }, { t16: 24, deg: 3 }, { t16: 28, deg: 5, term: true },
          { t16: 48, deg: 5 }, { t16: 52, deg: 4 }, { t16: 56, deg: 3 }, { t16: 60, deg: 2, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'D' },
      { t16: 16, duration16: 16, name: 'A' },
      { t16: 32, duration16: 16, name: 'G' },
      { t16: 48, duration16: 16, name: 'D' },
    ],
  },
  {
    id: 'gp_1_4',
    title: 'Contrary Arches',
    description: 'Opposite-direction lines train independence while staying simple.',
    tempo: 72,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'F',
    scale: 'major',
    difficulty: 2,
    tags: ['beginner', 'contrary-motion', 'independence'],
    voices: [
      {
        id: 'v1', name: 'Rising Voice', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 16, deg: 2 }, { t16: 32, deg: 3 },
          { t16: 48, deg: 5 }, { t16: 60, deg: 5, term: true },
        ],
      },
      {
        id: 'v2', name: 'Falling Voice', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 16, deg: 4 }, { t16: 32, deg: 3 },
          { t16: 48, deg: 2 }, { t16: 60, deg: 1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'F' },
      { t16: 16, duration16: 16, name: 'Bb' },
      { t16: 32, duration16: 16, name: 'C' },
      { t16: 48, duration16: 16, name: 'F' },
    ],
  },
];

/* ============================================================
   STAGE 2 — FINDING YOUR PART (2 Voices, More Movement)
   Independent melodies, sustained vs. moving lines.
   ============================================================ */

const stage2Arrangements: Arrangement[] = [
  {
    id: 'gp_2_1',
    title: 'Pedal and Melody',
    description: 'One voice holds long tones while the other sings a moving phrase.',
    tempo: 86,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'C',
    scale: 'major',
    difficulty: 2,
    tags: ['beginner', 'pedal-tone', 'independence'],
    voices: [
      {
        id: 'v1', name: 'Melody', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 4, deg: 2 }, { t16: 8, deg: 3 }, { t16: 12, deg: 5 },
          { t16: 16, deg: 6 }, { t16: 20, deg: 5 }, { t16: 24, deg: 3 }, { t16: 28, deg: 2 },
          { t16: 32, deg: 4 }, { t16: 36, deg: 5 }, { t16: 40, deg: 6 }, { t16: 44, deg: 5 },
          { t16: 48, deg: 3 }, { t16: 52, deg: 2 }, { t16: 56, deg: 1 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v2', name: 'Pedal Voice', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 1, octave: -1 },
          { t16: 32, deg: 5, octave: -1 },
          { t16: 60, deg: 1, octave: -1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'C' },
      { t16: 16, duration16: 16, name: 'Am' },
      { t16: 32, duration16: 16, name: 'F' },
      { t16: 48, duration16: 16, name: 'G' },
    ],
  },
  {
    id: 'gp_2_2',
    title: 'Suspension Practice',
    description: 'Held tones create tension before stepwise resolution.',
    tempo: 72,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'G',
    scale: 'major',
    difficulty: 2,
    tags: ['intermediate', 'suspension', 'resolution'],
    voices: [
      {
        id: 'v1', name: 'Upper Line', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 8, deg: 5 },
          { t16: 16, deg: 4 }, { t16: 24, deg: 4 },
          { t16: 32, deg: 3 }, { t16: 40, deg: 2 },
          { t16: 48, deg: 2 }, { t16: 56, deg: 2 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v2', name: 'Resolving Line', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 8, deg: 2 },
          { t16: 16, deg: 1 }, { t16: 24, deg: 7, octave: -1 },
          { t16: 32, deg: 1 }, { t16: 40, deg: 2 },
          { t16: 48, deg: 3 }, { t16: 56, deg: 2 }, { t16: 60, deg: 1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'G' },
      { t16: 16, duration16: 16, name: 'D' },
      { t16: 32, duration16: 16, name: 'C' },
      { t16: 48, duration16: 16, name: 'G' },
    ],
  },
  {
    id: 'gp_2_3',
    title: 'Waltz Weave',
    description: 'Two independent lines in 3/4 to build steady triple-meter phrasing.',
    tempo: 96,
    timeSig: { numerator: 3, denominator: 4 },
    bars: 4,
    tonic: 'A',
    scale: 'minor',
    difficulty: 2,
    tags: ['beginner', 'waltz', '3/4', 'minor'],
    voices: [
      {
        id: 'v1', name: 'Upper Waltz Line', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 6, deg: 6 },
          { t16: 12, deg: 5 }, { t16: 18, deg: 4 },
          { t16: 24, deg: 3 }, { t16: 30, deg: 4 },
          { t16: 36, deg: 5 }, { t16: 42, deg: 6 }, { t16: 46, deg: 5, term: true },
        ],
      },
      {
        id: 'v2', name: 'Lower Waltz Line', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 6, deg: 2 },
          { t16: 12, deg: 1 }, { t16: 18, deg: 2 },
          { t16: 24, deg: 3 }, { t16: 30, deg: 2 },
          { t16: 36, deg: 1 }, { t16: 42, deg: 7, octave: -1 }, { t16: 46, deg: 1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 12, name: 'Am' },
      { t16: 12, duration16: 12, name: 'Dm' },
      { t16: 24, duration16: 12, name: 'G' },
      { t16: 36, duration16: 12, name: 'Am' },
    ],
  },
];

/* ============================================================
   STAGE 3 — THREE-PART HARMONY (3 Voices)
   Introduction to triads and fuller sound.
   ============================================================ */

const stage3Arrangements: Arrangement[] = [
  {
    id: 'gp_3_1',
    title: 'Triad Flow',
    description: 'Three voices move through core chords with clear, smooth spacing.',
    tempo: 72,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'C',
    scale: 'major',
    difficulty: 2,
    tags: ['intermediate', 'triads', 'voice-leading'],
    voices: [
      {
        id: 'v1', name: 'Soprano', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 16, deg: 6 }, { t16: 32, deg: 6 },
          { t16: 48, deg: 5 }, { t16: 56, deg: 5 }, { t16: 60, deg: 5, term: true },
        ],
      },
      {
        id: 'v2', name: 'Alto', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 16, deg: 3 }, { t16: 32, deg: 4 },
          { t16: 48, deg: 2 }, { t16: 56, deg: 3 }, { t16: 60, deg: 3, term: true },
        ],
      },
      {
        id: 'v3', name: 'Bass', color: '#ffe66d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 16, deg: 6, octave: -1 }, { t16: 32, deg: 4, octave: -1 },
          { t16: 48, deg: 5, octave: -1 }, { t16: 56, deg: 1, octave: -1 }, { t16: 60, deg: 1, octave: -1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'C' },
      { t16: 16, duration16: 16, name: 'Am' },
      { t16: 32, duration16: 16, name: 'F' },
      { t16: 48, duration16: 8, name: 'G' },
      { t16: 56, duration16: 8, name: 'C' },
    ],
  },
  {
    id: 'gp_3_2',
    title: 'Round Entries',
    description: 'A staggered three-part round for overlap listening and steady tempo.',
    tempo: 92,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'C',
    scale: 'major',
    difficulty: 2,
    tags: ['intermediate', 'canon', 'listening'],
    voices: [
      {
        id: 'v1', name: 'Voice 1', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 4, deg: 2 }, { t16: 8, deg: 3 }, { t16: 12, deg: 2 },
          { t16: 16, deg: 1 }, { t16: 24, deg: 3 }, { t16: 32, deg: 5 }, { t16: 48, deg: 3 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v2', name: 'Voice 2', color: '#4ecdc4',
        nodes: [
          { t16: 16, deg: 1 }, { t16: 20, deg: 2 }, { t16: 24, deg: 3 }, { t16: 28, deg: 2 },
          { t16: 32, deg: 1 }, { t16: 40, deg: 3 }, { t16: 48, deg: 5 }, { t16: 56, deg: 3 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v3', name: 'Voice 3', color: '#ffe66d',
        nodes: [
          { t16: 32, deg: 1 }, { t16: 36, deg: 2 }, { t16: 40, deg: 3 }, { t16: 44, deg: 2 },
          { t16: 48, deg: 1 }, { t16: 52, deg: 3 }, { t16: 56, deg: 5 }, { t16: 60, deg: 1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'C' },
      { t16: 16, duration16: 16, name: 'F' },
      { t16: 32, duration16: 16, name: 'G' },
      { t16: 48, duration16: 16, name: 'C' },
    ],
  },
  {
    id: 'gp_3_3',
    title: 'Cadence Workshop',
    description: 'Three voices shape clear pre-cadence tension and release.',
    tempo: 68,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'F',
    scale: 'major',
    difficulty: 3,
    tags: ['intermediate', 'cadence', 'chorale'],
    voices: [
      {
        id: 'v1', name: 'Soprano', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 8, deg: 6 }, { t16: 16, deg: 5 }, { t16: 24, deg: 4 },
          { t16: 32, deg: 3 }, { t16: 40, deg: 2 }, { t16: 48, deg: 2 }, { t16: 56, deg: 1 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v2', name: 'Alto', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 8, deg: 4 }, { t16: 16, deg: 3 }, { t16: 24, deg: 2 },
          { t16: 32, deg: 1 }, { t16: 40, deg: 7, octave: -1 }, { t16: 48, deg: 1 }, { t16: 56, deg: 1 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v3', name: 'Bass', color: '#ffe66d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 16, deg: 4, octave: -1 }, { t16: 32, deg: 5, octave: -1 },
          { t16: 48, deg: 1, octave: -1 }, { t16: 60, deg: 1, octave: -1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'F' },
      { t16: 16, duration16: 16, name: 'Bb' },
      { t16: 32, duration16: 16, name: 'C' },
      { t16: 48, duration16: 16, name: 'F' },
    ],
  },
];

/* ============================================================
   STAGE 4 — FOUR-PART HARMONY (4 Voices)
   Full SATB voicing and richer progressions.
   ============================================================ */

const stage4Arrangements: Arrangement[] = [
  {
    id: 'gp_4_1',
    title: 'SATB Cadence Lab',
    description: 'Classic four-part writing with clean predominant and dominant motion.',
    tempo: 68,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'C',
    scale: 'major',
    difficulty: 3,
    tags: ['intermediate', 'satb', 'cadence'],
    voices: [
      {
        id: 'v1', name: 'Soprano', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 16, deg: 5 }, { t16: 32, deg: 6 },
          { t16: 48, deg: 5 }, { t16: 56, deg: 5 }, { t16: 60, deg: 5, term: true },
        ],
      },
      {
        id: 'v2', name: 'Alto', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 16, deg: 4 }, { t16: 32, deg: 4 },
          { t16: 48, deg: 2 }, { t16: 56, deg: 3 }, { t16: 60, deg: 3, term: true },
        ],
      },
      {
        id: 'v3', name: 'Tenor', color: '#ffe66d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 16, deg: 1 }, { t16: 32, deg: 2 },
          { t16: 48, deg: 7, octave: -1 }, { t16: 56, deg: 1 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v4', name: 'Bass', color: '#ff8c42',
        nodes: [
          { t16: 0, deg: 1, octave: -1 }, { t16: 16, deg: 4, octave: -1 }, { t16: 32, deg: 2, octave: -1 },
          { t16: 48, deg: 5, octave: -1 }, { t16: 56, deg: 1, octave: -1 }, { t16: 60, deg: 1, octave: -1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'C' },
      { t16: 16, duration16: 16, name: 'F' },
      { t16: 32, duration16: 16, name: 'Dm' },
      { t16: 48, duration16: 8, name: 'G' },
      { t16: 56, duration16: 8, name: 'C' },
    ],
  },
  {
    id: 'gp_4_2',
    title: 'Circle Motion',
    description: 'Four parts follow a circle-style progression with smooth inner voices.',
    tempo: 84,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'G',
    scale: 'major',
    difficulty: 3,
    tags: ['intermediate', 'satb', 'circle-of-fifths'],
    voices: [
      {
        id: 'v1', name: 'Soprano', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 16, deg: 5 }, { t16: 32, deg: 6 },
          { t16: 48, deg: 5 }, { t16: 56, deg: 4 }, { t16: 60, deg: 3, term: true },
        ],
      },
      {
        id: 'v2', name: 'Alto', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 16, deg: 3 }, { t16: 32, deg: 4 },
          { t16: 48, deg: 2 }, { t16: 56, deg: 2 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v3', name: 'Tenor', color: '#ffe66d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 16, deg: 7, octave: -1 }, { t16: 32, deg: 1 },
          { t16: 48, deg: 7, octave: -1 }, { t16: 56, deg: 7, octave: -1 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v4', name: 'Bass', color: '#ff8c42',
        nodes: [
          { t16: 0, deg: 1, octave: -1 }, { t16: 16, deg: 6, octave: -1 }, { t16: 32, deg: 2, octave: -1 },
          { t16: 48, deg: 5, octave: -1 }, { t16: 56, deg: 1, octave: -1 }, { t16: 60, deg: 1, octave: -1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'G' },
      { t16: 16, duration16: 16, name: 'Em' },
      { t16: 32, duration16: 16, name: 'Am' },
      { t16: 48, duration16: 8, name: 'D' },
      { t16: 56, duration16: 8, name: 'G' },
    ],
  },
  {
    id: 'gp_4_3',
    title: 'Minor Chorale',
    description: 'A four-part minor setting with careful spacing and gentle voice motion.',
    tempo: 74,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'A',
    scale: 'minor',
    difficulty: 3,
    tags: ['intermediate', 'minor', 'chorale'],
    voices: [
      {
        id: 'v1', name: 'Soprano', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 16, deg: 6 }, { t16: 32, deg: 4 },
          { t16: 48, deg: 5 }, { t16: 56, deg: 2 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v2', name: 'Alto', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 16, deg: 1 }, { t16: 32, deg: 6 },
          { t16: 48, deg: 7 }, { t16: 56, deg: 7 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v3', name: 'Tenor', color: '#ffe66d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 16, deg: 3 }, { t16: 32, deg: 4 },
          { t16: 48, deg: 5 }, { t16: 56, deg: 5 }, { t16: 60, deg: 3, term: true },
        ],
      },
      {
        id: 'v4', name: 'Bass', color: '#ff8c42',
        nodes: [
          { t16: 0, deg: 1, octave: -1 }, { t16: 16, deg: 6, octave: -1 }, { t16: 32, deg: 4, octave: -1 },
          { t16: 48, deg: 5, octave: -1 }, { t16: 56, deg: 1, octave: -1 }, { t16: 60, deg: 1, octave: -1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'Am' },
      { t16: 16, duration16: 16, name: 'F' },
      { t16: 32, duration16: 16, name: 'Dm' },
      { t16: 48, duration16: 8, name: 'Em' },
      { t16: 56, duration16: 8, name: 'Am' },
    ],
  },
];

/* ============================================================
   STAGE 5 — FIVE VOICES & EXTENDED HARMONY
   Adding a fifth voice and richer chord extensions.
   ============================================================ */

const stage5Arrangements: Arrangement[] = [
  {
    id: 'gp_5_1',
    title: 'Five-Part Chorale',
    description: 'Expanded choir texture with stable spacing and gentle inner movement.',
    tempo: 66,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'Eb',
    scale: 'major',
    difficulty: 4,
    tags: ['advanced', 'five-part', 'chorale'],
    voices: [
      {
        id: 'v1', name: 'Soprano 1', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 16, deg: 6 }, { t16: 32, deg: 5 },
          { t16: 48, deg: 5 }, { t16: 56, deg: 5 }, { t16: 60, deg: 5, term: true },
        ],
      },
      {
        id: 'v2', name: 'Soprano 2', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 16, deg: 3 }, { t16: 32, deg: 4 },
          { t16: 48, deg: 2 }, { t16: 56, deg: 3 }, { t16: 60, deg: 3, term: true },
        ],
      },
      {
        id: 'v3', name: 'Alto', color: '#ffe66d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 16, deg: 1 }, { t16: 32, deg: 1 },
          { t16: 48, deg: 7, octave: -1 }, { t16: 56, deg: 1 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v4', name: 'Tenor', color: '#ff8c42',
        nodes: [
          { t16: 0, deg: 5, octave: -1 }, { t16: 16, deg: 5, octave: -1 }, { t16: 32, deg: 6, octave: -1 },
          { t16: 48, deg: 5, octave: -1 }, { t16: 56, deg: 5, octave: -1 }, { t16: 60, deg: 5, octave: -1, term: true },
        ],
      },
      {
        id: 'v5', name: 'Bass', color: '#a78bfa',
        nodes: [
          { t16: 0, deg: 1, octave: -1 }, { t16: 16, deg: 6, octave: -1 }, { t16: 32, deg: 4, octave: -1 },
          { t16: 48, deg: 5, octave: -1 }, { t16: 56, deg: 1, octave: -1 }, { t16: 60, deg: 1, octave: -1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'Eb' },
      { t16: 16, duration16: 16, name: 'Cm' },
      { t16: 32, duration16: 16, name: 'Ab' },
      { t16: 48, duration16: 8, name: 'Bb' },
      { t16: 56, duration16: 8, name: 'Eb' },
    ],
  },
  {
    id: 'gp_5_2',
    title: 'ii-V-I Workshop',
    description: 'Guide-tone focused jazz movement in five voices.',
    tempo: 102,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'C',
    scale: 'major',
    difficulty: 4,
    tags: ['advanced', 'jazz', 'ii-V-I', 'guide-tones'],
    voices: [
      {
        id: 'v1', name: 'Lead', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 6 }, { t16: 16, deg: 7 },
          { t16: 32, deg: 1, octave: 1 }, { t16: 48, deg: 7 }, { t16: 60, deg: 1, octave: 1, term: true },
        ],
      },
      {
        id: 'v2', name: 'Upper Harmony', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 4 }, { t16: 16, deg: 4 },
          { t16: 32, deg: 5 }, { t16: 48, deg: 5 }, { t16: 60, deg: 5, term: true },
        ],
      },
      {
        id: 'v3', name: 'Middle Harmony', color: '#ffe66d',
        nodes: [
          { t16: 0, deg: 2 }, { t16: 16, deg: 2 },
          { t16: 32, deg: 3 }, { t16: 48, deg: 3 }, { t16: 60, deg: 3, term: true },
        ],
      },
      {
        id: 'v4', name: 'Lower Harmony', color: '#ff8c42',
        nodes: [
          { t16: 0, deg: 7, octave: -1 }, { t16: 16, deg: 4 },
          { t16: 32, deg: 1 }, { t16: 48, deg: 1 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v5', name: 'Bass', color: '#a78bfa',
        nodes: [
          { t16: 0, deg: 2, octave: -1 }, { t16: 16, deg: 5, octave: -1 },
          { t16: 32, deg: 1, octave: -1 }, { t16: 48, deg: 1, octave: -1 }, { t16: 60, deg: 1, octave: -1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'Dm9' },
      { t16: 16, duration16: 16, name: 'G13' },
      { t16: 32, duration16: 32, name: 'Cmaj9' },
    ],
  },
];

/* ============================================================
   STAGE 6 — FULL ENSEMBLE (5-6 Voices, Jazz & Beyond)
   Complex voicings, chromaticism, extended harmony.
   ============================================================ */

const stage6Arrangements: Arrangement[] = [
  {
    id: 'gp_6_1',
    title: 'Jazz Ballad Spread',
    description: 'Six voices sustain a wide, lush jazz ballad texture.',
    tempo: 70,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'Bb',
    scale: 'major',
    difficulty: 5,
    tags: ['advanced', 'jazz', 'ballad', 'six-part'],
    voices: [
      {
        id: 'v1', name: 'Soprano 1', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 2, octave: 1 }, { t16: 16, deg: 1, octave: 1 }, { t16: 32, deg: 7 },
          { t16: 48, deg: 6 }, { t16: 56, deg: 5 }, { t16: 60, deg: 5, term: true },
        ],
      },
      {
        id: 'v2', name: 'Soprano 2', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 7 }, { t16: 16, deg: 6 }, { t16: 32, deg: 5 },
          { t16: 48, deg: 4 }, { t16: 56, deg: 3 }, { t16: 60, deg: 3, term: true },
        ],
      },
      {
        id: 'v3', name: 'Alto', color: '#ffe66d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 16, deg: 4 }, { t16: 32, deg: 3 },
          { t16: 48, deg: 2 }, { t16: 56, deg: 1 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v4', name: 'Tenor 1', color: '#ff8c42',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 16, deg: 2 }, { t16: 32, deg: 1 },
          { t16: 48, deg: 7, octave: -1 }, { t16: 56, deg: 1 }, { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v5', name: 'Tenor 2', color: '#a78bfa',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 16, deg: 7, octave: -1 }, { t16: 32, deg: 6, octave: -1 },
          { t16: 48, deg: 5, octave: -1 }, { t16: 56, deg: 3, octave: -1 }, { t16: 60, deg: 3, octave: -1, term: true },
        ],
      },
      {
        id: 'v6', name: 'Bass', color: '#34d399',
        nodes: [
          { t16: 0, deg: 1, octave: -1 }, { t16: 16, deg: 6, octave: -1 }, { t16: 32, deg: 2, octave: -1 },
          { t16: 48, deg: 5, octave: -1 }, { t16: 56, deg: 1, octave: -1 }, { t16: 60, deg: 1, octave: -1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'Bbmaj9' },
      { t16: 16, duration16: 16, name: 'Gm9' },
      { t16: 32, duration16: 16, name: 'Cm9' },
      { t16: 48, duration16: 8, name: 'F13' },
      { t16: 56, duration16: 8, name: 'Bb6/9' },
    ],
  },
  {
    id: 'gp_6_2',
    title: 'Chromatic Threads',
    description: 'Six lines move with coordinated chromatic passing tones.',
    tempo: 80,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'C',
    scale: 'chromatic',
    difficulty: 5,
    tags: ['advanced', 'chromatic', 'six-part', 'jazz'],
    voices: [
      {
        id: 'v1', name: 'Voice 1', color: '#ff6b9d',
        nodes: [
          { t16: 0, semi: 16 }, { t16: 8, semi: 17 }, { t16: 16, semi: 16 }, { t16: 24, semi: 15 },
          { t16: 32, semi: 14 }, { t16: 40, semi: 12 }, { t16: 48, semi: 11 }, { t16: 56, semi: 12 }, { t16: 60, semi: 12, term: true },
        ],
      },
      {
        id: 'v2', name: 'Voice 2', color: '#4ecdc4',
        nodes: [
          { t16: 0, semi: 12 }, { t16: 8, semi: 12 }, { t16: 16, semi: 11 }, { t16: 24, semi: 10 },
          { t16: 32, semi: 9 }, { t16: 40, semi: 9 }, { t16: 48, semi: 7 }, { t16: 56, semi: 7 }, { t16: 60, semi: 7, term: true },
        ],
      },
      {
        id: 'v3', name: 'Voice 3', color: '#ffe66d',
        nodes: [
          { t16: 0, semi: 9 }, { t16: 8, semi: 10 }, { t16: 16, semi: 9 }, { t16: 24, semi: 8 },
          { t16: 32, semi: 7 }, { t16: 40, semi: 5 }, { t16: 48, semi: 4 }, { t16: 56, semi: 4 }, { t16: 60, semi: 4, term: true },
        ],
      },
      {
        id: 'v4', name: 'Voice 4', color: '#ff8c42',
        nodes: [
          { t16: 0, semi: 7 }, { t16: 8, semi: 7 }, { t16: 16, semi: 6 }, { t16: 24, semi: 5 },
          { t16: 32, semi: 4 }, { t16: 40, semi: 4 }, { t16: 48, semi: 2 }, { t16: 56, semi: 2 }, { t16: 60, semi: 2, term: true },
        ],
      },
      {
        id: 'v5', name: 'Voice 5', color: '#a78bfa',
        nodes: [
          { t16: 0, semi: 4 }, { t16: 8, semi: 5 }, { t16: 16, semi: 4 }, { t16: 24, semi: 3 },
          { t16: 32, semi: 2 }, { t16: 40, semi: 1 }, { t16: 48, semi: 0 }, { t16: 56, semi: 0 }, { t16: 60, semi: 0, term: true },
        ],
      },
      {
        id: 'v6', name: 'Voice 6', color: '#34d399',
        nodes: [
          { t16: 0, semi: 0 }, { t16: 8, semi: 0 }, { t16: 16, semi: -1 }, { t16: 24, semi: -2 },
          { t16: 32, semi: -3 }, { t16: 40, semi: -3 }, { t16: 48, semi: -5 }, { t16: 56, semi: -5 }, { t16: 60, semi: -5, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'Cmaj9' },
      { t16: 16, duration16: 16, name: 'A7alt' },
      { t16: 32, duration16: 16, name: 'Dm9' },
      { t16: 48, duration16: 8, name: 'G7alt' },
      { t16: 56, duration16: 8, name: 'Cmaj9' },
    ],
  },
];

/* ============================================================
   EXPORT: All stages assembled into the guided path
   ============================================================ */

export const guidedPath: GuidedStage[] = [
  {
    id: 'stage_1',
    number: 1,
    title: 'First Steps',
    subtitle: 'Unisons, thirds, and simple intervals',
    voiceCount: 2,
    color: '#4ecdc4',
    icon: '🌱',
    arrangements: stage1Arrangements,
  },
  {
    id: 'stage_2',
    number: 2,
    title: 'Finding Your Part',
    subtitle: 'Independent melodies and held notes',
    voiceCount: 2,
    color: '#38bdf8',
    icon: '🎵',
    arrangements: stage2Arrangements,
  },
  {
    id: 'stage_3',
    number: 3,
    title: 'Three-Part Harmony',
    subtitle: 'Triads, rounds, and chorale style',
    voiceCount: 3,
    color: '#ffe66d',
    icon: '🎶',
    arrangements: stage3Arrangements,
  },
  {
    id: 'stage_4',
    number: 4,
    title: 'Four-Part Harmony',
    subtitle: 'SATB voicing and jazz introduction',
    voiceCount: 4,
    color: '#ff8c42',
    icon: '🎼',
    arrangements: stage4Arrangements,
  },
  {
    id: 'stage_5',
    number: 5,
    title: 'Extended Harmony',
    subtitle: 'Five voices and jazz progressions',
    voiceCount: 5,
    color: '#a78bfa',
    icon: '✨',
    arrangements: stage5Arrangements,
  },
  {
    id: 'stage_6',
    number: 6,
    title: 'Full Ensemble',
    subtitle: 'Six-voice jazz and chromatic writing',
    voiceCount: 6,
    color: '#ff6b9d',
    icon: '🏆',
    arrangements: stage6Arrangements,
  },
];
