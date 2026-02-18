import type { MutableRefObject, RefObject, ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { Arrangement, LyricConnector } from '../../types';
import {
  type LyricHoldSpan,
  type LyricUiEntry,
  parseLyricDraft,
} from './gridDataUtils';

/**
 * Props needed for the Create-mode lyric lane editor.
 *
 * This component renders only UI. All store mutations and editor state still
 * live in Grid.tsx and are passed through props to preserve existing behavior.
 */
type GridLyricLaneEditorProps = {
  arrangement: Arrangement;
  gridMarginLeft: number;
  gridMarginRight: number;
  lyricLaneRef: RefObject<HTMLDivElement | null>;
  lyricLaneCameraTrackRef: RefObject<HTMLDivElement | null>;
  voice1MelodyNodes: Array<{ t16: number }>;
  hiddenLyricNodeTimes: Set<number>;
  lyricEntryByT16: Map<number, LyricUiEntry>;
  voice1NextNodeT16ByT16: Map<number, number>;
  lyricHoldSpans: LyricHoldSpan[];
  editingLyricT16: number | null;
  setEditingLyricT16: (value: number | null) => void;
  editingLyricText: string;
  setEditingLyricText: (value: string) => void;
  editingLyricT16Ref: MutableRefObject<number | null>;
  followModePxPerT: number;
  enableLyricsTrack: () => void;
  disableLyricsTrack: () => void;
  applyLyricConnectorAndAdvance: (
    connectorToNext: LyricConnector,
    draftTextOverride?: string
  ) => void;
  commitLyricEdit: (
    nextNodeT16?: number | null,
    connectorOverride?: LyricConnector | null
  ) => void;
  getAdjacentVoice1NodeT16: (fromT16: number, direction: -1 | 1) => number | null;
  handleLyricConnectorButton: (connectorToNext: LyricConnector) => void;
  startLyricEditAt: (t16: number) => void;
};

/**
 * Create-mode lyric lane overlay.
 *
 * Behavior parity goals:
 * - Keep token position locked to Voice 1 melody node time.
 * - Keep auto-advance shortcuts (`-`, `_`, Enter, Tab) exactly the same.
 * - Keep connector rendering (dash + hold) unchanged.
 */
export function GridLyricLaneEditor({
  arrangement,
  gridMarginLeft,
  gridMarginRight,
  lyricLaneRef,
  lyricLaneCameraTrackRef,
  voice1MelodyNodes,
  hiddenLyricNodeTimes,
  lyricEntryByT16,
  voice1NextNodeT16ByT16,
  lyricHoldSpans,
  editingLyricT16,
  setEditingLyricT16,
  editingLyricText,
  setEditingLyricText,
  editingLyricT16Ref,
  followModePxPerT,
  enableLyricsTrack,
  disableLyricsTrack,
  applyLyricConnectorAndAdvance,
  commitLyricEdit,
  getAdjacentVoice1NodeT16,
  handleLyricConnectorButton,
  startLyricEditAt,
}: GridLyricLaneEditorProps) {
  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      <div
        ref={lyricLaneRef}
        className="absolute pointer-events-auto overflow-hidden"
        style={{
          left: gridMarginLeft,
          right: gridMarginRight,
          bottom: 8,
          height: 34,
        }}
        title="Lyrics track for Voice 1. Use '-' to split syllables and '_' to hold a syllable."
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="absolute inset-0 rounded-lg border border-white/10 bg-black/20 backdrop-blur-[1px]">
          {!(arrangement.lyrics?.enabled ?? false) ? (
            <div className="h-full px-2 flex items-center gap-2">
              <button
                type="button"
                className="h-6 px-2 rounded-md border border-white/20 bg-white/8 text-[11px] font-semibold text-[var(--text-primary)] hover:bg-white/12 disabled:opacity-45 disabled:cursor-not-allowed"
                disabled={voice1MelodyNodes.length === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  enableLyricsTrack();
                }}
              >
                Enable Lyrics Track
              </button>
              <span className="text-[11px] text-[var(--text-muted)]">
                {voice1MelodyNodes.length > 0
                  ? 'Add syllables under Voice 1 melody notes.'
                  : 'Place Voice 1 melody notes first.'}
              </span>
            </div>
          ) : (
            <>
              <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)]">
                Lyrics
              </div>

              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md border border-red-400/25 bg-red-500/10 text-red-200 hover:bg-red-500/16 flex items-center justify-center"
                onClick={(e) => {
                  e.stopPropagation();
                  disableLyricsTrack();
                }}
                title="Disable lyrics track"
                aria-label="Disable lyrics track"
              >
                <Trash2 size={14} />
              </button>

              {(() => {
                const pxPerTVal = followModePxPerT;
                if (pxPerTVal <= 0) return null;

                const connectorLines: ReactNode[] = [];
                const chips: ReactNode[] = [];
                for (const node of voice1MelodyNodes) {
                  if (hiddenLyricNodeTimes.has(node.t16)) continue;
                  const x = node.t16 * pxPerTVal;

                  const entry = lyricEntryByT16.get(node.t16);
                  const text = entry?.text ?? '';
                  const connectorToNext = entry?.connectorToNext;

                  // Render connector lines between this node and the next node.
                  const nextNodeT16 = voice1NextNodeT16ByT16.get(node.t16);
                  if (connectorToNext === 'dash' && nextNodeT16 !== undefined) {
                    const x2 = nextNodeT16 * pxPerTVal;

                    const left = Math.min(x, x2);
                    const right = Math.max(x, x2);
                    const mid = (left + right) / 2;
                    const dashWidth = Math.min(16, Math.max(7, (right - left) * 0.35));
                    connectorLines.push(
                      <div
                        key={`lyric-connector-dash-${node.t16}`}
                        className="absolute pointer-events-none bg-white/85"
                        style={{
                          left: mid - dashWidth / 2,
                          width: dashWidth,
                          top: '50%',
                          height: 1,
                          transform: 'translateY(0.5px)',
                        }}
                      />
                    );
                  }

                  const isEditingToken = editingLyricT16 === node.t16;
                  const editingDraftConnector = isEditingToken
                    ? parseLyricDraft(editingLyricText).connectorToNext
                    : null;

                  chips.push(
                    <div
                      key={`lyric-${node.t16}`}
                      className="absolute top-1/2"
                      style={{
                        left: x,
                        transform: 'translate(-50%, -50%)',
                      }}
                    >
                      {isEditingToken ? (
                        <div className="flex items-center gap-1">
                          <input
                            value={editingLyricText}
                            autoFocus
                            placeholder="lyric"
                            className="w-24 px-2 py-1 rounded-md text-xs text-center bg-black/50 text-[var(--text-primary)] border border-white/30 outline-none focus:border-[var(--accent-primary)]"
                            onFocus={(evt) => {
                              // Auto-select existing text so retyping/deleting is one action.
                              if (evt.currentTarget.value.trim().length > 0) {
                                evt.currentTarget.select();
                              }
                            }}
                            onChange={(evt) => {
                              const nextValue = evt.target.value;
                              setEditingLyricText(nextValue);

                              const trimmedEnd = nextValue.trimEnd();
                              if (trimmedEnd.endsWith('-')) {
                                applyLyricConnectorAndAdvance('dash', nextValue);
                                return;
                              }

                              if (trimmedEnd.endsWith('_')) {
                                applyLyricConnectorAndAdvance('hold', nextValue);
                              }
                            }}
                            onBlur={() => {
                              if (editingLyricT16Ref.current !== node.t16) return;
                              commitLyricEdit();
                            }}
                            onKeyDown={(evt) => {
                              if (evt.key === 'Enter') {
                                evt.preventDefault();
                                const nextNodeT16 = getAdjacentVoice1NodeT16(node.t16, 1);
                                commitLyricEdit(nextNodeT16);
                                return;
                              }

                              if (evt.key === 'Tab') {
                                evt.preventDefault();
                                const direction: -1 | 1 = evt.shiftKey ? -1 : 1;
                                const nextNodeT16 = getAdjacentVoice1NodeT16(node.t16, direction);
                                commitLyricEdit(nextNodeT16);
                                return;
                              }

                              if (evt.key === 'Escape') {
                                evt.preventDefault();
                                setEditingLyricT16(null);
                                setEditingLyricText('');
                              }
                            }}
                          />

                          {/* Quick helpers for choir-style lyric notation. */}
                          <button
                            type="button"
                            className={`h-6 w-6 rounded border text-[11px] transition-colors ${editingDraftConnector === 'dash'
                              ? 'border-sky-300/70 bg-sky-400/25 text-sky-100'
                              : 'border-white/15 bg-white/6 text-[var(--text-muted)] hover:bg-white/12 hover:text-[var(--text-primary)]'
                              }`}
                            title="Split syllable to next node"
                            onMouseDown={(evt) => evt.preventDefault()}
                            onClick={(evt) => {
                              evt.stopPropagation();
                              handleLyricConnectorButton('dash');
                            }}
                          >
                            -
                          </button>

                          <button
                            type="button"
                            className={`h-6 w-6 rounded border text-[11px] transition-colors ${editingDraftConnector === 'hold'
                              ? 'border-sky-300/70 bg-sky-400/25 text-sky-100'
                              : 'border-white/15 bg-white/6 text-[var(--text-muted)] hover:bg-white/12 hover:text-[var(--text-primary)]'
                              }`}
                            title="Hold syllable to next node"
                            onMouseDown={(evt) => evt.preventDefault()}
                            onClick={(evt) => {
                              evt.stopPropagation();
                              handleLyricConnectorButton('hold');
                            }}
                          >
                            _
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={`max-w-[120px] px-2 py-1 rounded-md text-xs border transition-colors ${text
                            ? 'border-white/15 bg-white/8 text-[var(--text-primary)] hover:bg-white/14'
                            : 'border-dashed border-white/15 bg-white/4 text-[var(--text-disabled)] hover:bg-white/10'
                            }`}
                          onClick={(evt) => {
                            evt.stopPropagation();
                            if (editingLyricT16 !== null && editingLyricT16 !== node.t16) {
                              commitLyricEdit(node.t16);
                              return;
                            }
                            startLyricEditAt(node.t16);
                          }}
                          title={text || 'Add lyric'}
                        >
                          <span className="block truncate">{text || '·'}</span>
                        </button>
                      )}
                    </div>
                  );
                }

                for (const span of lyricHoldSpans) {
                  const left = Math.min(span.startT16, span.endT16) * pxPerTVal;
                  const right = Math.max(span.startT16, span.endT16) * pxPerTVal;

                  // Keep the hold line outside both lyric bubbles.
                  const bubbleInset = 22;
                  const lineStart = left + bubbleInset;
                  const lineEnd = span.endAtAnchor ? right : (right - bubbleInset);
                  const lineWidth = Math.max(0, lineEnd - lineStart);
                  if (lineWidth <= 0) continue;

                  connectorLines.push(
                    <div
                      key={`lyric-hold-span-${span.startT16}-${span.endT16}`}
                      className="absolute pointer-events-none rounded-full bg-white/85"
                      style={{
                        left: lineStart,
                        width: lineWidth,
                        top: '50%',
                        height: 2,
                        transform: 'translateY(10px)',
                      }}
                    />
                  );
                }

                return (
                  <div
                    ref={lyricLaneCameraTrackRef}
                    className="absolute inset-y-0 left-0 will-change-transform"
                  >
                    {connectorLines}
                    {chips}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default GridLyricLaneEditor;
