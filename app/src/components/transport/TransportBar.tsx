/* ============================================================
   TRANSPORT BAR COMPONENT
   
   Playback controls at the bottom of the app.
   Layout: Position | Speed | [Record Play Loop] | Zoom
   ============================================================ */

import { useState } from 'react';
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

  // State for speed menu
  const [isSpeedOpen, setIsSpeedOpen] = useState(false);

  // Symmetrical Widths:
  // We use w-auto and gap-6 to let it size naturally
  // BUT we use absolute centering for the middle group to ensure play button is EXACTLY center

  return (
    <div className="
      absolute bottom-12 left-[calc(50%+4.5rem+15px)] -translate-x-1/2
      flex items-center justify-between px-6 h-20
      w-auto min-w-[600px]
      glass-pane glass-med rounded-full
      shadow-[0_20px_50px_rgba(0,0,0,0.4)] z-40
      border border-white/5
    ">

      {/* LEFT SECTION: Time & Metronome */}
      <div className="flex items-center gap-4 z-10">

        {/* Position Display */}
        <div className="text-2xl font-mono font-bold text-[var(--text-primary)] tabular-nums min-w-[80px] text-center">
          {arrangement ? formatPosition(playback.position, arrangement.timeSig) : '--:--'}
        </div>

        <div className="w-px h-6 bg-white/10" />

        {/* Metronome */}
        <button
          onClick={() => setMetronomeEnabled(!playback.metronomeEnabled)}
          className={`
                w-10 h-10 rounded-full flex items-center justify-center transition-all relative
                ${playback.metronomeEnabled
              ? 'bg-blue-500/80 text-white shadow-lg shadow-blue-500/30'
              : 'text-white/40 hover:bg-white/10 hover:text-white'
            }
            `}
          title="Metronome"
        >
          <div className="flex gap-0.5 items-end h-3">
            <div className={`w-0.5 bg-current rounded-full ${playback.metronomeEnabled ? 'h-3 animate-pulse' : 'h-1.5'}`} />
            <div className="w-0.5 h-2 bg-current rounded-full opacity-60" />
            <div className="w-0.5 h-1.5 bg-current rounded-full opacity-40" />
          </div>
        </button>

      </div>

      {/* CENTER SECTION: Controls Group (Absolute Centered) */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-4 z-20">
        {/* Restart */}
        <button
          onClick={handleRestart}
          disabled={!arrangement}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 text-white/70 transition-all disabled:opacity-20"
          title="Restart"
        >
          <SkipBack size={20} />
        </button>

        {/* Play Button */}
        <button
          onClick={handlePlayPause}
          disabled={!arrangement}
          className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:scale-105 active:scale-95 transition-all disabled:opacity-20 z-50"
        >
          {playback.isPlaying ? <Pause size={28} /> : <Play size={28} className="ml-1" fill="currentColor" />}
        </button>

        {/* Loop */}
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
          title="Toggle Loop"
        >
          <Repeat size={20} />
        </button>
      </div>

      {/* RIGHT SECTION: Configuration */}
      <div className="flex items-center gap-4 z-10 pl-[240px]">
        {/* Spacer to push right content past absolute center group if width is tight */}

        {/* Speed Controls (Collapsible) */}
        {!isSpeedOpen ? (
          <button
            onClick={() => setIsSpeedOpen(true)}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all font-bold text-xs"
            title="Playback Speed"
          >
            {playback.tempoMultiplier}x
          </button>
        ) : (
          <div className="flex bg-white/5 rounded-full p-1 border border-white/5 animate-in fade-in zoom-in duration-200">
            {speedOptions.map((speed) => (
              <button
                key={speed}
                onClick={() => {
                  setTempoMultiplier(speed);
                  setIsSpeedOpen(false);
                }}
                className={`
                  px-3 py-1 text-[10px] font-bold rounded-full transition-all
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
        )}

        <div className="w-px h-6 bg-white/10" />

        {/* Zoom Controls */}
        <div className="flex items-center gap-1 bg-white/5 rounded-full p-1 border border-white/5">
          <button
            onClick={() => setZoomLevel(Math.max(0.5, display.zoomLevel - 0.25))}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={() => setZoomLevel(Math.min(4, display.zoomLevel + 0.25))}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
          >
            <ZoomIn size={14} />
          </button>
        </div>

      </div>

    </div>
  );
}

export default TransportBar;
