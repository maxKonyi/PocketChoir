import type { PitchPoint, Voice } from '../../types';
import { playbackEngine } from '../../services/PlaybackEngine';
import { worldTToScreenX } from '../../utils/followCamera';
import { sixteenthDurationMs } from '../../utils/timing';
import { A4_FREQUENCY, A4_MIDI, semitoneToLabel } from '../../utils/music';
import { getScaleDegreeColor } from '../../utils/colors';
import { degreeToY, semitoneToY } from './gridDataUtils';
import {
  type ContourSegmentStackData,
  type ContourSegmentStackInfo,
  buildContourHoldPieces,
  contourNodeToSemitone,
  createPrismaticContourGradient,
  getContourSegmentStackOffsetY,
  getPrismaticContourColorAtPhase,
  getRightEdgeHoldStackInfo,
} from './gridContourUtils';
import {
  createDialKitPrismaticContourGradient,
  getDialKitPrismaticContourColorAtPhase,
  type useUnisonContourDialKit
} from './UnisonContourDialKit';

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
export function drawVoiceContour(
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
  loopLen: number,
  segmentStackMap: Map<number, ContourSegmentStackData> | undefined,
  stackLineWidth: number,
  splitStackedContours: boolean,
  contourColorMode: 'voice' | 'scaleDegree',
  tonicSemitone: number,
  voiceColor: string,
  noteSize: number,
  unisonDialKitParams?: ReturnType<typeof useUnisonContourDialKit>
): void {
  if (voice.nodes.length === 0) return;

  // Each voice draw starts from a known line style so no dash/gradient settings
  // can leak from earlier voices or other rendering passes.
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Helper: convert a local t16 to screen X via world time
  const nodeToX = (localT16: number) =>
    gridLeftPx + worldTToScreenX(localT16 + tileOffset, camLeft, pxPerT);

  let lastX = 0;
  let lastY = 0;
  let lastRenderedY = 0;
  let lastT16 = 0;
  let lastSemitone = 0;
  let inPhrase = false;
  let hasActivePath = false;
  let activeOffsetY = 0;
  let segmentIndex = 0;

  // Keep unanchored playback extension dashes visually stable even when users
  // increase contour thickness in Display settings.
  const UNANCHORED_DASH_WIDTH_PX = 2.5;
  const UNANCHORED_DASH_PATTERN_PX: [number, number] = [8, 6];

  // Helper for the new scale-degree mode:
  // convert any semitone value to the matching reference color from the user's
  // Visualizer palette (1, b2, 2 ... 7).
  const getColorForSemitone = (semi: number): string => {
    const relativeSemi = semi - tonicSemitone;
    const degreeLabel = semitoneToLabel(relativeSemi);
    return getScaleDegreeColor(degreeLabel);
  };

  // Keep prism colors moving even when camera/playhead is static.
  const PRISM_ANIMATION_SPEED_PX_PER_MS = 0.04;
  const prismAnimationPhasePx = window.performance.now() * PRISM_ANIMATION_SPEED_PX_PER_MS;

  // Subtle glow dedicated to rainbow stack segments so they stand out.
  // This is independent from the global contour glow pass.
  // Note: Glow is now controlled by DialKit enableUnisonGlow toggle

  // Start or switch the active path when a segment's stacking offset changes.
  const ensurePathStart = (startX: number, startBaseY: number, segmentOffsetY: number): number => {
    const startY = startBaseY + segmentOffsetY;

    if (!hasActivePath) {
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      hasActivePath = true;
      activeOffsetY = segmentOffsetY;
      return startY;
    }

    if (Math.abs(activeOffsetY - segmentOffsetY) > 0.001) {
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      activeOffsetY = segmentOffsetY;
    }

    return startY;
  };

  // Draw one hold piece (horizontal segment).
  // If the stack offset changes at this boundary, we switch rows immediately.
  const drawHoldPieceWithOffsetEasing = (
    pieceStartX: number,
    pieceEndX: number,
    baseY: number,
    segmentOffsetY: number,
    stackInfo: ContourSegmentStackInfo | null,
    transitionFromRainbow: boolean = false
  ): number => {
    const targetY = baseY + segmentOffsetY;

    const isStackedPiece = !!stackInfo && stackInfo.stackSize > 1;
    const shouldCollapseToRainbow = isStackedPiece && !splitStackedContours;
    const shouldSkipHiddenStackVoice = shouldCollapseToRainbow && !!stackInfo && stackInfo.stackIndex > 0;
    const shouldDrawRainbow = shouldCollapseToRainbow && !!stackInfo && stackInfo.stackIndex === 0;

    if (shouldSkipHiddenStackVoice) {
      // Non-leading voices disappear while collapsed, so only one rainbow line remains.
      if (hasActivePath) {
        ctx.stroke();
        hasActivePath = false;
      }
      activeOffsetY = segmentOffsetY;
      return targetY;
    }

    if (transitionFromRainbow && pieceEndX > pieceStartX) {
      // Fade from prism color into the voice's true color when peeling off.
      if (hasActivePath) {
        ctx.stroke();
        hasActivePath = false;
      }

      const transition = ctx.createLinearGradient(pieceStartX, targetY, pieceEndX, targetY);
      // IMPORTANT: Use the same phase/color model as the rainbow segment itself.
      // If DialKit is active, this keeps the boundary color continuous when prismCyclePx changes.
      const prismAtStart = unisonDialKitParams && unisonDialKitParams.enablePrismaticGradient
        ? getDialKitPrismaticContourColorAtPhase(pieceStartX + prismAnimationPhasePx, unisonDialKitParams)
        : getPrismaticContourColorAtPhase(pieceStartX + prismAnimationPhasePx);
      const dist = Math.max(1, pieceEndX - pieceStartX);
      const blendRatio = Math.min(0.5, 40 / dist);
      transition.addColorStop(0, prismAtStart);
      transition.addColorStop(blendRatio, voiceColor);
      transition.addColorStop(1, voiceColor);

      ctx.save();
      ctx.strokeStyle = transition;
      ctx.beginPath();
      ctx.moveTo(pieceStartX, targetY);
      ctx.lineTo(pieceEndX, targetY);
      ctx.stroke();
      ctx.restore();

      activeOffsetY = segmentOffsetY;
      return targetY;
    }

    if (shouldDrawRainbow) {
      // Rainbow stack segments are drawn independently to avoid recoloring normal
      // single-voice sections before/after the stack.
      if (hasActivePath) {
        ctx.stroke();
        hasActivePath = false;
      }

      if (pieceEndX > pieceStartX) {
        // Use DialKit parameters if available, otherwise fall back to defaults
        const prismGradient = unisonDialKitParams && unisonDialKitParams.enablePrismaticGradient
          ? createDialKitPrismaticContourGradient(
            ctx,
            pieceStartX,
            targetY,
            pieceEndX,
            targetY,
            pieceStartX + prismAnimationPhasePx,
            unisonDialKitParams
          )
          : createPrismaticContourGradient(
            ctx,
            pieceStartX,
            targetY,
            pieceEndX,
            targetY,
            pieceStartX + prismAnimationPhasePx
          );

        ctx.save();

        // Apply DialKit glow settings if available and enabled
        if (unisonDialKitParams && unisonDialKitParams.enableUnisonGlow) {
          ctx.shadowBlur = unisonDialKitParams.unisonGlowBlur * unisonDialKitParams.unisonGlowIntensity;
          ctx.shadowColor = unisonDialKitParams.enablePrismaticGradient
            ? getDialKitPrismaticContourColorAtPhase(pieceStartX + prismAnimationPhasePx, unisonDialKitParams)
            : getPrismaticContourColorAtPhase(pieceStartX + prismAnimationPhasePx);
          // Line width inherits from normal contour line width
          ctx.globalAlpha = unisonDialKitParams.unisonOpacity;
        } else {
          // No glow when enableUnisonGlow is OFF
          ctx.shadowBlur = 0;
          ctx.shadowColor = 'transparent';
        }

        ctx.strokeStyle = prismGradient;
        ctx.beginPath();
        ctx.moveTo(pieceStartX, targetY);
        ctx.lineTo(pieceEndX, targetY);
        ctx.stroke();
        ctx.restore();
      }

      activeOffsetY = segmentOffsetY;
      return targetY;
    }

    if (!hasActivePath) {
      ctx.beginPath();
      ctx.moveTo(pieceStartX, targetY);
      hasActivePath = true;
      activeOffsetY = segmentOffsetY;
    }

    const hasOffsetChange = Math.abs(activeOffsetY - segmentOffsetY) > 0.001;
    if (hasOffsetChange) {
      const fromY = baseY + activeOffsetY;
      ctx.lineTo(pieceStartX, fromY);
      ctx.lineTo(pieceStartX, targetY);
      if (pieceEndX > pieceStartX) {
        ctx.lineTo(pieceEndX, targetY);
      }

      activeOffsetY = segmentOffsetY;
      return targetY;
    }

    if (pieceEndX > pieceStartX) {
      ctx.lineTo(pieceEndX, targetY);
    }
    return targetY;
  };

  // Draw one bend (straight or curved) from start to end.
  const drawBendPathSegment = (
    bendStartX: number,
    bendStartY: number,
    bendEndX: number,
    bendEndY: number
  ) => {
    const nodeRadius = 12 * noteSize;
    const bendWidth = Math.max(0, bendEndX - bendStartX);

    if (Math.abs(bendEndY - bendStartY) < 1 || bendWidth < 0.001) {
      // Same pitch, or tiny bend width: just draw a straight line.
      ctx.lineTo(bendEndX, bendEndY);
      return;
    }

    // Pitch changes: enter from bottom if moving up, top if moving down.
    const isMovingUp = bendEndY < bendStartY;
    const entryY = isMovingUp ? bendEndY + nodeRadius : bendEndY - nodeRadius;

    const cp1x = bendStartX + bendWidth * 0.5;
    const cp1y = bendStartY;
    const cp2x = bendEndX;
    const cp2y = bendStartY;

    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, bendEndX, entryY);
    ctx.lineTo(bendEndX, bendEndY);
  };

  // Optional mode: draw by scale degree color instead of per-voice color.
  // We draw each hold/bend immediately so every segment can have its own color,
  // and bends can smoothly gradient between the two pitch colors.
  if (contourColorMode === 'scaleDegree') {
    for (let i = 0; i < voice.nodes.length; i++) {
      const node = voice.nodes[i];

      if (node.term) {
        if (inPhrase) {
          const segmentData = segmentStackMap?.get(segmentIndex);
          const holdPieces = buildContourHoldPieces(lastT16, node.t16, segmentData?.holdSlices ?? []);
          const holdColor = getColorForSemitone(lastSemitone);

          for (const piece of holdPieces) {
            const stackInfo = piece.stackIndex !== null && piece.stackSize !== null
              ? { stackIndex: piece.stackIndex, stackSize: piece.stackSize }
              : null;
            const segmentOffsetY = stackInfo
              ? (splitStackedContours ? getContourSegmentStackOffsetY(stackInfo, stackLineWidth) : 0)
              : 0;

            const pieceStartX = nodeToX(piece.startT);
            const pieceEndX = nodeToX(piece.endT);
            const yHold = lastY + segmentOffsetY;

            if (pieceEndX > pieceStartX) {
              ctx.save();
              ctx.strokeStyle = holdColor;
              ctx.beginPath();
              ctx.moveTo(pieceStartX, yHold);
              ctx.lineTo(pieceEndX, yHold);
              ctx.stroke();
              ctx.restore();
              lastRenderedY = yHold;
            }
          }

          inPhrase = false;
          segmentIndex += 1;
        }
        continue;
      }

      const x = nodeToX(node.t16);
      const y = node.semi !== undefined
        ? semitoneToY(node.semi, minSemitone, maxSemitone, gridTop, gridHeight)
        : degreeToY(node.deg ?? 0, node.octave || 0, minSemitone, maxSemitone, gridTop, gridHeight, scaleType);
      const nodeSemitone = contourNodeToSemitone(node, scaleType);

      if (!inPhrase) {
        inPhrase = true;
        lastX = x;
        lastY = y;
        lastT16 = node.t16;
        lastSemitone = nodeSemitone;
        lastRenderedY = y;
        continue;
      }

      const segmentData = segmentStackMap?.get(segmentIndex);
      const dt = node.t16 - lastT16;

      if (dt > 0) {
        const isPitchChange = Math.abs(nodeSemitone - lastSemitone) >= 1e-6;
        const bendWidthT = isPitchChange
          ? Math.min(40 / Math.max(pxPerT, 0.0001), dt * 0.8)
          : 0;
        const holdEndT = isPitchChange ? Math.max(lastT16, node.t16 - bendWidthT) : node.t16;

        const holdPieces = buildContourHoldPieces(lastT16, holdEndT, segmentData?.holdSlices ?? []);
        const holdRightStackInfo = getRightEdgeHoldStackInfo(holdPieces);
        const holdColor = getColorForSemitone(lastSemitone);

        for (const piece of holdPieces) {
          const stackInfo = piece.stackIndex !== null && piece.stackSize !== null
            ? { stackIndex: piece.stackIndex, stackSize: piece.stackSize }
            : null;
          const segmentOffsetY = stackInfo
            ? (splitStackedContours ? getContourSegmentStackOffsetY(stackInfo, stackLineWidth) : 0)
            : 0;

          const pieceStartX = nodeToX(piece.startT);
          const pieceEndX = nodeToX(piece.endT);
          const yHold = lastY + segmentOffsetY;

          if (pieceEndX > pieceStartX) {
            ctx.save();
            ctx.strokeStyle = holdColor;
            ctx.beginPath();
            ctx.moveTo(pieceStartX, yHold);
            ctx.lineTo(pieceEndX, yHold);
            ctx.stroke();
            ctx.restore();
            lastRenderedY = yHold;
          }
        }

        if (isPitchChange) {
          const bendStackInfo = segmentData?.bendStack;
          const bendStartOffsetY = holdRightStackInfo
            ? (splitStackedContours ? getContourSegmentStackOffsetY(holdRightStackInfo, stackLineWidth) : 0)
            : 0;
          const bendEndOffsetY = bendStackInfo
            ? (splitStackedContours ? getContourSegmentStackOffsetY(bendStackInfo, stackLineWidth) : 0)
            : 0;

          const bendStartX = nodeToX(holdEndT);
          const bendStartY = lastY + bendStartOffsetY;
          const bendEndY = y + bendEndOffsetY;

          const startColor = getColorForSemitone(lastSemitone);
          const endColor = getColorForSemitone(nodeSemitone);
          const bendGradient = ctx.createLinearGradient(bendStartX, bendStartY, x, bendEndY);
          bendGradient.addColorStop(0, startColor);
          bendGradient.addColorStop(1, endColor);

          ctx.save();
          ctx.strokeStyle = bendGradient;
          ctx.beginPath();
          ctx.moveTo(bendStartX, bendStartY);
          drawBendPathSegment(bendStartX, bendStartY, x, bendEndY);
          ctx.stroke();
          ctx.restore();

          lastRenderedY = bendEndY;
        }
      }

      lastX = x;
      lastY = y;
      lastT16 = node.t16;
      lastSemitone = nodeSemitone;
      segmentIndex += 1;
    }

    if (inPhrase && playbackEngine.getIsPlaying()) {
      const endX = nodeToX(loopLen);
      const holdColor = getColorForSemitone(lastSemitone);
      ctx.save();
      ctx.strokeStyle = holdColor;
      ctx.lineWidth = UNANCHORED_DASH_WIDTH_PX;
      ctx.lineCap = 'butt';
      ctx.setLineDash(UNANCHORED_DASH_PATTERN_PX);
      ctx.beginPath();
      ctx.moveTo(lastX, lastRenderedY);
      ctx.lineTo(endX, lastRenderedY);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
    return;
  }

  for (let i = 0; i < voice.nodes.length; i++) {
    const node = voice.nodes[i];

    // Termination node ends the current phrase.
    if (node.term) {
      if (inPhrase) {
        const segmentData = segmentStackMap?.get(segmentIndex);
        const holdPieces = buildContourHoldPieces(lastT16, node.t16, segmentData?.holdSlices ?? []);

        for (let pIdx = 0; pIdx < holdPieces.length; pIdx++) {
          const piece = holdPieces[pIdx];
          const stackInfo = piece.stackIndex !== null && piece.stackSize !== null
            ? { stackIndex: piece.stackIndex, stackSize: piece.stackSize }
            : null;
          const segmentOffsetY = stackInfo
            ? (splitStackedContours ? getContourSegmentStackOffsetY(stackInfo, stackLineWidth) : 0)
            : 0;

          const pieceStartX = nodeToX(piece.startT);
          const pieceEndX = nodeToX(piece.endT);

          const isStacked = !!stackInfo && stackInfo.stackSize > 1;
          const prevPiece = pIdx > 0 ? holdPieces[pIdx - 1] : null;
          const prevIsStacked = !!prevPiece && prevPiece.stackSize !== null && prevPiece.stackSize > 1;
          const transitionFromRainbow = !splitStackedContours && !isStacked && prevIsStacked;

          const stackedY = drawHoldPieceWithOffsetEasing(
            pieceStartX,
            pieceEndX,
            lastY,
            segmentOffsetY,
            stackInfo,
            transitionFromRainbow
          );
          lastRenderedY = stackedY;
        }

        if (hasActivePath) {
          ctx.stroke();
          hasActivePath = false;
        } else {
          // Rainbow pieces are drawn as independent immediate strokes.
          // Clear any residual canvas path so later fallback strokes do not repaint
          // that segment with the plain voice color.
          ctx.beginPath();
        }
        inPhrase = false;
        segmentIndex += 1;
      }
      continue;
    }

    const x = nodeToX(node.t16);
    const y = node.semi !== undefined
      ? semitoneToY(node.semi, minSemitone, maxSemitone, gridTop, gridHeight)
      : degreeToY(node.deg ?? 0, node.octave || 0, minSemitone, maxSemitone, gridTop, gridHeight, scaleType);
    const nodeSemitone = contourNodeToSemitone(node, scaleType);

    if (!inPhrase) {
      inPhrase = true;
      lastX = x;
      lastY = y;
      lastT16 = node.t16;
      lastSemitone = nodeSemitone;
      lastRenderedY = y;
      continue;
    }

    const segmentData = segmentStackMap?.get(segmentIndex);
    const dt = node.t16 - lastT16;

    if (dt > 0) {
      const isPitchChange = Math.abs(nodeSemitone - lastSemitone) >= 1e-6;
      const bendWidthT = isPitchChange
        ? Math.min(40 / Math.max(pxPerT, 0.0001), dt * 0.8)
        : 0;
      const holdEndT = isPitchChange ? Math.max(lastT16, node.t16 - bendWidthT) : node.t16;

      const holdPieces = buildContourHoldPieces(lastT16, holdEndT, segmentData?.holdSlices ?? []);
      const holdRightStackInfo = getRightEdgeHoldStackInfo(holdPieces);
      for (let pIdx = 0; pIdx < holdPieces.length; pIdx++) {
        const piece = holdPieces[pIdx];
        const stackInfo = piece.stackIndex !== null && piece.stackSize !== null
          ? { stackIndex: piece.stackIndex, stackSize: piece.stackSize }
          : null;
        const segmentOffsetY = stackInfo
          ? (splitStackedContours ? getContourSegmentStackOffsetY(stackInfo, stackLineWidth) : 0)
          : 0;

        const pieceStartX = nodeToX(piece.startT);
        const pieceEndX = nodeToX(piece.endT);

        const isStacked = !!stackInfo && stackInfo.stackSize > 1;
        const prevPiece = pIdx > 0 ? holdPieces[pIdx - 1] : null;
        const prevIsStacked = !!prevPiece && prevPiece.stackSize !== null && prevPiece.stackSize > 1;
        const transitionFromRainbow = !splitStackedContours && !isStacked && prevIsStacked;

        const stackedY = drawHoldPieceWithOffsetEasing(
          pieceStartX,
          pieceEndX,
          lastY,
          segmentOffsetY,
          stackInfo,
          transitionFromRainbow
        );
        lastRenderedY = stackedY;
      }

      if (isPitchChange) {
        const bendStackInfo = segmentData?.bendStack;
        const bendStartOffsetY = holdRightStackInfo
          ? (splitStackedContours ? getContourSegmentStackOffsetY(holdRightStackInfo, stackLineWidth) : 0)
          : 0;
        const bendEndOffsetY = bendStackInfo
          ? (splitStackedContours ? getContourSegmentStackOffsetY(bendStackInfo, stackLineWidth) : 0)
          : 0;

        const bendStartX = nodeToX(holdEndT);
        const bendStartY = lastY + bendStartOffsetY;
        const stackedY = y + bendEndOffsetY;

        const isStackedBend = !!bendStackInfo && bendStackInfo.stackSize > 1;
        const shouldCollapseBendToRainbow = isStackedBend && !splitStackedContours;
        const shouldSkipHiddenBend = shouldCollapseBendToRainbow && !!bendStackInfo && bendStackInfo.stackIndex > 0;
        const shouldDrawRainbowBend = shouldCollapseBendToRainbow && !!bendStackInfo && bendStackInfo.stackIndex === 0;

        if (shouldSkipHiddenBend) {
          // Non-leading bend voices are hidden while collapsed so one rainbow
          // bend represents the whole stack.
          if (hasActivePath) {
            ctx.stroke();
            hasActivePath = false;
          }
          activeOffsetY = bendEndOffsetY;
        } else if (shouldDrawRainbowBend) {
          if (hasActivePath) {
            ctx.stroke();
            hasActivePath = false;
          }

          const prismGradient = unisonDialKitParams && unisonDialKitParams.enablePrismaticGradient
            ? createDialKitPrismaticContourGradient(
              ctx,
              bendStartX,
              bendStartY,
              x,
              stackedY,
              bendStartX + prismAnimationPhasePx,
              unisonDialKitParams
            )
            : createPrismaticContourGradient(
              ctx,
              bendStartX,
              bendStartY,
              x,
              stackedY,
              bendStartX + prismAnimationPhasePx
            );

          ctx.save();

          // Apply DialKit glow settings if available and enabled
          if (unisonDialKitParams && unisonDialKitParams.enableUnisonGlow) {
            ctx.shadowBlur = unisonDialKitParams.unisonGlowBlur * unisonDialKitParams.unisonGlowIntensity;
            ctx.shadowColor = unisonDialKitParams.enablePrismaticGradient
              ? getDialKitPrismaticContourColorAtPhase(bendStartX + prismAnimationPhasePx, unisonDialKitParams)
              : getPrismaticContourColorAtPhase(bendStartX + prismAnimationPhasePx);
            ctx.globalAlpha = unisonDialKitParams.unisonOpacity;
          } else {
            // No glow when enableUnisonGlow is OFF
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';
          }

          ctx.strokeStyle = prismGradient;
          ctx.beginPath();
          ctx.moveTo(bendStartX, bendStartY);
          drawBendPathSegment(bendStartX, bendStartY, x, stackedY);
          ctx.stroke();
          ctx.restore();

          activeOffsetY = bendEndOffsetY;
        } else {
          const transitionFromRainbowBend =
            !splitStackedContours &&
            !!holdRightStackInfo &&
            holdRightStackInfo.stackSize > 1 &&
            (!bendStackInfo || bendStackInfo.stackSize <= 1);

          if (transitionFromRainbowBend) {
            if (hasActivePath) {
              ctx.stroke();
              hasActivePath = false;
            }

            const transition = ctx.createLinearGradient(bendStartX, bendStartY, x, stackedY);
            // IMPORTANT: Use the same phase/color model as the rainbow bend segment.
            // This avoids a color jump at the bend boundary when DialKit cycle differs from legacy 400px.
            const prismAtStart = unisonDialKitParams && unisonDialKitParams.enablePrismaticGradient
              ? getDialKitPrismaticContourColorAtPhase(bendStartX + prismAnimationPhasePx, unisonDialKitParams)
              : getPrismaticContourColorAtPhase(bendStartX + prismAnimationPhasePx);
            const bendDist = Math.max(1, Math.sqrt((x - bendStartX) ** 2 + (stackedY - bendStartY) ** 2));
            const blendRatio = Math.min(0.5, 40 / bendDist);
            transition.addColorStop(0, prismAtStart);
            transition.addColorStop(blendRatio, voiceColor);
            transition.addColorStop(1, voiceColor);

            ctx.save();
            ctx.strokeStyle = transition;
            ctx.beginPath();
            ctx.moveTo(bendStartX, bendStartY);
            drawBendPathSegment(bendStartX, bendStartY, x, stackedY);
            ctx.stroke();
            ctx.restore();

            activeOffsetY = bendEndOffsetY;
          } else {
            const stackedLastY = ensurePathStart(bendStartX, lastY, bendStartOffsetY);
            drawBendPathSegment(bendStartX, stackedLastY, x, stackedY);
          }
        }

        lastRenderedY = stackedY;
      }
    }

    lastX = x;
    lastY = y;
    lastT16 = node.t16;
    lastSemitone = nodeSemitone;
    segmentIndex += 1;
  }

  if (inPhrase) {
    // Phrase has no drawable segment yet (single node phrase).
    // Seed a path so stroke/dash behavior remains identical to old behavior.
    if (!hasActivePath) {
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      hasActivePath = true;
      lastRenderedY = lastY;
    }

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
      ctx.moveTo(lastX, lastRenderedY);
      ctx.lineWidth = UNANCHORED_DASH_WIDTH_PX;
      ctx.lineCap = 'butt';
      ctx.setLineDash(UNANCHORED_DASH_PATTERN_PX);
      ctx.lineTo(endX, lastRenderedY);
      ctx.stroke();
      ctx.restore();
    } else if (hasActivePath) {
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Draw a pitch trace (user recording) with clean, neon glow.
 * Uses follow-mode world-time coordinates for tiled rendering.
 */
export function drawPitchTrace(
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
    headXOverride?: number;
  }
): void {
  if (trace.length < 2) return;

  const {
    color,
    lineWidth,
    opacity,
    isLive,
    effectiveTonicMidi,
    minSemitone,
    maxSemitone,
    worldTimeOffset,
    camLeft: optCamLeft,
    pxPerT: optPxPerT,
    headXOverride,
  } = options;

  // Helper: convert a local t16 to screen X via world time
  const traceToX = (localT16: number) =>
    gridLeft + worldTToScreenX(localT16 + worldTimeOffset, optCamLeft, optPxPerT);

  function getPitchY(frequency: number): number {
    // Calibrate against the grid:
    // 1. Get MIDI pitch of frequency
    const midi = A4_MIDI + 12 * Math.log2(frequency / A4_FREQUENCY);
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

    // Keep track of the last point we actually drew.
    // We use this to "extend" the trace line to the playhead when the live head
    // glow is pinned there (headXOverride). This avoids a visible gap between the
    // end of the line and the glow tip, at the cost of briefly holding the last
    // known pitch until the next detected pitch point arrives.
    let lastDrawnX = 0;
    let lastDrawnY = 0;
    let hasLastDrawn = false;

    // Pre-compute once — this value is constant for every point in the trace.
    const sixteenthMs = sixteenthDurationMs(tempo, timeSig);

    for (const point of trace) {
      const isGap =
        !Number.isFinite(point.frequency)
        || point.frequency <= 0
        || (lastPointTime !== -1 && point.time - lastPointTime > 150);

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

      const t16 = point.time / sixteenthMs;
      const x = traceToX(t16);
      const y = getPitchY(point.frequency);

      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }

      lastDrawnX = x;
      lastDrawnY = y;
      hasLastDrawn = true;
      lastPointTime = point.time;
    }

    if (started) {
      // If this is the live trace and the head is pinned to the playhead X,
      // extend the final segment so the line stays attached to the head glow.
      if (headXOverride !== undefined && hasLastDrawn && headXOverride > lastDrawnX) {
        ctx.lineTo(headXOverride, lastDrawnY);
      }
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
      const x = headXOverride ?? traceToX(t16);
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
