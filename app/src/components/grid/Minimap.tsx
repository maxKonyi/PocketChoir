/* ============================================================
   MINIMAP COMPONENT

   A compressed contour preview of the entire arrangement,
   shown below the main grid. Displays:
   - One loop cycle [0, loopLengthT) of contour previews
   - A viewport rectangle showing the currently visible region
   - Click to seek immediately; drag for seek-on-release

   The minimap is always exactly one loop wide.
   ============================================================ */

import React, { useCallback, useEffect, useRef } from 'react';
import type { Arrangement } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { playbackEngine } from '../../services/PlaybackEngine';
import { degreeToSemitoneOffset } from '../../utils/music';
import {
  visibleDurationT,
  worldTToLoopT,
  minimapRectWidth,
} from '../../utils/followCamera';

/* ------------------------------------------------------------
   Types
   ------------------------------------------------------------ */

interface MinimapProps {
  arrangement: Arrangement | null;
  className?: string;
}

/* ------------------------------------------------------------
   Constants
   ------------------------------------------------------------ */

// Height of the minimap canvas in CSS pixels
const MINIMAP_HEIGHT = 40;

// Horizontal padding inside the minimap
const MINIMAP_PAD = 4;

/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export function Minimap({ arrangement, className = '' }: MinimapProps) {
  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Store state
  const voiceStates = useAppStore((state) => state.voiceStates);
  const followMode = useAppStore((state) => state.followMode);
  const startMinimapDrag = useAppStore((state) => state.startMinimapDrag);
  const updatePendingWorldT = useAppStore((state) => state.updatePendingWorldT);
  const commitMinimapDrag = useAppStore((state) => state.commitMinimapDrag);

  // Ref to track if we are dragging inside the minimap
  const isDraggingRef = useRef(false);

  /**
   * Compute the pitch range from the arrangement (simplified version).
   * Returns { minSemi, maxSemi } relative to tonic.
   */
  const getPitchBounds = useCallback(() => {
    if (!arrangement) return { minSemi: -5, maxSemi: 19 };

    let minSemi = Infinity;
    let maxSemi = -Infinity;

    for (const voice of arrangement.voices) {
      for (const node of voice.nodes) {
        if (node.term) continue;
        const semi = node.semi !== undefined
          ? node.semi
          : degreeToSemitoneOffset(node.deg, node.octave || 0, arrangement.scale);
        minSemi = Math.min(minSemi, semi);
        maxSemi = Math.max(maxSemi, semi);
      }
    }

    if (!isFinite(minSemi)) return { minSemi: -5, maxSemi: 19 };

    // Add padding
    const pad = 3;
    return { minSemi: minSemi - pad, maxSemi: maxSemi + pad };
  }, [arrangement]);

  /**
   * Main drawing function for the minimap.
   */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !arrangement) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = rect.width;
    const height = rect.height;

    // Usable area inside the minimap (with padding)
    const drawLeft = MINIMAP_PAD;
    const drawWidth = width - MINIMAP_PAD * 2;
    const drawTop = 2;
    const drawHeight = height - 4;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    if ((ctx as any).roundRect) {
      (ctx as any).roundRect(0, 0, width, height, 6);
    } else {
      ctx.rect(0, 0, width, height);
    }
    ctx.fill();

    // Arrangement dimensions
    const loopLengthT = arrangement.bars * arrangement.timeSig.numerator * 4;
    if (loopLengthT <= 0) return;

    const { minSemi, maxSemi } = getPitchBounds();
    const semiRange = maxSemi - minSemi;
    if (semiRange <= 0) return;

    // Helper: convert local t16 → minimap X
    const tToX = (t16: number) => drawLeft + (t16 / loopLengthT) * drawWidth;

    // Helper: convert semitone → minimap Y
    const semiToY = (semi: number) => {
      const frac = (maxSemi - semi) / semiRange;
      return drawTop + frac * drawHeight;
    };

    // ── Draw contour previews for each voice ──
    // Solo/mute check
    const anySoloActive = voiceStates.some(v => v.synthSolo || v.vocalSolo);

    for (let voiceIndex = 0; voiceIndex < arrangement.voices.length; voiceIndex++) {
      const voice = arrangement.voices[voiceIndex];
      const voiceState = voiceStates.find(v => v.voiceId === voice.id);
      const isMuted = (voiceState?.synthMuted ?? false) || (anySoloActive && !(voiceState?.synthSolo ?? false));

      // Get voice color (full opacity, no reduction per spec)
      const voiceColor = isMuted
        ? 'rgba(100, 100, 100, 0.3)'
        : (voice.color || `var(--voice-${voiceIndex + 1}, #ff6b9d)`);

      ctx.strokeStyle = voiceColor;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      let inPhrase = false;
      let lastY = 0;

      for (const node of voice.nodes) {
        if (node.term) {
          if (inPhrase) {
            // Extend to termination time
            const termX = tToX(node.t16);
            ctx.lineTo(termX, lastY);
            ctx.stroke();
            ctx.beginPath();
            inPhrase = false;
          }
          continue;
        }

        const semi = node.semi !== undefined
          ? node.semi
          : degreeToSemitoneOffset(node.deg, node.octave || 0, arrangement.scale);

        const x = tToX(node.t16);
        const y = semiToY(semi);

        if (!inPhrase) {
          ctx.moveTo(x, y);
          inPhrase = true;
        } else {
          // Horizontal hold then jump to new pitch
          ctx.lineTo(x, lastY);
          ctx.lineTo(x, y);
        }
        lastY = y;
      }

      if (inPhrase) {
        // Extend to end of loop
        ctx.lineTo(tToX(loopLengthT), lastY);
        ctx.stroke();
      }
    }

    // ── Draw viewport rectangle ──
    const pxPerT = followMode.pxPerT;
    const currentWorldT = followMode.pendingWorldT !== null
      ? followMode.pendingWorldT
      : playbackEngine.getWorldPositionT16();

    // Derive the actual main grid pixel width from the stored minPxPerT floor.
    // minPxPerT = gridWidth / loopLengthT, so gridWidth = minPxPerT * loopLengthT.
    const mainGridWidth = followMode.minPxPerT * loopLengthT;
    const visDur = visibleDurationT(mainGridWidth, pxPerT);
    // Viewport rect width in minimap pixels
    const vpWidth = minimapRectWidth(drawWidth, visDur, loopLengthT);

    // Where is the center of the viewport in loop-space?
    const loopT = worldTToLoopT(currentWorldT, loopLengthT);
    const vpCenterX = drawLeft + (loopT / loopLengthT) * drawWidth;

    // Draw the viewport rectangle (may wrap around edges)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';

    const vpLeftX = vpCenterX - vpWidth / 2;
    const vpRightX = vpCenterX + vpWidth / 2;

    if (vpWidth >= drawWidth) {
      // Viewport is as wide as the full minimap
      ctx.fillRect(drawLeft, drawTop, drawWidth, drawHeight);
      ctx.strokeRect(drawLeft, drawTop, drawWidth, drawHeight);
    } else if (vpLeftX >= drawLeft && vpRightX <= drawLeft + drawWidth) {
      // Viewport fits entirely within the minimap — no wrapping
      ctx.fillRect(vpLeftX, drawTop, vpWidth, drawHeight);
      ctx.strokeRect(vpLeftX, drawTop, vpWidth, drawHeight);
    } else {
      // Viewport wraps around the edges — draw two rectangles
      if (vpLeftX < drawLeft) {
        // Left portion wraps to the right side
        const leftPartWidth = drawLeft - vpLeftX;
        const rightPartWidth = vpWidth - leftPartWidth;
        // Right portion (start of viewport)
        ctx.fillRect(drawLeft + drawWidth - leftPartWidth, drawTop, leftPartWidth, drawHeight);
        ctx.strokeRect(drawLeft + drawWidth - leftPartWidth, drawTop, leftPartWidth, drawHeight);
        // Left portion (main)
        ctx.fillRect(drawLeft, drawTop, rightPartWidth, drawHeight);
        ctx.strokeRect(drawLeft, drawTop, rightPartWidth, drawHeight);
      } else {
        // Right portion wraps to the left side
        const rightOverflow = vpRightX - (drawLeft + drawWidth);
        const mainWidth = vpWidth - rightOverflow;
        // Main portion
        ctx.fillRect(vpLeftX, drawTop, mainWidth, drawHeight);
        ctx.strokeRect(vpLeftX, drawTop, mainWidth, drawHeight);
        // Wrapped portion
        ctx.fillRect(drawLeft, drawTop, rightOverflow, drawHeight);
        ctx.strokeRect(drawLeft, drawTop, rightOverflow, drawHeight);
      }
    }

    // ── Draw playhead position marker ──
    const playheadX = drawLeft + (loopT / loopLengthT) * drawWidth;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX, drawTop);
    ctx.lineTo(playheadX, drawTop + drawHeight);
    ctx.stroke();

  }, [arrangement, voiceStates, followMode.pxPerT, followMode.pendingWorldT, getPitchBounds]);

  // ── Animation loop ──
  useEffect(() => {
    let animationId: number;
    const animate = () => {
      draw();
      animationId = requestAnimationFrame(animate);
    };
    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [draw]);

  /**
   * Convert a minimap click X → world time, preserving current loop count.
   */
  const minimapXToWorldT = useCallback((clientX: number): number => {
    if (!arrangement || !containerRef.current) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left - MINIMAP_PAD;
    const drawWidth = rect.width - MINIMAP_PAD * 2;
    const loopLengthT = arrangement.bars * arrangement.timeSig.numerator * 4;

    // Where in the loop did they click?
    const clickFrac = Math.max(0, Math.min(1, x / drawWidth));
    const clickLoopT = clickFrac * loopLengthT;

    // Preserve current loop iteration
    const currentWorldT = playbackEngine.getWorldPositionT16();
    const currentLoop = Math.floor(currentWorldT / loopLengthT);
    return Math.max(0, currentLoop * loopLengthT + clickLoopT);
  }, [arrangement]);

  /**
   * Click on minimap: seek immediately.
   */
  const handleClick = useCallback((e: React.MouseEvent) => {
    // Don't seek if we were dragging (the mouseUp handler does that)
    if (isDraggingRef.current) return;
    const worldT = minimapXToWorldT(e.clientX);
    playbackEngine.seekWorld(worldT);
  }, [minimapXToWorldT]);

  /**
   * Mouse down: begin minimap drag.
   */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = false;
    startMinimapDrag();
    const worldT = minimapXToWorldT(e.clientX);
    updatePendingWorldT(worldT);

    // Track movement to distinguish click from drag
    const startX = e.clientX;

    const handleMove = (me: MouseEvent) => {
      if (Math.abs(me.clientX - startX) > 3) {
        isDraggingRef.current = true;
      }
      const wt = minimapXToWorldT(me.clientX);
      updatePendingWorldT(wt);
    };

    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);

      const pending = useAppStore.getState().followMode.pendingWorldT;
      if (pending !== null) {
        playbackEngine.seekWorld(pending);
      }
      commitMinimapDrag();
      // Reset drag tracking after a short delay so click handler doesn't fire
      setTimeout(() => { isDraggingRef.current = false; }, 10);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [minimapXToWorldT, startMinimapDrag, updatePendingWorldT, commitMinimapDrag]);

  if (!arrangement) return null;

  return (
    <div
      ref={containerRef}
      className={`relative cursor-pointer ${className}`}
      style={{ height: MINIMAP_HEIGHT }}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full rounded-md"
      />
    </div>
  );
}

export default Minimap;
