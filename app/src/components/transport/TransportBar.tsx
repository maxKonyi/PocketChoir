/* ============================================================
   TRANSPORT BAR COMPONENT
   
   Playback controls at the bottom of the app.
   Contains: Play/Pause, Record, Loop, Speed, Zoom
   ============================================================ */

import { Play, Pause, Circle, Repeat, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { useAppStore } from '../../stores/appStore';

/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export function TransportBar() {
  // Get state from store
  const playback = useAppStore((state) => state.playback);
  const armedVoiceId = useAppStore((state) => state.armedVoiceId);
  const arrangement = useAppStore((state) => state.arrangement);
  const display = useAppStore((state) => state.display);
  
  // Get actions from store
  const setPlaying = useAppStore((state) => state.setPlaying);
  const setRecording = useAppStore((state) => state.setRecording);
  const setLoopEnabled = useAppStore((state) => state.setLoopEnabled);
  const setTempoMultiplier = useAppStore((state) => state.setTempoMultiplier);
  const setZoomLevel = useAppStore((state) => state.setZoomLevel);

  // Speed options
  const speedOptions = [0.5, 0.75, 1.0];

  /**
   * Handle play/pause toggle.
   */
  const handlePlayPause = () => {
    setPlaying(!playback.isPlaying);
  };

  /**
   * Handle record button click.
   */
  const handleRecord = () => {
    if (!armedVoiceId) {
      alert('Please arm a voice for recording first (click the red circle button next to a voice)');
      return;
    }
    
    if (playback.isRecording) {
      // Stop recording
      setRecording(false);
      setPlaying(false);
    } else {
      // Start recording (will also start playback)
      setRecording(true);
      setPlaying(true);
    }
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

  /**
   * Format position as Bar.Beat.
   */
  const formatPosition = (t16: number) => {
    if (!arrangement) return '1.1';
    const bar = Math.floor(t16 / 16) + 1;
    const beat = Math.floor((t16 % 16) / 4) + 1;
    return `${bar}.${beat}`;
  };

  return (
    <Panel 
      variant="solid" 
      className="flex items-center justify-between px-4 py-2 rounded-none border-x-0 border-b-0"
    >
      {/* Left side - Position display */}
      <div className="flex items-center gap-4 w-32">
        <div className="text-lg font-mono text-[var(--text-primary)]">
          {formatPosition(playback.position)}
        </div>
      </div>

      {/* Center - Main transport controls */}
      <div className="flex items-center gap-2">
        {/* Record button */}
        <Button
          variant={playback.isRecording ? 'record' : 'default'}
          size="icon"
          onClick={handleRecord}
          disabled={!arrangement}
          title={playback.isRecording ? 'Stop Recording' : 'Start Recording'}
          className={`
            h-10 w-10
            ${playback.isRecording ? 'animate-pulse' : ''}
            ${armedVoiceId ? '' : 'opacity-50'}
          `}
        >
          <Circle 
            size={20} 
            fill={playback.isRecording ? 'currentColor' : 'none'}
          />
        </Button>

        {/* Play/Pause button */}
        <Button
          variant="primary"
          size="icon"
          onClick={handlePlayPause}
          disabled={!arrangement}
          title={playback.isPlaying ? 'Pause' : 'Play'}
          className="h-12 w-12"
        >
          {playback.isPlaying ? (
            <Pause size={24} />
          ) : (
            <Play size={24} className="ml-1" />
          )}
        </Button>

        {/* Loop toggle */}
        <Button
          variant={playback.loopEnabled ? 'primary' : 'ghost'}
          size="icon"
          onClick={() => setLoopEnabled(!playback.loopEnabled)}
          disabled={!arrangement}
          title={playback.loopEnabled ? 'Disable Loop' : 'Enable Loop'}
          className="h-10 w-10"
        >
          <Repeat size={18} />
        </Button>
      </div>

      {/* Right side - Speed and Zoom */}
      <div className="flex items-center gap-4 w-32 justify-end">
        {/* Speed selector */}
        <div className="flex items-center gap-1 bg-[var(--button-bg)] rounded-[var(--radius-md)] p-1">
          {speedOptions.map((speed) => (
            <Button
              key={speed}
              variant={playback.tempoMultiplier === speed ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setTempoMultiplier(speed)}
              className="px-2 text-xs"
            >
              {speed}x
            </Button>
          ))}
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomOut}
            title="Zoom Out"
            className="h-7 w-7"
          >
            <ZoomOut size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomIn}
            title="Zoom In"
            className="h-7 w-7"
          >
            <ZoomIn size={14} />
          </Button>
        </div>
      </div>
    </Panel>
  );
}

export default TransportBar;
