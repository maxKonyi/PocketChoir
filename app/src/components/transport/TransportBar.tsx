/* ============================================================
   TRANSPORT BAR COMPONENT
   
   Playback controls at the bottom of the app.
   Layout: Position | Speed | [Record Play Loop] | Zoom
   ============================================================ */

import { Play, Pause, Repeat, SkipBack, ZoomIn, ZoomOut } from 'lucide-react';

import { useAppStore } from '../../stores/appStore';
import { playbackEngine } from '../../services/PlaybackEngine';

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

/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export function TransportBar() {
  // Get state from store
  const playback = useAppStore((state) => state.playback);
  const arrangement = useAppStore((state) => state.arrangement);
  const display = useAppStore((state) => state.display);

  // actions
  const setPlaying = useAppStore((state) => state.setPlaying);
  const setLoopEnabled = useAppStore((state) => state.setLoopEnabled);
  const setMetronomeEnabled = useAppStore((state) => state.setMetronomeEnabled);
  const setTempoMultiplier = useAppStore((state) => state.setTempoMultiplier);
  const setZoomLevel = useAppStore((state) => state.setZoomLevel);
  // setPosition is unused here because we use playbackEngine.seek directly for interactions that need immediate engine response
  // const setPosition = useAppStore((state) => state.setPosition);

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
    // const wasPlaying = playback.isPlaying; // Unused, seek maintains state
    playbackEngine.seek(0);
  };

  // Symmetrical Widths:
  // We use w-auto and gap-6 to let it size naturally
  // BUT we use absolute centering for the middle group to ensure play button is EXACTLY center

  return (
    <div className="
      absolute bottom-12 left-[calc(50%+4.5rem+15px)] -translate-x-1/2
      flex items-center justify-between px-8 h-[72px]
      w-auto min-w-[760px]
      glass-pane glass-med rounded-full shimmer
      shadow-[0_20px_60px_rgba(0,0,0,0.5),0_0_80px_-20px_rgba(139,92,246,0.08)] z-40
      border border-white/8
    ">

      {/* LEFT SECTION: Key, Tempo, Time, Metronome */}
      <div className="flex items-center gap-2.5 z-10 w-[260px] shrink-0">

        {/* Key Display - pill style */}
        {arrangement && (
          <div className="flex flex-col items-center leading-none px-2.5 py-1 rounded-lg bg-white/5">
            <span className="text-[9px] text-[var(--text-dim)] uppercase font-bold tracking-[0.15em]">Key</span>
            <span className="text-sm font-bold text-[var(--text-primary)] tabular-nums text-center min-w-[24px]">{arrangement.tonic}</span>
          </div>
        )}

        {/* Tempo Display - pill style */}
        {arrangement && (
          <div className="flex flex-col items-center leading-none px-2.5 py-1 rounded-lg bg-white/5">
            <span className="text-[9px] text-[var(--text-dim)] uppercase font-bold tracking-[0.15em]">BPM</span>
            <span className="text-sm font-bold text-[var(--text-primary)] tabular-nums text-center min-w-[24px]">{Math.round(arrangement.tempo)}</span>
          </div>
        )}

        <div className="w-px h-8 bg-white/8" />

        {/* Position Display - larger, more prominent */}
        <div className="
          text-2xl font-mono font-bold text-[var(--text-primary)] tabular-nums
          min-w-[70px] text-center
          drop-shadow-[0_0_8px_rgba(255,255,255,0.15)]
        ">
          {arrangement ? formatPosition(playback.position, arrangement.timeSig) : '--:--'}
        </div>

        <div className="w-px h-8 bg-white/8" />

        {/* Metronome */}
        <button
          onClick={() => setMetronomeEnabled(!playback.metronomeEnabled)}
          aria-label="Toggle Metronome"
          className={`
            w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer
            ${playback.metronomeEnabled
              ? 'bg-blue-500/25 text-blue-300 shadow-[0_0_15px_-3px_rgba(59,130,246,0.4)] border border-blue-500/30'
              : 'text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]'
            }
          `}
          title="Metronome"
        >
          {/* Metronome icon from Tabler Icons (free, high-quality) */}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={playback.metronomeEnabled ? 'animate-pulse' : ''}
          >
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M14.153 8.188l-.72 -3.236a2.493 2.493 0 0 0 -4.867 0l-3.025 13.614a2 2 0 0 0 1.952 2.434h7.014a2 2 0 0 0 1.952 -2.434l-.524 -2.357m-4.935 1.791l9 -13" />
            <path d="M19 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
          </svg>
        </button>

      </div>

      {/* CENTER SECTION: Controls Group (Absolute Centered) */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-5 z-20">
        {/* Restart */}
        <button
          onClick={handleRestart}
          disabled={!arrangement}
          aria-label="Restart"
          className="
            w-10 h-10 rounded-full flex items-center justify-center
            text-[var(--text-secondary)] hover:bg-white/10 hover:text-[var(--text-primary)]
            transition-all duration-200 disabled:opacity-20 cursor-pointer
            hover:shadow-[0_0_12px_-3px_rgba(255,255,255,0.1)]
          "
          title="Restart"
        >
          <SkipBack size={18} />
        </button>

        {/* Play Button - with animated glow ring */}
        <div className="relative">
          {/* Glow ring behind play button */}
          <div className={`
            absolute inset-[-4px] rounded-full transition-all duration-500
            ${playback.isPlaying
              ? 'bg-white/10 shadow-[0_0_30px_rgba(255,255,255,0.25)] animate-pulse'
              : 'bg-transparent'
            }
          `} />
          <button
            onClick={handlePlayPause}
            disabled={!arrangement}
            aria-label={playback.isPlaying ? 'Pause' : 'Play'}
            className="
              relative w-14 h-14 rounded-full bg-white text-black
              flex items-center justify-center
              shadow-[0_0_30px_rgba(255,255,255,0.25),0_4px_15px_rgba(0,0,0,0.3)]
              hover:scale-105 hover:shadow-[0_0_40px_rgba(255,255,255,0.35)]
              active:scale-95 transition-all duration-200
              disabled:opacity-20 z-50 cursor-pointer
            "
          >
            {playback.isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-0.5" fill="currentColor" />}
          </button>
        </div>

        {/* Loop */}
        <button
          onClick={() => setLoopEnabled(!playback.loopEnabled)}
          disabled={!arrangement}
          aria-label="Toggle Loop"
          className={`
            w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer
            ${playback.loopEnabled
              ? 'bg-[var(--accent-secondary)]/25 text-[var(--accent-secondary-light)] shadow-[0_0_15px_-3px_var(--accent-secondary-glow)] border border-[var(--accent-secondary)]/30'
              : 'text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]'
            }
            disabled:opacity-20
          `}
          title="Toggle Loop"
        >
          <Repeat size={18} />
        </button>
      </div>

      {/* RIGHT SECTION: Configuration */}
      <div className="flex items-center justify-end gap-3 z-10 w-[260px] shrink-0">

        {/* Speed Controls (Always visible) */}
        <div className="flex bg-white/5 rounded-full p-0.5 border border-white/8">
          {speedOptions.map((speed) => (
            <button
              key={speed}
              onClick={() => {
                setTempoMultiplier(speed);
              }}
              aria-label={`Set playback speed to ${speed}x`}
              className={`
                px-3 py-1.5 text-[10px] font-bold rounded-full transition-all duration-200 cursor-pointer
                ${playback.tempoMultiplier === speed
                  ? 'bg-white/15 text-[var(--text-primary)] shadow-[0_0_10px_-3px_rgba(255,255,255,0.15)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/5'
                }
              `}
              title={`Playback Speed: ${speed}x`}
            >
              {speed}x
            </button>
          ))}
        </div>

        <div className="w-px h-6 bg-white/8" />

        {/* Zoom Controls */}
        <div className="flex items-center gap-0.5 bg-white/5 rounded-full p-0.5 border border-white/5">
          <button
            onClick={() => setZoomLevel(Math.max(0.5, display.zoomLevel - 0.25))}
            aria-label="Zoom Out"
            className="
              w-8 h-8 rounded-full flex items-center justify-center
              text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10
              transition-all duration-200 cursor-pointer
            "
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={() => setZoomLevel(Math.min(4, display.zoomLevel + 0.25))}
            aria-label="Zoom In"
            className="
              w-8 h-8 rounded-full flex items-center justify-center
              text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10
              transition-all duration-200 cursor-pointer
            "
          >
            <ZoomIn size={14} />
          </button>
        </div>

      </div>

    </div>
  );
}

export default TransportBar;
