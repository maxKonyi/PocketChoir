import type { MutableRefObject, RefObject, ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { Arrangement } from '../../types';
import {
  cameraLeftWorldT,
  resolveToCanonical,
  screenXToWorldT,
  worldTToScreenX,
} from '../../utils/followCamera';
import { getCameraCenterWorldT } from '../../utils/cameraState';
import { isChordDiatonic } from './gridDataUtils';
import { quantizeT16, type GridDivision } from '../../utils/timing';

// Note: RefObject is kept for chordLaneRef; MutableRefObject for camera-track and drag refs.

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
  chordLaneRef: RefObject<HTMLDivElement | null>;
  // Inner div that receives translateX every RAF frame for smooth camera tracking.
  // Grid.tsx drives this via a requestAnimationFrame loop, same as the lyric lane.
  chordLaneCameraTrackRef: MutableRefObject<HTMLDivElement | null>;
  chordBoundaryDragRef: MutableRefObject<ChordBoundaryDragState | null>;
  followModePxPerT: number;
  followModePendingWorldT: number | null;
  gridDivision: GridDivision;
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
  disableChordTrack: () => void;
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
  chordLaneRef,
  chordLaneCameraTrackRef,
  chordBoundaryDragRef,
  followModePxPerT,
  followModePendingWorldT,
  gridDivision,
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
  disableChordTrack,
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
          const snappedT16 = Math.max(0, Math.min(totalT16, quantizeT16(tLocal, gridDivision)));

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
        {/* ── Static UI: enable button or disable (trash) button ── */}
        {/* These live OUTSIDE the overflow-hidden chord lane so they are never clipped. */}
        <div
          className="absolute"
          style={{
            left: 0,
            right: 0,
            top: 12,
            height: 24,
            // Pointer events only on the button areas, not the whole bar
            pointerEvents: 'none',
          }}
        >
          {chords.length === 0 ? (
            // No chords yet: show the "Enable" button spanning the full width
            <button
              type="button"
              className="w-full h-full rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs font-semibold"
              style={{ pointerEvents: 'auto' }}
              onClick={(e) => {
                e.stopPropagation();
                enableChordTrack();
              }}
            >
              Enable Chord Track
            </button>
          ) : (
            // Chords exist: show a small trash icon button on the right to disable the track.
            // Positioned outside overflow-hidden so it is never clipped by the scrolling lane.
            <button
              type="button"
              className="absolute right-0 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md border border-red-400/25 bg-red-500/10 text-red-200 hover:bg-red-500/16 z-10 flex items-center justify-center"
              style={{ pointerEvents: 'auto' }}
              onClick={(e) => {
                e.stopPropagation();
                disableChordTrack();
              }}
              title="Disable chord track"
              aria-label="Disable chord track"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>

        {/* ── Scrolling chord blocks (camera-tracked via RAF translateX) ── */}
        {chords.length > 0 && (
          <div
            className="absolute overflow-hidden"
            style={{
              left: 0,
              // Leave room on the right for the Disable button
              right: 60,
              top: 12,
              height: 24,
            }}
          >
            {/* Hover split marker — positioned in screen space so it doesn't scroll */}
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

            {/* Camera-tracked inner div: Grid.tsx applies translateX every RAF frame */}
            <div
              ref={chordLaneCameraTrackRef}
              className="absolute inset-y-0 left-0 will-change-transform"
            >
              {(() => {
                const pxPerTVal = followModePxPerT;
                const blocks: ReactNode[] = [];

                for (let idx = 0; idx < chords.length; idx++) {
                  const chord = chords[idx];

                  // Position chord blocks by t16 * pxPerT (world-space offset from t=0).
                  // The parent div receives translateX from the RAF loop in Grid.tsx,
                  // so these positions stay in sync with the canvas grid exactly.
                  const leftPx = chord.t16 * pxPerTVal;
                  const widthPx = Math.max(1, chord.duration16 * pxPerTVal);

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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default GridChordLaneEditor;
