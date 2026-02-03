/* ============================================================
   TRANSPORT BAR COMPONENT
   
   Playback controls at the bottom of the app.
   Matches mockup: Speed selector | Record | Play | Loop | Zoom controls
   ============================================================ */

import { Play, Pause, Circle, Repeat, ZoomIn, ZoomOut, Search } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useRecording } from '../../hooks/useRecording';

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
   * Handle zoom in.
   */
  const handleZoomIn = () => {
    setZoomLevel(Math.min(4, display.zoomLevel + 0.5));
  };

  /**
   * Handle zoom out.
   */
  const handleZoomOut = () => {
    setZoomLevel(Math.max(0.5, display.zoomLevel - 0.5));
  };

  return (
    <div className="flex items-center justify-center gap-6 px-4 py-3 bg-[var(--bg-secondary)]/60 backdrop-blur-md border-t border-white/5">
      {/* Speed selector (left) */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-muted)]">
          {playback.tempoMultiplier}x speed
        </span>
        <div className="flex bg-[var(--button-bg)]/60 rounded-full border border-white/10 p-0.5">
          {speedOptions.map((speed) => (
            <button
              key={speed}
              onClick={() => setTempoMultiplier(speed)}
              className={`
                px-2 py-0.5 text-xs font-medium rounded-full transition-all
                ${playback.tempoMultiplier === speed 
                  ? 'bg-[var(--accent-primary)] text-white' 
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }
              `}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>

      {/* Center - Main transport controls */}
      <div className="flex items-center gap-3">
        {/* Record button */}
        <button
          onClick={toggleRecording}
          disabled={!arrangement || !armedVoiceId}
          className={`
            w-10 h-10 rounded-full
            flex items-center justify-center
            transition-all
            ${isRecording 
              ? 'bg-red-500 text-white animate-pulse ring-2 ring-red-400' 
              : armedVoiceId 
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 ring-1 ring-red-500/50' 
                : 'bg-white/5 text-[var(--text-muted)] cursor-not-allowed'
            }
          `}
          title={isRecording ? 'Stop Recording' : armedVoiceId ? 'Start Recording' : 'Arm a voice first'}
        >
          <Circle size={16} fill={isRecording ? 'currentColor' : 'none'} />
        </button>

        {/* Play/Pause button - large and prominent */}
        <button
          onClick={handlePlayPause}
          disabled={!arrangement}
          className={`
            w-12 h-12 rounded-full
            flex items-center justify-center
            transition-all
            ${arrangement 
              ? 'bg-white/10 hover:bg-white/20 text-white' 
              : 'bg-white/5 text-[var(--text-muted)] cursor-not-allowed'
            }
            ${playback.isPlaying ? 'ring-2 ring-[var(--accent-primary)] shadow-lg' : ''}
          `}
          title={playback.isPlaying ? 'Pause' : 'Play'}
        >
          {playback.isPlaying ? (
            <Pause size={20} />
          ) : (
            <Play size={20} className="ml-0.5" fill="currentColor" />
          )}
        </button>

        {/* Loop toggle */}
        <button
          onClick={() => setLoopEnabled(!playback.loopEnabled)}
          disabled={!arrangement}
          className={`
            w-10 h-10 rounded-full
            flex items-center justify-center
            transition-all
            ${playback.loopEnabled 
              ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]/50' 
              : 'bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/10'
            }
          `}
          title={playback.loopEnabled ? 'Disable Loop' : 'Enable Loop'}
        >
          <Repeat size={16} />
        </button>
      </div>

      {/* Zoom controls (right) */}
      <div className="flex items-center gap-2">
        {/* Magnifying glass / fit to screen */}
        <button
          onClick={() => setZoomLevel(1)}
          className="
            w-8 h-8 rounded-full
            flex items-center justify-center
            bg-white/5 text-[var(--text-secondary)]
            hover:bg-white/10 hover:text-[var(--text-primary)]
            transition-all
          "
          title="Fit to screen"
        >
          <Search size={14} />
        </button>
        
        {/* Zoom out */}
        <button
          onClick={handleZoomOut}
          className="
            w-8 h-8 rounded-full
            flex items-center justify-center
            bg-white/5 text-[var(--text-secondary)]
            hover:bg-white/10 hover:text-[var(--text-primary)]
            transition-all
          "
          title="Zoom Out"
        >
          <ZoomOut size={14} />
        </button>
        
        {/* Zoom in */}
        <button
          onClick={handleZoomIn}
          className="
            w-8 h-8 rounded-full
            flex items-center justify-center
            bg-white/5 text-[var(--text-secondary)]
            hover:bg-white/10 hover:text-[var(--text-primary)]
            transition-all
          "
          title="Zoom In"
        >
          <ZoomIn size={14} />
        </button>
      </div>
    </div>
  );
}

export default TransportBar;
