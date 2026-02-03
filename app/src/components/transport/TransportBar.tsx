/* ============================================================
   TRANSPORT BAR COMPONENT
   
   Playback controls at the bottom of the app.
   Layout: Position | Speed | [Record Play Loop] | Zoom
   ============================================================ */

import { Play, Pause, Circle, Repeat, SkipBack, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
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
      absolute bottom-6 left-6 right-6
      flex items-center justify-between
      h-16 px-8
      glass-pane glass-high rounded-2xl
      shadow-2xl z-20
    ">


      {/* Left: Position display */}
      <div className="flex items-center gap-4 min-w-[180px]">
        {/* Current position */}
        <div className="text-center">
          <div className="text-2xl font-mono font-bold text-[var(--text-primary)] tabular-nums">
            {arrangement ? formatPosition(playback.position, arrangement.timeSig) : '--:--'}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
            Bar:Beat
          </div>
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-[var(--border-color)]" />

        {/* Speed selector */}
        <div className="flex flex-col items-start gap-1">
          <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Speed</span>
          <div className="flex bg-[var(--button-bg)] rounded-md p-0.5">
            {speedOptions.map((speed) => (
              <button
                key={speed}
                onClick={() => setTempoMultiplier(speed)}
                className={`
                  px-2 py-0.5 text-xs font-medium rounded transition-all
                  ${playback.tempoMultiplier === speed
                    ? 'bg-[var(--accent-primary)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }
                `}
              >
                {speed}×
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Center: Main transport controls */}
      <div className="flex items-center gap-2">
        {/* Restart button */}
        <button
          onClick={handleRestart}
          disabled={!arrangement}
          className="
            w-9 h-9 rounded-lg
            flex items-center justify-center
            bg-[var(--button-bg)] text-[var(--text-secondary)]
            hover:bg-[var(--button-bg-hover)] hover:text-[var(--text-primary)]
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-all
          "
          title="Go to start"
        >
          <SkipBack size={16} />
        </button>

        {/* Record button */}
        <button
          onClick={toggleRecording}
          disabled={!arrangement || !armedVoiceId}
          className={`
            w-10 h-10 rounded-lg
            flex items-center justify-center
            transition-all
            ${isRecording
              ? 'bg-red-500 text-white animate-pulse'
              : armedVoiceId
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'
                : 'bg-[var(--button-bg)] text-[var(--text-muted)] cursor-not-allowed'
            }
          `}
          title={isRecording ? 'Stop Recording' : armedVoiceId ? 'Record' : 'Arm a voice to record'}
        >
          <Circle size={18} fill={isRecording ? 'currentColor' : 'none'} />
        </button>

        {/* Play/Pause button - prominent */}
        <button
          onClick={handlePlayPause}
          disabled={!arrangement}
          className={`
            w-14 h-14 rounded-xl
            flex items-center justify-center
            transition-all
            ${arrangement
              ? playback.isPlaying
                ? 'bg-[var(--accent-primary)] text-white shadow-lg shadow-[var(--accent-primary)]/30'
                : 'bg-[var(--accent-primary)] text-white hover:brightness-110'
              : 'bg-[var(--button-bg)] text-[var(--text-muted)] cursor-not-allowed'
            }
          `}
          title={playback.isPlaying ? 'Pause' : 'Play'}
        >
          {playback.isPlaying ? (
            <Pause size={24} />
          ) : (
            <Play size={24} className="ml-1" fill="currentColor" />
          )}
        </button>

        {/* Loop toggle */}
        <button
          onClick={() => setLoopEnabled(!playback.loopEnabled)}
          disabled={!arrangement}
          className={`
            w-10 h-10 rounded-lg
            flex items-center justify-center
            transition-all
            ${playback.loopEnabled
              ? 'bg-[var(--accent-secondary)]/20 text-[var(--accent-secondary)] border border-[var(--accent-secondary)]/30'
              : 'bg-[var(--button-bg)] text-[var(--text-secondary)] hover:bg-[var(--button-bg-hover)] hover:text-[var(--text-primary)]'
            }
            disabled:opacity-40 disabled:cursor-not-allowed
          `}
          title={playback.loopEnabled ? 'Loop On' : 'Loop Off'}
        >
          <Repeat size={16} />
        </button>
      </div>

      {/* Right: Zoom controls */}
      <div className="flex items-center gap-3 min-w-[180px] justify-end">
        {/* Zoom label */}
        <span className="text-xs text-[var(--text-muted)]">
          {Math.round(display.zoomLevel * 100)}%
        </span>

        {/* Zoom buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoomLevel(Math.max(0.5, display.zoomLevel - 0.25))}
            className="
              w-8 h-8 rounded-md
              flex items-center justify-center
              bg-[var(--button-bg)] text-[var(--text-secondary)]
              hover:bg-[var(--button-bg-hover)] hover:text-[var(--text-primary)]
              transition-all
            "
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>

          <button
            onClick={() => setZoomLevel(1)}
            className="
              w-8 h-8 rounded-md
              flex items-center justify-center
              bg-[var(--button-bg)] text-[var(--text-secondary)]
              hover:bg-[var(--button-bg-hover)] hover:text-[var(--text-primary)]
              transition-all
            "
            title="Fit to View"
          >
            <Maximize2 size={14} />
          </button>

          <button
            onClick={() => setZoomLevel(Math.min(4, display.zoomLevel + 0.25))}
            className="
              w-8 h-8 rounded-md
              flex items-center justify-center
              bg-[var(--button-bg)] text-[var(--text-secondary)]
              hover:bg-[var(--button-bg-hover)] hover:text-[var(--text-primary)]
              transition-all
            "
            title="Zoom In"
          >
            <ZoomIn size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default TransportBar;
