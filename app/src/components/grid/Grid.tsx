/* ============================================================
   GRID COMPONENT
   
   Main visualization canvas showing:
   - Vertical grid lines (bars, beats, subdivisions)
   - Horizontal pitch lines
   - Contour lines for each voice
   - User's pitch trace during recording
   - Playhead
   ============================================================ */

import { useRef, useEffect, useCallback } from 'react';
import type { Arrangement, Voice, PitchPoint } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { scaleDegreeToFrequency } from '../../utils/music';
import { generateGridLines, sixteenthDurationMs } from '../../utils/timing';

/* ------------------------------------------------------------
   Types
   ------------------------------------------------------------ */

interface GridProps {
  arrangement: Arrangement | null;
  className?: string;
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
 * Convert a scale degree to a Y position on the grid.
 * Higher pitches = lower Y values (top of canvas)
 */
function degreeToY(
  degree: number,
  octaveOffset: number,
  minDegree: number,
  maxDegree: number,
  gridTop: number,
  gridHeight: number
): number {
  // Calculate the effective degree (considering octave)
  const effectiveDegree = degree + (octaveOffset * 7);
  const range = maxDegree - minDegree;
  
  // Normalize to 0-1 (inverted so higher pitch = lower Y)
  const normalized = (effectiveDegree - minDegree) / range;
  
  // Map to grid area
  return gridTop + gridHeight * (1 - normalized);
}

/**
 * Convert a frequency to Y position (for pitch trace).
 */
function frequencyToY(
  frequency: number,
  minFreq: number,
  maxFreq: number,
  gridTop: number,
  gridHeight: number
): number {
  if (frequency <= 0) return gridTop + gridHeight; // Off-screen for no pitch
  
  // Use logarithmic scale for frequency
  const logMin = Math.log2(minFreq);
  const logMax = Math.log2(maxFreq);
  const logFreq = Math.log2(frequency);
  
  const normalized = (logFreq - logMin) / (logMax - logMin);
  return gridTop + gridHeight * (1 - normalized);
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

export function Grid({ arrangement, className = '' }: GridProps) {
  // Canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Get state from store
  const playback = useAppStore((state) => state.playback);
  const voiceStates = useAppStore((state) => state.voiceStates);
  const livePitchTrace = useAppStore((state) => state.livePitchTrace);
  const display = useAppStore((state) => state.display);
  const recordings = useAppStore((state) => state.recordings);
  const armedVoiceId = useAppStore((state) => state.armedVoiceId);

  /**
   * Calculate the pitch range for the arrangement.
   */
  const getPitchRange = useCallback(() => {
    if (!arrangement) return { minDegree: 1, maxDegree: 8, minFreq: 130, maxFreq: 520 };
    
    let minDeg = Infinity;
    let maxDeg = -Infinity;
    
    for (const voice of arrangement.voices) {
      for (const node of voice.nodes) {
        const effectiveDeg = node.deg + ((node.octave || 0) * 7);
        minDeg = Math.min(minDeg, effectiveDeg);
        maxDeg = Math.max(maxDeg, effectiveDeg);
      }
    }
    
    // Add generous padding for breathing room (at least 2 degrees on each side)
    minDeg = Math.max(-2, minDeg - 3);
    maxDeg = maxDeg + 3;
    
    // Calculate frequency range
    const minFreq = scaleDegreeToFrequency(minDeg, arrangement.tonic, arrangement.scale, 4, -1);
    const maxFreq = scaleDegreeToFrequency(maxDeg, arrangement.tonic, arrangement.scale, 4, 1);
    
    return { minDegree: minDeg, maxDegree: maxDeg, minFreq, maxFreq };
  }, [arrangement]);

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
    const bgColor = getCssVar('--bg-grid') || '#1e1a2e';
    const barLineColor = getCssVar('--grid-line-bar') || 'rgba(255, 255, 255, 0.15)';
    const beatLineColor = getCssVar('--grid-line-beat') || 'rgba(255, 255, 255, 0.08)';
    const subdivLineColor = getCssVar('--grid-line-subdivision') || 'rgba(255, 255, 255, 0.04)';
    const pitchLineColor = getCssVar('--grid-pitch-line') || 'rgba(255, 255, 255, 0.05)';
    const playheadColor = getCssVar('--playhead-color') || '#ffffff';
    const textColor = getCssVar('--text-secondary') || '#a8a3b8';
    
    // Clear canvas
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);
    
    if (!arrangement) {
      // Draw placeholder text
      ctx.fillStyle = textColor;
      ctx.font = '16px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Select an arrangement to begin', width / 2, height / 2);
      return;
    }
    
    // Get pitch range
    const { minDegree, maxDegree, minFreq, maxFreq } = getPitchRange();
    
    // Time range (in 16th notes)
    const totalT16 = arrangement.bars * 16; // Assuming 4/4
    const startT16 = 0;
    const endT16 = totalT16;
    
    // Draw horizontal pitch lines (degree 1 is brighter for orientation)
    for (let deg = Math.ceil(minDegree); deg <= Math.floor(maxDegree); deg++) {
      const y = degreeToY(deg, 0, minDegree, maxDegree, gridTop, gridHeight);
      
      // Make degree 1 (tonic) brighter and thicker for orientation
      if (deg === 1 || deg === 8) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 2;
      } else {
        ctx.strokeStyle = pitchLineColor;
        ctx.lineWidth = 1;
      }
      
      ctx.beginPath();
      ctx.moveTo(gridLeft, y);
      ctx.lineTo(gridLeft + gridWidth, y);
      ctx.stroke();
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
    
    // Draw chord track - blocks that touch end to end
    if (display.showChordTrack && arrangement.chords) {
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
        
        // Draw block background
        ctx.fillStyle = chordColor + '30'; // 20% opacity
        ctx.fillRect(blockStartX, blockY, blockWidth, blockHeight);
        
        // Draw block border (left, top, bottom - not right to touch next block)
        ctx.strokeStyle = chordColor + '60';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(blockStartX, blockY);
        ctx.lineTo(blockStartX, blockY + blockHeight);
        ctx.moveTo(blockStartX, blockY);
        ctx.lineTo(blockEndX, blockY);
        ctx.moveTo(blockStartX, blockY + blockHeight);
        ctx.lineTo(blockEndX, blockY + blockHeight);
        ctx.stroke();
        
        // Draw chord text centered in block
        ctx.fillStyle = chordColor;
        ctx.font = 'bold 13px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(chord.name, blockStartX + blockWidth / 2, blockY + blockHeight / 2);
      }
    }
    
    // Draw contour lines for each voice
    for (let voiceIndex = 0; voiceIndex < arrangement.voices.length; voiceIndex++) {
      const voice = arrangement.voices[voiceIndex];
      const voiceState = voiceStates.find(v => v.voiceId === voice.id);
      
      // Skip if muted (but not if soloed)
      const hasSolo = voiceStates.some(v => v.synthSolo);
      if (hasSolo && !voiceState?.synthSolo) continue;
      if (!hasSolo && voiceState?.synthMuted) continue;
      
      // Get voice color
      const voiceColor = voice.color || getCssVar(`--voice-${voiceIndex + 1}`) || '#ff6b9d';
      const glowColor = voiceColor.replace(')', ', 0.5)').replace('rgb', 'rgba');
      
      // Draw contour with glow effect
      ctx.save();
      
      // Glow layer
      if (display.glowIntensity > 0) {
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 10 * display.glowIntensity;
        ctx.strokeStyle = voiceColor;
        ctx.lineWidth = 3;
        drawVoiceContour(ctx, voice, minDegree, maxDegree, startT16, endT16, gridLeft, gridTop, gridWidth, gridHeight);
      }
      
      // Main line
      ctx.shadowBlur = 0;
      ctx.strokeStyle = voiceColor;
      ctx.lineWidth = 2;
      drawVoiceContour(ctx, voice, minDegree, maxDegree, startT16, endT16, gridLeft, gridTop, gridWidth, gridHeight);
      
      // Draw nodes - larger circles with scale degree numbers (like mockup)
      const nodeRadius = 12; // Larger nodes to fit numbers
      
      for (const node of voice.nodes) {
        if (node.term) continue; // Skip termination nodes
        
        const x = t16ToX(node.t16, startT16, endT16, gridLeft, gridWidth);
        const y = degreeToY(node.deg, node.octave || 0, minDegree, maxDegree, gridTop, gridHeight);
        
        // Draw node glow
        if (display.glowIntensity > 0) {
          ctx.shadowColor = voiceColor;
          ctx.shadowBlur = 8 * display.glowIntensity;
        }
        
        // Draw node circle with stroke (outlined style like mockup)
        ctx.beginPath();
        ctx.arc(x, y, nodeRadius, 0, Math.PI * 2);
        ctx.fillStyle = voiceColor + '30'; // Semi-transparent fill
        ctx.fill();
        ctx.strokeStyle = voiceColor;
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.shadowBlur = 0;
        
        // Always draw scale degree number inside node (white text for contrast)
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(node.deg), x, y + 0.5);
      }
      
      ctx.restore();
    }
    
    // Draw recorded pitch traces
    for (const [voiceId, recording] of recordings.entries()) {
      const voiceIndex = arrangement.voices.findIndex(v => v.id === voiceId);
      if (voiceIndex === -1) continue;
      
      const voice = arrangement.voices[voiceIndex];
      const voiceColor = voice.color || getCssVar(`--voice-${voiceIndex + 1}`) || '#ff6b9d';
      
      ctx.strokeStyle = voiceColor;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      
      drawPitchTrace(ctx, recording.pitchTrace, minFreq, maxFreq, startT16, endT16, 
        arrangement.tempo, arrangement.timeSig, gridLeft, gridTop, gridWidth, gridHeight);
      
      ctx.globalAlpha = 1;
    }
    
    // Draw live pitch trace (during recording)
    if (livePitchTrace.length > 0 && armedVoiceId) {
      const voiceIndex = arrangement.voices.findIndex(v => v.id === armedVoiceId);
      const voice = voiceIndex >= 0 ? arrangement.voices[voiceIndex] : null;
      const traceColor = voice?.color || getCssVar(`--voice-${voiceIndex + 1}`) || '#ffffff';
      
      ctx.strokeStyle = traceColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      
      drawPitchTrace(ctx, livePitchTrace, minFreq, maxFreq, startT16, endT16,
        arrangement.tempo, arrangement.timeSig, gridLeft, gridTop, gridWidth, gridHeight);
      
      ctx.globalAlpha = 1;
    }
    
    // Draw playhead
    const playheadT16 = playback.position;
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
    
  }, [arrangement, playback.position, voiceStates, livePitchTrace, display, recordings, armedVoiceId, getPitchRange]);

  /**
   * Draw a voice's contour line.
   */
  function drawVoiceContour(
    ctx: CanvasRenderingContext2D,
    voice: Voice,
    minDegree: number,
    maxDegree: number,
    startT16: number,
    endT16: number,
    gridLeft: number,
    gridTop: number,
    gridWidth: number,
    gridHeight: number
  ) {
    if (voice.nodes.length === 0) return;
    
    ctx.beginPath();
    let inPhrase = false;
    
    for (let i = 0; i < voice.nodes.length; i++) {
      const node = voice.nodes[i];
      const x = t16ToX(node.t16, startT16, endT16, gridLeft, gridWidth);
      const y = degreeToY(node.deg, node.octave || 0, minDegree, maxDegree, gridTop, gridHeight);
      
      if (!inPhrase) {
        ctx.moveTo(x, y);
        inPhrase = true;
      } else {
        // Draw line from previous node to this one
        ctx.lineTo(x, y);
      }
      
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
   * Draw a pitch trace (user recording).
   */
  function drawPitchTrace(
    ctx: CanvasRenderingContext2D,
    trace: PitchPoint[],
    minFreq: number,
    maxFreq: number,
    startT16: number,
    endT16: number,
    tempo: number,
    timeSig: { numerator: number; denominator: number },
    gridLeft: number,
    gridTop: number,
    gridWidth: number,
    gridHeight: number
  ) {
    if (trace.length < 2) return;
    
    ctx.beginPath();
    let started = false;
    
    for (const point of trace) {
      if (point.frequency <= 0 || point.confidence < 0.5) {
        // No valid pitch - break the line
        if (started) {
          ctx.stroke();
          ctx.beginPath();
          started = false;
        }
        continue;
      }
      
      // Convert time (ms) to t16 position
      const sixteenthMs = sixteenthDurationMs(tempo, timeSig);
      const t16 = point.time / sixteenthMs;
      
      const x = t16ToX(t16, startT16, endT16, gridLeft, gridWidth);
      const y = frequencyToY(point.frequency, minFreq, maxFreq, gridTop, gridHeight);
      
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    
    if (started) {
      ctx.stroke();
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

  return (
    <div 
      ref={containerRef}
      className={`relative w-full h-full ${className}`}
    >
      <canvas 
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
    </div>
  );
}

export default Grid;
