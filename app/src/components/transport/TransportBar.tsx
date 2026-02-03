/* ============================================================
   TRANSPORT BAR COMPONENT
   
   Playback controls at the bottom of the app.
   Layout: Position | Speed | [Record Play Loop] | Zoom
   ============================================================ */

import { Play, Pause, Circle, Repeat, SkipBack, ZoomIn, ZoomOut } from 'lucide-react';

import { useAppStore } from '../../stores/appStore';
import { useRecording } from '../../hooks/useRecording';

/* ------------------------------------------------------------
   Helper: Format position as Bar:Beat
   ------------------------------------------------------------ */

function formatPosition(t16: number, timeSig: { numerator: number; denominator: number } = { numerator: 4, denominator: 4 }): string {
  const beatsPerBar = timeSig.numerator;
  const sixteenthsPerBeat = 4;
  const sixteenthsPerBar = beatsPerBar * sixteenthsPerBeat;

  const bar = Math.floor(t16 / sixteenthsPerBar) + 1;
  const beatInBar = Math.floor((t16 % sixteenthsPerBar) / sixteenthsPerBeat) + 1;

  return `${bar}:${beatInBar}`;
}

/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export function TransportBar() {
  // Get state from store
  const playback = useAppStore((state) => state.playback);
  const arrangement = useAppStore((state) => state.arrangement);
  const display = useAppStore((state) => state.display);
  const armedVoiceId = useAppStore((state) => state.armedVoiceId);

  // Get actions from store
  const setPlaying = useAppStore((state) => state.setPlaying);
  const setLoopEnabled = useAppStore((state) => state.setLoopEnabled);
  const setTempoMultiplier = useAppStore((state) => state.setTempoMultiplier);
  const setZoomLevel = useAppStore((state) => state.setZoomLevel);
  const setPosition = useAppStore((state) => state.setPosition);

  // Recording hook
  const { toggleRecording, isRecording } = useRecording();

  // Speed options
  const speedOptions = [0.5, 0.75, 1.0];

  /**
   * Handle play/pause toggle.
   */
  const handlePlayPause = () => {
    setPlaying(!playback.isPlaying);
  };

  /**
   * Reset to beginning.
   */
  const handleRestart = () => {
    setPosition(0);
  };

  return (
    <div className="
      absolute bottom-12 left-1/2 -translate-x-1/2
      flex items-center justify-between
      w-[800px] h-20 px-4
      glass-pane glass-high rounded-full
      shadow-[0_20px_50px_rgba(0,0,0,0.4)] z-40
      border border-white/5
    ">
      {/* Left Section: Position & Basic Controls */}
      <div className="flex-1 flex items-center gap-4 pl-6">
        <div className="text-2xl font-mono font-bold text-[var(--text-primary)] tabular-nums min-w-[70px]">
          {arrangement ? formatPosition(playback.position, arrangement.timeSig) : '--:--'}
        </div>

        <div className="w-px h-6 bg-white/10 mx-2" />

        <button
          onClick={handleRestart}
          disabled={!arrangement}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 text-white/70 transition-all disabled:opacity-20"
        >
          <SkipBack size={20} />
        </button>

        <button
          onClick={toggleRecording}
          disabled={!arrangement || !armedVoiceId}
          className={`
            w-10 h-10 rounded-full flex items-center justify-center transition-all
            ${isRecording
              ? 'bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.5)]'
              : armedVoiceId
                ? 'bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20'
                : 'bg-white/5 text-white/20'
            }
          `}
        >
          <Circle size={18} fill={isRecording ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* Center Section: Main Action */}
      <div className="flex-none relative w-20 flex justify-center">
        <button
          onClick={handlePlayPause}
          disabled={!arrangement}
          className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:scale-105 active:scale-95 transition-all disabled:opacity-20"
        >
          {playback.isPlaying ? <Pause size={28} /> : <Play size={28} className="ml-1" fill="currentColor" />}
        </button>
      </div>

      {/* Right Section: Configuration & View */}
      <div className="flex-1 flex items-center justify-end gap-4 pr-6">
        <button
          onClick={() => setLoopEnabled(!playback.loopEnabled)}
          disabled={!arrangement}
          className={`
            w-10 h-10 rounded-full flex items-center justify-center transition-all
            ${playback.loopEnabled
              ? 'bg-[var(--accent-secondary)] text-white shadow-lg shadow-[var(--accent-secondary)]/30'
              : 'text-white/40 hover:bg-white/10 hover:text-white'
            }
            disabled:opacity-20
          `}
        >
          <Repeat size={20} />
        </button>

        <div className="w-px h-6 bg-white/10 mx-2" />

        <div className="flex bg-white/5 rounded-full p-1 border border-white/5">
          {speedOptions.map((speed) => (
            <button
              key={speed}
              onClick={() => setTempoMultiplier(speed)}
              className={`
                px-2.5 py-1 text-[10px] font-bold rounded-full transition-all
                ${playback.tempoMultiplier === speed
                  ? 'bg-white/20 text-white'
                  : 'text-white/40 hover:text-white/60'
                }
              `}
            >
              {speed}x
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-white/5 rounded-full p-1 border border-white/5">
          <button
            onClick={() => setZoomLevel(Math.max(0.5, display.zoomLevel - 0.25))}
            className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={() => setZoomLevel(Math.min(4, display.zoomLevel + 0.25))}
            className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
          >
            <ZoomIn size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default TransportBar;
