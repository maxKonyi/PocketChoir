import type { Arrangement } from '../../types';
import { degreeToSemitoneOffset } from '../../utils/music';

// For each contour segment, if multiple voices share exactly the same segment
// (same start/end time and same start/end pitch), we assign each voice a
// vertical stack position so all lines remain visible.
export interface ContourSegmentStackInfo {
  stackIndex: number;
  stackSize: number;
}

export interface ContourHoldSlice {
  startT: number;
  endT: number;
  stackIndex: number;
  stackSize: number;
}

export interface ContourSegmentStackData {
  holdSlices: ContourHoldSlice[];
  bendStack?: ContourSegmentStackInfo;
}

export type ContourStackLookup = Map<string, Map<number, ContourSegmentStackData>>;

/**
 * Build a stable string key for floating point values used in overlap grouping.
 */
function contourNumberKey(value: number): string {
  return value.toFixed(6);
}

/**
 * Build drawable hold pieces from stacked slices.
 *
 * The returned pieces cover [startT, endT] completely. Regions without overlap
 * use stackIndex/stackSize = null (which means no Y offset).
 */
export function buildContourHoldPieces(
  startT: number,
  endT: number,
  holdSlices: ContourHoldSlice[]
): Array<{ startT: number; endT: number; stackIndex: number | null; stackSize: number | null }> {
  if (endT <= startT) return [];
  if (holdSlices.length === 0) {
    return [{ startT, endT, stackIndex: null, stackSize: null }];
  }

  const sortedSlices = [...holdSlices].sort((a, b) => a.startT - b.startT || a.endT - b.endT);
  const pieces: Array<{ startT: number; endT: number; stackIndex: number | null; stackSize: number | null }> = [];
  let cursor = startT;

  for (const slice of sortedSlices) {
    const sliceStart = Math.max(startT, slice.startT);
    const sliceEnd = Math.min(endT, slice.endT);
    if (sliceEnd <= sliceStart) continue;

    if (sliceStart > cursor) {
      pieces.push({ startT: cursor, endT: sliceStart, stackIndex: null, stackSize: null });
    }

    pieces.push({
      startT: sliceStart,
      endT: sliceEnd,
      stackIndex: slice.stackIndex,
      stackSize: slice.stackSize,
    });

    cursor = sliceEnd;
  }

  if (cursor < endT) {
    pieces.push({ startT: cursor, endT, stackIndex: null, stackSize: null });
  }

  return pieces;
}

/**
 * Read the effective stack info at the RIGHT edge of a hold-piece list.
 *
 * This is used to keep bend transitions smooth:
 * - bend START uses the hold's final offset
 * - bend END uses bend-stack offset (or 0 if not stacked)
 */
export function getRightEdgeHoldStackInfo(
  holdPieces: Array<{ startT: number; endT: number; stackIndex: number | null; stackSize: number | null }>
): ContourSegmentStackInfo | null {
  if (holdPieces.length === 0) return null;
  const lastPiece = holdPieces[holdPieces.length - 1];
  if (lastPiece.stackIndex === null || lastPiece.stackSize === null) return null;
  return {
    stackIndex: lastPiece.stackIndex,
    stackSize: lastPiece.stackSize,
  };
}

/**
 * Convert a contour node to a semitone value (relative to arrangement tonic).
 */
export function contourNodeToSemitone(
  node: { semi?: number; deg?: number; octave?: number },
  scaleType: string
): number {
  return node.semi !== undefined
    ? node.semi
    : degreeToSemitoneOffset(node.deg ?? 0, node.octave || 0, scaleType);
}

/**
 * Build a lookup that tells us which segments should be vertically stacked.
 *
 * Key idea:
 * - We walk every voice and index each drawn segment in the same order used by
 *   drawVoiceContour().
 * - We group segments that are geometrically identical.
 * - For groups with 2+ voices, we assign stack order by sidebar voice order
 *   (arrangement.voices order).
 */
export function buildContourSegmentStackLookup(arrangement: Arrangement, pxPerT: number): ContourStackLookup {
  const lookup: ContourStackLookup = new Map();

  const getOrCreateSegmentData = (voiceId: string, segmentIndex: number): ContourSegmentStackData => {
    let perVoice = lookup.get(voiceId);
    if (!perVoice) {
      perVoice = new Map<number, ContourSegmentStackData>();
      lookup.set(voiceId, perVoice);
    }

    const existing = perVoice.get(segmentIndex);
    if (existing) return existing;

    const created: ContourSegmentStackData = { holdSlices: [] };
    perVoice.set(segmentIndex, created);
    return created;
  };

  // Use a normalized pitch key so tiny float noise does not break hold stacking.
  // This is especially important for node→anchor hold segments.
  const holdRefsByPitch = new Map<string, Array<{
    voiceId: string;
    voiceOrder: number;
    segmentIndex: number;
    startT: number;
    endT: number;
  }>>();

  const bendGroups = new Map<string, Array<{ voiceId: string; voiceOrder: number; segmentIndex: number }>>();

  for (let voiceOrder = 0; voiceOrder < arrangement.voices.length; voiceOrder++) {
    const voice = arrangement.voices[voiceOrder];
    let inPhrase = false;
    let segmentIndex = 0;
    let lastNode: (typeof voice.nodes)[number] | null = null;
    let lastSemitone = 0;

    for (const node of voice.nodes) {
      if (node.term) {
        if (inPhrase && lastNode) {
          const holdPitchKey = contourNumberKey(lastSemitone);
          const holdStartT = lastNode.t16;
          const holdEndT = node.t16;

          if (holdEndT > holdStartT) {
            const refs = holdRefsByPitch.get(holdPitchKey) ?? [];
            refs.push({
              voiceId: voice.id,
              voiceOrder,
              segmentIndex,
              startT: holdStartT,
              endT: holdEndT,
            });
            holdRefsByPitch.set(holdPitchKey, refs);
          }

          segmentIndex += 1;
          inPhrase = false;
          lastNode = null;
        }
        continue;
      }

      const nodeSemitone = contourNodeToSemitone(node, arrangement.scale);

      if (!inPhrase) {
        inPhrase = true;
        lastNode = node;
        lastSemitone = nodeSemitone;
        continue;
      }

      const dt = node.t16 - lastNode!.t16;
      if (dt > 0) {
        const isPitchChange = Math.abs(nodeSemitone - lastSemitone) >= 1e-6;
        const bendWidthT = isPitchChange
          ? Math.min(40 / Math.max(pxPerT, 0.0001), dt * 0.8)
          : 0;
        const holdStartT = lastNode!.t16;
        const holdEndT = isPitchChange ? Math.max(holdStartT, node.t16 - bendWidthT) : node.t16;

        if (holdEndT > holdStartT) {
          const holdPitchKey = contourNumberKey(lastSemitone);
          const refs = holdRefsByPitch.get(holdPitchKey) ?? [];
          refs.push({
            voiceId: voice.id,
            voiceOrder,
            segmentIndex,
            startT: holdStartT,
            endT: holdEndT,
          });
          holdRefsByPitch.set(holdPitchKey, refs);
        }

        if (isPitchChange) {
          const bendStartT = holdEndT;
          const bendKey = `bend|${contourNumberKey(bendStartT)}|${contourNumberKey(node.t16)}|${contourNumberKey(lastSemitone)}|${contourNumberKey(nodeSemitone)}`;
          const group = bendGroups.get(bendKey) ?? [];
          group.push({ voiceId: voice.id, voiceOrder, segmentIndex });
          bendGroups.set(bendKey, group);
        }
      }

      segmentIndex += 1;
      lastNode = node;
      lastSemitone = nodeSemitone;
    }
  }

  // Hold stacking: if intervals overlap at the same pitch, stack during that overlap.
  for (const refs of holdRefsByPitch.values()) {
    const boundariesSet = new Set<number>();
    for (const ref of refs) {
      boundariesSet.add(ref.startT);
      boundariesSet.add(ref.endT);
    }

    const boundaries = [...boundariesSet].sort((a, b) => a - b);
    for (let i = 0; i < boundaries.length - 1; i++) {
      const sliceStart = boundaries[i];
      const sliceEnd = boundaries[i + 1];
      if (sliceEnd <= sliceStart) continue;

      const active = refs.filter((ref) => ref.startT < sliceEnd && ref.endT > sliceStart);
      if (active.length < 2) continue;

      active.sort((a, b) => a.voiceOrder - b.voiceOrder);
      const stackSize = active.length;

      for (let stackIndex = 0; stackIndex < active.length; stackIndex++) {
        const ref = active[stackIndex];
        const data = getOrCreateSegmentData(ref.voiceId, ref.segmentIndex);
        data.holdSlices.push({ startT: sliceStart, endT: sliceEnd, stackIndex, stackSize });
      }
    }
  }

  // Bend stacking: only when the bend geometry is exactly identical.
  for (const refs of bendGroups.values()) {
    if (refs.length < 2) continue;
    refs.sort((a, b) => a.voiceOrder - b.voiceOrder);
    const stackSize = refs.length;

    for (let stackIndex = 0; stackIndex < refs.length; stackIndex++) {
      const ref = refs[stackIndex];
      const data = getOrCreateSegmentData(ref.voiceId, ref.segmentIndex);
      data.bendStack = { stackIndex, stackSize };
    }
  }

  return lookup;
}

/**
 * Convert stack slot to vertical pixel offset.
 *
 * We space centers by one line width so adjacent lines "butt" exactly with no gap.
 * Example with 2 lines: offsets are -0.5w and +0.5w.
 */
export function getContourSegmentStackOffsetY(stackInfo: ContourSegmentStackInfo, lineWidth: number): number {
  return (stackInfo.stackIndex - (stackInfo.stackSize - 1) / 2) * lineWidth;
}

/**
 * Build a vibrant pearlescent gradient used to represent a stacked/unison contour.
 *
 * Hue is sampled by traveled pixel distance so color flow stays continuous
 * across connected hold/bend segments (no restart at curve boundaries).
 */
export function createPrismaticContourGradient(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  phaseSeedX: number
): CanvasGradient {
  const hasLength = Math.abs(endX - startX) > 0.001 || Math.abs(endY - startY) > 0.001;
  const safeEndX = hasLength ? endX : startX + 1;
  const safeEndY = hasLength ? endY : startY;
  const gradient = ctx.createLinearGradient(startX, startY, safeEndX, safeEndY);

  const PRISM_CYCLE_PX = 400;
  const dist = Math.sqrt((safeEndX - startX) ** 2 + (safeEndY - startY) ** 2);

  // Brighter pearlescent: higher lightness and moderated saturation.
  const getRainbowColorByDistance = (distancePx: number) => {
    const hue = (((phaseSeedX + distancePx) / PRISM_CYCLE_PX) * 360) % 360;
    return `hsl(${hue.toFixed(1)} 58% 88%)`;
  };

  const stopCount = 6;
  for (let i = 0; i <= stopCount; i++) {
    const p = i / stopCount;
    gradient.addColorStop(p, getRainbowColorByDistance(dist * p));
  }

  return gradient;
}

/**
 * Return the prismatic color at a specific X phase seed.
 * Used to blend OUT of a collapsed rainbow stack into a voice's own color.
 */
export function getPrismaticContourColorAtPhase(phaseSeedX: number): string {
  const PRISM_CYCLE_PX = 400;
  const hue = (((phaseSeedX / PRISM_CYCLE_PX) * 360) % 360 + 360) % 360;
  return `hsl(${hue.toFixed(1)} 58% 88%)`;
}
