import type { MutableRefObject, RefObject, ReactNode } from 'react';
import type { Arrangement } from '../../types';
import {
  cameraLeftWorldT,
  resolveToCanonical,
  screenXToWorldT,
  worldTToScreenX,
} from '../../utils/followCamera';
import { getCameraCenterWorldT } from '../../utils/cameraState';
import { isChordDiatonic } from './gridDataUtils';

/**
 * Small ref-state object used while a user drags a chord boundary handle.
 *
 * - `leftChordIndex` points to the chord on the left side of the dragged boundary.
 */
export type ChordBoundaryDragState = {
  leftChordIndex: number;
};

/**
 * Props needed to render and control the Create-mode chord lane editor.
 *
 * This component is intentionally “dumb”: all store actions and long-lived state
 * still live in Grid.tsx and are passed in.
 */
type GridChordLaneEditorProps = {
  arrangement: Arrangement;
  gridMarginLeft: number;
  gridMarginRight: number;
  gridMarginTop: number;
  containerRef: RefObject<HTMLDivElement | null>;
  chordLaneRef: RefObject<HTMLDivElement | null>;
  chordBoundaryDragRef: MutableRefObject<ChordBoundaryDragState | null>;
  followModePxPerT: number;
  followModePendingWorldT: number | null;
  editingChordIndex: number | null;
  setEditingChordIndex: (index: number | null) => void;
  editingChordName: string;
  setEditingChordName: (name: string) => void;
  hoverSplitT16: number | null;
  setHoverSplitT16: (value: number | null) => void;
  hoverSplitScreenX: number | null;
  setHoverSplitScreenX: (value: number | null) => void;
  enableChordTrack: () => void;
  splitChordAt: (t16: number) => void;
  deleteChord: (index: number) => void;
  commitChordNameEdit: () => void;
};

/**
 * Create-mode chord lane overlay.
 *
 * Behavior parity goals:
 * - Keep the exact split-marker hover zone and click semantics.
 * - Keep chord block sizing/positioning tied to the same camera math as before.
 * - Keep rename, delete (Shift+click), and boundary-drag handles unchanged.
 */
export function GridChordLaneEditor({
  arrangement,
  gridMarginLeft,
  gridMarginRight,
  gridMarginTop,
  containerRef,
  chordLaneRef,
  chordBoundaryDragRef,
  followModePxPerT,
  followModePendingWorldT,
  editingChordIndex,
  setEditingChordIndex,
  editingChordName,
  setEditingChordName,
  hoverSplitT16,
  setHoverSplitT16,
  hoverSplitScreenX,
  setHoverSplitScreenX,
  enableChordTrack,
  splitChordAt,
  deleteChord,
  commitChordNameEdit,
}: GridChordLaneEditorProps) {
  const chords = arrangement.chords ?? [];

  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      <div
        ref={chordLaneRef}
        className="absolute pointer-events-auto overflow-hidden"
        style={{
          left: gridMarginLeft,
          right: gridMarginRight,
          top: gridMarginTop - 42,
          height: 48,
        }}
        onClickCapture={(e) => {
          // If the split marker is visible, any click inside the chord lane should
          // trigger the split (even if the user clicked on a chord block).
          if (chords.length === 0) return;
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
          setHoverSplitScreenX(null);
        }}
        onMouseMove={(e) => {
          if (chords.length === 0) {
            setHoverSplitT16(null);
            setHoverSplitScreenX(null);
            return;
          }
          if (editingChordIndex !== null) {
            setHoverSplitT16(null);
            setHoverSplitScreenX(null);
            return;
          }
          if (chordBoundaryDragRef.current) {
            setHoverSplitT16(null);
            setHoverSplitScreenX(null);
            return;
          }

          const rect = chordLaneRef.current?.getBoundingClientRect();
          if (!rect) {
            setHoverSplitT16(null);
            setHoverSplitScreenX(null);
            return;
          }

          // Only show the split marker when you hover very near the top of the chord lane.
          // This keeps most of the chord block body free for rename + boundary dragging.
          const visualTopOffsetPx = 12;
          const yFromVisualTop = (e.clientY - rect.top) - visualTopOffsetPx;
          const inTopHoverZone = yFromVisualTop >= -6 && yFromVisualTop <= 2;
          if (!inTopHoverZone) {
            setHoverSplitT16(null);
            setHoverSplitScreenX(null);
            return;
          }

          // Snap split preview to the same grid division that splitting uses.
          // This keeps the ghost marker position visually consistent with the
          // actual split result on click.
          const totalT16 = arrangement.bars * arrangement.timeSig.numerator * 4;
          const pxPerTVal = followModePxPerT;
          if (pxPerTVal <= 0 || totalT16 <= 0) {
            setHoverSplitT16(null);
            setHoverSplitScreenX(null);
            return;
          }

          const currentWorldT = followModePendingWorldT !== null
            ? followModePendingWorldT
            : getCameraCenterWorldT();
          const camLeft = cameraLeftWorldT(currentWorldT, rect.width, pxPerTVal);
          const screenX = e.clientX - rect.left;
          const hoverWorldT = screenXToWorldT(screenX, camLeft, pxPerTVal);
          const { tLocal, k } = resolveToCanonical(hoverWorldT, totalT16);
          const snappedT16 = Math.max(0, Math.min(totalT16, Math.round(tLocal)));

          // Keep marker on the same repeated-tile instance the mouse is over.
          const snappedWorldT = k * totalT16 + snappedT16;
          const snappedScreenX = worldTToScreenX(snappedWorldT, camLeft, pxPerTVal);

          setHoverSplitT16(snappedT16);
          setHoverSplitScreenX(snappedScreenX);
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
          {chords.length === 0 ? (
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
              {hoverSplitT16 !== null && hoverSplitScreenX !== null && (
                <div
                  className="absolute top-0 h-full"
                  style={{
                    left: hoverSplitScreenX,
                    transform: 'translateX(-50%)',
                    pointerEvents: 'none',
                  }}
                >
                  <div className="absolute left-1/2 top-0 -translate-x-1/2 w-px h-full bg-white/25" />
                  <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full border border-white/20 bg-white/10 text-[var(--text-primary)] text-[12px] font-black flex items-center justify-center cursor-pointer">
                    +
                  </div>
                </div>
              )}

              {/* Chord blocks (synced to grid camera + zoom) */}
              {(() => {
                const pxPerTVal = followModePxPerT;

                // Width of the chord lane's visible area (same as the grid drawing width).
                const laneWidth = (() => {
                  const laneRect = chordLaneRef.current?.getBoundingClientRect();
                  if (laneRect) return laneRect.width;
                  const containerRect = containerRef.current?.getBoundingClientRect();
                  if (!containerRect) return 0;
                  return containerRect.width - gridMarginLeft - gridMarginRight;
                })();

                const worldT = followModePendingWorldT !== null
                  ? followModePendingWorldT
                  : getCameraCenterWorldT();

                const camLeft = cameraLeftWorldT(worldT, laneWidth, pxPerTVal);

                // DAW-style: no tiling — draw tile 0 only
                const blocks: ReactNode[] = [];

                for (let idx = 0; idx < chords.length; idx++) {
                  const chord = chords[idx];
                  const drawWorldT = chord.t16;

                  const leftPx = worldTToScreenX(drawWorldT, camLeft, pxPerTVal);
                  const widthPx = Math.max(1, chord.duration16 * pxPerTVal);

                  // Cull blocks far outside the lane to reduce DOM work.
                  if (leftPx > laneWidth + 200 || leftPx + widthPx < -200) continue;

                  const isEditing = editingChordIndex === idx;
                  const isDiatonicChord = isChordDiatonic(chord, arrangement);

                  blocks.push(
                    <div
                      key={`${chord.t16}-${idx}`}
                      className="absolute top-0 h-full rounded-lg border border-white/10"
                      style={{
                        left: leftPx,
                        width: widthPx,
                        background: isDiatonicChord
                          ? 'linear-gradient(to bottom, var(--chord-fill-top), var(--chord-fill-bottom))'
                          : 'linear-gradient(to bottom, var(--chord-fill-tension-top), var(--chord-fill-tension-bottom))',
                        borderColor: isDiatonicChord ? 'var(--chord-stroke)' : 'var(--chord-stroke-tension)',
                      }}
                      title="Shift+click to delete. Drag edges to stretch or overwrite."
                      onDoubleClick={(evt) => {
                        evt.stopPropagation();
                        setEditingChordIndex(idx);
                        setEditingChordName(chord.name);
                      }}
                      onClick={(evt) => {
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
                                evt.preventDefault();
                                commitChordNameEdit();
                              }
                              if (evt.key === 'Escape') {
                                evt.preventDefault();
                                setEditingChordIndex(null);
                                setEditingChordName('');
                              }
                            }}
                          />
                        ) : (
                          <span className={`text-xs font-bold ${isDiatonicChord ? 'text-[var(--chord-text)]' : 'text-[var(--chord-text-tension)]'}`}>
                            {chord.name}
                          </span>
                        )}
                      </div>

                      {/* Resize handles */}
                      <>
                        <button
                          type="button"
                          className="absolute left-0 top-0 h-full w-3 cursor-ew-resize bg-transparent hover:bg-white/10"
                          title="Drag to resize"
                          onMouseDown={(evt) => {
                            evt.stopPropagation();
                            chordBoundaryDragRef.current = { leftChordIndex: idx - 1 };
                          }}
                        />
                        <button
                          type="button"
                          className="absolute right-0 top-0 h-full w-3 cursor-ew-resize bg-transparent hover:bg-white/10"
                          title="Drag to resize"
                          onMouseDown={(evt) => {
                            evt.stopPropagation();
                            chordBoundaryDragRef.current = { leftChordIndex: idx };
                          }}
                        />
                      </>
                    </div>
                  );
                }

                return blocks;
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default GridChordLaneEditor;
