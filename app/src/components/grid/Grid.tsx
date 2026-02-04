/* ============================================================
   GRID COMPONENT
   
   Main visualization canvas showing:
   - Vertical grid lines (bars, beats, subdivisions)
   - Horizontal pitch lines
   - Contour lines for each voice
   - User's pitch trace during recording
   - Playhead
   ============================================================ */

import { useRef, useEffect, useCallback, useState } from 'react';
import type { Arrangement, Voice, PitchPoint } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { degreeToSemitoneOffset, semitoneToLabel, midiToFrequency, noteNameToMidi, A4_MIDI, A4_FREQUENCY, SCALE_PATTERNS } from '../../utils/music';
import { generateGridLines, sixteenthDurationMs } from '../../utils/timing';
import { playbackEngine } from '../../services/PlaybackEngine';

/* ------------------------------------------------------------
   Types
   ------------------------------------------------------------ */

interface GridProps {
  arrangement: Arrangement | null;
  className?: string;
  hideChords?: boolean;
  onlyChords?: boolean;
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
 * Convert a time position (t16) to X position on the grid.
 */
function t16ToX(
  t16: number,
  startT16: number,
  endT16: number,
  gridLeft: number,
  gridWidth: number
): number {
  const range = endT16 - startT16;
  const normalized = (t16 - startT16) / range;
  return gridLeft + gridWidth * normalized;
}

/* ------------------------------------------------------------
   Grid Component
   ------------------------------------------------------------ */

// Type for tracking dragged node
interface DragState {
  voiceId: string;
  originalT16: number;
  isDragging: boolean;
}

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

  // Get arrangement from store to ensure we always have latest (for create mode updates)
  const arrangementFromStore = useAppStore((state) => state.arrangement);
  const arrangement = arrangementFromStore || arrangementProp;

  const playback = useAppStore((state) => state.playback);
  const voiceStates = useAppStore((state) => state.voiceStates);
  const livePitchTrace = useAppStore((state) => state.livePitchTrace);
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

  /**
   * Calculate the pitch range for the arrangement in semitones.
   * Returns min/max semitones relative to the tonic, plus frequency range.
   * Uses zoomLevel to adjust the visible range (higher zoom = fewer semitones visible).
   */
  const getPitchRange = useCallback(() => {
    if (!arrangement) return { minSemitone: -5, maxSemitone: 19, minFreq: 130, maxFreq: 520, effectiveTonicMidi: 60 };

    let minSemi = Infinity;
    let maxSemi = -Infinity;

    for (const voice of arrangement.voices) {
      for (const node of voice.nodes) {
        // Convert each node's degree+octave to semitones
        const semitone = degreeToSemitoneOffset(node.deg, node.octave || 0, arrangement.scale);
        minSemi = Math.min(minSemi, semitone);
        maxSemi = Math.max(maxSemi, semitone);
      }
    }

    // If no nodes found, use default range (about 2 octaves centered on tonic)
    if (minSemi === Infinity || maxSemi === -Infinity) {
      minSemi = -5;  // 5 semitones below tonic
      maxSemi = 19;  // Octave + 7 semitones above tonic
    }

    // Calculate center and base range
    const center = (minSemi + maxSemi) / 2;
    const baseRange = maxSemi - minSemi;

    // Add base padding (5 semitones)
    const basePadding = 5;
    const paddedRange = baseRange + basePadding * 2;

    // Apply zoom: zoomLevel 1 = fit all, higher = zoomed in (fewer semitones)
    // zoomLevel 2 = half the range, zoomLevel 0.5 = double the range
    const zoomFactor = Math.max(0.25, display.zoomLevel); // Prevent extreme zoom out
    const zoomedRange = paddedRange / zoomFactor;

    // Calculate final min/max centered on the arrangement
    const finalMin = Math.floor(center - zoomedRange / 2);
    const finalMax = Math.ceil(center + zoomedRange / 2);

    // Calculate frequency range (using MIDI-based calculation)
    // Get the MIDI pitch of the arrangement's tonic at base octave 4
    const tonicMidi = noteNameToMidi(`${arrangement.tonic}4`) || 60;

    // We also need to factor in playback transposition for the frequencies
    // but the grid itself stays in 'compositional' semitones (where tonic is 0)
    const effectiveTonicMidi = tonicMidi + (transposition || 0);

    const minFreq = midiToFrequency(effectiveTonicMidi + finalMin);
    const maxFreq = midiToFrequency(effectiveTonicMidi + finalMax);

    return { minSemitone: finalMin, maxSemitone: finalMax, minFreq, maxFreq, effectiveTonicMidi };
  }, [arrangement, display.zoomLevel]);

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
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Grid area (with margins for labels)
    const margin = { top: 40, right: 20, bottom: 40, left: 50 };
    const gridLeft = margin.left;
    const gridTop = margin.top;
    const gridWidth = width - margin.left - margin.right;
    const gridHeight = height - margin.top - margin.bottom;

    // Get colors from CSS variables

    const barLineColor = getCssVar('--grid-line-bar') || 'rgba(255, 255, 255, 0.15)';
    const beatLineColor = getCssVar('--grid-line-beat') || 'rgba(255, 255, 255, 0.08)';
    const subdivLineColor = getCssVar('--grid-line-subdivision') || 'rgba(255, 255, 255, 0.04)';
    const pitchLineColor = getCssVar('--grid-pitch-line') || 'rgba(255, 255, 255, 0.05)';
    const playheadColor = getCssVar('--playhead-color') || '#ffffff';
    const textColor = getCssVar('--text-secondary') || '#a8a3b8';

    // Clear canvas
    ctx.clearRect(0, 0, width, height);


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

    // Time range (in 16th notes) - calculate based on time signature
    const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
    const startT16 = 0;
    const endT16 = totalT16;

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
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; // Brighter tonic
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
          ctx.fillStyle = semi % 12 === 0 ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)';
          ctx.font = 'bold 10px system-ui';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, gridLeft - 10, y);
        }
      }

      // Draw vertical grid lines
      const gridLines = generateGridLines(arrangement.bars, arrangement.timeSig);
      for (const line of gridLines) {
        const x = t16ToX(line.t16, startT16, endT16, gridLeft, gridWidth);

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

      // Draw bar numbers
      ctx.fillStyle = textColor;
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      for (let bar = 0; bar <= arrangement.bars; bar++) {
        const t16 = bar * 16;
        const x = t16ToX(t16, startT16, endT16, gridLeft, gridWidth);
        ctx.fillText(`${bar + 1}`, x, gridTop - 10);
      }
      ctx.restore();
    }

    // Draw chord track
    if (!hideChords && display.showChordTrack && arrangement.chords) {
      // ... (rest of the drawing code)


      const chordColors = ['#ff6b9d', '#4ecdc4', '#a78bfa', '#ffe66d', '#ff8c42', '#34d399'];
      const blockHeight = 24;
      const blockY = gridTop - 30;

      for (let i = 0; i < arrangement.chords.length; i++) {
        const chord = arrangement.chords[i];
        const chordColor = chordColors[i % chordColors.length];

        // Calculate block start and end positions
        const blockStartX = t16ToX(chord.t16, startT16, endT16, gridLeft, gridWidth);
        const blockEndX = t16ToX(chord.t16 + chord.duration16, startT16, endT16, gridLeft, gridWidth);
        const blockWidth = blockEndX - blockStartX;

        // Draw glass-like rounded block with gap
        const gap = 6;
        const radius = 8;
        const bStartX = blockStartX + gap / 2;
        const bWidth = Math.max(0, blockWidth - gap);

        ctx.beginPath();
        if ((ctx as any).roundRect) {
          (ctx as any).roundRect(bStartX, blockY, bWidth, blockHeight, radius);
        } else {
          ctx.rect(bStartX, blockY, bWidth, blockHeight);
        }

        ctx.fillStyle = chordColor + '40'; // 25% opacity for better visibility

        ctx.fill();
        ctx.strokeStyle = chordColor + '80'; // Bright border
        ctx.lineWidth = 1.5;
        ctx.stroke();


        // Draw chord text centered in block
        ctx.fillStyle = chordColor;
        ctx.font = 'bold 13px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(chord.name, blockStartX + blockWidth / 2, blockY + blockHeight / 2);
      }
    }

    if (!onlyChords) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 1. Draw recorded pitch traces (behind contours)
      for (const [voiceId, recording] of recordings.entries()) {
        const voiceIndex = arrangement.voices.findIndex(v => v.id === voiceId);
        if (voiceIndex === -1) continue;

        const voice = arrangement.voices[voiceIndex];
        const voiceState = voiceStates.find(v => v.voiceId === voiceId);

        // Recorded traces follow the VOX (vocal) mute/solo state.
        // Solo is global across all tracks, but VOX coloring is based on VOX solo.
        const anySoloActive = voiceStates.some(v => v.synthSolo || v.vocalSolo);
        const isVocalMuted = (voiceState?.vocalMuted ?? false) || (anySoloActive && !(voiceState?.vocalSolo ?? false));

        const voiceColor = isVocalMuted
          ? 'rgba(150, 150, 150, 0.4)'
          : (voice.color || getCssVar(`--voice-${voiceIndex + 1}`) || '#ff6b9d');

        drawPitchTrace(ctx, recording.pitchTrace, startT16, endT16,
          arrangement.tempo, arrangement.timeSig, gridLeft, gridTop, gridWidth, gridHeight, {
          color: voiceColor,
          lineWidth: 10,
          opacity: isVocalMuted ? 0.2 : 0.4,
          isLive: false,
          effectiveTonicMidi,
          minSemitone,
          maxSemitone
        });
      }

      // 2. Draw live pitch trace (during recording)
      if (livePitchTrace.length > 0 && armedVoiceId && playback.isRecording) {
        const voiceIndex = arrangement.voices.findIndex(v => v.id === armedVoiceId);
        const voice = voiceIndex >= 0 ? arrangement.voices[voiceIndex] : null;
        const traceColor = voice?.color || getCssVar(`--voice-${voiceIndex + 1}`) || '#ffffff';

        drawPitchTrace(ctx, livePitchTrace, startT16, endT16,
          arrangement.tempo, arrangement.timeSig, gridLeft, gridTop, gridWidth, gridHeight, {
          color: traceColor,
          lineWidth: 10,
          opacity: 0.8,
          isLive: true,
          effectiveTonicMidi,
          minSemitone,
          maxSemitone
        });
      }
      ctx.restore();
    }

    // 3. Draw contour lines for each voice
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let voiceIndex = 0; voiceIndex < arrangement.voices.length; voiceIndex++) {
      const voice = arrangement.voices[voiceIndex];
      const voiceState = voiceStates.find(v => v.voiceId === voice.id);

      // Contour lines follow the SYN (synth) mute/solo state.
      // Solo is global across all tracks, but SYN coloring is based on SYN solo.
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
        drawVoiceContour(ctx, voice, minSemitone, maxSemitone, startT16, endT16, gridLeft, gridTop, gridWidth, gridHeight, arrangement.scale);
      }

      // Main line
      ctx.shadowBlur = 0;
      ctx.strokeStyle = voiceColor;
      ctx.lineWidth = 2;
      drawVoiceContour(ctx, voice, minSemitone, maxSemitone, startT16, endT16, gridLeft, gridTop, gridWidth, gridHeight, arrangement.scale);

      // Draw nodes - larger circles with scale degree numbers (like mockup)
      const nodeRadius = 12; // Larger nodes to fit numbers

      for (const node of voice.nodes) {
        if (node.term) continue; // Skip termination nodes

        const x = t16ToX(node.t16, startT16, endT16, gridLeft, gridWidth);
        const y = degreeToY(node.deg, node.octave || 0, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale);

        // Draw node glow - only if not muted
        if (display.glowIntensity > 0 && !isSynthMuted) {
          ctx.shadowColor = voiceColor;
          ctx.shadowBlur = 8 * display.glowIntensity;
        }

        // Draw node circle with opaque fill (mockup style)
        ctx.beginPath();
        ctx.arc(x, y, nodeRadius, 0, Math.PI * 2);
        ctx.fillStyle = voiceColor; // Fully opaque fill
        ctx.fill();
        ctx.strokeStyle = isSynthMuted ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.4)'; // Subtle white ring
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.shadowBlur = 0;

        // Always draw scale degree number inside node (white text for contrast)
        ctx.fillStyle = isSynthMuted ? 'rgba(255, 255, 255, 0.5)' : '#ffffff';
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(node.deg), x, y + 0.5);
      }

      ctx.restore();
    }
    ctx.restore();

    // 4. Draw playhead - read directly from engine for smooth animation
    const playheadT16 = playbackEngine.getCurrentPositionT16();
    const playheadX = t16ToX(playheadT16, startT16, endT16, gridLeft, gridWidth);

    ctx.strokeStyle = playheadColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, gridTop);
    ctx.lineTo(playheadX, gridTop + gridHeight);
    ctx.stroke();

    // Playhead glow
    ctx.shadowColor = playheadColor;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(playheadX, gridTop);
    ctx.lineTo(playheadX, gridTop + gridHeight);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }, [arrangement, voiceStates, livePitchTrace, display, recordings, armedVoiceId, getPitchRange, onlyChords, playback.isRecording]);

  /**
   * Draw a voice's contour line (now using semitones).
   */
  function drawVoiceContour(
    ctx: CanvasRenderingContext2D,
    voice: Voice,
    minSemitone: number,
    maxSemitone: number,
    startT16: number,
    endT16: number,
    gridLeft: number,
    gridTop: number,
    gridWidth: number,
    gridHeight: number,
    scaleType: string
  ) {
    if (voice.nodes.length === 0) return;

    ctx.beginPath();
    let lastX = 0;
    let lastY = 0;
    let inPhrase = false;

    for (let i = 0; i < voice.nodes.length; i++) {
      const node = voice.nodes[i];
      const x = t16ToX(node.t16, startT16, endT16, gridLeft, gridWidth);
      const y = degreeToY(node.deg, node.octave || 0, minSemitone, maxSemitone, gridTop, gridHeight, scaleType);

      if (!inPhrase) {
        ctx.moveTo(x, y);
        inPhrase = true;
      } else {
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

          // Curve to the entry point at the top/bottom of the circle
          // cp1 maintains horizontal exit from the previous segment
          // cp2 ensures vertical entry into the circle
          const cp1x = bendStartX + bendWidth * 0.5;
          const cp1y = lastY;
          const cp2x = x;
          const cp2y = lastY;

          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, entryY);
          // Final vertical segment to the center
          ctx.lineTo(x, y);
        }
      }

      lastX = x;
      lastY = y;

      // Check if this is a termination node
      if (node.term) {
        ctx.stroke();
        ctx.beginPath();
        inPhrase = false;
      }
    }

    if (inPhrase) {
      ctx.stroke();
    }
  }

  /**
   * Draw a pitch trace (user recording) with clean, neon glow.
   */
  function drawPitchTrace(
    ctx: CanvasRenderingContext2D,
    trace: PitchPoint[],
    startT16: number,
    endT16: number,
    tempo: number,
    timeSig: { numerator: number; denominator: number },
    gridLeft: number,
    gridTop: number,
    gridWidth: number,
    gridHeight: number,
    options: {
      color: string;
      lineWidth: number;
      opacity: number;
      isLive: boolean;
      effectiveTonicMidi: number;
      minSemitone: number;
      maxSemitone: number;
    }
  ) {
    if (trace.length < 2) return;

    const { color, lineWidth, opacity, isLive, effectiveTonicMidi, minSemitone, maxSemitone } = options;

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
        const isGap = point.frequency <= 0 || (lastPointTime !== -1 && point.time - lastPointTime > 150);

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
        const x = t16ToX(t16, startT16, endT16, gridLeft, gridWidth);
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
      if (lastPoint && lastPoint.frequency > 0) {
        const sixteenthMs = sixteenthDurationMs(tempo, timeSig);
        const t16 = lastPoint.time / sixteenthMs;
        const x = t16ToX(t16, startT16, endT16, gridLeft, gridWidth);
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

  // Animation loop for smooth playhead movement
  useEffect(() => {
    let animationId: number;

    const animate = () => {
      draw();
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [draw]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      draw();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [draw]);

  /**
   * Handle canvas click for placing/removing nodes in create mode.
   */
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Only handle clicks in create mode
    if (mode !== 'create' || !arrangement) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Get click position relative to canvas
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Calculate grid dimensions (same as in draw function)
    const width = container.clientWidth;
    const height = container.clientHeight;
    const padding = { top: 40, right: 20, bottom: 20, left: 60 };

    const gridLeft = padding.left;
    const gridTop = padding.top;
    const gridWidth = width - padding.left - padding.right;
    const gridHeight = height - padding.top - padding.bottom;

    // Check if click is within grid area
    if (x < gridLeft || x > gridLeft + gridWidth || y < gridTop || y > gridTop + gridHeight) {
      return;
    }

    // Calculate time range
    const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
    const startT16 = 0;
    const endT16 = totalT16;

    // Get pitch range (in semitones)
    const { minSemitone, maxSemitone } = getPitchRange();

    // Convert click to t16 (snap to nearest 16th note)
    const relativeX = (x - gridLeft) / gridWidth;
    const rawT16 = startT16 + relativeX * (endT16 - startT16);
    const t16 = Math.round(rawT16); // Snap to nearest 16th

    // Convert click to semitone (relative to tonic)
    const relativeY = (y - gridTop) / gridHeight;
    const rawSemitone = maxSemitone - relativeY * (maxSemitone - minSemitone);
    const semitone = Math.round(rawSemitone);

    // Convert semitone back to scale degree + octave for storage
    // Using major scale mapping: semitones [0,2,4,5,7,9,11] = degrees [1,2,3,4,5,6,7]
    const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
    const octaveOffset = Math.floor(semitone / 12);
    const semitoneInOctave = ((semitone % 12) + 12) % 12;

    // Find the closest scale degree
    let closestDeg = 1;
    let minDiff = 12;
    for (let i = 0; i < MAJOR_SCALE.length; i++) {
      const diff = Math.abs(MAJOR_SCALE[i] - semitoneInOctave);
      if (diff < minDiff) {
        minDiff = diff;
        closestDeg = i + 1;
      }
    }

    // Determine voice to edit - use selected voice or first voice
    const voiceId = selectedVoiceId || arrangement.voices[0]?.id;
    if (!voiceId) return;

    // Auto-select voice if none selected
    if (!selectedVoiceId) {
      setSelectedVoiceId(voiceId);
    }

    // Check if there's already a node near this position
    const voice = arrangement.voices.find((v) => v.id === voiceId);
    const existingNode = voice?.nodes.find((n) => Math.abs(n.t16 - t16) < 2);

    if (existingNode && e.shiftKey) {
      // Shift+click removes node
      removeNode(voiceId, existingNode.t16);
    } else {
      // Regular click adds/updates node
      const finalDeg = closestDeg;
      const octave = octaveOffset;

      addNode(voiceId, t16, finalDeg, octave);
    }
  }, [mode, arrangement, selectedVoiceId, addNode, removeNode, setSelectedVoiceId, getPitchRange]);

  /**
   * Handle double-click to toggle termination status of a node.
   */
  const handleCanvasDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Only handle double-clicks in create mode
    if (mode !== 'create' || !arrangement) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Get click position relative to canvas
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Calculate grid dimensions
    const width = container.clientWidth;
    const height = container.clientHeight;
    const padding = { top: 40, right: 20, bottom: 20, left: 60 };

    const gridLeft = padding.left;
    const gridTop = padding.top;
    const gridWidth = width - padding.left - padding.right;
    const gridHeight = height - padding.top - padding.bottom;

    // Check if click is within grid area
    if (x < gridLeft || x > gridLeft + gridWidth || y < gridTop || y > gridTop + gridHeight) {
      return;
    }

    // Calculate time from click
    const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
    const startT16 = 0;
    const endT16 = totalT16;
    const relativeX = (x - gridLeft) / gridWidth;
    const rawT16 = startT16 + relativeX * (endT16 - startT16);
    const t16 = Math.round(rawT16);

    // Find voice to edit
    const voiceId = selectedVoiceId || arrangement.voices[0]?.id;
    if (!voiceId) return;

    // Find existing node near this position
    const voice = arrangement.voices.find((v) => v.id === voiceId);
    const existingNode = voice?.nodes.find((n) => Math.abs(n.t16 - t16) < 4);

    if (existingNode) {
      // Toggle termination status using updateNode
      updateNode(voiceId, existingNode.t16, existingNode.t16, existingNode.deg, existingNode.octave || 0, !existingNode.term);
    }
  }, [mode, arrangement, selectedVoiceId, updateNode]);

  /**
   * Handle mouse down for starting node drag in create mode.
   */
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== 'create' || !arrangement) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const padding = { top: 40, right: 20, bottom: 20, left: 60 };
    const gridLeft = padding.left;
    const gridTop = padding.top;
    const gridWidth = width - padding.left - padding.right;
    const gridHeight = height - padding.top - padding.bottom;

    if (x < gridLeft || x > gridLeft + gridWidth || y < gridTop || y > gridTop + gridHeight) return;

    const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
    const relativeX = (x - gridLeft) / gridWidth;
    const t16 = Math.round(relativeX * totalT16);

    const voiceId = selectedVoiceId || arrangement.voices[0]?.id;
    if (!voiceId) return;

    // Check if clicking on an existing node
    const voice = arrangement.voices.find((v) => v.id === voiceId);
    const existingNode = voice?.nodes.find((n) => Math.abs(n.t16 - t16) < 3);

    if (existingNode) {
      // Start dragging this node
      setDragState({ voiceId, originalT16: existingNode.t16, isDragging: true });
    }
  }, [mode, arrangement, selectedVoiceId]);

  /**
   * Handle mouse move for dragging nodes.
   */
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragState?.isDragging || mode !== 'create' || !arrangement) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const padding = { top: 40, right: 20, bottom: 20, left: 60 };
    const gridLeft = padding.left;
    const gridTop = padding.top;
    const gridWidth = width - padding.left - padding.right;
    const gridHeight = height - padding.top - padding.bottom;

    // Calculate new position
    const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
    const { minSemitone, maxSemitone } = getPitchRange();

    const relativeX = Math.max(0, Math.min(1, (x - gridLeft) / gridWidth));
    const relativeY = Math.max(0, Math.min(1, (y - gridTop) / gridHeight));

    const newT16 = Math.round(relativeX * totalT16);
    const rawSemitone = maxSemitone - relativeY * (maxSemitone - minSemitone);
    const semitone = Math.round(rawSemitone);

    // Convert semitone to scale degree
    const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
    const octaveOffset = Math.floor(semitone / 12);
    const semitoneInOctave = ((semitone % 12) + 12) % 12;

    let closestDeg = 1;
    let minDiff = 12;
    for (let i = 0; i < MAJOR_SCALE.length; i++) {
      const diff = Math.abs(MAJOR_SCALE[i] - semitoneInOctave);
      if (diff < minDiff) {
        minDiff = diff;
        closestDeg = i + 1;
      }
    }

    // Get the original node to preserve term status
    const voice = arrangement.voices.find((v) => v.id === dragState.voiceId);
    const originalNode = voice?.nodes.find((n) => n.t16 === dragState.originalT16);

    // Update the node position
    updateNode(dragState.voiceId, dragState.originalT16, newT16, closestDeg, octaveOffset, originalNode?.term);

    // Update drag state with new position
    setDragState({ ...dragState, originalT16: newT16 });
  }, [dragState, mode, arrangement, getPitchRange, updateNode]);

  /**
   * Handle mouse up to end drag.
   */
  const handleMouseUp = useCallback(() => {
    if (dragState?.isDragging) {
      setDragState(null);
    }
  }, [dragState]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full ${className}`}
    >
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full ${mode === 'create' ? (dragState?.isDragging ? 'cursor-grabbing' : 'cursor-crosshair') : ''}`}
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
}

export default Grid;
