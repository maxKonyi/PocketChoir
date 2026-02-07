/* ============================================================
   GRID COMPONENT
   
   Main visualization canvas showing:
   - Vertical grid lines (bars, beats, subdivisions)
   - Horizontal pitch lines
   - Contour lines for each voice
   - User's pitch trace during recording
   - Playhead
   ============================================================ */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Arrangement, Voice, PitchPoint, Chord } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { degreeToSemitoneOffset, semitoneToLabel, midiToFrequency, noteNameToMidi, A4_MIDI, A4_FREQUENCY, SCALE_PATTERNS } from '../../utils/music';
import { generateGridLines, sixteenthDurationMs } from '../../utils/timing';
import { darkenColor } from '../../utils/colors';
import { playbackEngine } from '../../services/PlaybackEngine';
import {
  cameraLeftWorldT,
  visibleDurationT,
  worldTToScreenX,
  screenXToWorldT,
  getTileRange,
  tileLocalToWorldT,
  getGridLOD,
  dragPixelsToTimeDelta,
  resolveToCanonical,
} from '../../utils/followCamera';

/* ------------------------------------------------------------
   Types
   ------------------------------------------------------------ */

interface GridProps {
  arrangement: Arrangement | null;
  className?: string;
  hideChords?: boolean;
  onlyChords?: boolean;
}

/**
 * Convert a chromatic semitone offset (relative to tonic) to Y position.
 */
function semitoneOffsetToY(
  semitoneOffset: number,
  minSemitone: number,
  maxSemitone: number,
  gridTop: number,
  gridHeight: number
): number {
  return semitoneToY(semitoneOffset, minSemitone, maxSemitone, gridTop, gridHeight);
}



/* ------------------------------------------------------------
   Helper Functions
   ------------------------------------------------------------ */

/**
 * Get CSS variable value from the document.
 */
function getCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
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
function isChordDiatonic(chord: Chord, arrangement: Arrangement): boolean {
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
function semitoneToY(
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
function degreeToY(
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


/**
 * Find the closest in-scale ("legal") semitone to a raw semitone.
 * The semitone values here are relative to the arrangement tonic (0 = tonic).
 */
function snapSemitoneToScale(scaleType: string, rawSemitone: number): number {
  const pattern = SCALE_PATTERNS[scaleType] || SCALE_PATTERNS['major'];

  // We search a small octave window around the raw semitone.
  // This is enough to find the nearest scale tone without heavy computation.
  const baseOctave = Math.floor(rawSemitone / 12);
  let best = 0;
  let bestDiff = Infinity;

  for (let octave = baseOctave - 1; octave <= baseOctave + 1; octave++) {
    for (const semiInOctave of pattern) {
      const candidate = octave * 12 + semiInOctave;
      const diff = Math.abs(candidate - rawSemitone);
      if (diff < bestDiff) {
        best = candidate;
        bestDiff = diff;
      }
    }
  }

  return best;
}

/* ------------------------------------------------------------
   Grid Component
   ------------------------------------------------------------ */

// Type for tracking dragged node
interface DragState {
  voiceId: string;
  originalT16: number;
  isDragging: boolean;
  anchorParentT16?: number;
}

// The "anchor" range for the Y-axis (pitch) view.
// We compute this once when an arrangement is loaded, and then keep it stable.
// This prevents Create mode from "jumping" when you add/move notes.
interface PitchRangeAnchor {
  centerSemitone: number;
  paddedRangeSemitones: number;
}

// A snapped, "legal" grid point for Create mode.
// - `t16` is time snapped to the nearest 16th-note.
// - `deg` + `octave` are snapped to the nearest in-scale pitch.
interface SnappedGridPoint {
  t16: number;
  deg: number;
  octave: number;
  semi?: number;
}

// Keep the grid margins consistent between drawing and mouse hit-testing.
// If these differ, the "ghost" preview and click zones will feel offset.
const GRID_MARGIN = { top: 40, right: 20, bottom: 40, left: 50 };

export function Grid({
  arrangement: arrangementProp,
  className = '',
  hideChords = false,
  onlyChords = false
}: GridProps) {

  // Canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drag state for node editing
  const [dragState, setDragState] = useState<DragState | null>(null);

  // Hover preview state (stored in a ref so it can update frequently without re-rendering).
  // The draw loop runs continuously, so it can just read the latest ref value.
  const hoverPreviewRef = useRef<{ voiceId: string; point: SnappedGridPoint } | null>(null);

  // When you press the mouse down in Create mode, we treat it as an "audition" gesture.
  // While held, moving the mouse glides the synth pitch; releasing stops the note.
  const auditionRef = useRef<{ voiceId: string } | null>(null);

  // When placing a NEW node (not dragging an existing one), we commit it on mouse-up.
  const placingNewNodeRef = useRef<{ voiceId: string; point: SnappedGridPoint } | null>(null);

  // React will still fire an `onClick` after a `mousedown`/`mouseup`.
  // We use this flag to avoid double-adding nodes (because Create mode now commits on mouse-up).
  const skipNextClickRef = useRef(false);

  // Stable pitch-range anchor for the current arrangement.
  // This is what makes zoom behavior stable (only changes when you change zoom manually
  // or load a different arrangement).
  const [pitchRangeAnchor, setPitchRangeAnchor] = useState<PitchRangeAnchor | null>(null);
  const [isHoveringAnchor, setIsHoveringAnchor] = useState(false);

  // Get arrangement from store to ensure we always have latest (for create mode updates)
  const arrangementFromStore = useAppStore((state) => state.arrangement);
  const arrangement = arrangementFromStore || arrangementProp;

  const playback = useAppStore((state) => state.playback);
  const voiceStates = useAppStore((state) => state.voiceStates);
  const livePitchTrace = useAppStore((state) => state.livePitchTrace);
  const livePitchTraceVoiceId = useAppStore((state) => state.livePitchTraceVoiceId);
  const display = useAppStore((state) => state.display);
  const recordings = useAppStore((state) => state.recordings);
  const armedVoiceId = useAppStore((state) => state.armedVoiceId);
  const mode = useAppStore((state) => state.mode);
  const selectedVoiceId = useAppStore((state) => state.selectedVoiceId);
  const addNode = useAppStore((state) => state.addNode);
  const removeNode = useAppStore((state) => state.removeNode);
  const setSelectedVoiceId = useAppStore((state) => state.setSelectedVoiceId);
  const updateNode = useAppStore((state) => state.updateNode);
  const transposition = useAppStore((state) => state.transposition);

  // Follow-mode timeline state and actions
  const followMode = useAppStore((state) => state.followMode);
  const startTimelineDrag = useAppStore((state) => state.startTimelineDrag);
  const updatePendingWorldT = useAppStore((state) => state.updatePendingWorldT);
  const commitTimelineDrag = useAppStore((state) => state.commitTimelineDrag);

  // Ref to track drag start position for scrub gestures
  const dragStartRef = useRef<{ startX: number; startWorldT: number } | null>(null);

  // Chord-track editor actions (Create mode)
  const enableChordTrack = useAppStore((state) => state.enableChordTrack);
  const setChordName = useAppStore((state) => state.setChordName);
  const splitChordAt = useAppStore((state) => state.splitChordAt);
  const resizeChordBoundary = useAppStore((state) => state.resizeChordBoundary);
  const deleteChord = useAppStore((state) => state.deleteChord);

  // Which chord label is currently being edited (inline rename).
  const [editingChordIndex, setEditingChordIndex] = useState<number | null>(null);
  const [editingChordName, setEditingChordName] = useState<string>('');

  // Hover-based split marker (Create mode chord editing)
  const [hoverSplitT16, setHoverSplitT16] = useState<number | null>(null);

  // DOM ref for the chord lane overlay (used for boundary-drag hit testing).
  const chordLaneRef = useRef<HTMLDivElement | null>(null);

  // Temporary drag state for resizing a boundary between two chord blocks.
  const chordBoundaryDragRef = useRef<{ leftChordIndex: number } | null>(null);

  // If the arrangement changes (or chord list is replaced), cancel any inline rename.
  useEffect(() => {
    setEditingChordIndex(null);
    setEditingChordName('');
    setHoverSplitT16(null);
  }, [arrangement?.id]);

  /**
   * Stop editing (commit changes back into the store).
   */
  const commitChordNameEdit = useCallback(() => {
    if (!arrangement) return;
    if (editingChordIndex === null) return;

    const nextName = editingChordName.trim() || 'C';
    setChordName(editingChordIndex, nextName);
    setEditingChordIndex(null);
  }, [arrangement, editingChordIndex, editingChordName, setChordName]);

  /**
   * Convert a mouse X position inside the chord lane into a snapped `t16` value.
   */
  const chordLaneMouseXToT16 = useCallback((clientX: number): number | null => {
    if (!arrangement) return null;
    const lane = chordLaneRef.current;
    if (!lane) return null;

    const rect = lane.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
    return Math.round(pct * totalT16);
  }, [arrangement]);

  /**
   * Install global mouse listeners while dragging a chord boundary.
   * This keeps the resize working even if your mouse leaves the chord lane.
   */
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (mode !== 'create') return;
      if (!arrangement) return;
      const drag = chordBoundaryDragRef.current;
      if (!drag) return;

      const t16 = chordLaneMouseXToT16(e.clientX);
      if (t16 === null) return;
      resizeChordBoundary(drag.leftChordIndex, t16);
    };

    const handleUp = () => {
      if (chordBoundaryDragRef.current) {
        chordBoundaryDragRef.current = null;
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [mode, arrangement, chordLaneMouseXToT16, resizeChordBoundary]);

  /**
   * Find the closest in-scale ("legal") semitone to a raw semitone.
   * The semitone values here are relative to the arrangement tonic (0 = tonic).
   */
  const snapSemitoneToScaleMemo = useCallback((rawSemitone: number, scaleType: string): number => {
    return snapSemitoneToScale(scaleType, rawSemitone);
  }, []);

  /**
   * Find the closest existing node to the mouse (pixel-based hit testing).
   * This avoids the old behavior where you had to be "3 sixteenths away" from another node.
   */
  const getNodeHitAtMouseEvent = useCallback((
    e: React.MouseEvent<HTMLCanvasElement>,
    voiceId: string,
    _startT16: number,
    _endT16: number,
    gridLeft: number,
    gridTop: number,
    gridWidth: number,
    gridHeight: number,
    minSemitone: number,
    maxSemitone: number
  ) => {
    if (!arrangement) return null;

    const container = containerRef.current;
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const voice = arrangement.voices.find((v) => v.id === voiceId);
    if (!voice) return null;

    const hitRadius = 14;

    // ── Follow-mode: compute camera to position nodes on screen ──
    const pxPerTVal = followMode.pxPerT;
    const loopLen = arrangement.bars * arrangement.timeSig.numerator * 4;
    const currentWorldT = followMode.pendingWorldT !== null
      ? followMode.pendingWorldT
      : playbackEngine.getWorldPositionT16();
    const camLeft = cameraLeftWorldT(currentWorldT, gridWidth, pxPerTVal);
    const visDur = visibleDurationT(gridWidth, pxPerTVal);
    const [kStart, kEnd] = getTileRange(camLeft, camLeft + visDur, loopLen);

    // Check all visible tiles for a node hit
    for (let k = kStart; k <= kEnd; k++) {
      const tileOffset = k * loopLen;
      for (const node of voice.nodes) {
        const r = node.term ? 9 : hitRadius;

        const nodeWorldT = node.t16 + tileOffset;
        if (nodeWorldT < 0) continue;
        const x = gridLeft + worldTToScreenX(nodeWorldT, camLeft, pxPerTVal);

        // Skip off-screen nodes
        if (x < gridLeft - r || x > gridLeft + gridWidth + r) continue;

        const y = node.semi !== undefined
          ? semitoneOffsetToY(node.semi, minSemitone, maxSemitone, gridTop, gridHeight)
          : degreeToY(node.deg, node.octave || 0, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale);

        const dx = mouseX - x;
        const dy = mouseY - y;
        if (dx * dx + dy * dy <= r * r) {
          return node;
        }
      }
    }

    return null;
  }, [arrangement, followMode.pxPerT, followMode.pendingWorldT]);

  /**
   * Convert a snapped semitone into (deg, octaveOffset) for storage in the arrangement.
   */
  const semitoneToDegreeAndOctave = useCallback((semitone: number, scaleType: string): { deg: number; octave: number } => {
    const pattern = SCALE_PATTERNS[scaleType] || SCALE_PATTERNS['major'];

    const octave = Math.floor(semitone / 12);
    const semitoneInOctave = ((semitone % 12) + 12) % 12;
    const index = pattern.indexOf(semitoneInOctave);

    // If something went wrong (shouldn't happen because we snapped using the same pattern),
    // fall back to degree 1.
    const deg = index >= 0 ? index + 1 : 1;

    return { deg, octave };
  }, []);

  /**
   * Compute a stable pitch-range anchor from the arrangement content.
   *
   * NOTE: We intentionally do NOT recompute this on every node edit.
   * We only recompute when the arrangement ID changes.
   */
  const computePitchRangeAnchor = useCallback((arr: Arrangement): PitchRangeAnchor => {
    let minSemi = Infinity;
    let maxSemi = -Infinity;

    for (const voice of arr.voices) {
      for (const node of voice.nodes) {
        const semitone = node.semi !== undefined
          ? node.semi
          : degreeToSemitoneOffset(node.deg, node.octave || 0, arr.scale);
        minSemi = Math.min(minSemi, semitone);
        maxSemi = Math.max(maxSemi, semitone);
      }
    }

    // If no nodes exist yet, use a reasonable default range.
    if (minSemi === Infinity || maxSemi === -Infinity) {
      minSemi = -5;
      maxSemi = 19;
    }

    const centerSemitone = (minSemi + maxSemi) / 2;
    const baseRange = maxSemi - minSemi;
    const basePadding = 10;
    const paddedRangeSemitones = baseRange + basePadding * 2;

    return { centerSemitone, paddedRangeSemitones };
  }, []);

  // Initialize / refresh the stable pitch anchor when a new arrangement is loaded.
  // We key off `arrangement.id` so Create-mode edits (which update nodes) don't cause jumps.
  useEffect(() => {
    if (!arrangement) {
      setPitchRangeAnchor(null);
      return;
    }

    setPitchRangeAnchor(computePitchRangeAnchor(arrangement));
  }, [arrangement?.id, computePitchRangeAnchor]);

  /**
   * Calculate the pitch range for the arrangement in semitones.
   * Returns min/max semitones relative to the tonic, plus frequency range.
   * Uses zoomLevel to adjust the visible range (higher zoom = fewer semitones visible).
   */
  const getPitchRange = useCallback(() => {
    if (!arrangement) return { minSemitone: -5, maxSemitone: 19, minFreq: 130, maxFreq: 520, effectiveTonicMidi: 60 };

    // Use the stable pitch anchor if available.
    // Fallback to computing it directly (should be rare; mainly first render).
    const anchor = pitchRangeAnchor ?? computePitchRangeAnchor(arrangement);

    // Apply zoom: zoomLevel 1 = fit all, higher = zoomed in (fewer semitones)
    // zoomLevel 2 = half the range, zoomLevel 0.5 = double the range
    const zoomFactor = Math.max(0.25, display.zoomLevel); // Prevent extreme zoom out
    const zoomedRange = anchor.paddedRangeSemitones / zoomFactor;

    // Calculate final min/max centered on the arrangement anchor
    const finalMin = Math.floor(anchor.centerSemitone - zoomedRange / 2);
    const finalMax = Math.ceil(anchor.centerSemitone + zoomedRange / 2);

    // Calculate frequency range (using MIDI-based calculation)
    // Get the MIDI pitch of the arrangement's tonic at base octave 4
    const tonicMidi = noteNameToMidi(`${arrangement.tonic}4`) || 60;

    // We also need to factor in playback transposition for the frequencies
    // but the grid itself stays in 'compositional' semitones (where tonic is 0)
    const effectiveTonicMidi = tonicMidi + (transposition || 0);

    const minFreq = midiToFrequency(effectiveTonicMidi + finalMin);
    const maxFreq = midiToFrequency(effectiveTonicMidi + finalMax);

    return { minSemitone: finalMin, maxSemitone: finalMax, minFreq, maxFreq, effectiveTonicMidi };
  }, [arrangement, display.zoomLevel, pitchRangeAnchor, computePitchRangeAnchor, transposition]);

  /**
   * Given a mouse event, compute the nearest legal grid point for Create mode.
   * Returns null if the mouse is outside the grid.
   */
  const getSnappedPointFromMouseEvent = useCallback((e: React.MouseEvent<HTMLCanvasElement>): SnappedGridPoint | null => {
    if (!arrangement) return null;
    const container = containerRef.current;

    // Use the container rect so mouse math matches the exact same box used in draw().
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const width = rect.width;
    const height = rect.height;

    const gridLeft = GRID_MARGIN.left;
    const gridTop = GRID_MARGIN.top;
    const gridWidth = width - GRID_MARGIN.left - GRID_MARGIN.right;
    const gridHeight = height - GRID_MARGIN.top - GRID_MARGIN.bottom;

    if (x < gridLeft || x > gridLeft + gridWidth || y < gridTop || y > gridTop + gridHeight) return null;

    const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
    const { minSemitone, maxSemitone } = getPitchRange();

    // ── Follow-mode: convert screen X → world time → canonical local t16 ──
    const pxPerTVal = followMode.pxPerT;
    const currentWorldT = followMode.pendingWorldT !== null
      ? followMode.pendingWorldT
      : playbackEngine.getWorldPositionT16();
    const camLeft = cameraLeftWorldT(currentWorldT, gridWidth, pxPerTVal);

    // Screen X (relative to grid left) → world time
    const clickWorldT = screenXToWorldT(x - gridLeft, camLeft, pxPerTVal);
    // Resolve world time → canonical local t16 within [0, loopLengthT)
    const { tLocal } = resolveToCanonical(clickWorldT, totalT16);
    const t16 = Math.max(0, Math.min(totalT16, Math.round(tLocal)));

    const relativeY = (y - gridTop) / gridHeight;
    const rawSemitone = maxSemitone - relativeY * (maxSemitone - minSemitone);

    // Ctrl = allow chromatic (non-diatonic) notes.
    if (e.ctrlKey) {
      const chromaticSemitone = Math.round(rawSemitone);
      return { t16, deg: 1, octave: 0, semi: chromaticSemitone };
    }

    const snappedSemitone = snapSemitoneToScaleMemo(rawSemitone, arrangement.scale);
    const { deg, octave } = semitoneToDegreeAndOctave(snappedSemitone, arrangement.scale);

    return { t16, deg, octave };
  }, [arrangement, getPitchRange, snapSemitoneToScaleMemo, semitoneToDegreeAndOctave, followMode.pxPerT, followMode.pendingWorldT]);

  /**
   * Main drawing function.
   */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI displays
    // IMPORTANT: We must reset the transform each frame.
    // If we call `ctx.scale(dpr, dpr)` repeatedly without resetting, the scale accumulates,
    // which makes drawings (and mouse hit-testing) feel offset.
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    // Clear in device pixels with identity transform.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw in CSS pixels with a single DPR transform.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = rect.width;
    const height = rect.height;

    // Grid area (with margins for labels)
    const gridLeft = GRID_MARGIN.left;
    const gridTop = GRID_MARGIN.top;
    const gridWidth = width - GRID_MARGIN.left - GRID_MARGIN.right;
    const gridHeight = height - GRID_MARGIN.top - GRID_MARGIN.bottom;

    // Get colors from CSS variables

    const barLineColor = getCssVar('--grid-line-bar') || 'rgba(255, 255, 255, 0.15)';
    const beatLineColor = getCssVar('--grid-line-beat') || 'rgba(255, 255, 255, 0.08)';
    const subdivLineColor = getCssVar('--grid-line-subdivision') || 'rgba(255, 255, 255, 0.04)';
    const pitchLineTonicColor = getCssVar('--grid-pitch-line-tonic') || 'rgba(255, 255, 255, 0.35)';
    const pitchLineColor = getCssVar('--grid-pitch-line') || 'rgba(255, 255, 255, 0.05)';
    const playheadColor = getCssVar('--playhead-color') || '#ffffff';
    const textColor = getCssVar('--text-secondary') || '#a8a3b8';
    const chordFillTop = getCssVar('--chord-fill-top') || '#5a4c80';
    const chordFillBottom = getCssVar('--chord-fill-bottom') || '#342656';
    const chordFillTensionTop = getCssVar('--chord-fill-tension-top') || '#8a2e47';
    const chordFillTensionBottom = getCssVar('--chord-fill-tension-bottom') || '#4a1a28';
    const chordStroke = getCssVar('--chord-stroke') || 'rgba(255, 255, 255, 0.35)';
    const chordStrokeTension = getCssVar('--chord-stroke-tension') || 'rgba(255, 148, 180, 0.7)';
    const chordText = getCssVar('--chord-text') || '#fefaff';
    const chordTextTension = getCssVar('--chord-text-tension') || '#ffe6ef';

    // Canvas was already cleared above (in device pixels)


    if (!arrangement) {
      // Draw placeholder text
      ctx.fillStyle = textColor;
      ctx.font = '16px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Select an arrangement to begin', width / 2, height / 2);
      return;
    }

    // Get pitch range (now in semitones)
    const { minSemitone, maxSemitone, effectiveTonicMidi } = getPitchRange();

    // ── Follow-mode camera setup ──
    // loopLengthT is the arrangement length in 16th notes (one full loop cycle).
    const loopLengthT = arrangement.bars * arrangement.timeSig.numerator * 4;

    // Horizontal zoom: pixels per 16th note
    const pxPerT = followMode.pxPerT;

    // Current world time: use pendingWorldT during a drag, otherwise read from the engine.
    const worldT = followMode.pendingWorldT !== null
      ? followMode.pendingWorldT
      : playbackEngine.getWorldPositionT16();

    // Camera left edge in world time (may be negative near the start).
    const camLeft = cameraLeftWorldT(worldT, gridWidth, pxPerT);

    // Visible time span and the viewport's right edge in world time.
    const visDur = visibleDurationT(gridWidth, pxPerT);
    const viewEnd = camLeft + visDur;

    // Which tile indices overlap the visible range (forward-only, clamped >= 0).
    // In one-shot mode (loopEnabled=false), only draw tile 0 — no tiling.
    const loopEnabled = playback.loopEnabled;
    const [kStart, kEnd] = loopEnabled
      ? getTileRange(camLeft, viewEnd, loopLengthT)
      : [0, 0] as [number, number];

    // Helper: convert a world-time value to a screen X pixel inside the grid area.
    const wToX = (wt: number) => gridLeft + worldTToScreenX(wt, camLeft, pxPerT);

    // Keep these around for pitch trace + chord drawing that still use local coordinates.
    const totalT16 = loopLengthT;
    const startT16 = 0;
    const endT16 = totalT16;

    // Grid level-of-detail: hide subdivision / beat lines when zoomed far out.
    const lod = getGridLOD(pxPerT);

    // Draw horizontal pitch lines (semitone-based chromatic grid)
    if (!onlyChords) {
      ctx.save();
      ctx.globalAlpha = display.gridOpacity;

      for (let semi = Math.ceil(minSemitone); semi <= Math.floor(maxSemitone); semi++) {
        // Determine if this pitch is diatonic
        // Normalize semi to 0-11 range relative to tonic
        // minSemitone is relative to tonic, so semi is also relative to tonic
        const noteInScale = ((semi % 12) + 12) % 12;
        const scalePattern = SCALE_PATTERNS[arrangement.scale] || SCALE_PATTERNS['major'];
        const isDiatonic = scalePattern.includes(noteInScale);

        // Only draw grid lines for diatonic notes
        if (!isDiatonic) continue;

        const y = semitoneToY(semi, minSemitone, maxSemitone, gridTop, gridHeight);
        const label = semitoneToLabel(semi);

        // Make tonic (1) and octave brighter for orientation
        if (semi % 12 === 0) {
          ctx.strokeStyle = pitchLineTonicColor;
          ctx.lineWidth = 1.5;
        } else {
          // Standard diatonic lines
          ctx.strokeStyle = pitchLineColor;
          ctx.lineWidth = 0.5; // Thinner lines
        }

        ctx.beginPath();
        ctx.moveTo(gridLeft, y);
        ctx.lineTo(gridLeft + gridWidth, y);
        ctx.stroke();

        // Draw semitone label on the left
        if (semi >= minSemitone + 1 && semi <= maxSemitone - 1) {
          ctx.fillStyle = semi % 12 === 0 ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.35)';
          ctx.font = 'bold 10px system-ui';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, gridLeft - 15, y);
        }
      }

      // ── Tiled vertical grid lines ──
      // Draw grid lines for every visible tile (seamless infinite looping).
      const gridLines = generateGridLines(arrangement.bars, arrangement.timeSig);

      for (let k = kStart; k <= kEnd; k++) {
        for (const line of gridLines) {
          // Skip line types based on LOD (zoom level)
          if (line.type === 'subdivision' && !lod.showSubdivisions) continue;
          if (line.type === 'beat' && !lod.showBeats) continue;

          // Convert local grid time → world time for this tile
          const drawWorldT = tileLocalToWorldT(line.t16, k, loopLengthT);
          if (drawWorldT === null) continue; // before time 0

          const x = wToX(drawWorldT);
          // Skip lines that are off-screen (with a small margin)
          if (x < gridLeft - 2 || x > gridLeft + gridWidth + 2) continue;

          switch (line.type) {
            case 'bar':
              ctx.strokeStyle = barLineColor;
              ctx.lineWidth = 2;
              break;
            case 'beat':
              ctx.strokeStyle = beatLineColor;
              ctx.lineWidth = 1;
              break;
            case 'subdivision':
              ctx.strokeStyle = subdivLineColor;
              ctx.lineWidth = 1;
              break;
          }

          ctx.beginPath();
          ctx.moveTo(x, gridTop);
          ctx.lineTo(x, gridTop + gridHeight);
          ctx.stroke();
        }

        // ── Loop Start Marker ──
        // Draw a distinctive marker at the beginning of each loop repetition.
        // This helps the singer see "bar 1" approaching at the end of each cycle.
        const loopStartWorldT = k * loopLengthT;
        if (loopStartWorldT >= 0) {
          const lsX = wToX(loopStartWorldT);
          if (lsX >= gridLeft - 2 && lsX <= gridLeft + gridWidth + 2) {
            // Bright, thick line
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
            ctx.lineWidth = 3;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(lsX, gridTop);
            ctx.lineTo(lsX, gridTop + gridHeight);
            ctx.stroke();

            // Label "1" (bar 1) above the marker
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.font = 'bold 13px system-ui';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText('1', lsX, gridTop - 2);
            ctx.restore();
          }
        }

        // Draw bar numbers for this tile (skip bar 0 since the loop marker covers it)
        ctx.fillStyle = textColor;
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center';
        for (let bar = 1; bar < arrangement.bars; bar++) {
          const localT16 = bar * arrangement.timeSig.numerator * 4;
          const drawWT = tileLocalToWorldT(localT16, k, loopLengthT);
          if (drawWT === null) continue;
          const bx = wToX(drawWT);
          if (bx < gridLeft - 20 || bx > gridLeft + gridWidth + 20) continue;
          ctx.fillText(`${bar + 1}`, bx, gridTop - 10);
        }
      }

      ctx.restore();
    }

    // Draw chord track (tiled across visible tiles)
    // In Create mode we render interactive chord blocks as HTML overlay elements,
    // so we skip the canvas chord drawing to avoid double-rendering.
    if (!hideChords && mode !== 'create' && display.showChordTrack && arrangement.chords) {
      // Clip chords horizontally so they stop exactly at the visible grid edges.
      // (Chord blocks sit slightly above `gridTop`, so we only clip in X, not Y.)
      ctx.save();
      ctx.beginPath();
      ctx.rect(gridLeft, 0, gridWidth, height);
      ctx.clip();

      const blockHeight = 24;
      const blockY = gridTop - 30;

      for (let k = kStart; k <= kEnd; k++) {
        for (let i = 0; i < arrangement.chords.length; i++) {
          const chord = arrangement.chords[i];
          const isDiatonicChord = arrangement ? isChordDiatonic(chord, arrangement) : true;

          // Convert chord local times to world time for this tile
          const chordStartWT = tileLocalToWorldT(chord.t16, k, loopLengthT);
          const chordEndWT = tileLocalToWorldT(chord.t16 + chord.duration16, k, loopLengthT);
          if (chordStartWT === null || chordEndWT === null) continue;

          const blockStartX = wToX(chordStartWT);
          const blockEndX = wToX(chordEndWT);
          const blockWidth = blockEndX - blockStartX;

          // Skip off-screen blocks
          if (blockEndX < gridLeft - 10 || blockStartX > gridLeft + gridWidth + 10) continue;

          // Draw glass-like rounded block with gap
          const gap = 6;
          const radius = 8;
          const bStartX = blockStartX + gap / 2;
          const bWidth = Math.max(0, blockWidth - gap);

          // Build the main fill gradient
          const gradient = ctx.createLinearGradient(bStartX, blockY, bStartX, blockY + blockHeight);
          if (isDiatonicChord) {
            gradient.addColorStop(0, chordFillTop);
            gradient.addColorStop(1, chordFillBottom);
          } else {
            gradient.addColorStop(0, chordFillTensionTop);
            gradient.addColorStop(1, chordFillTensionBottom);
          }

          // Path for the rounded "chip".
          ctx.beginPath();
          if ((ctx as any).roundRect) {
            (ctx as any).roundRect(bStartX, blockY, bWidth, blockHeight, radius);
          } else {
            ctx.rect(bStartX, blockY, bWidth, blockHeight);
          }

          // 1) Soft drop shadow
          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
          ctx.shadowBlur = 12;
          ctx.shadowOffsetY = 4;
          ctx.fillStyle = gradient;
          ctx.fill();
          ctx.restore();

          // 2) Crisp outer stroke.
          ctx.strokeStyle = isDiatonicChord ? chordStroke : chordStrokeTension;
          ctx.lineWidth = 1.25;
          ctx.stroke();

          // 3) Top "sheen" highlight
          const sheen = ctx.createLinearGradient(0, blockY, 0, blockY + blockHeight);
          sheen.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
          sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0.04)');
          sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.strokeStyle = sheen;
          ctx.lineWidth = 1;
          ctx.stroke();

          // Draw chord text centered in block.
          ctx.save();
          ctx.fillStyle = isDiatonicChord ? chordText : chordTextTension;
          ctx.font = '700 13px system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
          ctx.shadowBlur = 6;
          ctx.fillText(chord.name, blockStartX + blockWidth / 2, blockY + blockHeight / 2);
          ctx.stroke();
        }
      }

      // Pop the chord-track clip rect.
      ctx.restore();
    }

    // 3. Draw contours + nodes + playhead (these are part of the "main grid layer")
    // IMPORTANT: When `onlyChords=true`, this component is being used as a dedicated chord-track overlay
    // that sits on top of the main (masked) grid.
    // In that mode, we must NOT draw contours/nodes/playhead, otherwise they won't receive the fade mask.
    if (!onlyChords) {
      // Clip to the visible grid rectangle so contour lines / nodes / playhead
      // do not render past the left/right grid edge.
      ctx.save();
      ctx.beginPath();
      ctx.rect(gridLeft, gridTop, gridWidth, gridHeight);
      ctx.clip();

      ctx.lineJoin = 'round';

      // 1. Draw recorded pitch traces (behind contours) — tiled across visible tiles
      for (const [voiceId, recording] of recordings.entries()) {
        // Skip drawing the saved trace for the voice currently being recorded.
        // The live trace (drawn below) replaces it during recording.
        // Without this, both traces render simultaneously, causing flickering
        // and wrong-color artifacts.
        if (playback.isRecording && voiceId === livePitchTraceVoiceId) continue;

        const voiceIndex = arrangement.voices.findIndex(v => v.id === voiceId);
        if (voiceIndex === -1) continue;

        const voice = arrangement.voices[voiceIndex];
        const voiceState = voiceStates.find(v => v.voiceId === voiceId);

        // Recorded traces follow the VOX (vocal) mute/solo state.
        const anySoloActive = voiceStates.some(v => v.synthSolo || v.vocalSolo);
        const isVocalMuted = (voiceState?.vocalMuted ?? false) || (anySoloActive && !(voiceState?.vocalSolo ?? false));

        const voiceColor = isVocalMuted
          ? 'rgba(150, 150, 150, 0.4)'
          : (voice.color || getCssVar(`--voice-${voiceIndex + 1}`) || '#ff6b9d');

        // Draw the pitch trace for each visible tile
        for (let k = kStart; k <= kEnd; k++) {
          const tileOffset = k * loopLengthT;
          drawPitchTrace(ctx, recording.pitchTrace, startT16, endT16,
            arrangement.tempo, arrangement.timeSig, gridLeft, gridTop, gridWidth, gridHeight, {
            color: voiceColor,
            lineWidth: 10,
            opacity: isVocalMuted ? 0.2 : 0.4,
            isLive: false,
            effectiveTonicMidi,
            minSemitone,
            maxSemitone,
            worldTimeOffset: tileOffset,
            camLeft,
            pxPerT,
          });
        }
      }

      // 2. Draw live pitch trace (during recording) — tiled across visible tiles
      // This is important in Loop mode so that, as the next repetition (bar 1) scrolls
      // into view near the end of the current loop, you can also see the beginning of
      // the pitch trace you are currently recording.
      if (livePitchTrace.length > 0 && livePitchTraceVoiceId && playback.isRecording) {
        // Use the tagged voiceId (not armedVoiceId) so the color is always
        // correct even if armedVoiceId changes mid-render.
        const voiceIndex = arrangement.voices.findIndex(v => v.id === livePitchTraceVoiceId);
        const voice = voiceIndex >= 0 ? arrangement.voices[voiceIndex] : null;
        const traceColor = voice?.color || getCssVar(`--voice-${voiceIndex + 1}`) || '#ffffff';

        // Draw the same live trace for each visible tile.
        // Because the live trace time axis starts at 0 for the recording,
        // drawing it with `worldTimeOffset = k * loopLengthT` makes the trace
        // appear correctly within each repeated copy of the arrangement.
        for (let k = kStart; k <= kEnd; k++) {
          const tileOffset = k * loopLengthT;
          drawPitchTrace(ctx, livePitchTrace, startT16, endT16,
            arrangement.tempo, arrangement.timeSig, gridLeft, gridTop, gridWidth, gridHeight, {
            color: traceColor,
            lineWidth: 10,
            opacity: 0.8,
            isLive: true,
            effectiveTonicMidi,
            minSemitone,
            maxSemitone,
            worldTimeOffset: tileOffset,
            camLeft,
            pxPerT,
          });
        }
      }

      // 3A. Draw contour lines for each voice — tiled
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Node sizes are shared across voices.
      // We draw *all* contour lines first, then draw *all* nodes afterwards.
      // This guarantees nodes always sit on top.
      const nodeRadius = 12;
      const anchorRadius = nodeRadius * 0.5;

      // Pass A: Contour lines only (including glow) — for each visible tile
      for (let k = kStart; k <= kEnd; k++) {
        const tileOffset = k * loopLengthT;

        for (let voiceIndex = 0; voiceIndex < arrangement.voices.length; voiceIndex++) {
          const voice = arrangement.voices[voiceIndex];
          const voiceState = voiceStates.find(v => v.voiceId === voice.id);

          // Contour lines follow the SYN (synth) mute/solo state.
          const anySoloActive = voiceStates.some(v => v.synthSolo || v.vocalSolo);
          const isSynthMuted = (voiceState?.synthMuted ?? false) || (anySoloActive && !(voiceState?.synthSolo ?? false));

          // Get voice color
          const baseColor = voice.color || getCssVar(`--voice-${voiceIndex + 1}`) || '#ff6b9d';
          const voiceColor = isSynthMuted ? 'rgba(150, 150, 150, 0.4)' : baseColor;
          const glowColor = voiceColor.includes('rgba') ? voiceColor : voiceColor.replace(')', ', 0.5)').replace('rgb', 'rgba');

          // Draw contour with glow effect
          ctx.save();

          // Glow layer - only if not muted
          if (display.glowIntensity > 0 && !isSynthMuted) {
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 10 * display.glowIntensity;
            ctx.strokeStyle = voiceColor;
            ctx.lineWidth = 3;
            drawVoiceContour(ctx, voice, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale, tileOffset, camLeft, pxPerT, gridLeft, loopLengthT);
          }

          // Main line
          ctx.shadowBlur = 0;
          ctx.strokeStyle = voiceColor;
          ctx.lineWidth = 3;
          drawVoiceContour(ctx, voice, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale, tileOffset, camLeft, pxPerT, gridLeft, loopLengthT);
          ctx.restore();
        }
      }

      // Draw playhead above contour lines but below nodes.
      // The playhead is always at the horizontal center of the grid area.
      const playheadX = gridLeft + gridWidth / 2;

      ctx.strokeStyle = playheadColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, gridTop);
      ctx.lineTo(playheadX, gridTop + gridHeight);
      ctx.stroke();

      // Pass B: Nodes on top (for every voice) — tiled
      for (let k = kStart; k <= kEnd; k++) {
        const tileOffset = k * loopLengthT;

        for (let voiceIndex = 0; voiceIndex < arrangement.voices.length; voiceIndex++) {
          const voice = arrangement.voices[voiceIndex];
          const voiceState = voiceStates.find(v => v.voiceId === voice.id);

          // Contour nodes follow the SYN (synth) mute/solo state.
          const anySoloActive = voiceStates.some(v => v.synthSolo || v.vocalSolo);
          const isSynthMuted = (voiceState?.synthMuted ?? false) || (anySoloActive && !(voiceState?.synthSolo ?? false));

          const baseColor = voice.color || getCssVar(`--voice-${voiceIndex + 1}`) || '#ff6b9d';
          const voiceColor = isSynthMuted ? 'rgba(150, 150, 150, 0.4)' : baseColor;

          const nodeStrokeColor = voiceColor;
          const nodeFillColor = isSynthMuted
            ? 'rgba(90, 90, 90, 1)'
            : (baseColor.startsWith('#') ? darkenColor(baseColor, 35) : baseColor);

          for (const node of voice.nodes) {
            // Convert node local time to world time for this tile
            const nodeWorldT = node.t16 + tileOffset;
            if (nodeWorldT < 0) continue; // before time 0
            const x = wToX(nodeWorldT);
            // Skip nodes that are off-screen
            if (x < gridLeft - 20 || x > gridLeft + gridWidth + 20) continue;

            const y = node.semi !== undefined
              ? semitoneOffsetToY(node.semi, minSemitone, maxSemitone, gridTop, gridHeight)
              : degreeToY(node.deg, node.octave || 0, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale);

            // Draw node glow - only if not muted
            if (display.glowIntensity > 0 && !isSynthMuted) {
              ctx.shadowColor = voiceColor;
              ctx.shadowBlur = 8 * display.glowIntensity;
            }

            if (node.term) {
              // Anchor: small filled circle, no stroke, same color as the line.
              const isDraggedAnchor = !!dragState?.isDragging && dragState.voiceId === voice.id && dragState.originalT16 === node.t16;

              if (isDraggedAnchor) {
                // Simple "halo" while dragging: a slightly larger solid circle.
                ctx.save();
                ctx.globalAlpha = 0.35;
                ctx.beginPath();
                ctx.arc(x, y, anchorRadius * 2.2, 0, Math.PI * 2);
                ctx.fillStyle = voiceColor;
                ctx.fill();
                ctx.restore();
              }

              ctx.beginPath();
              ctx.arc(x, y, anchorRadius, 0, Math.PI * 2);
              ctx.fillStyle = voiceColor;
              ctx.fill();

              ctx.shadowBlur = 0;
              continue;
            }

            // Regular node circle with opaque fill
            ctx.beginPath();
            ctx.arc(x, y, nodeRadius, 0, Math.PI * 2);
            ctx.fillStyle = nodeFillColor;
            ctx.fill();
            ctx.strokeStyle = nodeStrokeColor;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.shadowBlur = 0;

            // Scale degree number inside node
            ctx.fillStyle = isSynthMuted ? 'rgba(255, 255, 255, 0.5)' : '#ffffff';
            ctx.font = 'bold 12px system-ui';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(node.semi !== undefined ? semitoneToLabel(node.semi) : String(node.deg), x, y + 0.5);
          }

          // Create mode hover preview ("phantom" node) — only draw once (not per tile)
          if (k === kStart) {
            const isDraggingAnchor = !!dragState?.isDragging && dragState.voiceId === voice.id && !!voice.nodes.find(n => n.term && n.t16 === dragState.originalT16);

            if (mode === 'create' && hoverPreviewRef.current?.voiceId === voice.id && !onlyChords && !isDraggingAnchor) {
              const preview = hoverPreviewRef.current.point;
              // For create-mode hover, use the nearest visible tile to show the preview
              const previewWorldT = preview.t16 + kStart * loopLengthT;
              const px = wToX(previewWorldT);
              const py = preview.semi !== undefined
                ? semitoneOffsetToY(preview.semi, minSemitone, maxSemitone, gridTop, gridHeight)
                : degreeToY(preview.deg, preview.octave, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale);

              ctx.save();
              ctx.globalAlpha = 0.35;

              ctx.beginPath();
              ctx.arc(px, py, nodeRadius, 0, Math.PI * 2);
              ctx.fillStyle = nodeFillColor;
              ctx.fill();

              ctx.strokeStyle = nodeStrokeColor;
              ctx.lineWidth = 1.5;
              ctx.stroke();

              ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
              ctx.font = 'bold 12px system-ui';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(preview.semi !== undefined ? semitoneToLabel(preview.semi) : String(preview.deg), px, py + 0.5);

              ctx.restore();
            }
          }
        }
      }
      ctx.restore();

      // Pop the clip rect.
      ctx.restore();
    }
  }, [arrangement, voiceStates, livePitchTrace, livePitchTraceVoiceId, display, recordings, armedVoiceId, getPitchRange, onlyChords, playback.isRecording, followMode.pxPerT, followMode.pendingWorldT]);

  /**
   * Draw a voice's contour line (now using semitones).
   * Uses follow-mode world-time coordinates for tiled rendering.
   *
   * @param tileOffset - world-time offset for this tile (k * loopLengthT)
   * @param camLeft    - camera left edge in world time
   * @param pxPerT     - pixels per 16th note (horizontal zoom)
   * @param gridLeftPx - left edge of the grid area in CSS pixels
   * @param loopLen    - loop length in 16th notes
   */
  function drawVoiceContour(
    ctx: CanvasRenderingContext2D,
    voice: Voice,
    minSemitone: number,
    maxSemitone: number,
    gridTop: number,
    gridHeight: number,
    scaleType: string,
    tileOffset: number,
    camLeft: number,
    pxPerT: number,
    gridLeftPx: number,
    loopLen: number
  ) {
    if (voice.nodes.length === 0) return;

    // Helper: convert a local t16 to screen X via world time
    const nodeToX = (localT16: number) =>
      gridLeftPx + worldTToScreenX(localT16 + tileOffset, camLeft, pxPerT);

    ctx.beginPath();
    let lastX = 0;
    let lastY = 0;
    let inPhrase = false;

    for (let i = 0; i < voice.nodes.length; i++) {
      const node = voice.nodes[i];

      // Termination node ends the current phrase.
      if (node.term) {
        if (inPhrase) {
          // Draw a horizontal hold segment to the termination time.
          const termX = nodeToX(node.t16);
          ctx.lineTo(termX, lastY);
          ctx.stroke();
          ctx.beginPath();
          inPhrase = false;
        }
        continue;
      }

      const x = nodeToX(node.t16);
      const y = node.semi !== undefined
        ? semitoneOffsetToY(node.semi, minSemitone, maxSemitone, gridTop, gridHeight)
        : degreeToY(node.deg, node.octave || 0, minSemitone, maxSemitone, gridTop, gridHeight, scaleType);

      if (!inPhrase) {
        ctx.moveTo(x, y);
        inPhrase = true;
        lastX = x;
        lastY = y;
        continue;
      }

      // Draw curved connection from previous node to this one
      const nodeRadius = 12;
      const bendWidth = Math.min(40, (x - lastX) * 0.8);
      const bendStartX = x - bendWidth;

      // Draw a straight horizontal line to the start of the bend
      ctx.lineTo(bendStartX, lastY);

      if (Math.abs(y - lastY) < 1) {
        // Same pitch, just draw a straight line
        ctx.lineTo(x, y);
      } else {
        // Pitch changes: enter from bottom if moving up, top if moving down
        const isMovingUp = y < lastY;
        const entryY = isMovingUp ? y + nodeRadius : y - nodeRadius;

        const cp1x = bendStartX + bendWidth * 0.5;
        const cp1y = lastY;
        const cp2x = x;
        const cp2y = lastY;

        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, entryY);
        ctx.lineTo(x, y);
      }

      lastX = x;
      lastY = y;
    }

    if (inPhrase) {
      // If playback is running and there is no terminating anchor,
      // show a dashed line indicating the note holds to the end of the loop.
      if (playbackEngine.getIsPlaying()) {
        // Extend to the end of this tile (loop end for this tile)
        const endX = nodeToX(loopLen);

        // IMPORTANT:
        // We must stroke the contour so far using a solid line BEFORE enabling dashes.
        // Otherwise the dash pattern applies to the entire path and the whole voice
        // appears dashed.
        ctx.stroke();

        // Now draw ONLY the final "hold" extension as a separate dashed segment.
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.setLineDash([6, 6]);
        ctx.lineTo(endX, lastY);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.stroke();
      }
    }
  }

  /**
   * Draw a pitch trace (user recording) with clean, neon glow.
   * Uses follow-mode world-time coordinates for tiled rendering.
   */
  function drawPitchTrace(
    ctx: CanvasRenderingContext2D,
    trace: PitchPoint[],
    _startT16: number,
    _endT16: number,
    tempo: number,
    timeSig: { numerator: number; denominator: number },
    gridLeft: number,
    gridTop: number,
    _gridWidth: number,
    gridHeight: number,
    options: {
      color: string;
      lineWidth: number;
      opacity: number;
      isLive: boolean;
      effectiveTonicMidi: number;
      minSemitone: number;
      maxSemitone: number;
      // Follow-mode parameters: offset the pitch trace by a tile's world time
      worldTimeOffset: number;
      camLeft: number;
      pxPerT: number;
    }
  ) {
    if (trace.length < 2) return;

    const { color, lineWidth, opacity, isLive, effectiveTonicMidi, minSemitone, maxSemitone,
            worldTimeOffset, camLeft: optCamLeft, pxPerT: optPxPerT } = options;

    // Helper: convert a local t16 to screen X via world time
    const traceToX = (localT16: number) =>
      gridLeft + worldTToScreenX(localT16 + worldTimeOffset, optCamLeft, optPxPerT);

    function getPitchY(frequency: number): number {
      // Calibrate against the grid: 
      // 1. Get MIDI pitch of frequency
      const midi = (A4_MIDI + 12 * Math.log2(frequency / A4_FREQUENCY));
      // 2. Convert to semitone offset from EFFECTIVE tonic (including transposition)
      const semitone = midi - effectiveTonicMidi;
      // 3. Map to Y using the shared semitoneToY logic
      return semitoneToY(semitone, minSemitone, maxSemitone, gridTop, gridHeight);
    }

    function drawPath(width: number, alpha: number, blur?: number, composite: GlobalCompositeOperation = 'source-over') {
      ctx.save();
      ctx.beginPath();
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = composite;

      if (blur) {
        ctx.shadowBlur = blur;
        ctx.shadowColor = color;
      }

      let started = false;
      let lastPointTime = -1;

      for (const point of trace) {
        const isGap = !Number.isFinite(point.frequency) || point.frequency <= 0 || (lastPointTime !== -1 && point.time - lastPointTime > 150);

        if (isGap || point.confidence < 0.3) {
          if (started) {
            ctx.stroke();
            ctx.beginPath();
            started = false;
          }
          if (isGap) {
            lastPointTime = point.time;
            continue;
          }
        }

        const sixteenthMs = sixteenthDurationMs(tempo, timeSig);
        const t16 = point.time / sixteenthMs;
        const x = traceToX(t16);
        const y = getPitchY(point.frequency);

        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
        lastPointTime = point.time;
      }

      if (started) {
        ctx.stroke();
      }
      ctx.restore();
    }

    // Pass 1: The Glow Pass (Same method as contour lines)
    // Forced to equivalent of intensity 1 (shadowBlur 10)
    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = color;
    drawPath(lineWidth, opacity * 0.8);
    ctx.restore();

    // Pass 2: The Core Pass (Solid line)
    drawPath(lineWidth, opacity);

    // Live Head Flair (Pulse only, no particles)
    if (isLive) {
      const lastPoint = trace[trace.length - 1];
      if (lastPoint && Number.isFinite(lastPoint.frequency) && lastPoint.frequency > 0) {
        const sixteenthMs = sixteenthDurationMs(tempo, timeSig);
        const t16 = lastPoint.time / sixteenthMs;
        const x = traceToX(t16);
        const y = getPitchY(lastPoint.frequency);

        ctx.save();
        // Bright Pulsing Cursor
        const pulse = Math.sin(Date.now() / 150) * 2 + 8;

        // Glow circle
        const grad = ctx.createRadialGradient(x, y, 0, x, y, pulse * 2.5);
        grad.addColorStop(0, '#fff');
        grad.addColorStop(0.2, color);
        grad.addColorStop(1, 'transparent');

        ctx.fillStyle = grad;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(x, y, pulse * 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Sharp highlight center
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }
    }
  }

  // Keep the latest draw() in a ref so the RAF loop never needs to restart.
  // Restarting the RAF effect on every state change can leak multiple loops,
  // which shows up as flicker (different stale closures drawing alternating frames).
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  // Animation loop for smooth playhead movement
  useEffect(() => {
    let animationId: number;

    const animate = () => {
      drawRef.current();
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, []);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      drawRef.current();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  /**
   * Handle canvas click for placing/removing nodes in create mode.
   */
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // In Create mode, we now commit placement on mouse-up (not on click),
    // so we skip the click handler to avoid double-adding nodes.
    if (skipNextClickRef.current) {
      skipNextClickRef.current = false;
      return;
    }

    // Only handle clicks in create mode
    if (mode !== 'create' || !arrangement) return;

    // Legacy behavior: allow Shift+Click removal.
    // (Placement is handled via mouse down/move/up so you can audition first.)
    if (!e.shiftKey) return;

    const snapped = getSnappedPointFromMouseEvent(e);
    if (!snapped) return;

    const voiceId = selectedVoiceId || arrangement.voices[0]?.id;
    if (!voiceId) return;

    const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
    const startT16 = 0;
    const endT16 = totalT16;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const width = rect.width;
    const height = rect.height;

    const gridLeft = GRID_MARGIN.left;
    const gridTop = GRID_MARGIN.top;
    const gridWidth = width - GRID_MARGIN.left - GRID_MARGIN.right;
    const gridHeight = height - GRID_MARGIN.top - GRID_MARGIN.bottom;

    const { minSemitone, maxSemitone } = getPitchRange();

    const hit = getNodeHitAtMouseEvent(e, voiceId, startT16, endT16, gridLeft, gridTop, gridWidth, gridHeight, minSemitone, maxSemitone);
    if (!hit) return;

    removeNode(voiceId, hit.t16);
  }, [mode, arrangement, selectedVoiceId, removeNode, getSnappedPointFromMouseEvent, getPitchRange, getNodeHitAtMouseEvent]);

  /**
   * Handle double-click to toggle termination status of a node.
   */
  const handleCanvasDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Only handle double-clicks in create mode
    if (mode !== 'create' || !arrangement) return;

    const container = containerRef.current;
    if (!container) return;

    const voiceId = selectedVoiceId || arrangement.voices[0]?.id;
    if (!voiceId) return;

    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const gridLeft = GRID_MARGIN.left;
    const gridTop = GRID_MARGIN.top;
    const gridWidth = width - GRID_MARGIN.left - GRID_MARGIN.right;
    const gridHeight = height - GRID_MARGIN.top - GRID_MARGIN.bottom;

    const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
    const startT16 = 0;
    const endT16 = totalT16;
    const { minSemitone, maxSemitone } = getPitchRange();

    const hit = getNodeHitAtMouseEvent(e, voiceId, startT16, endT16, gridLeft, gridTop, gridWidth, gridHeight, minSemitone, maxSemitone);
    if (hit) {
      // Double-clicking a node toggles anchor state.
      // When turning INTO an anchor, it must inherit the pitch of the previous note.
      if (!hit.term) {
        const voice = arrangement.voices.find((v) => v.id === voiceId);
        if (!voice) return;

        const previousNodes = voice.nodes
          .filter((n) => !n.term && n.t16 < hit.t16)
          .sort((a, b) => a.t16 - b.t16);

        const prev = previousNodes.length > 0 ? previousNodes[previousNodes.length - 1] : null;
        if (!prev) return;

        // Enforce: first note of a phrase can never be an anchor.
        // (No previous note => we returned above.)

        // This conversion creates an anchor at hit.t16 that ends the hold started at `prev`.
        // Only one anchor is allowed per held segment, and it must be the one closest to the note.
        const nextNoteAfterHit = voice.nodes
          .filter((n) => !n.term && n.t16 > hit.t16)
          .sort((a, b) => a.t16 - b.t16)[0];

        const segmentEndT16 = nextNoteAfterHit ? nextNoteAfterHit.t16 : Infinity;

        const existingAnchor = voice.nodes
          .filter((n) => n.term && n.t16 > prev.t16 && n.t16 < segmentEndT16)
          .sort((a, b) => a.t16 - b.t16)[0];

        // If an anchor already exists and it's closer (earlier) than this candidate,
        // do nothing. (Prevents creating "later" anchors that orphan the segment.)
        if (existingAnchor && existingAnchor.t16 < hit.t16) {
          return;
        }

        for (const n of voice.nodes) {
          if (!n.term) continue;
          if (n.t16 <= hit.t16) continue;
          if (n.t16 >= segmentEndT16) continue;
          removeNode(voiceId, n.t16);
        }

        updateNode(voiceId, hit.t16, hit.t16, prev.deg, prev.octave || 0, true, prev.semi);
        return;
      }

      // Turning an anchor back into a normal node: keep its stored pitch.
      updateNode(voiceId, hit.t16, hit.t16, hit.deg, hit.octave || 0, false, hit.semi);
      return;
    }

    // Double-clicking an empty grid point creates a termination (hold end) node.
    // We copy the pitch from the most recent node before that time.
    const snapped = getSnappedPointFromMouseEvent(e);
    if (!snapped) return;

    const voice = arrangement.voices.find((v) => v.id === voiceId);
    if (!voice) return;

    const previousNodes = voice.nodes
      .filter((n) => !n.term && n.t16 <= snapped.t16)
      .sort((a, b) => a.t16 - b.t16);

    const prev = previousNodes.length > 0 ? previousNodes[previousNodes.length - 1] : null;
    if (!prev) return;

    // Remove any later anchors between this parent note and the next note.
    // This ensures there is only one "end of hold" anchor for a held segment,
    // and inserting a closer anchor deletes the older one.
    const nextNote = voice.nodes
      .filter((n) => !n.term && n.t16 > prev.t16)
      .sort((a, b) => a.t16 - b.t16)[0];
    const segmentEndT16 = nextNote ? nextNote.t16 : Infinity;

    const existingAnchor = voice.nodes
      .filter((n) => n.term && n.t16 > prev.t16 && n.t16 < segmentEndT16)
      .sort((a, b) => a.t16 - b.t16)[0];

    // If an anchor already exists and this new one would be later, do nothing.
    // You can only "move" an anchor closer to the note (earlier), not farther away.
    if (existingAnchor && snapped.t16 > existingAnchor.t16) {
      return;
    }

    for (const n of voice.nodes) {
      if (!n.term) continue;
      if (n.t16 <= prev.t16) continue;
      if (n.t16 >= segmentEndT16) continue;
      // Keep only the earliest anchor in the segment.
      // If we're creating a new anchor at snapped.t16, any anchor AFTER it is superseded.
      if (n.t16 <= snapped.t16) continue;
      removeNode(voiceId, n.t16);
    }

    // Use updateNode to "insert" a term node at this time.
    // We pass deg/octave/semi of the previous note so the contour line holds visually.
    updateNode(voiceId, snapped.t16, snapped.t16, prev.deg, prev.octave || 0, true, prev.semi);
  }, [mode, arrangement, selectedVoiceId, updateNode, removeNode, getPitchRange, getNodeHitAtMouseEvent, getSnappedPointFromMouseEvent]);

  /**
   * Handle mouse down for starting node drag in create mode,
   * or for starting a timeline scrub/drag in play mode.
   */
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!arrangement) return;

    // ── Play mode: start a timeline scrub/drag (seek-on-release) ──
    if (mode === 'play') {
      const currentWorldT = playbackEngine.getWorldPositionT16();
      dragStartRef.current = { startX: e.clientX, startWorldT: currentWorldT };
      startTimelineDrag();
      updatePendingWorldT(currentWorldT);
      return;
    }

    if (mode !== 'create') return;

    // If this is the second click of a double-click, don't start auditioning/placing.
    // The `onDoubleClick` handler will take care of the interaction.
    if (e.detail > 1) return;

    // We will handle Create mode placement via mouse down/move/up.
    // Prevent the older `onClick` handler from also firing.
    skipNextClickRef.current = true;

    const snapped = getSnappedPointFromMouseEvent(e);
    if (!snapped) return;

    // Determine voice to edit - use selected voice or first voice.
    const voiceId = selectedVoiceId || arrangement.voices[0]?.id;
    if (!voiceId) return;

    // Auto-select voice if none selected.
    if (!selectedVoiceId) {
      setSelectedVoiceId(voiceId);
    }

    // Update hover preview immediately (so the phantom node appears on press).
    hoverPreviewRef.current = { voiceId, point: snapped };

    const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
    const startT16 = 0;
    const endT16 = totalT16;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const width = rect.width;
    const height = rect.height;

    const gridLeft = GRID_MARGIN.left;
    const gridTop = GRID_MARGIN.top;
    const gridWidth = width - GRID_MARGIN.left - GRID_MARGIN.right;
    const gridHeight = height - GRID_MARGIN.top - GRID_MARGIN.bottom;

    const { minSemitone, maxSemitone } = getPitchRange();

    // Check if clicking on an existing node (pixel-distance hit test).
    const existingNode = getNodeHitAtMouseEvent(e, voiceId, startT16, endT16, gridLeft, gridTop, gridWidth, gridHeight, minSemitone, maxSemitone);

    // Shift+press removes a node immediately.
    if (existingNode && e.shiftKey) {
      removeNode(voiceId, existingNode.t16);
      placingNewNodeRef.current = null;
      auditionRef.current = null;
      playbackEngine.previewSynthRelease(voiceId);
      return;
    }

    // Start the synth preview note (rings while the mouse is held down).
    auditionRef.current = { voiceId };
    if (existingNode?.term) {
      playbackEngine.previewSynthAttack(voiceId, existingNode.deg, existingNode.octave || 0, existingNode.semi);
    } else {
      playbackEngine.previewSynthAttack(voiceId, snapped.deg, snapped.octave, snapped.semi);
    }

    if (existingNode) {
      // Start dragging this existing node.
      if (existingNode.term) {
        const voice = arrangement.voices.find((v) => v.id === voiceId);
        const parent = voice?.nodes
          .filter((n) => !n.term && n.t16 < existingNode.t16)
          .sort((a, b) => a.t16 - b.t16)
          .pop();

        // If there is no previous note, this anchor is invalid; don't allow dragging it.
        if (!parent) {
          return;
        }

        setDragState({ voiceId, originalT16: existingNode.t16, isDragging: true, anchorParentT16: parent.t16 });
      } else {
        setDragState({ voiceId, originalT16: existingNode.t16, isDragging: true });
      }
      placingNewNodeRef.current = null;
      return;
    }

    // Otherwise, we're placing a new node (commit happens on mouse-up).
    placingNewNodeRef.current = { voiceId, point: snapped };
  }, [mode, arrangement, selectedVoiceId, getSnappedPointFromMouseEvent, removeNode, setSelectedVoiceId, getPitchRange, getNodeHitAtMouseEvent]);

  /**
   * Handle mouse move for dragging nodes (Create mode)
   * or scrubbing the timeline (Play mode).
   */
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!arrangement) return;

    // ── Play mode: update pending world time during a drag ──
    if (mode === 'play' && followMode.isDraggingTimeline && dragStartRef.current) {
      const dx = e.clientX - dragStartRef.current.startX;
      // Dragging left → time moves forward (positive delta)
      const dT = dragPixelsToTimeDelta(dx, followMode.pxPerT);
      const newWorldT = Math.max(0, dragStartRef.current.startWorldT + dT);
      updatePendingWorldT(newWorldT);
      return;
    }

    if (mode !== 'create') return;

    const snapped = getSnappedPointFromMouseEvent(e);
    if (!snapped) {
      hoverPreviewRef.current = null;
      setIsHoveringAnchor(false);
      return;
    }

    // Determine voice to preview - use selected voice or first voice.
    const voiceId = selectedVoiceId || arrangement.voices[0]?.id;
    if (!voiceId) return;

    // If we're dragging an anchor, suppress phantom placement previews.
    if (dragState?.isDragging) {
      const voice = arrangement.voices.find((v) => v.id === dragState.voiceId);
      const originalNode = voice?.nodes.find((n) => n.t16 === dragState.originalT16);
      if (originalNode?.term) {
        hoverPreviewRef.current = null;
      }
    }

    if (!dragState?.isDragging) {
      const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
      const startT16 = 0;
      const endT16 = totalT16;

      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const width = rect.width;
        const height = rect.height;

        const gridLeft = GRID_MARGIN.left;
        const gridTop = GRID_MARGIN.top;
        const gridWidth = width - GRID_MARGIN.left - GRID_MARGIN.right;
        const gridHeight = height - GRID_MARGIN.top - GRID_MARGIN.bottom;

        const { minSemitone, maxSemitone } = getPitchRange();
        const hit = getNodeHitAtMouseEvent(e, voiceId, startT16, endT16, gridLeft, gridTop, gridWidth, gridHeight, minSemitone, maxSemitone);
        setIsHoveringAnchor(!!hit?.term);
      }
    }

    // Update hover preview (phantom node) only when not dragging an anchor.
    if (!dragState?.isDragging) {
      hoverPreviewRef.current = { voiceId, point: snapped };
    }

    // If the mouse is held down, glide the preview synth pitch.
    if (auditionRef.current?.voiceId === voiceId) {
      // If we are dragging an anchor, preview pitch should not change vertically.
      if (dragState?.isDragging) {
        const voice = arrangement.voices.find((v) => v.id === dragState.voiceId);
        const originalNode = voice?.nodes.find((n) => n.t16 === dragState.originalT16);
        if (originalNode?.term) {
          playbackEngine.previewSynthGlide(voiceId, originalNode.deg, originalNode.octave || 0, originalNode.semi);
        } else {
          playbackEngine.previewSynthGlide(voiceId, snapped.deg, snapped.octave, snapped.semi);
        }
      } else {
        playbackEngine.previewSynthGlide(voiceId, snapped.deg, snapped.octave, snapped.semi);
      }
    }

    // If we're dragging an existing node, update it to the snapped position.
    if (dragState?.isDragging) {
      const voice = arrangement.voices.find((v) => v.id === dragState.voiceId);
      const originalNode = voice?.nodes.find((n) => n.t16 === dragState.originalT16);

      if (originalNode?.term) {
        // Anchors can move in time only (no pitch changes).
        const parentT16 = dragState.anchorParentT16;

        // Anchor must stay to the right of its parent note by at least one 16th.
        const minT16 = parentT16 !== undefined ? parentT16 + 1 : snapped.t16;
        const clampedT16 = Math.max(snapped.t16, minT16);

        // Do not allow the anchor to move onto an existing non-anchor note.
        const wouldCollideWithNote = voice?.nodes.some((n) => !n.term && n.t16 === clampedT16) ?? false;
        if (wouldCollideWithNote) {
          return;
        }

        updateNode(dragState.voiceId, dragState.originalT16, clampedT16, originalNode.deg, originalNode.octave || 0, true, originalNode.semi);
        setDragState({ ...dragState, originalT16: clampedT16 });
        return;
      }

      updateNode(dragState.voiceId, dragState.originalT16, snapped.t16, snapped.deg, snapped.octave, originalNode?.term, snapped.semi);
      setDragState({ ...dragState, originalT16: snapped.t16 });
      return;
    }

    // If we're placing a NEW node, keep updating its target position until mouse-up commits.
    // (But do NOT do this while dragging an anchor.)
    if (!dragState?.isDragging && placingNewNodeRef.current?.voiceId === voiceId) {
      placingNewNodeRef.current = { voiceId, point: snapped };
    }
  }, [dragState, mode, arrangement, getSnappedPointFromMouseEvent, updateNode, selectedVoiceId, getPitchRange, getNodeHitAtMouseEvent]);

  /**
   * Handle mouse up to end drag.
   * In Play mode this commits the scrub (seek-on-release).
   * In Create mode this commits a new node placement or ends a node drag.
   */
  const handleMouseUp = useCallback(() => {
    // ── Play mode: commit the timeline scrub (seek-on-release) ──
    if (followMode.isDraggingTimeline) {
      const pending = followMode.pendingWorldT;
      if (pending !== null) {
        playbackEngine.seekWorld(pending);
      }
      commitTimelineDrag();
      dragStartRef.current = null;
      return;
    }

    // Commit a new node placement (if we were placing one).
    const placing = placingNewNodeRef.current;
    if (placing && mode === 'create') {
      const voice = arrangement?.voices.find((v) => v.id === placing.voiceId);
      const existingAnchorAtT = voice?.nodes.find((n) => n.t16 === placing.point.t16 && n.term);

      // If there's an anchor at this time, you must convert/delete it first.
      if (!existingAnchorAtT) {
        addNode(placing.voiceId, placing.point.t16, placing.point.deg, placing.point.octave, placing.point.semi);
      }
    }

    placingNewNodeRef.current = null;

    if (dragState?.isDragging) {
      setDragState(null);
    }

    // Stop any audition note.
    const audition = auditionRef.current;
    if (audition) {
      playbackEngine.previewSynthRelease(audition.voiceId);
      auditionRef.current = null;
    }
  }, [dragState, mode, addNode, arrangement, followMode.isDraggingTimeline, followMode.pendingWorldT, commitTimelineDrag]);

  // Follow-mode horizontal zoom action from the store
  const setHorizontalZoom = useAppStore((state) => state.setHorizontalZoom);
  const setMinPxPerT = useAppStore((state) => state.setMinPxPerT);

  /**
   * Keep the store's minPxPerT floor in sync with the current grid width and arrangement.
   * This ensures max zoom-out always shows exactly one full loop.
   * Called on mount, resize, and arrangement change.
   */
  useEffect(() => {
    const updateFloor = () => {
      if (!arrangement) return;
      const container = containerRef.current;
      if (!container) return;
      const gridW = container.getBoundingClientRect().width - GRID_MARGIN.left - GRID_MARGIN.right;
      const loopLenT = arrangement.bars * arrangement.timeSig.numerator * 4;
      if (loopLenT <= 0) return;
      setMinPxPerT(gridW / loopLenT);
    };
    updateFloor();
    window.addEventListener('resize', updateFloor);
    return () => window.removeEventListener('resize', updateFloor);
  }, [arrangement, setMinPxPerT]);

  /**
   * Handle mouse wheel for horizontal zoom.
   * Scrolling up (or pinch-out) zooms in, scrolling down zooms out.
   * Uses Shift as the modifier key to avoid conflicting with browser Ctrl+scroll zoom.
   */
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    // Only zoom when Shift is held (Ctrl conflicts with browser zoom)
    if (!e.shiftKey) return;
    e.preventDefault();

    if (e.deltaY < 0) {
      setHorizontalZoom('in');
    } else if (e.deltaY > 0) {
      setHorizontalZoom('out');
    }
  }, [setHorizontalZoom]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full ${className}`}
    >
      {/*
        Chord Track Editor (Create mode)

        We render chord blocks as HTML on top of the canvas so you can:
        - enable the chord track
        - drag resize handles
        - rename chord labels with a text input
        - delete chords
        - add chords by hovering near the top of the chord lane and clicking the split marker

        The canvas is still used to render chords in Play mode.
      */}
      {!hideChords && mode === 'create' && display.showChordTrack && arrangement && (
        <div className="absolute inset-0 z-30 pointer-events-none">
          <div
            ref={chordLaneRef}
            className="absolute pointer-events-auto overflow-hidden"
            style={{
              left: GRID_MARGIN.left,
              right: GRID_MARGIN.right,
              top: GRID_MARGIN.top - 42,
              height: 48,
            }}
            onClickCapture={(e) => {
              // If the split marker is visible, any click inside the chord lane should
              // trigger the split (even if the user clicked on a chord block).
              if (!arrangement?.chords || arrangement.chords.length === 0) return;
              if (editingChordIndex !== null) return;
              if (chordBoundaryDragRef.current) return;
              if (hoverSplitT16 === null) return;
              if (e.shiftKey) return;

              e.preventDefault();
              e.stopPropagation();
              splitChordAt(hoverSplitT16);
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            onMouseLeave={() => {
              setHoverSplitT16(null);
            }}
            onMouseMove={(e) => {
              if (!arrangement.chords || arrangement.chords.length === 0) {
                setHoverSplitT16(null);
                return;
              }
              if (editingChordIndex !== null) {
                setHoverSplitT16(null);
                return;
              }
              if (chordBoundaryDragRef.current) {
                setHoverSplitT16(null);
                return;
              }

              const rect = chordLaneRef.current?.getBoundingClientRect();
              if (!rect) {
                setHoverSplitT16(null);
                return;
              }

              // Only show the split marker when you hover very near the top of the chord lane.
              // This keeps most of the chord block body free for rename + boundary dragging.
              const visualTopOffsetPx = 12;
              const yFromVisualTop = (e.clientY - rect.top) - visualTopOffsetPx;
              const inTopHoverZone = yFromVisualTop >= -6 && yFromVisualTop <= 2;
              if (!inTopHoverZone) {
                setHoverSplitT16(null);
                return;
              }

              setHoverSplitT16(chordLaneMouseXToT16(e.clientX));
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div
              className="absolute"
              style={{
                left: 0,
                right: 0,
                top: 12,
                height: 24,
              }}
            >
              {(arrangement.chords?.length ?? 0) === 0 ? (
                <button
                  type="button"
                  className="w-full h-full rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs font-semibold"
                  onClick={(e) => {
                    e.stopPropagation();
                    enableChordTrack();
                  }}
                >
                  Enable Chord Track
                </button>
              ) : (
                <>
                  {/* Hover split marker */}
                  {hoverSplitT16 !== null && (() => {
                    const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
                    const leftPct = (hoverSplitT16 / totalT16) * 100;
                    return (
                      <div
                        className="absolute top-0 h-full"
                        style={{
                          left: `${leftPct}%`,
                          transform: 'translateX(-50%)',
                          pointerEvents: 'none',
                        }}
                      >
                        <div className="absolute left-1/2 top-0 -translate-x-1/2 w-px h-full bg-white/25" />
                        <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full border border-white/20 bg-white/10 text-[var(--text-primary)] text-[12px] font-black flex items-center justify-center cursor-pointer">
                          +
                        </div>
                      </div>
                    );
                  })()}

                  {/* Chord blocks */}
                  {arrangement.chords!.map((chord, idx) => {
                  const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
                  const leftPct = (chord.t16 / totalT16) * 100;
                  const widthPct = (chord.duration16 / totalT16) * 100;
                  const isEditing = editingChordIndex === idx;
                  const isDiatonicChord = isChordDiatonic(chord, arrangement);

                  return (
                    <div
                      key={`${chord.t16}-${idx}`}
                      className="absolute top-0 h-full rounded-lg border border-white/10"
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        background: isDiatonicChord
                          ? `linear-gradient(to bottom, var(--chord-fill-top), var(--chord-fill-bottom))`
                          : `linear-gradient(to bottom, var(--chord-fill-tension-top), var(--chord-fill-tension-bottom))`,
                        borderColor: isDiatonicChord ? 'var(--chord-stroke)' : 'var(--chord-stroke-tension)',
                      }}
                      title="Shift+click to delete. Drag edges to stretch or overwrite."
                      onDoubleClick={(evt) => {
                        // Double-click focuses the inline rename input for the clicked chord.
                        evt.stopPropagation();
                        setEditingChordIndex(idx);
                        setEditingChordName(chord.name);
                      }}
                      onClick={(evt) => {
                        // Shift+click removes the chord without needing an X button.
                        evt.stopPropagation();
                        if (evt.shiftKey) {
                          deleteChord(idx);
                        }
                      }}
                    >
                      <div className="absolute inset-0 flex items-center justify-center px-2">
                        {isEditing ? (
                          <input
                            value={editingChordName}
                            autoFocus
                            className={`w-full bg-transparent text-center text-xs font-bold outline-none ${isDiatonicChord ? 'text-[var(--chord-text)]' : 'text-[var(--chord-text-tension)]'}`}
                            onChange={(evt) => setEditingChordName(evt.target.value)}
                            onBlur={() => commitChordNameEdit()}
                            onKeyDown={(evt) => {
                              if (evt.key === 'Enter') {
                                commitChordNameEdit();
                              }
                              if (evt.key === 'Escape') {
                                setEditingChordIndex(null);
                              }
                            }}
                            onClick={(evt) => evt.stopPropagation()}
                          />
                        ) : (
                          <span
                            className={`text-xs font-bold select-none ${isDiatonicChord ? 'text-[var(--chord-text)]' : 'text-[var(--chord-text-tension)]'}`}
                            style={{ textShadow: '0 2px 6px rgba(0,0,0,0.35)' }}
                            title="Double-click to rename. Hover near the top and click to split."
                          >
                            {chord.name}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Boundary resize handles (between chords) */}
                {arrangement.chords!.slice(0, -1).map((chord, idx) => {
                  const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
                  const boundaryT16 = chord.t16 + chord.duration16;
                  const boundaryPct = (boundaryT16 / totalT16) * 100;
                  return (
                    <div
                      key={`boundary-${idx}-${boundaryT16}`}
                      className="absolute top-0 h-full"
                      style={{
                        left: `calc(${boundaryPct}% - 6px)`,
                        width: 12,
                        cursor: 'col-resize',
                      }}
                      title="Drag to resize chord boundary"
                      onMouseDown={(evt) => {
                        evt.preventDefault();
                        evt.stopPropagation();
                        chordBoundaryDragRef.current = { leftChordIndex: idx };
                      }}
                      onClick={(evt) => {
                        evt.stopPropagation();
                      }}
                    >
                      <div className="mx-auto h-full w-px bg-white/20" />
                    </div>
                  );
                })}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full ${
          mode === 'create'
            ? (dragState?.isDragging ? 'cursor-grabbing' : (isHoveringAnchor ? 'cursor-grab' : 'cursor-crosshair'))
            : (followMode.isDraggingTimeline ? 'cursor-grabbing' : 'cursor-grab')
        }`}
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onMouseLeave={() => {
          hoverPreviewRef.current = null;
          handleMouseUp();
        }}
      />
    </div>
  );
}

export default Grid;
