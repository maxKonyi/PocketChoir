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
  cameraLeftWorldT,
  minimapRectWidth,
} from '../../utils/followCamera';
import { getCameraCenterWorldT } from '../../utils/cameraState';

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
  const loopEnabled = useAppStore((state) => state.playback.loopEnabled);
  const loopStart = useAppStore((state) => state.playback.loopStart);
  const loopEnd = useAppStore((state) => state.playback.loopEnd);
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
          : degreeToSemitoneOffset(node.deg ?? 0, node.octave || 0, arrangement.scale);
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

    const fillRoundedRect = (
      x: number,
      y: number,
      w: number,
      h: number,
      r: number
    ) => {
      const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
      ctx.beginPath();
      if ((ctx as any).roundRect) {
        (ctx as any).roundRect(x, y, w, h, radius);
      } else {
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + w, y, x + w, y + h, radius);
        ctx.arcTo(x + w, y + h, x, y + h, radius);
        ctx.arcTo(x, y + h, x, y, radius);
        ctx.arcTo(x, y, x + w, y, radius);
        ctx.closePath();
      }
      ctx.fill();
    };

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
    for (let voiceIndex = 0; voiceIndex < arrangement.voices.length; voiceIndex++) {
      const voice = arrangement.voices[voiceIndex];
      // Get voice color (full opacity, no reduction per spec)
      const voiceColor = voice.color || `var(--voice-${voiceIndex + 1}, #ff6b9d)`;

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
          : degreeToSemitoneOffset(node.deg ?? 0, node.octave || 0, arrangement.scale);

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
    // The viewport rect must reflect exactly what content is visible in the
    // main grid.  When the playhead is near t=0 the camera's left edge is
    // negative (empty space), so we clamp to 0 and shrink the rect.
    //
    // In Play mode, the camera center may differ from the playhead (smart-cam
    // static states or free-look), so we read from the cameraState module.
    // In Create mode, we use the createView camera position.
    const pxPerT = followMode.pxPerT;
    const mode = useAppStore.getState().mode;
    const currentWorldT = followMode.pendingWorldT !== null
      ? followMode.pendingWorldT
      : (mode === 'play'
        ? getCameraCenterWorldT()
        : useAppStore.getState().createView.cameraWorldT);

    // Use the real measured main-grid viewport width (stored by Grid.tsx).
    // Fallback: if it's not measured yet (0), approximate using the old minPxPerT method.
    const mainGridWidth = followMode.viewportWidthPx > 0
      ? followMode.viewportWidthPx
      : (followMode.minPxPerT * loopLengthT);
    const visDur = visibleDurationT(mainGridWidth, pxPerT);

    // Camera edges in world time
    const camLeft = cameraLeftWorldT(currentWorldT, mainGridWidth, pxPerT);
    const camRight = camLeft + visDur;

    // Clamp to content range.
    // Nothing exists before worldT = 0 or after the arrangement end.
    const effectiveLeft = Math.max(0, camLeft);
    const effectiveRight = Math.min(loopLengthT, camRight);
    const effectiveVisDur = Math.max(0, effectiveRight - effectiveLeft);

    // Map effective range into minimap-space (no wrapping — always clamped).
    const clampedLeftT = Math.max(0, Math.min(loopLengthT, effectiveLeft));
    const vpWidth = minimapRectWidth(drawWidth, effectiveVisDur, loopLengthT);
    const vpLeftX = drawLeft + (clampedLeftT / loopLengthT) * drawWidth;
    const vpRightX = vpLeftX + vpWidth;

    // Playhead position in minimap-space (always the actual transport position,
    // NOT the camera center — so the playhead marker moves even when the camera
    // is static / in free-look).
    const actualPlayheadWorldT = playbackEngine.getWorldPositionT16();
    const loopT = Math.max(0, Math.min(loopLengthT, actualPlayheadWorldT));

    // ── Loop region overlay on the minimap ──
    // When the practice loop is enabled, shade the loop region and dim the rest.
    if (loopEnabled) {
      // Dim regions outside the loop
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      const loopStartX = drawLeft + (loopStart / loopLengthT) * drawWidth;
      const loopEndX = drawLeft + (loopEnd / loopLengthT) * drawWidth;

      // Left dim (before loop start)
      if (loopStartX > drawLeft) {
        ctx.fillRect(drawLeft, drawTop, loopStartX - drawLeft, drawHeight);
      }
      // Right dim (after loop end)
      if (loopEndX < drawLeft + drawWidth) {
        ctx.fillRect(loopEndX, drawTop, (drawLeft + drawWidth) - loopEndX, drawHeight);
      }

      // Draw loop boundary markers
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
      ctx.lineWidth = 1;
      if (loopStartX >= drawLeft && loopStartX <= drawLeft + drawWidth) {
        ctx.beginPath();
        ctx.moveTo(loopStartX, drawTop);
        ctx.lineTo(loopStartX, drawTop + drawHeight);
        ctx.stroke();
      }
      if (loopEndX >= drawLeft && loopEndX <= drawLeft + drawWidth) {
        ctx.beginPath();
        ctx.moveTo(loopEndX, drawTop);
        ctx.lineTo(loopEndX, drawTop + drawHeight);
        ctx.stroke();
      }
    }

    // Draw the viewport rectangle (always clamped, no wrapping)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
    const viewportCornerRadius = 6;

    if (vpWidth >= drawWidth) {
      // Viewport is as wide as the full minimap
      fillRoundedRect(drawLeft, drawTop, drawWidth, drawHeight, viewportCornerRadius);
    } else {
      // Clamp rect to the minimap bounds
      const clampedLeftPx = Math.max(drawLeft, Math.min(drawLeft + drawWidth, vpLeftX));
      const clampedRightPx = Math.max(drawLeft, Math.min(drawLeft + drawWidth, vpRightX));
      const w = Math.max(0, clampedRightPx - clampedLeftPx);
      fillRoundedRect(clampedLeftPx, drawTop, w, drawHeight, viewportCornerRadius);
    }

    // ── Draw playhead position marker ──
    const playheadX = drawLeft + (loopT / loopLengthT) * drawWidth;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX, drawTop);
    ctx.lineTo(playheadX, drawTop + drawHeight);
    ctx.stroke();

  }, [arrangement, voiceStates, followMode.pxPerT, followMode.minPxPerT, followMode.viewportWidthPx, followMode.pendingWorldT, loopEnabled, loopStart, loopEnd, getPitchBounds]);

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
