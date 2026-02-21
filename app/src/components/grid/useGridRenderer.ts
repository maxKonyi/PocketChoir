import { useCallback } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { Arrangement, PitchPoint, Recording } from '../../types';
import { useAppStore } from '../../stores/appStore';
import {
  degreeToSemitoneOffset,
  SCALE_PATTERNS,
  semitoneToLabel,
  semitoneToLetterName,
  semitoneToSolfege,
} from '../../utils/music';
import { darkenColor } from '../../utils/colors';
import { playbackEngine } from '../../services/PlaybackEngine';
import {
  cameraLeftWorldT,
  getGridLOD,
  tileLocalToWorldT,
  worldTToScreenX,
} from '../../utils/followCamera';
import { getCameraCenterWorldT } from '../../utils/cameraState';
import type { ContourStackLookup } from './gridContourUtils';
import { drawPitchTrace, drawVoiceContour } from './gridCanvasRenderers';
import {
  type LyricHoldSpan,
  type LyricUiEntry,
  degreeToY,
  isChordDiatonic,
  lightenCssColorTowardWhite,
  localT16ToNearestWorldT,
  semitoneToY,
} from './gridDataUtils';
import type { useUnisonContourDialKit } from './UnisonContourDialKit';

type GridMode = 'play' | 'create';
type GridLabelFormat = 'degree' | 'solfege' | 'noteName';

type GridVoiceStateLike = {
  voiceId: string;
  synthMuted: boolean;
  synthSolo: boolean;
  vocalMuted: boolean;
  vocalSolo: boolean;
};

type GridDisplayLike = {
  showChordTrack: boolean;
  showLyricsTrack: boolean;
  showNoteLabels: boolean;
  labelFormat: GridLabelFormat;
  noteSize: number;
  lineThickness: number;
  glowIntensity: number;
  gridOpacity: number;
  snapCameraToPixels: boolean;
};

type GridCssColors = {
  barLine: string;
  beatLine: string;
  subdivLine: string;
  pitchLineTonic: string;
  pitchLine: string;
  playhead: string;
  text: string;
  chordFillTop: string;
  chordFillBottom: string;
  chordFillTensionTop: string;
  chordFillTensionBot: string;
  chordStroke: string;
  chordStrokeTension: string;
  chordText: string;
  chordTextTension: string;
  voiceFallback: string[];
};

type CanvasMetrics = {
  dpr: number;
  cssWidth: number;
  cssHeight: number;
  gridLeft: number;
  gridTop: number;
  gridWidth: number;
  gridHeight: number;
};

type SnappedGridPoint = {
  t16: number;
  deg: number;
  octave: number;
  semi?: number;
};

type HoverPreviewState = {
  voiceId: string;
  point: SnappedGridPoint;
};

type MarqueeState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additive: boolean;
};

type DragStateLike = {
  voiceId: string;
  originalT16: number;
  isDragging: boolean;
  anchorParentT16?: number;
};

type PitchRangeResult = {
  minSemitone: number;
  maxSemitone: number;
  minFreq: number;
  maxFreq: number;
  effectiveTonicMidi: number;
};

type GridLine = {
  t16: number;
  type: 'bar' | 'beat' | 'subdivision';
};

type UseGridRendererParams = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvasMetricsRef: MutableRefObject<CanvasMetrics | null>;
  updateCanvasMetrics: () => void;
  arrangement: Arrangement | null;
  cssColors: GridCssColors;
  getPitchRange: () => PitchRangeResult;
  followModePxPerT: number;
  followModePendingWorldT: number | null;
  visualWorldTRef: MutableRefObject<number | null>;
  display: GridDisplayLike;
  hideChords: boolean;
  onlyChords: boolean;
  mode: GridMode;
  isPlaying: boolean;
  loopEnabled: boolean;
  voiceStates: GridVoiceStateLike[];
  recordings: Map<string, Recording>;
  isRecording: boolean;
  livePitchTrace: PitchPoint[];
  livePitchTraceVoiceId: string | null;
  contourStackLookup: ContourStackLookup;
  selectedVoiceId: string | null;
  hoveredContourVoiceIdRef: MutableRefObject<string | null>;
  shadowMaskCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  shadowCompositeCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  dragState: DragStateLike | null;
  nodeFlashStartMsRef: MutableRefObject<Map<string, number>>;
  transposition: number;
  voice1MelodyNodes: Array<{ t16: number }>;
  lyricEntryByT16: Map<number, LyricUiEntry>;
  lyricHoldSpans: LyricHoldSpan[];
  hiddenLyricNodeTimes: Set<number>;
  memoizedGridLines: GridLine[];
  hoverPreviewRef: MutableRefObject<HoverPreviewState | null>;
  marqueeRef: MutableRefObject<MarqueeState | null>;
  unisonDialKitParams?: ReturnType<typeof useUnisonContourDialKit>;
};

/**
 * Extracted draw orchestration hook for Grid.
 *
 * This hook returns the exact same `draw` callback logic that previously lived
 * in Grid.tsx. It keeps render pass order unchanged so visual behavior remains
 * identical while reducing Grid.tsx size.
 */
export function useGridRenderer({
  canvasRef,
  canvasMetricsRef,
  updateCanvasMetrics,
  arrangement,
  cssColors,
  getPitchRange,
  followModePxPerT,
  followModePendingWorldT,
  visualWorldTRef,
  display,
  hideChords,
  onlyChords,
  mode,
  isPlaying,
  loopEnabled,
  voiceStates,
  recordings,
  isRecording,
  livePitchTrace,
  livePitchTraceVoiceId,
  contourStackLookup,
  selectedVoiceId,
  hoveredContourVoiceIdRef,
  shadowMaskCanvasRef,
  shadowCompositeCanvasRef,
  dragState,
  nodeFlashStartMsRef,
  transposition,
  voice1MelodyNodes,
  lyricEntryByT16,
  lyricHoldSpans,
  hiddenLyricNodeTimes,
  memoizedGridLines,
  hoverPreviewRef,
  marqueeRef,
  unisonDialKitParams,
}: UseGridRendererParams): () => void {
  // Use passed DialKit parameters (from App.tsx) instead of calling hook here
  // This ensures only ONE DialKit panel is created at the root level
  return useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Ensure we have up-to-date canvas metrics.
    // In normal operation this is updated by ResizeObserver + window resize.
    if (!canvasMetricsRef.current) {
      updateCanvasMetrics();
    }

    const metrics = canvasMetricsRef.current;
    if (!metrics) return;

    // Handle high DPI displays
    // IMPORTANT: We must reset the transform each frame.
    // If we call `ctx.scale(dpr, dpr)` repeatedly without resetting, the scale accumulates,
    // which makes drawings (and mouse hit-testing) feel offset.
    const dpr = metrics.dpr;

    // Clear in device pixels with identity transform.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw in CSS pixels with a single DPR transform.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = metrics.cssWidth;
    const height = metrics.cssHeight;

    // Grid area (with margins for labels)
    const gridLeft = metrics.gridLeft;
    const gridTop = metrics.gridTop;
    const gridWidth = metrics.gridWidth;
    const gridHeight = metrics.gridHeight;

    // Read colors from the cached CSS variables (refreshed only on theme/display change).
    const barLineColor = cssColors.barLine;
    const beatLineColor = cssColors.beatLine;
    const subdivLineColor = cssColors.subdivLine;
    const pitchLineTonicColor = cssColors.pitchLineTonic;
    const pitchLineColor = cssColors.pitchLine;
    const playheadColor = cssColors.playhead;
    const textColor = cssColors.text;
    const chordFillTop = cssColors.chordFillTop;
    const chordFillBottom = cssColors.chordFillBottom;
    const chordFillTensionTop = cssColors.chordFillTensionTop;
    const chordFillTensionBottom = cssColors.chordFillTensionBot;
    const chordStroke = cssColors.chordStroke;
    const chordStrokeTension = cssColors.chordStrokeTension;
    const chordText = cssColors.chordText;
    const chordTextTension = cssColors.chordTextTension;

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
    const pxPerT = followModePxPerT;

    // ── Camera center ("worldT") and playhead position ──
    //
    // In Create mode the camera is independent (user pans with right-click).
    // In Play mode the Smart Cam decides the camera center each frame
    // and stores it in the cameraState module.  The playhead may NOT be at
    // the viewport center (static states let it drift).
    //
    // We track both:
    //   worldT       – camera center (determines what the viewport shows)
    //   playheadWorldT – actual transport position (for drawing the playhead line)
    const engineWorldT = playbackEngine.getWorldPositionT16();
    const visualWorldT = visualWorldTRef.current ?? engineWorldT;

    // Playhead position (always the transport position, used for the playhead line)
    const playheadWorldT = followModePendingWorldT !== null
      ? followModePendingWorldT
      : visualWorldT;

    // Camera center — single source of truth from cameraState module.
    // In Play mode, both the main grid AND the chord overlay read from
    // getCameraCenterWorldT(), so they are always perfectly synchronized.
    // During a pending seek drag, override with the drag position.
    const worldT = followModePendingWorldT !== null
      ? followModePendingWorldT
      : getCameraCenterWorldT();

    // Camera left edge in world time (may be negative near the start).
    const camLeft = cameraLeftWorldT(worldT, gridWidth, pxPerT);

    // NOTE:
    // - If snapCameraToPixels is ON, we quantize the camera to device pixels.
    //   This reduces shimmer in thin lines but can create subtle micro-lurching.
    // - If snapCameraToPixels is OFF, motion is perfectly continuous, but thin
    //   lines may shimmer slightly at some zoom levels.
    const camLeftSnapped = display.snapCameraToPixels
      ? (Math.round(camLeft * pxPerT * dpr) / dpr) / pxPerT
      : camLeft;

    // Use fresh loop state (from the store) so dragging loop handles updates the
    // canvas immediately (the RAF draw loop will pick up new values without
    // needing a React re-render).
    const pb = useAppStore.getState().playback;
    const loopEnabledNow = pb.loopEnabled;
    const loopStartNow = pb.loopStart;
    const loopEndNow = pb.loopEnd;

    // DAW-style: always draw tile 0 only — no tiling.
    const kStart = 0;
    const kEnd = 0;

    // Helper: convert a world-time value to a screen X pixel inside the grid area.
    const wToX = (wt: number) => gridLeft + worldTToScreenX(wt, camLeftSnapped, pxPerT);

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
        const scalePattern = SCALE_PATTERNS[arrangement.scale] || SCALE_PATTERNS.major;
        const isDiatonic = scalePattern.includes(noteInScale);

        // Only draw grid lines for diatonic notes
        if (!isDiatonic) continue;

        const y = semitoneToY(semi, minSemitone, maxSemitone, gridTop, gridHeight);

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
      }

      // Restore after pitch lines so subsequent passes (bar/beat/subdivision, chords,
      // contours, etc.) are not affected by display.gridOpacity.
      ctx.restore();
    }

    // ── Tiled vertical grid lines ──
    // Draw grid lines for every visible tile (seamless infinite looping).
    // These should only be drawn on the MAIN grid layer.
    // The chord-only overlay layer must remain clean so it doesn't cover contours
    // or bypass the vertical (top/bottom) fade.
    if (!onlyChords) {
      // Apply the same gridOpacity that controls the horizontal pitch lines,
      // so the Display Settings slider affects ALL grid lines uniformly.
      ctx.save();
      ctx.globalAlpha = display.gridOpacity;

      // Uses the memoized array (only recomputed when bars/timeSig change).
      const gridLines = memoizedGridLines;

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

      // Restore after vertical grid lines so subsequent passes (chords, contours,
      // playhead, etc.) are not affected by display.gridOpacity.
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
          const isDiatonicChord = isChordDiatonic(chord, arrangement);

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
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(bStartX, blockY, bWidth, blockHeight, radius);
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

          // 3) Top sheen highlight
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
          ctx.restore(); // Must match the ctx.save() for chord text above!
        }
      }

      // Pop the chord-track clip rect.
      ctx.restore();
    }

    // 3. Draw contours + nodes + playhead (these are part of the main grid layer)
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

      // Pre-compute once: is ANY voice soloed? Used by mute/solo logic below.
      const anySoloActive = voiceStates.some((v) => v.synthSolo || v.vocalSolo);

      // 1. Draw recorded pitch traces (behind contours) — tiled across visible tiles
      for (const [voiceId, recording] of recordings.entries()) {
        // Skip drawing the saved trace for the voice currently being recorded.
        // The live trace (drawn below) replaces it during recording.
        // Without this, both traces render simultaneously, causing flickering
        // and wrong-color artifacts.
        if (isRecording && voiceId === livePitchTraceVoiceId) continue;

        const voiceIndex = arrangement.voices.findIndex((v) => v.id === voiceId);
        if (voiceIndex === -1) continue;

        const voice = arrangement.voices[voiceIndex];
        const voiceState = voiceStates.find((v) => v.voiceId === voiceId);

        // Recorded traces follow the VOX (vocal) mute/solo state.
        const isVocalMuted = (voiceState?.vocalMuted ?? false) || (anySoloActive && !(voiceState?.vocalSolo ?? false));

        const voiceColor = isVocalMuted
          ? 'rgba(150, 150, 150, 0.4)'
          : (voice.color || cssColors.voiceFallback[voiceIndex] || '#ff6b9d');

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
            camLeft: camLeftSnapped,
            pxPerT,
          });
        }
      }

      // 2. Draw live pitch trace (during recording) — tiled across visible tiles
      // This is important in Loop mode so that, as the next repetition (bar 1) scrolls
      // into view near the end of the current loop, you can also see the beginning of
      // the pitch trace you are currently recording.
      if (livePitchTrace.length > 0 && livePitchTraceVoiceId && isRecording) {
        // Use the tagged voiceId (not armedVoiceId) so the color is always
        // correct even if armedVoiceId changes mid-render.
        const voiceIndex = arrangement.voices.findIndex((v) => v.id === livePitchTraceVoiceId);
        const voice = voiceIndex >= 0 ? arrangement.voices[voiceIndex] : null;
        const traceColor = voice?.color || cssColors.voiceFallback[voiceIndex] || '#ffffff';

        // Compute the playhead screen X from the actual transport position.
        // In follow states the playhead is near viewport center; in static
        // states it can drift to either side.
        const playheadXUnsnapped = gridLeft + worldTToScreenX(playheadWorldT, camLeftSnapped, pxPerT);
        const playheadX = Math.round(playheadXUnsnapped * dpr) / dpr;

        // Identify which tile the playhead is currently in, so we only draw ONE head flare.
        // (The trace itself still renders on every tile so looping looks continuous.)
        // Use playheadWorldT (transport position), NOT worldT (camera center).
        const playheadTile = loopLengthT > 0
          ? Math.floor(Math.max(0, playheadWorldT) / loopLengthT)
          : 0;

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
            isLive: k === playheadTile,
            effectiveTonicMidi,
            minSemitone,
            maxSemitone,
            worldTimeOffset: tileOffset,
            camLeft: camLeftSnapped,
            pxPerT,
            headXOverride: k === playheadTile ? playheadX : undefined,
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
      const nodeRadius = 12 * display.noteSize;
      const anchorRadius = nodeRadius * 0.5;

      // Rendering order rule:
      // - Default: sidebar top voice should render on top, so we draw from bottom -> top.
      // - Create mode: actively edited voice (selectedVoiceId) is forced to top.
      const voiceRenderOrder = arrangement.voices.map((_, idx) => idx).reverse();
      if (mode === 'create' && selectedVoiceId) {
        const selectedIdx = arrangement.voices.findIndex((v) => v.id === selectedVoiceId);
        if (selectedIdx >= 0) {
          const withoutSelected = voiceRenderOrder.filter((idx) => idx !== selectedIdx);
          voiceRenderOrder.length = 0;
          voiceRenderOrder.push(...withoutSelected, selectedIdx);
        }
      }
      // Pass A: Contour lines only (including glow) — for each visible tile
      // Hovering any contour temporarily expands stacked lines so users can inspect
      // which voices are currently in a unison stack.
      const splitStackedContours = hoveredContourVoiceIdRef.current !== null;
      for (let k = kStart; k <= kEnd; k++) {
        const tileOffset = k * loopLengthT;

        for (const voiceIndex of voiceRenderOrder) {
          const voice = arrangement.voices[voiceIndex];
          const voiceState = voiceStates.find((v) => v.voiceId === voice.id);

          // Contour lines follow the SYN (synth) mute/solo state.
          const isSynthMuted = (voiceState?.synthMuted ?? false) || (anySoloActive && !(voiceState?.synthSolo ?? false));

          // Get voice color
          const baseColor = voice.color || cssColors.voiceFallback[voiceIndex] || '#ff6b9d';
          const voiceColor = isSynthMuted ? 'rgba(150, 150, 150, 0.4)' : baseColor;
          const glowColor = voiceColor.includes('rgba') ? voiceColor : voiceColor.replace(')', ', 0.5)').replace('rgb', 'rgba');

          // Contour lines get thicker when the mouse hovers over them (play mode only).
          const isHoveredContour = hoveredContourVoiceIdRef.current === voice.id;
          const baseContourWidth = 3 * display.lineThickness;
          const contourLineWidth = isHoveredContour ? baseContourWidth * 1.67 : baseContourWidth;
          const voiceSegmentStackMap = contourStackLookup.get(voice.id);

          // Draw contour with glow effect
          ctx.save();

          // Glow layer - only if not muted
          if (display.glowIntensity > 0 && !isSynthMuted) {
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 10 * display.glowIntensity;
            ctx.strokeStyle = voiceColor;
            ctx.lineWidth = contourLineWidth;
            drawVoiceContour(ctx, voice, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale, tileOffset, camLeftSnapped, pxPerT, gridLeft, loopLengthT, voiceSegmentStackMap, baseContourWidth, splitStackedContours, voiceColor, display.noteSize, unisonDialKitParams);
          }

          // Main line
          ctx.shadowBlur = 0;
          ctx.strokeStyle = voiceColor;
          ctx.lineWidth = contourLineWidth;
          drawVoiceContour(ctx, voice, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale, tileOffset, camLeftSnapped, pxPerT, gridLeft, loopLengthT, voiceSegmentStackMap, baseContourWidth, splitStackedContours, voiceColor, display.noteSize, unisonDialKitParams);
          ctx.restore();
        }
      }

      // Pass A.5: Node radial shadows projected onto contours only.
      // We render shadows into an offscreen layer, then mask it with a contour-only
      // alpha mask so the darkening affects contour lines but NOT nodes/background.
      const ensureOffscreenCanvas = (
        canvasRefObj: MutableRefObject<HTMLCanvasElement | null>
      ): HTMLCanvasElement => {
        if (!canvasRefObj.current) {
          canvasRefObj.current = document.createElement('canvas');
        }
        const offscreen = canvasRefObj.current;
        if (offscreen.width !== canvas.width || offscreen.height !== canvas.height) {
          offscreen.width = canvas.width;
          offscreen.height = canvas.height;
        }
        return offscreen;
      };

      const shadowMaskCanvas = ensureOffscreenCanvas(shadowMaskCanvasRef);
      const shadowCompositeCanvas = ensureOffscreenCanvas(shadowCompositeCanvasRef);
      const maskCtx = shadowMaskCanvas.getContext('2d');
      const shadowCtx = shadowCompositeCanvas.getContext('2d');

      if (maskCtx && shadowCtx) {
        // 1) Build contour mask layer (only contour pixels are opaque).
        maskCtx.setTransform(1, 0, 0, 1, 0, 0);
        maskCtx.clearRect(0, 0, shadowMaskCanvas.width, shadowMaskCanvas.height);
        maskCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        maskCtx.save();
        maskCtx.beginPath();
        maskCtx.rect(gridLeft, gridTop, gridWidth, gridHeight);
        maskCtx.clip();
        maskCtx.lineCap = 'round';
        maskCtx.lineJoin = 'round';
        maskCtx.strokeStyle = '#ffffff';

        for (let k = kStart; k <= kEnd; k++) {
          const tileOffset = k * loopLengthT;
          for (const voiceIndex of voiceRenderOrder) {
            const voice = arrangement.voices[voiceIndex];
            const isHoveredContour = hoveredContourVoiceIdRef.current === voice.id;
            const baseContourWidth = 3 * display.lineThickness;
            const contourLineWidth = isHoveredContour ? baseContourWidth * 1.67 : baseContourWidth;
            const voiceSegmentStackMap = contourStackLookup.get(voice.id);

            maskCtx.lineWidth = contourLineWidth;
            drawVoiceContour(maskCtx, voice, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale, tileOffset, camLeftSnapped, pxPerT, gridLeft, loopLengthT, voiceSegmentStackMap, baseContourWidth, splitStackedContours, '#ffffff', display.noteSize, unisonDialKitParams);
          }
        }
        maskCtx.restore();

        // 2) Draw radial shadows at node positions.
        shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
        shadowCtx.clearRect(0, 0, shadowCompositeCanvas.width, shadowCompositeCanvas.height);
        shadowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        shadowCtx.save();
        shadowCtx.beginPath();
        shadowCtx.rect(gridLeft, gridTop, gridWidth, gridHeight);
        shadowCtx.clip();

        // Multiple voices can share the same rendered node position.
        // To avoid stacking several identical radial fills on top of each other,
        // we keep one shadow entry per screen position and draw it once.
        const shadowByPosition = new Map<string, { x: number; y: number; radius: number }>();

        for (let k = kStart; k <= kEnd; k++) {
          const tileOffset = k * loopLengthT;
          for (const voice of arrangement.voices) {
            for (const node of voice.nodes) {
              const nodeWorldT = node.t16 + tileOffset;
              if (nodeWorldT < 0) continue;
              const x = wToX(nodeWorldT);
              if (x < gridLeft - 30 || x > gridLeft + gridWidth + 30) continue;

              const y = node.semi !== undefined
                ? semitoneToY(node.semi, minSemitone, maxSemitone, gridTop, gridHeight)
                : degreeToY(node.deg ?? 0, node.octave || 0, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale);

              const nodeShadowRadius = node.term ? anchorRadius * 2.6 : nodeRadius * 2.1;
              const shadowKey = `${Math.round(x * 10)}:${Math.round(y * 10)}`;
              const existingShadow = shadowByPosition.get(shadowKey);

              if (!existingShadow) {
                shadowByPosition.set(shadowKey, { x, y, radius: nodeShadowRadius });
                continue;
              }

              // Keep the widest radius so mixed node types at one position still
              // produce a shadow large enough to cover the visible node marker.
              if (nodeShadowRadius > existingShadow.radius) {
                existingShadow.radius = nodeShadowRadius;
              }
            }
          }
        }

        for (const { x, y, radius } of shadowByPosition.values()) {
          const shadowGradient = shadowCtx.createRadialGradient(
            x,
            y,
            0,
            x,
            y,
            radius
          );
          shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0.100)');
          shadowGradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.60)');
          shadowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

          shadowCtx.fillStyle = shadowGradient;
          shadowCtx.beginPath();
          shadowCtx.arc(x, y, radius, 0, Math.PI * 2);
          shadowCtx.fill();
        }
        shadowCtx.restore();

        // 3) Keep shadow only where contours exist.
        shadowCtx.save();
        shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
        shadowCtx.globalCompositeOperation = 'destination-in';
        shadowCtx.drawImage(shadowMaskCanvas, 0, 0);
        shadowCtx.restore();

        // 4) Composite shadow onto main canvas before nodes draw.
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = 0.95;
        ctx.drawImage(shadowCompositeCanvas, 0, 0);
        ctx.restore();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Pass A.6: Playhead pulse illumination — clipped to contour shapes.
        // Uses the contour mask from step 1 to confine the effect to the lines.
        if (isPlaying) {
          const playheadScreenX = gridLeft + worldTToScreenX(playheadWorldT, camLeftSnapped, pxPerT);

          // Reuse the shadow composite canvas for the energy layer.
          shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
          shadowCtx.clearRect(0, 0, shadowCompositeCanvas.width, shadowCompositeCanvas.height);
          shadowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          shadowCtx.save();
          shadowCtx.beginPath();
          shadowCtx.rect(gridLeft, gridTop, gridWidth, gridHeight);
          shadowCtx.clip();

          // A) Playhead illumination — a comet-tail glow trailing behind the playhead.
          const glowReach = 80 + 20 * display.lineThickness;
          const pulseGrad = shadowCtx.createLinearGradient(
            playheadScreenX - glowReach, 0,
            playheadScreenX, 0
          );
          pulseGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
          pulseGrad.addColorStop(0.65, 'rgba(255, 255, 255, 0.4)');
          pulseGrad.addColorStop(1, 'rgba(255, 255, 255, 1.0)');
          shadowCtx.fillStyle = pulseGrad;

          // Only draw to the left of the playhead for a hard cutoff right at the line
          const drawWidth = Math.max(0, playheadScreenX - gridLeft);
          shadowCtx.fillRect(gridLeft, gridTop, drawWidth, gridHeight);

          shadowCtx.restore();

          // Clip energy layer to contour shapes only.
          shadowCtx.save();
          shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
          shadowCtx.globalCompositeOperation = 'destination-in';
          shadowCtx.drawImage(shadowMaskCanvas, 0, 0);
          shadowCtx.restore();

          // Composite energy onto main canvas with additive (screen) blending.
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalCompositeOperation = 'screen';
          ctx.drawImage(shadowCompositeCanvas, 0, 0);
          ctx.restore();
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
      }

      // Draw playhead above contour lines but below nodes.
      // In follow states the playhead is near viewport center;
      // in static states it can be anywhere on screen.
      const playheadXUnsnapped = gridLeft + worldTToScreenX(playheadWorldT, camLeftSnapped, pxPerT);
      const playheadX = Math.round(playheadXUnsnapped * dpr) / dpr;

      ctx.strokeStyle = playheadColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, gridTop);
      ctx.lineTo(playheadX, gridTop + gridHeight);
      ctx.stroke();

      // Pass B: Nodes on top (for every voice) — tiled
      for (let k = kStart; k <= kEnd; k++) {
        const tileOffset = k * loopLengthT;

        for (const voiceIndex of voiceRenderOrder) {
          const voice = arrangement.voices[voiceIndex];
          const voiceState = voiceStates.find((v) => v.voiceId === voice.id);

          // Contour nodes follow the SYN (synth) mute/solo state.
          const isSynthMuted = (voiceState?.synthMuted ?? false) || (anySoloActive && !(voiceState?.synthSolo ?? false));

          const baseColor = voice.color || cssColors.voiceFallback[voiceIndex] || '#ff6b9d';
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
              ? semitoneToY(node.semi, minSemitone, maxSemitone, gridTop, gridHeight)
              : degreeToY(node.deg ?? 0, node.octave || 0, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale);

            // Draw node glow - only if not muted
            if (display.glowIntensity > 0 && !isSynthMuted) {
              ctx.shadowColor = voiceColor;
              ctx.shadowBlur = 8 * display.glowIntensity;
            }

            if (node.term) {
              // Anchor: small filled circle, no stroke, same color as the line.
              const isDraggedAnchor = !!dragState?.isDragging && dragState.voiceId === voice.id && dragState.originalT16 === node.t16;

              if (isDraggedAnchor) {
                // Simple halo while dragging: a slightly larger solid circle.
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

            // Playback flash:
            // When the playhead triggers this node's synth event, we briefly thicken
            // and lighten the stroke toward white, then fade back to normal.
            // IMPORTANT:
            // Use world time so only this specific tiled copy flashes.
            const flashKey = `${voice.id}:${node.t16}`;
            const flashStartMs = nodeFlashStartMsRef.current.get(flashKey);
            const nowMs = window.performance.now();

            // These timings mirror the old IndexOLD.html behavior:
            // 200ms rise (instant hold at peak) + 1000ms decay.
            // NOTE:
            // The old behavior included a noticeable full hold. For the newer
            // feel you asked for (fast initial falloff, slow tail), we use a short
            // attack ramp and then start the decay immediately.
            const FLASH_ATTACK_MS = 35;
            const FLASH_DECAY_MS = 2000;
            const flashAgeMs = flashStartMs !== undefined ? (nowMs - flashStartMs) : Infinity;

            let flashIntensity = 0;
            if (flashAgeMs >= 0 && flashAgeMs <= (FLASH_ATTACK_MS + FLASH_DECAY_MS)) {
              if (flashAgeMs <= FLASH_ATTACK_MS) {
                // Quick ramp up to avoid a harsh single-frame jump.
                flashIntensity = Math.max(0, Math.min(1, flashAgeMs / FLASH_ATTACK_MS));
              } else {
                // Exponential-style decay: fast initial falloff, slow tail.
                // Larger DECAY_K = faster drop.
                const DECAY_K = 4;
                const decay01 = (flashAgeMs - FLASH_ATTACK_MS) / FLASH_DECAY_MS;
                flashIntensity = Math.exp(-DECAY_K * decay01);
              }
            } else if (flashStartMs !== undefined && flashAgeMs > (FLASH_ATTACK_MS + FLASH_DECAY_MS)) {
              // Cleanup so the map doesn't grow unbounded during long playback.
              nodeFlashStartMsRef.current.delete(flashKey);
            }

            const baseStrokeWidth = 1.5;
            const flashStrokeWidth = baseStrokeWidth + flashIntensity * 3;
            const flashStrokeColor = flashIntensity > 0
              ? lightenCssColorTowardWhite(nodeStrokeColor, 0.4 * flashIntensity)
              : nodeStrokeColor;

            ctx.strokeStyle = flashStrokeColor;
            ctx.lineWidth = flashStrokeWidth;
            ctx.stroke();

            ctx.shadowBlur = 0;

            // Note label inside node (controlled by showNoteLabels toggle)
            if (display.showNoteLabels) {
              const labelFontSize = Math.round(12 * display.noteSize);
              ctx.fillStyle = isSynthMuted ? 'rgba(255, 255, 255, 0.5)' : '#ffffff';
              ctx.font = `bold ${labelFontSize}px system-ui`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';

              // Determine label text based on labelFormat setting
              let labelText: string;
              if (node.semi !== undefined) {
                // Node stored as raw semitone offset
                if (display.labelFormat === 'solfege') {
                  labelText = semitoneToSolfege(node.semi);
                } else if (display.labelFormat === 'noteName') {
                  labelText = semitoneToLetterName(node.semi, arrangement.tonic || 'C', transposition);
                } else {
                  labelText = semitoneToLabel(node.semi);
                }
              } else {
                // Node stored as scale degree
                const deg = node.deg ?? 0;
                if (display.labelFormat === 'solfege') {
                  const semi = degreeToSemitoneOffset(deg, 0, arrangement.scale);
                  labelText = semitoneToSolfege(semi);
                } else if (display.labelFormat === 'noteName') {
                  const semi = degreeToSemitoneOffset(deg, 0, arrangement.scale);
                  labelText = semitoneToLetterName(semi, arrangement.tonic || 'C', transposition);
                } else {
                  labelText = String(deg);
                }
              }

              ctx.fillText(labelText, x, y + 0.5);
            }

            // ── Selection highlight: draw a bright ring around selected nodes ──
            if (mode === 'create' && k === kStart) {
              const selKeys = useAppStore.getState().createView.selectedNodeKeys;
              const nk = `${voice.id}:${node.t16}`;
              if (selKeys.has(nk)) {
                ctx.save();
                ctx.strokeStyle = '#00ffff';   // Cyan selection ring
                ctx.lineWidth = 2.5;
                ctx.shadowColor = '#00ffff';
                ctx.shadowBlur = 8;
                const selRadius = node.term ? anchorRadius + 4 : nodeRadius + 4;
                ctx.beginPath();
                ctx.arc(x, y, selRadius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
              }
            }
          }

          // Create mode hover preview (phantom node) — only draw once (not per tile)
          if (k === kStart) {
            const isDraggingAnchor = !!dragState?.isDragging && dragState.voiceId === voice.id && !!voice.nodes.find((n) => n.term && n.t16 === dragState.originalT16);

            if (mode === 'create' && hoverPreviewRef.current?.voiceId === voice.id && !onlyChords && !isDraggingAnchor) {
              const preview = hoverPreviewRef.current.point;
              // For create-mode hover, use the nearest visible tile to show the preview
              const previewWorldT = preview.t16 + kStart * loopLengthT;
              const px = wToX(previewWorldT);
              const py = preview.semi !== undefined
                ? semitoneToY(preview.semi, minSemitone, maxSemitone, gridTop, gridHeight)
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

              if (display.showNoteLabels) {
                const labelFontSize = Math.round(12 * display.noteSize);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                ctx.font = `bold ${labelFontSize}px system-ui`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                let previewLabel: string;
                if (preview.semi !== undefined) {
                  if (display.labelFormat === 'solfege') {
                    previewLabel = semitoneToSolfege(preview.semi);
                  } else if (display.labelFormat === 'noteName') {
                    previewLabel = semitoneToLetterName(preview.semi, arrangement.tonic || 'C', transposition);
                  } else {
                    previewLabel = semitoneToLabel(preview.semi);
                  }
                } else {
                  if (display.labelFormat === 'solfege') {
                    const semi = degreeToSemitoneOffset(preview.deg, 0, arrangement.scale);
                    previewLabel = semitoneToSolfege(semi);
                  } else if (display.labelFormat === 'noteName') {
                    const semi = degreeToSemitoneOffset(preview.deg, 0, arrangement.scale);
                    previewLabel = semitoneToLetterName(semi, arrangement.tonic || 'C', transposition);
                  } else {
                    previewLabel = String(preview.deg);
                  }
                }

                ctx.fillText(previewLabel, px, py + 0.5);
              }

              ctx.restore();
            }
          }
        }
      }
      ctx.restore();

      // Pop the clip rect.
      // ── Loop region overlay ──
      // Draw this AFTER contours/nodes so it dims them too.
      if (loopEnabledNow) {
        const loopStartX = wToX(loopStartNow);
        const loopEndX = wToX(loopEndNow);

        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';

        const dimLeftStart = gridLeft;
        const dimLeftEnd = Math.max(gridLeft, Math.min(gridLeft + gridWidth, loopStartX));
        if (dimLeftEnd > dimLeftStart) {
          ctx.fillRect(dimLeftStart, gridTop, dimLeftEnd - dimLeftStart, gridHeight);
        }

        const dimRightStart = Math.max(gridLeft, Math.min(gridLeft + gridWidth, loopEndX));
        const dimRightEnd = gridLeft + gridWidth;
        if (dimRightEnd > dimRightStart) {
          ctx.fillRect(dimRightStart, gridTop, dimRightEnd - dimRightStart, gridHeight);
        }
        ctx.restore();

        // Re-draw boundary lines on top so the handles remain obvious.
        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);

        if (loopStartX >= gridLeft && loopStartX <= gridLeft + gridWidth) {
          ctx.beginPath();
          ctx.moveTo(loopStartX, gridTop);
          ctx.lineTo(loopStartX, gridTop + gridHeight);
          ctx.stroke();
        }

        if (loopEndX >= gridLeft && loopEndX <= gridLeft + gridWidth) {
          ctx.beginPath();
          ctx.moveTo(loopEndX, gridTop);
          ctx.lineTo(loopEndX, gridTop + gridHeight);
          ctx.stroke();
        }

        ctx.restore();
      }

      // ── Marquee selection rectangle (Create mode only) ──
      // Drawn on top of everything so it's always visible.
      if (mode === 'create' && marqueeRef.current) {
        const mq = marqueeRef.current;
        const mqLeftPx = Math.min(mq.startX, mq.currentX) * dpr;
        const mqTopPx = Math.min(mq.startY, mq.currentY) * dpr;
        const mqW = Math.abs(mq.currentX - mq.startX) * dpr;
        const mqH = Math.abs(mq.currentY - mq.startY) * dpr;

        ctx.save();
        // Semi-transparent blue fill
        ctx.fillStyle = 'rgba(0, 180, 255, 0.12)';
        ctx.fillRect(mqLeftPx, mqTopPx, mqW, mqH);
        // Dashed cyan border
        ctx.strokeStyle = 'rgba(0, 200, 255, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(mqLeftPx, mqTopPx, mqW, mqH);
        ctx.setLineDash([]);
        ctx.restore();
      }

      ctx.restore();
    }

    // ── Lyrics lane (Play mode) ──
    // Draw AFTER the contour clip is restored so bottom-lane text is not clipped.
    // IMPORTANT:
    // App.tsx renders two Grid instances:
    // - hideChords=true  -> main contour layer (inside vertical fade mask)
    // - hideChords=false -> overlay lane used for chords (outside vertical fade mask)
    // Lyrics should live on the overlay lane so bottom text stays readable.
    if (!hideChords && mode === 'play' && display.showLyricsTrack && arrangement.lyrics?.enabled && voice1MelodyNodes.length > 0) {
      const lyricLaneHeight = 24;
      const lyricLaneBottom = 8;
      const lyricLaneTop = height - lyricLaneBottom - lyricLaneHeight;
      const lyricBaselineY = lyricLaneTop + lyricLaneHeight / 2 + 0.5;
      const voice1Id = arrangement.voices[0]?.id ?? null;

      // Match the node-flash timing so lyric flashes feel synchronized with note hits.
      const LYRIC_FLASH_ATTACK_MS = 35;
      const LYRIC_FLASH_DECAY_MS = 2000;

      // Determine the currently active lyric by playhead position.
      let activeLyricT16: number | null = null;
      if (isPlaying) {
        // In loop mode, wrap world time into one arrangement-length local lane.
        // In one-shot mode, clamp instead of wrapping so the final frame does not
        // briefly jump back to lyric #1 at the very end.
        const localPlayheadT16 = loopLengthT > 0
          ? (
            loopEnabled
              ? (((playheadWorldT % loopLengthT) + loopLengthT) % loopLengthT)
              : Math.max(0, Math.min(loopLengthT, playheadWorldT))
          )
          : playheadWorldT;

        for (const node of voice1MelodyNodes) {
          if (node.t16 > localPlayheadT16) break;
          const entry = lyricEntryByT16.get(node.t16);
          if (entry?.text) {
            activeLyricT16 = node.t16;
          }
        }
      }

      ctx.save();

      // Subtle lane baseline (sheet-music style guide line).
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gridLeft, lyricBaselineY);
      ctx.lineTo(gridLeft + gridWidth, lyricBaselineY);
      ctx.stroke();

      // Draw connector lines first so text sits cleanly on top.
      // Dash connectors stay adjacent. Hold connectors are rendered from
      // precomputed spans so they can cross multiple nodes and stop at anchors.
      for (let i = 0; i < voice1MelodyNodes.length - 1; i++) {
        const fromNode = voice1MelodyNodes[i];
        const toNode = voice1MelodyNodes[i + 1];
        const connector = lyricEntryByT16.get(fromNode.t16)?.connectorToNext;
        if (connector !== 'dash') continue;

        const fromWorldT = localT16ToNearestWorldT(fromNode.t16, loopLengthT, worldT);
        const toWorldT = localT16ToNearestWorldT(toNode.t16, loopLengthT, fromWorldT + (toNode.t16 - fromNode.t16));
        const x1 = wToX(fromWorldT);
        const x2 = wToX(toWorldT);

        if (Math.max(x1, x2) < gridLeft - 36 || Math.min(x1, x2) > gridLeft + gridWidth + 36) continue;

        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const mid = (left + right) / 2;
        const dashLength = Math.min(16, Math.max(7, (right - left) * 0.35));
        ctx.moveTo(mid - dashLength / 2, lyricBaselineY + 0.5);
        ctx.lineTo(mid + dashLength / 2, lyricBaselineY + 0.5);

        ctx.stroke();
        ctx.restore();
      }

      for (const span of lyricHoldSpans) {
        const startWorldT = localT16ToNearestWorldT(span.startT16, loopLengthT, worldT);
        const endWorldT = localT16ToNearestWorldT(span.endT16, loopLengthT, startWorldT + (span.endT16 - span.startT16));
        const x1 = wToX(startWorldT);
        const x2 = wToX(endWorldT);

        if (Math.max(x1, x2) < gridLeft - 36 || Math.min(x1, x2) > gridLeft + gridWidth + 36) continue;

        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const bubbleInset = 22;
        const lineStart = left + bubbleInset;
        const lineEnd = span.endAtAnchor ? right : (right - bubbleInset);
        if (lineEnd <= lineStart) continue;

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1.7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(lineStart, lyricBaselineY + 8);
        ctx.lineTo(lineEnd, lyricBaselineY + 8);
        ctx.stroke();
        ctx.restore();
      }

      // Render lyric tokens centered under their Voice 1 melody node.
      ctx.font = '600 13px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (const node of voice1MelodyNodes) {
        if (hiddenLyricNodeTimes.has(node.t16)) continue;
        const text = lyricEntryByT16.get(node.t16)?.text ?? '';
        if (!text) continue;

        const drawWorldT = localT16ToNearestWorldT(node.t16, loopLengthT, worldT);
        const x = wToX(drawWorldT);
        if (x < gridLeft - 36 || x > gridLeft + gridWidth + 36) continue;

        // Triggered flash comes from playback-engine note events (same source as node flashes).
        let flashIntensity = 0;
        if (voice1Id) {
          const flashKey = `${voice1Id}:${node.t16}`;
          const flashStartMs = nodeFlashStartMsRef.current.get(flashKey);
          const nowMs = window.performance.now();
          const flashAgeMs = flashStartMs !== undefined ? (nowMs - flashStartMs) : Infinity;

          if (flashAgeMs >= 0 && flashAgeMs <= (LYRIC_FLASH_ATTACK_MS + LYRIC_FLASH_DECAY_MS)) {
            if (flashAgeMs <= LYRIC_FLASH_ATTACK_MS) {
              flashIntensity = Math.max(0, Math.min(1, flashAgeMs / LYRIC_FLASH_ATTACK_MS));
            } else {
              const DECAY_K = 4;
              const decay01 = (flashAgeMs - LYRIC_FLASH_ATTACK_MS) / LYRIC_FLASH_DECAY_MS;
              flashIntensity = Math.exp(-DECAY_K * decay01);
            }
          }
        }

        const isActive = activeLyricT16 === node.t16;
        const highlightStrength = Math.max(isActive ? 0.45 : 0, flashIntensity);

        if (highlightStrength > 0.001) {
          ctx.save();
          const textAlpha = Math.min(1, 0.78 + highlightStrength * 0.22);
          const glowAlpha = Math.min(0.82, 0.24 + highlightStrength * 0.58);
          const glowBlur = 4 + highlightStrength * 10;

          ctx.fillStyle = `rgba(255, 250, 205, ${textAlpha})`;
          ctx.shadowColor = `rgba(255, 235, 140, ${glowAlpha})`;
          ctx.shadowBlur = glowBlur;
          ctx.fillText(text, x, lyricBaselineY);
          ctx.restore();
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
          ctx.fillText(text, x, lyricBaselineY);
        }
      }

      ctx.restore();
    }

    // Apply edge fades directly in-canvas for reliable cross-browser behavior.
    // We use destination-in so drawn content fades out toward transparent edges
    // without adding any dark overlay box on top of the artwork.
    {
      // Fade tuning (in CSS pixels):
      // - edgeClearPx: fully transparent strip at the edge
      // - fadePx: transition distance from transparent -> fully visible
      const sideFadePx = 80;
      const verticalFadePx = 80;
      const sideEdgeClearPx = 10;
      const verticalEdgeClearPx = 10;

      ctx.save();

      // 1. Horizontal Side Fades
      // Applied specifically to the grid area. Since destination-in keeps only the overlap,
      // this technically "erases" the labels area (to the left of gridLeft).
      ctx.globalCompositeOperation = 'destination-in';
      const sideRatio = Math.min(0.49, sideFadePx / Math.max(1, gridWidth));
      const sideEdgePadRatio = Math.min(0.25, sideEdgeClearPx / Math.max(1, gridWidth));
      const sideSolidStart = Math.max(sideEdgePadRatio, sideRatio);
      const sideSolidEnd = Math.min(1 - sideEdgePadRatio, 1 - sideRatio);
      const sideGradient = ctx.createLinearGradient(gridLeft, 0, gridLeft + gridWidth, 0);
      sideGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      sideGradient.addColorStop(sideEdgePadRatio, 'rgba(0, 0, 0, 0)');
      sideGradient.addColorStop(sideSolidStart, 'rgba(0, 0, 0, 1)');
      sideGradient.addColorStop(sideSolidEnd, 'rgba(0, 0, 0, 1)');
      sideGradient.addColorStop(1 - sideEdgePadRatio, 'rgba(0, 0, 0, 0)');
      sideGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = sideGradient;
      ctx.fillRect(gridLeft, 0, gridWidth, height);

      // 2. Clear Compositing & Draw Pitch Labels
      // We draw these AFTER the side fades have cleared the side margin, so labels remain opaque.
      ctx.globalCompositeOperation = 'source-over';
      if (!onlyChords) {
        for (let semi = Math.ceil(minSemitone); semi <= Math.floor(maxSemitone); semi++) {
          const noteInScale = ((semi % 12) + 12) % 12;
          const scalePattern = SCALE_PATTERNS[arrangement.scale] || SCALE_PATTERNS.major;
          const isDiatonic = scalePattern.includes(noteInScale);
          if (!isDiatonic) continue;

          if (semi < minSemitone + 1 || semi > maxSemitone - 1) continue;

          const y = semitoneToY(semi, minSemitone, maxSemitone, gridTop, gridHeight);
          const label = semitoneToLabel(semi);

          ctx.save();
          ctx.globalAlpha = display.gridOpacity;
          ctx.fillStyle = semi % 12 === 0 ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.78)';
          ctx.font = 'bold 11px system-ui';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, gridLeft - 8, y);
          ctx.restore();
        }
      }

      // 3. Vertical Top/Bottom Fades
      // Applied to the whole width, so both labels and grid fade out at edges.
      if (!onlyChords) {
        ctx.globalCompositeOperation = 'destination-in';
        const verticalRatio = Math.min(0.49, verticalFadePx / Math.max(1, gridHeight));
        const verticalEdgePadRatio = Math.min(0.25, verticalEdgeClearPx / Math.max(1, gridHeight));
        const verticalSolidStart = Math.max(verticalEdgePadRatio, verticalRatio);
        const verticalSolidEnd = Math.min(1 - verticalEdgePadRatio, 1 - verticalRatio);
        const verticalGradient = ctx.createLinearGradient(0, gridTop, 0, gridTop + gridHeight);
        verticalGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        verticalGradient.addColorStop(verticalEdgePadRatio, 'rgba(0, 0, 0, 0)');
        verticalGradient.addColorStop(verticalSolidStart, 'rgba(0, 0, 0, 1)');
        verticalGradient.addColorStop(verticalSolidEnd, 'rgba(0, 0, 0, 1)');
        verticalGradient.addColorStop(1 - verticalEdgePadRatio, 'rgba(0, 0, 0, 0)');
        verticalGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = verticalGradient;
        ctx.fillRect(0, 0, width, height);
      }

      ctx.restore();
    }
  }, [
    arrangement,
    canvasMetricsRef,
    canvasRef,
    contourStackLookup,
    cssColors,
    display,
    dragState,
    followModePendingWorldT,
    followModePxPerT,
    getPitchRange,
    hiddenLyricNodeTimes,
    hideChords,
    hoverPreviewRef,
    hoveredContourVoiceIdRef,
    isPlaying,
    isRecording,
    livePitchTrace,
    livePitchTraceVoiceId,
    loopEnabled,
    lyricEntryByT16,
    lyricHoldSpans,
    memoizedGridLines,
    mode,
    nodeFlashStartMsRef,
    onlyChords,
    recordings,
    selectedVoiceId,
    shadowCompositeCanvasRef,
    shadowMaskCanvasRef,
    transposition,
    updateCanvasMetrics,
    visualWorldTRef,
    marqueeRef,
    voice1MelodyNodes,
    voiceStates,
  ]);
}
