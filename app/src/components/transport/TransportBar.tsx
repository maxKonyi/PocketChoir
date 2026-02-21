/* ============================================================
   TRANSPORT BAR COMPONENT
   
   Playback controls at the bottom of the app.
   Layout: Position | Speed | [Record Play Loop] | Zoom
   ============================================================ */

import { useMemo, useRef, useState } from 'react';

import { ChevronDown, ChevronUp, Pause, Play, Repeat, SkipBack } from 'lucide-react';

import { useAppStore } from '../../stores/appStore';
import { playbackEngine } from '../../services/PlaybackEngine';
import { transposeTonic } from '../../utils/music';



/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export function TransportBar() {
  // Get state from store.
  // Subscribe to individual playback fields instead of the whole playback object.
  // setPosition() fires ~30fps; subscribing to the whole object would re-render
  // this component 30fps for fields it doesn't display (e.g. loopEnd, loopStart).
  const pbIsPlaying = useAppStore((state) => state.playback.isPlaying);
  const pbLoopEnabled = useAppStore((state) => state.playback.loopEnabled);
  const pbMetronomeEnabled = useAppStore((state) => state.playback.metronomeEnabled);
  const arrangement = useAppStore((state) => state.arrangement);
  const transposition = useAppStore((state) => state.transposition);
  const setPlaying = useAppStore((state) => state.setPlaying);
  const setLoopEnabled = useAppStore((state) => state.setLoopEnabled);
  const setMetronomeEnabled = useAppStore((state) => state.setMetronomeEnabled);
  const setTransposition = useAppStore((state) => state.setTransposition);
  const updateArrangementParams = useAppStore((state) => state.updateArrangementParams);
  const cameraMode = useAppStore((state) => state.followMode.cameraMode);
  const setCameraMode = useAppStore((state) => state.setCameraMode);
  // setPosition is unused here because we use playbackEngine.seek directly for interactions that need immediate engine response
  // const setPosition = useAppStore((state) => state.setPosition);

  const effectiveTonic = useMemo(() => {
    if (!arrangement) return null;
    return transposeTonic(arrangement.tonic, transposition || 0);
  }, [arrangement, transposition]);

  const bpmValue = useMemo(() => {
    if (!arrangement) return null;
    return Math.round(arrangement.tempo);
  }, [arrangement]);

  const [isEditingBpm, setIsEditingBpm] = useState(false);
  const [bpmDraft, setBpmDraft] = useState(() => String(bpmValue ?? ''));
  const bpmDragRef = useRef<{
    isDragging: boolean;
    startClientY: number;
    startTempo: number;
  } | null>(null);

  const clampTempo = (tempo: number) => {
    return Math.max(30, Math.min(300, tempo));
  };

  const commitTempo = (tempo: number) => {
    if (!arrangement) return;
    const nextTempo = clampTempo(tempo);
    updateArrangementParams({
      title: arrangement.title,
      tempo: nextTempo,
      tonic: arrangement.tonic,
      scale: arrangement.scale,
      bars: arrangement.bars,
      timeSig: arrangement.timeSig,
    });
  };

  const commitTransposeDelta = (deltaSemitones: number) => {
    const next = (transposition || 0) + deltaSemitones;
    setTransposition(next);
  };


  /**
   * Handle play/pause toggle.
   */
  const handlePlayPause = () => {
    setPlaying(!pbIsPlaying);
  };

  /**
   * Reset to beginning.
   * Also triggers a camera follow reset so the smart cam snaps back to
   * the playhead instead of staying in free-look / static.
   */
  const handleRestart = () => {
    playbackEngine.seek(0);
    // Signal Grid.tsx to reset camera to follow mode.
    useAppStore.getState().triggerCameraFollowReset();
  };

  // Symmetrical Widths:
  // We use w-auto and gap-6 to let it size naturally
  // BUT we use absolute centering for the middle group to ensure play button is EXACTLY center

  return (
    <div className="
      absolute bottom-4 left-[calc(50%+4.5rem+15px)] -translate-x-1/2
      flex items-center justify-between px-8 h-[72px]
      w-auto min-w-[760px]
      glass-pane glass-med rounded-full shimmer
      shadow-[0_20px_60px_rgba(0,0,0,0.5),0_0_80px_-20px_rgba(139,92,246,0.08)] z-40
      border border-white/8
    ">

      {/* LEFT SECTION: Key, Tempo, Time */}
      <div className="flex items-center justify-start gap-4 z-10 flex-1 min-w-0">

        <div className="flex items-center gap-2">

          {/* Key Display - fixed-width pill + arrows outside on the bar */}
          {arrangement && (
            <div className="flex items-center gap-0.5">
              {/* Key label in its own pill */}
              <div className="flex flex-col items-center leading-none px-2.5 py-1 rounded-xl bg-white/5 w-[46px]">
                <span className="text-[10px] text-[var(--text-dim)] font-semibold tracking-wide">Key</span>
                <span className="text-sm font-bold text-[var(--text-primary)] tabular-nums text-center w-full">{effectiveTonic ?? arrangement.tonic}</span>
              </div>

              {/* Transpose arrows - directly on the transport bar, outside the pill */}
              <div className="flex flex-col justify-center">
                <button
                  onClick={() => commitTransposeDelta(1)}
                  aria-label="Transpose Up"
                  className="
                  w-5 h-5 flex items-center justify-center
                  text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/8 rounded
                  transition-all duration-150 cursor-pointer
                "
                  title="Transpose Up (Semitone)"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  onClick={() => commitTransposeDelta(-1)}
                  aria-label="Transpose Down"
                  className="
                  w-5 h-5 flex items-center justify-center
                  text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/8 rounded
                  transition-all duration-150 cursor-pointer
                "
                  title="Transpose Down (Semitone)"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Tempo Display - fixed-width pill, supports up to 999 BPM without resizing */}
          {arrangement && (
            <div
              className="flex flex-col items-center leading-none px-2.5 py-1 rounded-xl bg-white/5 select-none w-[52px] cursor-ns-resize"
              onDoubleClick={() => {
                setIsEditingBpm(true);
                setBpmDraft(String(bpmValue ?? Math.round(arrangement.tempo)));
              }}
              onPointerDown={(e) => {
                if (isEditingBpm) return;
                const startTempo = bpmValue ?? Math.round(arrangement.tempo);
                bpmDragRef.current = {
                  isDragging: true,
                  startClientY: e.clientY,
                  startTempo,
                };
                (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const drag = bpmDragRef.current;
                if (!drag?.isDragging) return;
                const dy = e.clientY - drag.startClientY;

                const sensitivityPxPerBpm = 6;
                const delta = -dy / sensitivityPxPerBpm;
                const nextTempo = drag.startTempo + delta;
                commitTempo(nextTempo);
              }}
              onPointerUp={() => {
                bpmDragRef.current = null;
              }}
              title="Drag up/down to change BPM • Double-click to type"
            >
              <span className="text-[10px] text-[var(--text-dim)] font-semibold tracking-wide">BPM</span>
              {isEditingBpm ? (
                <input
                  autoFocus
                  value={bpmDraft}
                  onChange={(e) => setBpmDraft(e.target.value)}
                  onBlur={() => {
                    const parsed = Number(bpmDraft);
                    if (Number.isFinite(parsed)) {
                      commitTempo(parsed);
                    }
                    setIsEditingBpm(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const parsed = Number(bpmDraft);
                      if (Number.isFinite(parsed)) {
                        commitTempo(parsed);
                      }
                      setIsEditingBpm(false);
                    }
                    if (e.key === 'Escape') {
                      setIsEditingBpm(false);
                    }
                  }}
                  className="
                  text-sm font-bold text-[var(--text-primary)] tabular-nums text-center
                  w-full bg-transparent outline-none
                "
                  inputMode="numeric"
                />
              ) : (
                <span className="text-sm font-bold text-[var(--text-primary)] tabular-nums text-center w-full">{bpmValue}</span>
              )}
            </div>
          )}

          <div className="w-px h-8 bg-white/8 ml-2" />
        </div>

        {/* Metronome Button - between BPM and Restart */}
        <button
          onClick={() => setMetronomeEnabled(!pbMetronomeEnabled)}
          aria-label="Toggle Metronome"
          className={`
            w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer
            ${pbMetronomeEnabled
              ? 'bg-blue-500/25 text-blue-300 shadow-[0_0_15px_-3px_rgba(59,130,246,0.4)] border border-blue-500/30'
              : 'text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]'
            }
          `}
          title="Metronome"
        >
          {/* Metronome icon from Tabler Icons (free, high-quality) */}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={pbMetronomeEnabled ? 'animate-pulse' : ''}
          >
            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
            <path d="M14.153 8.188l-.72 -3.236a2.493 2.493 0 0 0 -4.867 0l-3.025 13.614a2 2 0 0 0 1.952 2.434h7.014a2 2 0 0 0 1.952 -2.434l-.524 -2.357m-4.935 1.791l9 -13" />
            <path d="M19 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
          </svg>
        </button>

        {/* Restart Button - pinned to the inside edge (closer to Play) */}
        <button
          onClick={handleRestart}
          disabled={!arrangement}
          aria-label="Restart"
          className="
            w-12 h-12 rounded-full flex items-center justify-center
            text-[var(--text-secondary)] hover:bg-white/10 hover:text-[var(--text-primary)]
            transition-all duration-200 disabled:opacity-20 cursor-pointer
            hover:shadow-[0_0_12px_-3px_rgba(255,255,255,0.1)]
          "
          title="Restart"
        >
          <SkipBack size={20} />
        </button>
      </div>

      {/* CENTER SECTION: Play Button Only (Perfectly Centered) */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
        {/* Play Button - with animated glow ring */}
        <div className="relative">
          {/* Glow ring behind play button */}
          <div className={`
            absolute inset-[-4px] rounded-full transition-all duration-500
            ${pbIsPlaying
              ? 'bg-white/10 shadow-[0_0_30px_rgba(255,255,255,0.25)] animate-pulse'
              : 'bg-transparent'
            }
          `} />
          <button
            onClick={handlePlayPause}
            disabled={!arrangement}
            aria-label={pbIsPlaying ? 'Pause' : 'Play'}
            className="
              relative w-14 h-14 rounded-full bg-white text-black
              flex items-center justify-center
              shadow-[0_0_30px_rgba(255,255,255,0.25),0_4px_15px_rgba(0,0,0,0.3)]
              hover:scale-105 hover:shadow-[0_0_40px_rgba(255,255,255,0.35)]
              active:scale-95 transition-all duration-200
              disabled:opacity-20 z-50 cursor-pointer
            "
          >
            {pbIsPlaying ? <Pause size={24} /> : <Play size={24} className="ml-0.5" fill="currentColor" />}
          </button>
        </div>
      </div>

      {/* RIGHT SECTION: Loop, Metronome, Camera */}
      <div className="flex items-center justify-end gap-5 z-10 flex-1 min-w-0">

        <div className="flex items-center gap-2">
          {/* Loop Button */}
          <button
            onClick={() => setLoopEnabled(!pbLoopEnabled)}
            disabled={!arrangement}
            aria-label="Toggle Loop"
            className={`
              w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer
              ${pbLoopEnabled
                ? 'bg-[var(--accent-secondary)]/25 text-[var(--accent-secondary-light)] shadow-[0_0_15px_-3px_var(--accent-secondary-glow)] border border-[var(--accent-secondary)]/30'
                : 'text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]'
              }
              disabled:opacity-20
            `}
            title="Toggle Loop"
          >
            <Repeat size={20} />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="w-px h-6 bg-white/8" />

          {/* Camera mode toggle: Smart / Follow / Static */}
          <div className="flex bg-white/5 rounded-full p-1 border border-white/8 items-center gap-1">
            <button
              onClick={() => setCameraMode('smart')}
              className={`
                px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wide
                transition-all duration-150 cursor-pointer
                ${cameraMode === 'smart'
                  ? 'bg-white/15 text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-white hover:bg-white/10'
                }
              `}
              title="Camera: Smart"
            >
              Smart
            </button>
            <button
              onClick={() => setCameraMode('follow')}
              className={`
                px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wide
                transition-all duration-150 cursor-pointer
                ${cameraMode === 'follow'
                  ? 'bg-white/15 text-[var(--text-primary)] shadow-sm'
                  : cameraMode === 'smart'
                    ? 'text-[var(--text-disabled)] opacity-60'
                    : 'text-[var(--text-muted)] hover:text-white hover:bg-white/10'
                }
              `}
              title="Camera: Follow"
            >
              Follow
            </button>
            <button
              onClick={() => setCameraMode('static')}
              className={`
                px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wide
                transition-all duration-150 cursor-pointer
                ${cameraMode === 'static'
                  ? 'bg-white/15 text-[var(--text-primary)] shadow-sm'
                  : cameraMode === 'smart'
                    ? 'text-[var(--text-disabled)] opacity-60'
                    : 'text-[var(--text-muted)] hover:text-white hover:bg-white/10'
                }
              `}
              title="Camera: Static"
            >
              Static
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

export default TransportBar;
