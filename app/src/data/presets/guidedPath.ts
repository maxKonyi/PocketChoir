/* ============================================================
   GUIDED PATH PRESETS

   A structured learning journey from simple 2-voice intervals
   all the way up to complex 6-voice jazz harmonies.

   Each "stage" groups arrangements by voice count and complexity.
   The user works through them in order, building skills as they go.
   ============================================================ */

import type { Arrangement } from '../../types';
import type { GuidedStage } from '../../types/library';

/* ============================================================
   STAGE 1 — FIRST STEPS (2 Voices)
   Simple intervals: unisons, thirds, fifths.
   ============================================================ */

const stage1Arrangements: Arrangement[] = [
  {
    id: 'gp_1_1',
    title: 'Unison Warmup',
    description: 'Sing the same melody together — get comfortable with the app',
    tempo: 76,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'C',
    scale: 'major',
    difficulty: 1,
    tags: ['beginner', 'unison', 'warmup'],
    voices: [
      {
        id: 'v1', name: 'Voice 1', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 8, deg: 2 }, { t16: 16, deg: 3 },
          { t16: 24, deg: 2 }, { t16: 32, deg: 1 }, { t16: 48, deg: 1 },
          { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v2', name: 'Voice 2', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 8, deg: 2 }, { t16: 16, deg: 3 },
          { t16: 24, deg: 2 }, { t16: 32, deg: 1 }, { t16: 48, deg: 1 },
          { t16: 60, deg: 1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'C' },
      { t16: 16, duration16: 16, name: 'F' },
      { t16: 32, duration16: 32, name: 'C' },
    ],
  },
  {
    id: 'gp_1_2',
    title: 'Parallel Thirds',
    description: 'Two voices moving together a third apart — the foundation of harmony',
    tempo: 80,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'C',
    scale: 'major',
    difficulty: 1,
    tags: ['beginner', 'thirds', 'parallel'],
    voices: [
      {
        id: 'v1', name: 'High Voice', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 8, deg: 6 }, { t16: 16, deg: 7 },
          { t16: 24, deg: 8 }, { t16: 32, deg: 7 }, { t16: 40, deg: 6 },
          { t16: 48, deg: 5 }, { t16: 56, deg: 5, term: true },
        ],
      },
      {
        id: 'v2', name: 'Low Voice', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 8, deg: 4 }, { t16: 16, deg: 5 },
          { t16: 24, deg: 6 }, { t16: 32, deg: 5 }, { t16: 40, deg: 4 },
          { t16: 48, deg: 3 }, { t16: 56, deg: 3, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'C' },
      { t16: 16, duration16: 16, name: 'G' },
      { t16: 32, duration16: 16, name: 'Am' },
      { t16: 48, duration16: 16, name: 'C' },
    ],
  },
  {
    id: 'gp_1_3',
    title: 'Call and Response',
    description: 'One voice leads, the other echoes — learn to listen and follow',
    tempo: 84,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'G',
    scale: 'major',
    difficulty: 1,
    tags: ['beginner', 'call-response'],
    voices: [
      {
        id: 'v1', name: 'Leader', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 4, deg: 2 }, { t16: 8, deg: 3 },
          { t16: 12, deg: 3, term: true },
          { t16: 32, deg: 5 }, { t16: 36, deg: 4 }, { t16: 40, deg: 3 },
          { t16: 44, deg: 3, term: true },
        ],
      },
      {
        id: 'v2', name: 'Echo', color: '#4ecdc4',
        nodes: [
          { t16: 16, deg: 1 }, { t16: 20, deg: 2 }, { t16: 24, deg: 3 },
          { t16: 28, deg: 3, term: true },
          { t16: 48, deg: 5 }, { t16: 52, deg: 4 }, { t16: 56, deg: 3 },
          { t16: 60, deg: 3, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'G' },
      { t16: 16, duration16: 16, name: 'G' },
      { t16: 32, duration16: 16, name: 'C' },
      { t16: 48, duration16: 16, name: 'G' },
    ],
  },
  {
    id: 'gp_1_4',
    title: 'Contrary Motion',
    description: 'Voices move in opposite directions — builds independence',
    tempo: 72,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'D',
    scale: 'major',
    difficulty: 2,
    tags: ['beginner', 'contrary-motion'],
    voices: [
      {
        id: 'v1', name: 'Rising', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 16, deg: 3 }, { t16: 32, deg: 5 },
          { t16: 48, deg: 8 }, { t16: 60, deg: 8, term: true },
        ],
      },
      {
        id: 'v2', name: 'Falling', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 8 }, { t16: 16, deg: 6 }, { t16: 32, deg: 4 },
          { t16: 48, deg: 1 }, { t16: 60, deg: 1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'D' },
      { t16: 16, duration16: 16, name: 'Bm' },
      { t16: 32, duration16: 16, name: 'G' },
      { t16: 48, duration16: 16, name: 'D' },
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
    title: 'Melody & Drone',
    description: 'Hold a steady note while the other voice moves freely',
    tempo: 88,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'D',
    scale: 'major',
    difficulty: 2,
    tags: ['beginner', 'drone', 'melody'],
    voices: [
      {
        id: 'v1', name: 'Melody', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 4, deg: 2 }, { t16: 8, deg: 3 },
          { t16: 12, deg: 4 }, { t16: 16, deg: 5 }, { t16: 20, deg: 4 },
          { t16: 24, deg: 3 }, { t16: 28, deg: 2 },
          { t16: 32, deg: 1 }, { t16: 36, deg: 3 }, { t16: 40, deg: 5 },
          { t16: 48, deg: 3 }, { t16: 56, deg: 1, term: true },
        ],
      },
      {
        id: 'v2', name: 'Drone', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 5, octave: -1 },
          { t16: 32, deg: 1 },
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
  },
  {
    id: 'gp_2_2',
    title: 'Suspensions',
    description: 'One voice holds while the other resolves — beautiful tension',
    tempo: 72,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'F',
    scale: 'major',
    difficulty: 2,
    tags: ['intermediate', 'suspensions'],
    voices: [
      {
        id: 'v1', name: 'Sustaining', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 16, deg: 4 },
          { t16: 32, deg: 3 }, { t16: 48, deg: 3 },
          { t16: 60, deg: 3, term: true },
        ],
      },
      {
        id: 'v2', name: 'Resolving', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 12, deg: 2 }, { t16: 16, deg: 1 },
          { t16: 28, deg: 7, octave: -1 }, { t16: 32, deg: 1 },
          { t16: 48, deg: 1 }, { t16: 60, deg: 1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'F' },
      { t16: 16, duration16: 16, name: 'Dm' },
      { t16: 32, duration16: 16, name: 'C' },
      { t16: 48, duration16: 16, name: 'F' },
    ],
  },
  {
    id: 'gp_2_3',
    title: 'Waltz for Two',
    description: 'A gentle 3/4 duet — practice singing in triple time',
    tempo: 100,
    timeSig: { numerator: 3, denominator: 4 },
    bars: 4,
    tonic: 'G',
    scale: 'major',
    difficulty: 2,
    tags: ['beginner', 'waltz', '3/4'],
    voices: [
      {
        id: 'v1', name: 'Voice 1', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 12, deg: 3 },
          { t16: 24, deg: 4 }, { t16: 36, deg: 5 },
          { t16: 44, deg: 5, term: true },
        ],
      },
      {
        id: 'v2', name: 'Voice 2', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 12, deg: 1 },
          { t16: 24, deg: 2 }, { t16: 36, deg: 3 },
          { t16: 44, deg: 3, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 12, name: 'G' },
      { t16: 12, duration16: 12, name: 'Em' },
      { t16: 24, duration16: 12, name: 'C' },
      { t16: 36, duration16: 12, name: 'G' },
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
    title: 'Simple Triads',
    description: 'Three voices forming basic major and minor chords',
    tempo: 72,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'G',
    scale: 'major',
    difficulty: 2,
    tags: ['intermediate', 'triads', 'chords'],
    voices: [
      {
        id: 'v1', name: 'Soprano', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 16, deg: 4 },
          { t16: 32, deg: 3 }, { t16: 48, deg: 5 },
          { t16: 60, deg: 5, term: true },
        ],
      },
      {
        id: 'v2', name: 'Alto', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 16, deg: 1 },
          { t16: 32, deg: 1 }, { t16: 48, deg: 3 },
          { t16: 60, deg: 3, term: true },
        ],
      },
      {
        id: 'v3', name: 'Tenor', color: '#ffe66d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 16, deg: 5, octave: -1 },
          { t16: 32, deg: 5, octave: -1 }, { t16: 48, deg: 1 },
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
  },
  {
    id: 'gp_3_2',
    title: 'Row, Row, Row',
    description: 'A classic three-part round — staggered entries build the harmony',
    tempo: 96,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'C',
    scale: 'major',
    difficulty: 2,
    tags: ['intermediate', 'round', 'canon'],
    voices: [
      {
        id: 'v1', name: 'Voice 1', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 4, deg: 1 }, { t16: 8, deg: 1 },
          { t16: 10, deg: 2 }, { t16: 12, deg: 3 },
          { t16: 16, deg: 3 }, { t16: 18, deg: 2 }, { t16: 20, deg: 3 },
          { t16: 22, deg: 4 }, { t16: 24, deg: 5 },
          { t16: 60, deg: 5, term: true },
        ],
      },
      {
        id: 'v2', name: 'Voice 2', color: '#4ecdc4',
        nodes: [
          { t16: 16, deg: 1 }, { t16: 20, deg: 1 }, { t16: 24, deg: 1 },
          { t16: 26, deg: 2 }, { t16: 28, deg: 3 },
          { t16: 32, deg: 3 }, { t16: 34, deg: 2 }, { t16: 36, deg: 3 },
          { t16: 38, deg: 4 }, { t16: 40, deg: 5 },
          { t16: 60, deg: 5, term: true },
        ],
      },
      {
        id: 'v3', name: 'Voice 3', color: '#ffe66d',
        nodes: [
          { t16: 32, deg: 1 }, { t16: 36, deg: 1 }, { t16: 40, deg: 1 },
          { t16: 42, deg: 2 }, { t16: 44, deg: 3 },
          { t16: 48, deg: 3 }, { t16: 50, deg: 2 }, { t16: 52, deg: 3 },
          { t16: 54, deg: 4 }, { t16: 56, deg: 5 },
          { t16: 60, deg: 5, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'C' },
      { t16: 16, duration16: 16, name: 'C' },
      { t16: 32, duration16: 16, name: 'C' },
      { t16: 48, duration16: 16, name: 'C' },
    ],
  },
  {
    id: 'gp_3_3',
    title: 'Hymn Style',
    description: 'Smooth three-part voice leading in a chorale style',
    tempo: 66,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'F',
    scale: 'major',
    difficulty: 3,
    tags: ['intermediate', 'chorale', 'hymn'],
    voices: [
      {
        id: 'v1', name: 'Soprano', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 8, deg: 6 },
          { t16: 16, deg: 5 }, { t16: 24, deg: 4 },
          { t16: 32, deg: 3 }, { t16: 40, deg: 4 },
          { t16: 48, deg: 5 }, { t16: 60, deg: 5, term: true },
        ],
      },
      {
        id: 'v2', name: 'Alto', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 8, deg: 4 },
          { t16: 16, deg: 3 }, { t16: 24, deg: 2 },
          { t16: 32, deg: 1 }, { t16: 40, deg: 2 },
          { t16: 48, deg: 3 }, { t16: 60, deg: 3, term: true },
        ],
      },
      {
        id: 'v3', name: 'Bass', color: '#ffe66d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 16, deg: 1 },
          { t16: 32, deg: 6, octave: -1 }, { t16: 40, deg: 7, octave: -1 },
          { t16: 48, deg: 1 }, { t16: 60, deg: 1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'F' },
      { t16: 16, duration16: 16, name: 'Dm' },
      { t16: 32, duration16: 16, name: 'Bb' },
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
    title: 'SATB Basics',
    description: 'Soprano, Alto, Tenor, Bass — the classic four-part chorale',
    tempo: 68,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'C',
    scale: 'major',
    difficulty: 3,
    tags: ['intermediate', 'satb', 'chorale'],
    voices: [
      {
        id: 'v1', name: 'Soprano', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 16, deg: 3 },
          { t16: 32, deg: 4 }, { t16: 48, deg: 5 },
          { t16: 60, deg: 5, term: true },
        ],
      },
      {
        id: 'v2', name: 'Alto', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 16, deg: 1 },
          { t16: 32, deg: 2 }, { t16: 48, deg: 3 },
          { t16: 60, deg: 3, term: true },
        ],
      },
      {
        id: 'v3', name: 'Tenor', color: '#ffe66d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 16, deg: 5, octave: -1 },
          { t16: 32, deg: 7, octave: -1 }, { t16: 48, deg: 1 },
          { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v4', name: 'Bass', color: '#ff8c42',
        nodes: [
          { t16: 0, deg: 1, octave: -1 }, { t16: 16, deg: 3, octave: -1 },
          { t16: 32, deg: 5, octave: -1 }, { t16: 48, deg: 1, octave: -1 },
          { t16: 60, deg: 1, octave: -1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'C' },
      { t16: 16, duration16: 16, name: 'Am' },
      { t16: 32, duration16: 16, name: 'G' },
      { t16: 48, duration16: 16, name: 'C' },
    ],
  },
  {
    id: 'gp_4_2',
    title: 'Jazz Intro',
    description: 'Your first taste of jazz — four voices with 7th chords',
    tempo: 96,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'F',
    scale: 'major',
    difficulty: 3,
    tags: ['intermediate', 'jazz', '7ths'],
    voices: [
      {
        id: 'v1', name: 'Voice 1', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 7 }, { t16: 16, deg: 2, octave: 1 },
          { t16: 32, deg: 6 }, { t16: 48, deg: 5 },
          { t16: 60, deg: 5, term: true },
        ],
      },
      {
        id: 'v2', name: 'Voice 2', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 16, deg: 5 },
          { t16: 32, deg: 4 }, { t16: 48, deg: 3 },
          { t16: 60, deg: 3, term: true },
        ],
      },
      {
        id: 'v3', name: 'Voice 3', color: '#ffe66d',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 16, deg: 3 },
          { t16: 32, deg: 2 }, { t16: 48, deg: 1 },
          { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v4', name: 'Voice 4', color: '#ff8c42',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 16, deg: 7, octave: -1 },
          { t16: 32, deg: 6, octave: -1 }, { t16: 48, deg: 5, octave: -1 },
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
  },
  {
    id: 'gp_4_3',
    title: 'Minor Moods',
    description: 'Four voices in natural minor — melancholy and expressive',
    tempo: 76,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'A',
    scale: 'minor',
    difficulty: 3,
    tags: ['intermediate', 'minor', 'expressive'],
    voices: [
      {
        id: 'v1', name: 'Soprano', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 16, deg: 4 },
          { t16: 32, deg: 3 }, { t16: 48, deg: 1 },
          { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v2', name: 'Alto', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 16, deg: 2 },
          { t16: 32, deg: 1 }, { t16: 48, deg: 5, octave: -1 },
          { t16: 60, deg: 5, octave: -1, term: true },
        ],
      },
      {
        id: 'v3', name: 'Tenor', color: '#ffe66d',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 16, deg: 7, octave: -1 },
          { t16: 32, deg: 5, octave: -1 }, { t16: 48, deg: 3, octave: -1 },
          { t16: 60, deg: 3, octave: -1, term: true },
        ],
      },
      {
        id: 'v4', name: 'Bass', color: '#ff8c42',
        nodes: [
          { t16: 0, deg: 1, octave: -1 }, { t16: 16, deg: 5, octave: -2 },
          { t16: 32, deg: 6, octave: -2 }, { t16: 48, deg: 1, octave: -1 },
          { t16: 60, deg: 1, octave: -1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'Am' },
      { t16: 16, duration16: 16, name: 'Em' },
      { t16: 32, duration16: 16, name: 'F' },
      { t16: 48, duration16: 16, name: 'Am' },
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
    title: 'Five-Part Cluster',
    description: 'Close-voiced five-part harmony — rich and lush',
    tempo: 66,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'Bb',
    scale: 'major',
    difficulty: 4,
    tags: ['advanced', 'five-part', 'cluster'],
    voices: [
      {
        id: 'v1', name: 'Soprano', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 16, deg: 6 },
          { t16: 32, deg: 5 }, { t16: 48, deg: 3 },
          { t16: 60, deg: 3, term: true },
        ],
      },
      {
        id: 'v2', name: 'Mezzo', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 4 }, { t16: 16, deg: 4 },
          { t16: 32, deg: 3 }, { t16: 48, deg: 2 },
          { t16: 60, deg: 2, term: true },
        ],
      },
      {
        id: 'v3', name: 'Alto', color: '#ffe66d',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 16, deg: 2 },
          { t16: 32, deg: 1 }, { t16: 48, deg: 1 },
          { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v4', name: 'Tenor', color: '#ff8c42',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 16, deg: 7, octave: -1 },
          { t16: 32, deg: 6, octave: -1 }, { t16: 48, deg: 5, octave: -1 },
          { t16: 60, deg: 5, octave: -1, term: true },
        ],
      },
      {
        id: 'v5', name: 'Bass', color: '#a78bfa',
        nodes: [
          { t16: 0, deg: 1, octave: -1 }, { t16: 16, deg: 4, octave: -1 },
          { t16: 32, deg: 1, octave: -1 }, { t16: 48, deg: 1, octave: -1 },
          { t16: 60, deg: 1, octave: -1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'Bb' },
      { t16: 16, duration16: 16, name: 'Eb' },
      { t16: 32, duration16: 16, name: 'Bb' },
      { t16: 48, duration16: 16, name: 'Bb' },
    ],
  },
  {
    id: 'gp_5_2',
    title: 'ii-V-I Jazz',
    description: 'The most important jazz progression — five voices, rich voicings',
    tempo: 104,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'C',
    scale: 'major',
    difficulty: 4,
    tags: ['advanced', 'jazz', 'ii-V-I'],
    voices: [
      {
        id: 'v1', name: 'Lead', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 6 }, { t16: 16, deg: 7 },
          { t16: 32, deg: 1, octave: 1 }, { t16: 48, deg: 7 },
          { t16: 60, deg: 7, term: true },
        ],
      },
      {
        id: 'v2', name: 'High Harmony', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 4 }, { t16: 16, deg: 5 },
          { t16: 32, deg: 5 }, { t16: 48, deg: 5 },
          { t16: 60, deg: 5, term: true },
        ],
      },
      {
        id: 'v3', name: 'Mid Harmony', color: '#ffe66d',
        nodes: [
          { t16: 0, deg: 2 }, { t16: 16, deg: 2 },
          { t16: 32, deg: 3 }, { t16: 48, deg: 3 },
          { t16: 60, deg: 3, term: true },
        ],
      },
      {
        id: 'v4', name: 'Low Harmony', color: '#ff8c42',
        nodes: [
          { t16: 0, deg: 7, octave: -1 }, { t16: 16, deg: 4 },
          { t16: 32, deg: 1 }, { t16: 48, deg: 1 },
          { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v5', name: 'Bass', color: '#a78bfa',
        nodes: [
          { t16: 0, deg: 2, octave: -1 }, { t16: 16, deg: 5, octave: -1 },
          { t16: 32, deg: 1, octave: -1 }, { t16: 48, deg: 1, octave: -1 },
          { t16: 60, deg: 1, octave: -1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'Dm7' },
      { t16: 16, duration16: 16, name: 'G7' },
      { t16: 32, duration16: 32, name: 'Cmaj7' },
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
    title: 'Jazz Ballad',
    description: 'Six-voice ballad with lush 9th and 13th chord voicings',
    tempo: 72,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'Eb',
    scale: 'major',
    difficulty: 5,
    tags: ['advanced', 'jazz', 'ballad', 'six-part'],
    voices: [
      {
        id: 'v1', name: 'Soprano 1', color: '#ff6b9d',
        nodes: [
          { t16: 0, deg: 2, octave: 1 }, { t16: 16, deg: 1, octave: 1 },
          { t16: 32, deg: 6 }, { t16: 48, deg: 5 },
          { t16: 60, deg: 5, term: true },
        ],
      },
      {
        id: 'v2', name: 'Soprano 2', color: '#4ecdc4',
        nodes: [
          { t16: 0, deg: 7 }, { t16: 16, deg: 5 },
          { t16: 32, deg: 4 }, { t16: 48, deg: 3 },
          { t16: 60, deg: 3, term: true },
        ],
      },
      {
        id: 'v3', name: 'Alto', color: '#ffe66d',
        nodes: [
          { t16: 0, deg: 5 }, { t16: 16, deg: 3 },
          { t16: 32, deg: 2 }, { t16: 48, deg: 1 },
          { t16: 60, deg: 1, term: true },
        ],
      },
      {
        id: 'v4', name: 'Tenor 1', color: '#ff8c42',
        nodes: [
          { t16: 0, deg: 3 }, { t16: 16, deg: 1 },
          { t16: 32, deg: 7, octave: -1 }, { t16: 48, deg: 5, octave: -1 },
          { t16: 60, deg: 5, octave: -1, term: true },
        ],
      },
      {
        id: 'v5', name: 'Tenor 2', color: '#a78bfa',
        nodes: [
          { t16: 0, deg: 1 }, { t16: 16, deg: 6, octave: -1 },
          { t16: 32, deg: 5, octave: -1 }, { t16: 48, deg: 3, octave: -1 },
          { t16: 60, deg: 3, octave: -1, term: true },
        ],
      },
      {
        id: 'v6', name: 'Bass', color: '#34d399',
        nodes: [
          { t16: 0, deg: 1, octave: -1 }, { t16: 16, deg: 4, octave: -1 },
          { t16: 32, deg: 2, octave: -1 }, { t16: 48, deg: 1, octave: -1 },
          { t16: 60, deg: 1, octave: -1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'Ebmaj9' },
      { t16: 16, duration16: 16, name: 'Abmaj7' },
      { t16: 32, duration16: 16, name: 'Fm9' },
      { t16: 48, duration16: 16, name: 'Eb6/9' },
    ],
  },
  {
    id: 'gp_6_2',
    title: 'Chromatic Cascade',
    description: 'Six voices weaving through chromatic passing tones',
    tempo: 80,
    timeSig: { numerator: 4, denominator: 4 },
    bars: 4,
    tonic: 'C',
    scale: 'chromatic',
    difficulty: 5,
    tags: ['advanced', 'chromatic', 'six-part'],
    voices: [
      {
        id: 'v1', name: 'Voice 1', color: '#ff6b9d',
        nodes: [
          { t16: 0, semi: 16 }, { t16: 8, semi: 17 },
          { t16: 16, semi: 19 }, { t16: 32, semi: 16 },
          { t16: 48, semi: 14 }, { t16: 60, semi: 14, term: true },
        ],
      },
      {
        id: 'v2', name: 'Voice 2', color: '#4ecdc4',
        nodes: [
          { t16: 0, semi: 12 }, { t16: 16, semi: 14 },
          { t16: 32, semi: 12 }, { t16: 48, semi: 11 },
          { t16: 60, semi: 11, term: true },
        ],
      },
      {
        id: 'v3', name: 'Voice 3', color: '#ffe66d',
        nodes: [
          { t16: 0, semi: 9 }, { t16: 16, semi: 10 },
          { t16: 32, semi: 9 }, { t16: 48, semi: 7 },
          { t16: 60, semi: 7, term: true },
        ],
      },
      {
        id: 'v4', name: 'Voice 4', color: '#ff8c42',
        nodes: [
          { t16: 0, semi: 7 }, { t16: 16, semi: 7 },
          { t16: 32, semi: 5 }, { t16: 48, semi: 4 },
          { t16: 60, semi: 4, term: true },
        ],
      },
      {
        id: 'v5', name: 'Voice 5', color: '#a78bfa',
        nodes: [
          { t16: 0, semi: 4 }, { t16: 16, semi: 5 },
          { t16: 32, semi: 4 }, { t16: 48, semi: 2 },
          { t16: 60, semi: 2, term: true },
        ],
      },
      {
        id: 'v6', name: 'Voice 6', color: '#34d399',
        nodes: [
          { t16: 0, semi: 0 }, { t16: 16, semi: 2 },
          { t16: 32, semi: 0 }, { t16: 48, semi: -1 },
          { t16: 60, semi: -1, term: true },
        ],
      },
    ],
    chords: [
      { t16: 0, duration16: 16, name: 'Cmaj7#11' },
      { t16: 16, duration16: 16, name: 'D7alt' },
      { t16: 32, duration16: 16, name: 'Cmaj9' },
      { t16: 48, duration16: 16, name: 'Bmaj7' },
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
