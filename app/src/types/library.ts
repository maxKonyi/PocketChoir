/* ============================================================
   LIBRARY & PRESET BROWSER TYPES

   Types for the guided-path preset system and the user's
   personal library of saved/downloaded arrangements.
   ============================================================ */

import type { Arrangement } from './arrangement';

/* ------------------------------------------------------------
   Guided Path (Built-in Presets)
   ------------------------------------------------------------ */

/**
 * A single stage in the guided learning path.
 * Each stage groups arrangements by voice count and complexity.
 *
 * Example stages:
 *   Stage 1 — "First Steps" (2 voices, simple intervals)
 *   Stage 2 — "Three-Part Harmony" (3 voices, triads)
 *   ...
 *   Stage 6 — "Jazz Ensemble" (5-6 voices, extended chords)
 */
export interface GuidedStage {
  id: string;                     // Unique stage identifier (e.g. "stage_1")
  number: number;                 // Display order (1, 2, 3 …)
  title: string;                  // Short stage title (e.g. "First Steps")
  subtitle: string;               // What you'll learn (e.g. "Singing in parallel thirds")
  voiceCount: number;             // How many voices arrangements in this stage use
  color: string;                  // Accent color for the stage header
  icon: string;                   // Emoji icon for the stage card
  arrangements: Arrangement[];    // The preset arrangements in this stage
}

/* ------------------------------------------------------------
   User Library (Saved / Downloaded Arrangements)
   ------------------------------------------------------------ */

/**
 * A folder in the user's personal library.
 * Folders can be nested (parentId points to another folder).
 */
export interface LibraryFolder {
  id: string;                     // Unique folder ID
  name: string;                   // Folder display name
  parentId: string | null;        // null = root-level folder
  createdAt: string;              // ISO date string
  color?: string;                 // Optional accent color
}

/**
 * A saved arrangement in the user's personal library.
 * Wraps an Arrangement with library-specific metadata.
 */
export interface LibraryItem {
  id: string;                     // Unique library-item ID
  arrangement: Arrangement;       // The full arrangement data
  folderId: string | null;        // Which folder it lives in (null = root)
  isFavorite: boolean;            // Starred by the user
  savedAt: string;                // ISO date — when it was saved
  updatedAt: string;              // ISO date — last modification
  source: 'user' | 'downloaded';  // Where the arrangement came from
}

/**
 * Which tab is active in the preset browser.
 */
export type LibraryTab = 'guided' | 'myLibrary';
