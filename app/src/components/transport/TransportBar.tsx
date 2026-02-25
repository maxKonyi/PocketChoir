/* ============================================================
   TRANSPORT BAR COMPONENT
   
   Playback controls at the bottom of the app.
   Layout: KEY | BPM METRONOME | RESTART PLAY LOOP | CAMERA
   ============================================================ */

import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Pause, Play, Repeat, RotateCcw, SkipBack } from 'lucide-react';

import { useAppStore } from '../../stores/appStore';
import { playbackEngine } from '../../services/PlaybackEngine';
import { transposeTonic } from '../../utils/music';

export function TransportBar() {
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
  const bpmDragRef = useRef<{ isDragging: boolean; startClientY: number; startTempo: number; } | null>(null);

  const commitTempo = (tempo: number) => {
    if (!arrangement) return;
    const nextTempo = Math.max(30, Math.min(300, tempo));
    updateArrangementParams({ ...arrangement, tempo: nextTempo });
  };

  const commitTransposeDelta = (deltaSemitones: number) => {
    setTransposition((transposition || 0) + deltaSemitones);
  };

  const handlePlayPause = () => setPlaying(!pbIsPlaying);
  const handleRestart = () => {
    playbackEngine.seek(0);
    useAppStore.getState().triggerCameraFollowReset();
  };

  return (
    <div className="
      absolute bottom-4 left-[calc(50%+4.5rem+15px)] -translate-x-1/2
      flex items-center justify-between px-8 h-[72px]
      w-auto min-w-[760px]
      glass-pane glass-med rounded-full shimmer
      shadow-[0_20px_60px_rgba(0,0,0,0.5),0_0_80px_-20px_rgba(139,92,246,0.08)] z-40
      border border-white/8
    ">

      {/* LEFT SECTION: Key | BPM Metronome */}
      <div className="flex items-center justify-start gap-4 z-10 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {/* Key Display */}
          {arrangement && (
            <div className="flex items-center gap-0.5">
              <div className="flex flex-col items-center leading-none px-2.5 py-1 rounded-xl bg-white/5 w-[46px]">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[var(--text-dim)] font-semibold tracking-wide">Key</span>
                  {Boolean(transposition) && (
                    <button
                      onClick={() => setTransposition(0)}
                      title="Reset to original key"
                      aria-label="Reset to original key"
                      className="w-3.5 h-3.5 flex items-center justify-center text-amber-300/90 hover:text-amber-200 transition-colors cursor-pointer"
                    >
                      <RotateCcw size={10} />
                    </button>
                  )}
                </div>
                <span className="text-sm font-bold text-[var(--text-primary)] tabular-nums text-center w-full">{effectiveTonic ?? arrangement.tonic}</span>
              </div>
              <div className="flex flex-col justify-center">
                <button onClick={() => commitTransposeDelta(1)} className="w-5 h-5 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/8 rounded transition-all duration-150 cursor-pointer">
                  <ChevronUp size={14} />
                </button>
                <button onClick={() => commitTransposeDelta(-1)} className="w-5 h-5 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/8 rounded transition-all duration-150 cursor-pointer">
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>
          )}

          <div className="w-px h-6 bg-white/10 mx-2" />

          {/* BPM + Metronome */}
          {arrangement && (
            <div className="flex items-center gap-2">
              <div
                className="flex flex-col items-center leading-none px-2.5 py-1 rounded-xl bg-white/5 select-none w-[52px] cursor-ns-resize"
                onDoubleClick={() => {
                  setIsEditingBpm(true);
                  setBpmDraft(String(bpmValue ?? Math.round(arrangement.tempo)));
                }}
                onPointerDown={(e) => {
                  if (isEditingBpm) return;
                  const startTempo = bpmValue ?? Math.round(arrangement.tempo);
                  bpmDragRef.current = { isDragging: true, startClientY: e.clientY, startTempo };
                  (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const drag = bpmDragRef.current;
                  if (!drag?.isDragging) return;
                  const dy = e.clientY - drag.startClientY;
                  commitTempo(drag.startTempo + (-dy / 6));
                }}
                onPointerUp={() => { bpmDragRef.current = null; }}
              >
                <span className="text-[10px] text-[var(--text-dim)] font-semibold tracking-wide">BPM</span>
                {isEditingBpm ? (
                  <input
                    autoFocus
                    value={bpmDraft}
                    onChange={(e) => setBpmDraft(e.target.value)}
                    onBlur={() => {
                      const parsed = Number(bpmDraft);
                      if (Number.isFinite(parsed)) commitTempo(parsed);
                      setIsEditingBpm(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const parsed = Number(bpmDraft);
                        if (Number.isFinite(parsed)) commitTempo(parsed);
                        setIsEditingBpm(false);
                      } else if (e.key === 'Escape') {
                        setIsEditingBpm(false);
                      }
                    }}
                    className="text-sm font-bold text-[var(--text-primary)] tabular-nums text-center w-full bg-transparent outline-none"
                    inputMode="numeric"
                  />
                ) : (
                  <span className="text-sm font-bold text-[var(--text-primary)] tabular-nums text-center w-full">{bpmValue}</span>
                )}
              </div>

              <button
                onClick={() => setMetronomeEnabled(!pbMetronomeEnabled)}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer ${pbMetronomeEnabled ? 'bg-blue-500/25 text-blue-300 shadow-[0_0_15px_-3px_rgba(59,130,246,0.4)] border border-blue-500/30' : 'text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]'}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={pbMetronomeEnabled ? 'animate-pulse' : ''}>
                  <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                  <path d="M14.153 8.188l-.72 -3.236a2.493 2.493 0 0 0 -4.867 0l-3.025 13.614a2 2 0 0 0 1.952 2.434h7.014a2 2 0 0 0 1.952 -2.434l-.524 -2.357m-4.935 1.791l9 -13" />
                  <path d="M19 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
                </svg>
              </button>
            </div>
          )}
        </div>
        <div className="w-px h-6 bg-white/10 ml-1" />
      </div>

      {/* CENTER SECTION: RESTART PLAY LOOP */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex items-center gap-4">
        <button
          onClick={handleRestart}
          disabled={!arrangement}
          className="w-11 h-11 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:bg-white/10 hover:text-[var(--text-primary)] transition-all duration-200 disabled:opacity-20 cursor-pointer"
        >
          <SkipBack size={18} />
        </button>

        <div className="relative">
          <div className={`absolute inset-[-4px] rounded-full transition-all duration-500 ${pbIsPlaying ? 'bg-white/10 shadow-[0_0_30px_rgba(255,255,255,0.25)] animate-pulse' : 'bg-transparent'}`} />
          <button
            onClick={handlePlayPause}
            disabled={!arrangement}
            className="relative w-14 h-14 rounded-full bg-white text-black flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.25),0_4px_15px_rgba(0,0,0,0.3)] hover:scale-105 hover:shadow-[0_0_40px_rgba(255,255,255,0.35)] active:scale-95 transition-all duration-200 disabled:opacity-20 z-50 cursor-pointer"
          >
            {pbIsPlaying ? <Pause size={24} /> : <Play size={24} className="ml-0.5" fill="currentColor" />}
          </button>
        </div>

        <button
          onClick={() => setLoopEnabled(!pbLoopEnabled)}
          disabled={!arrangement}
          className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer ${pbLoopEnabled ? 'bg-[var(--accent-secondary)]/25 text-[var(--accent-secondary-light)] shadow-[0_0_15px_-3px_var(--accent-secondary-glow)] border border-[var(--accent-secondary)]/30' : 'text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]'} disabled:opacity-20`}
        >
          <Repeat size={18} />
        </button>
      </div>

      {/* RIGHT SECTION: CAMERA */}
      <div className="flex items-center justify-end z-10 flex-1 min-w-0">
        <div className="flex items-center gap-4">
          <div className="w-px h-6 bg-white/10 mr-1" />
          <div className="flex bg-white/5 rounded-full p-1 border border-white/8 items-center gap-1">
            {['smart', 'follow', 'static'].map((mode) => (
              <button
                key={mode}
                onClick={() => setCameraMode(mode as any)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wide transition-all duration-150 cursor-pointer ${cameraMode === mode ? 'bg-white/15 text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-muted)] hover:text-white hover:bg-white/10'}`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TransportBarWrapper() {
  return <TransportBar />;
}

export default TransportBar;
