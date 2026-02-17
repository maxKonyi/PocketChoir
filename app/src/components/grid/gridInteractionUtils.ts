import type { Arrangement } from '../../types';
import { cameraLeftWorldT, screenXToWorldT, worldTToScreenX } from '../../utils/followCamera';
import { degreeToY, semitoneToY } from './gridDataUtils';
import {
  type ContourStackLookup,
  buildContourHoldPieces,
  contourNodeToSemitone,
  getContourSegmentStackOffsetY,
  getRightEdgeHoldStackInfo,
} from './gridContourUtils';

/**
 * Compute squared distance from a point to a line segment.
 *
 * We use squared distance (no sqrt) for performance during frequent mouse-move hit tests.
 */
export function pointToSegmentDistanceSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  // Degenerate segment: treat as a point.
  if (lenSq === 0) {
    const pdx = px - ax;
    const pdy = py - ay;
    return pdx * pdx + pdy * pdy;
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const ddx = px - projX;
  const ddy = py - projY;
  return ddx * ddx + ddy * ddy;
}

/**
 * Find which loop handle is nearest to the mouse (if inside the grab threshold).
 */
export function getNearestLoopHandle(
  mouseX: number,
  loopStartX: number,
  loopEndX: number,
  handleHitPx: number,
): 'start' | 'end' | null {
  const distToStart = Math.abs(mouseX - loopStartX);
  const distToEnd = Math.abs(mouseX - loopEndX);

  if (distToStart > handleHitPx && distToEnd > handleHitPx) {
    return null;
  }

  return distToStart <= distToEnd ? 'start' : 'end';
}

/**
 * True when mouse X is within loop-handle grab range of either boundary.
 */
export function isMouseNearLoopHandle(
  mouseX: number,
  loopStartX: number,
  loopEndX: number,
  handleHitPx: number,
): boolean {
  return getNearestLoopHandle(mouseX, loopStartX, loopEndX, handleHitPx) !== null;
}

type LoopBoundaryScreenParams = {
  loopStartT: number;
  loopEndT: number;
  gridLeftPx: number;
  gridWidthPx: number;
  pxPerT: number;
  worldT: number;
};

/**
 * Convert loop boundary times (t16) into screen X values for hit/hover checks.
 */
export function getLoopBoundaryScreenPositions(params: LoopBoundaryScreenParams): {
  loopStartX: number;
  loopEndX: number;
} {
  const { loopStartT, loopEndT, gridLeftPx, gridWidthPx, pxPerT, worldT } = params;
  const camLeft = cameraLeftWorldT(worldT, gridWidthPx, pxPerT);
  return {
    loopStartX: gridLeftPx + worldTToScreenX(loopStartT, camLeft, pxPerT),
    loopEndX: gridLeftPx + worldTToScreenX(loopEndT, camLeft, pxPerT),
  };
}

type SnappedLoopTimeParams = {
  mouseX: number;
  gridLeftPx: number;
  gridWidthPx: number;
  pxPerT: number;
  worldT: number;
  arrangementLengthT16: number;
};

/**
 * Convert loop-drag mouse position to the nearest valid loop boundary time (t16).
 */
export function getSnappedLoopTimeFromMouseX(params: SnappedLoopTimeParams): number {
  const {
    mouseX,
    gridLeftPx,
    gridWidthPx,
    pxPerT,
    worldT,
    arrangementLengthT16,
  } = params;

  const camLeft = cameraLeftWorldT(worldT, gridWidthPx, pxPerT);
  const rawT = screenXToWorldT(mouseX - gridLeftPx, camLeft, pxPerT);
  return Math.round(Math.max(0, Math.min(arrangementLengthT16, rawT)));
}

type GroupDragDeltaParams = {
  startMouseX: number;
  startMouseY: number;
  currentMouseX: number;
  currentMouseY: number;
  lastDeltaT16: number;
  lastDeltaSemi: number;
  pxPerT: number;
  minSemitone: number;
  maxSemitone: number;
  gridHeightPx: number;
};

/**
 * Convert group-drag mouse movement into both absolute and incremental deltas.
 *
 * - Time delta is measured in 16th notes (t16).
 * - Pitch delta is measured in semitones.
 */
export function getGroupDragDelta(params: GroupDragDeltaParams): {
  newDeltaT16: number;
  newDeltaSemi: number;
  incrT16: number;
  incrSemi: number;
} {
  const {
    startMouseX,
    startMouseY,
    currentMouseX,
    currentMouseY,
    lastDeltaT16,
    lastDeltaSemi,
    pxPerT,
    minSemitone,
    maxSemitone,
    gridHeightPx,
  } = params;

  const dxPx = currentMouseX - startMouseX;
  const dyPx = currentMouseY - startMouseY;

  const newDeltaT16 = Math.round(dxPx / pxPerT);
  const safeGridHeight = Math.max(1, gridHeightPx);
  const semitonesPerPx = (maxSemitone - minSemitone) / safeGridHeight;
  // Negative dy = mouse moved up = higher pitch = positive semitone delta.
  const newDeltaSemi = Math.round(-dyPx * semitonesPerPx);

  return {
    newDeltaT16,
    newDeltaSemi,
    incrT16: newDeltaT16 - lastDeltaT16,
    incrSemi: newDeltaSemi - lastDeltaSemi,
  };
}

/**
 * Determine if keyboard input is currently focused in an editable text target.
 *
 * This prevents global hotkeys from firing while users type in text inputs.
 */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName;
  return target.isContentEditable
    || tag === 'INPUT'
    || tag === 'TEXTAREA'
    || (target as HTMLInputElement).type === 'text';
}

type ContourHitTestParams = {
  arrangement: Arrangement;
  contourStackLookup: ContourStackLookup;
  mouseX: number;
  mouseY: number;
  gridLeft: number;
  gridTop: number;
  gridWidth: number;
  gridHeight: number;
  minSemitone: number;
  maxSemitone: number;
  noteSize: number;
  lineThickness: number;
  pxPerT: number;
  worldT: number;
  splitStackedContoursForHit: boolean;
};

/**
 * Check if the mouse is near any voice's contour line.
 * Returns the closest voiceId inside threshold, or null.
 *
 * This is a pure helper so Grid can reuse the exact same geometry math
 * while keeping the React hook body much smaller.
 */
export function getContourHitAtMouseVoiceId(params: ContourHitTestParams): string | null {
  const {
    arrangement,
    contourStackLookup,
    mouseX,
    mouseY,
    gridLeft,
    gridTop,
    gridWidth,
    gridHeight,
    minSemitone,
    maxSemitone,
    noteSize,
    lineThickness,
    pxPerT,
    worldT,
    splitStackedContoursForHit,
  } = params;

  // How close the mouse must be to the contour line (in CSS pixels).
  // The visual line radius is (1.5 * lineThickness).
  // We add fixed padding for comfortable targeting.
  const hitThreshold = 8 * noteSize;
  const baseContourWidth = 3 * lineThickness;
  const camLeft = cameraLeftWorldT(worldT, gridWidth, pxPerT);

  // Helper: convert local t16 to screen X (no tiling — tile 0 only)
  const toScreenX = (localT16: number) =>
    gridLeft + worldTToScreenX(localT16, camLeft, pxPerT);

  // Helper: convert a node to its Y position on screen
  const nodeToY = (node: { deg?: number; octave?: number; semi?: number }) =>
    node.semi !== undefined
      ? semitoneToY(node.semi, minSemitone, maxSemitone, gridTop, gridHeight)
      : degreeToY(node.deg ?? 0, node.octave || 0, minSemitone, maxSemitone, gridTop, gridHeight, arrangement.scale);

  const thresholdSq = hitThreshold * hitThreshold;
  let bestVoiceId: string | null = null;
  let bestDistSq = Infinity;

  // Tile 0 only — no tiling
  for (const voice of arrangement.voices) {
    if (voice.nodes.length === 0) continue;

    const voiceStackMap = contourStackLookup.get(voice.id);

    let lastY = 0;
    let inPhrase = false;
    let segmentIndex = 0;
    let lastT16 = 0;
    let lastSemitone = 0;

    for (const node of voice.nodes) {
      if (node.term) {
        if (inPhrase) {
          const segmentData = voiceStackMap?.get(segmentIndex);
          const holdPieces = buildContourHoldPieces(lastT16, node.t16, segmentData?.holdSlices ?? []);
          let previousHoldY: number | null = null;

          for (const piece of holdPieces) {
            const stackInfo = piece.stackIndex !== null && piece.stackSize !== null
              ? { stackIndex: piece.stackIndex, stackSize: piece.stackSize }
              : null;
            const segmentOffsetY = stackInfo
              ? (splitStackedContoursForHit ? getContourSegmentStackOffsetY(stackInfo, baseContourWidth) : 0)
              : 0;

            const x1 = toScreenX(piece.startT);
            const x2 = toScreenX(piece.endT);
            const y = lastY + segmentOffsetY;
            if (previousHoldY !== null && Math.abs(previousHoldY - y) > 0.001) {
              // Immediate row switch at piece boundary (no smoothing/easing).
              const dStep = pointToSegmentDistanceSq(mouseX, mouseY, x1, previousHoldY, x1, y);
              if (dStep < thresholdSq && dStep < bestDistSq) {
                bestDistSq = dStep;
                bestVoiceId = voice.id;
              }
            }

            const d = pointToSegmentDistanceSq(mouseX, mouseY, x1, y, x2, y);
            if (d < thresholdSq && d < bestDistSq) {
              bestDistSq = d;
              bestVoiceId = voice.id;
            }

            previousHoldY = y;
          }

          inPhrase = false;
          segmentIndex += 1;
        }
        continue;
      }

      const x = toScreenX(node.t16);
      const y = nodeToY(node);
      const nodeSemitone = contourNodeToSemitone(node, arrangement.scale);

      if (!inPhrase) {
        lastY = y;
        lastT16 = node.t16;
        lastSemitone = nodeSemitone;
        inPhrase = true;
        continue;
      }

      const segmentData = voiceStackMap?.get(segmentIndex);
      const dt = node.t16 - lastT16;

      if (dt > 0) {
        const isPitchChange = Math.abs(nodeSemitone - lastSemitone) >= 1e-6;
        const bendWidthT = isPitchChange
          ? Math.min(40 / Math.max(pxPerT, 0.0001), dt * 0.8)
          : 0;
        const holdEndT = isPitchChange ? Math.max(lastT16, node.t16 - bendWidthT) : node.t16;

        const holdPieces = buildContourHoldPieces(lastT16, holdEndT, segmentData?.holdSlices ?? []);
        const holdRightStackInfo = getRightEdgeHoldStackInfo(holdPieces);
        let previousHoldY: number | null = null;
        for (const piece of holdPieces) {
          const stackInfo = piece.stackIndex !== null && piece.stackSize !== null
            ? { stackIndex: piece.stackIndex, stackSize: piece.stackSize }
            : null;
          const segmentOffsetY = stackInfo
            ? (splitStackedContoursForHit ? getContourSegmentStackOffsetY(stackInfo, baseContourWidth) : 0)
            : 0;

          const x1 = toScreenX(piece.startT);
          const x2 = toScreenX(piece.endT);
          const yHold = lastY + segmentOffsetY;
          if (previousHoldY !== null && Math.abs(previousHoldY - yHold) > 0.001) {
            // Immediate row switch at hold-piece boundary (no smoothing/easing).
            const dStep = pointToSegmentDistanceSq(mouseX, mouseY, x1, previousHoldY, x1, yHold);
            if (dStep < thresholdSq && dStep < bestDistSq) {
              bestDistSq = dStep;
              bestVoiceId = voice.id;
            }
          }

          const d1 = pointToSegmentDistanceSq(mouseX, mouseY, x1, yHold, x2, yHold);
          if (d1 < thresholdSq && d1 < bestDistSq) {
            bestDistSq = d1;
            bestVoiceId = voice.id;
          }

          previousHoldY = yHold;
        }

        if (isPitchChange) {
          const bendStackInfo = segmentData?.bendStack;
          const bendStartOffsetY = holdRightStackInfo
            ? (splitStackedContoursForHit ? getContourSegmentStackOffsetY(holdRightStackInfo, baseContourWidth) : 0)
            : 0;
          const bendEndOffsetY = bendStackInfo
            ? (splitStackedContoursForHit ? getContourSegmentStackOffsetY(bendStackInfo, baseContourWidth) : 0)
            : 0;

          const bendStartX = toScreenX(holdEndT);
          const lastYOffset = lastY + bendStartOffsetY;
          const yOffset = y + bendEndOffsetY;
          const d2 = pointToSegmentDistanceSq(mouseX, mouseY, bendStartX, lastYOffset, x, yOffset);
          if (d2 < thresholdSq && d2 < bestDistSq) {
            bestDistSq = d2;
            bestVoiceId = voice.id;
          }
        }
      }

      lastY = y;
      lastT16 = node.t16;
      lastSemitone = nodeSemitone;
      segmentIndex += 1;
    }
  }

  return bestVoiceId;
}
