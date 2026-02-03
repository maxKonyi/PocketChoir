/* ============================================================
   HARMONY SINGING APP - MAIN COMPONENT
   
   The root component that assembles the entire application.
   Layout: TopBar + (Sidebar + Grid) + TransportBar
   ============================================================ */

import { useEffect, useState } from 'react';
import { TopBar } from './components/topbar';
import { VoiceSidebar } from './components/sidebar';
import { TransportBar } from './components/transport';
import { Grid } from './components/grid';
import { LibraryModal, MicSetupModal, RangeSetupModal, DisplaySettingsModal, CreateArrangementModal } from './components/modals';
import { useAppStore } from './stores/appStore';
import { AudioService } from './services/AudioService';
import { playbackEngine } from './services/PlaybackEngine';
import { applyTheme } from './utils/colors';

function App() {
  // Get state and actions from store
  const arrangement = useAppStore((state) => state.arrangement);
  const playback = useAppStore((state) => state.playback);
  const countIn = useAppStore((state) => state.countIn);
  const theme = useAppStore((state) => state.theme);
  const setPosition = useAppStore((state) => state.setPosition);

  // Count-in visual state
  const [countInDisplay, setCountInDisplay] = useState<number | null>(null);

  /**
   * Initialize audio on first user interaction.
   * Required due to browser autoplay policies.
   */
  const initializeAudio = async () => {
    if (!AudioService.isReady()) {
      try {
        await AudioService.initialize();
        console.log('Audio initialized');
      } catch (error) {
        console.error('Failed to initialize audio:', error);
      }
    }
  };

  /**
   * Apply theme on mount and when theme changes.
   */
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  /**
   * Initialize playback engine when arrangement changes.
   */
  useEffect(() => {
    if (arrangement && AudioService.isReady()) {
      playbackEngine.initialize(arrangement, {
        onPositionUpdate: (t16) => {
          setPosition(t16);
        },
        onLoop: () => {
          console.log('Loop');
        },
      });
    }
  }, [arrangement, setPosition]);

  /**
   * Handle play/pause state changes.
   */
  useEffect(() => {
    if (!arrangement) return;

    const handlePlayback = async () => {
      // Make sure audio is initialized
      await initializeAudio();

      // Re-initialize playback engine if needed
      if (!playbackEngine.getIsPlaying() && !AudioService.isReady()) {
        await AudioService.initialize();
        playbackEngine.initialize(arrangement, {
          onPositionUpdate: (t16) => {
            setPosition(t16);
          },
          onCountIn: (beat, total) => {
            // Show count-in visual feedback
            setCountInDisplay(total - beat + 1);
          },
        });
      }

      if (playback.isPlaying) {
        // Use count-in only when recording starts
        const countInBars = (playback.isRecording && countIn.enabled) ? countIn.bars : 0;
        playbackEngine.play(countInBars).then(() => {
          // Clear count-in display when done
          setCountInDisplay(null);
        });
      } else {
        playbackEngine.pause();
        setCountInDisplay(null);
      }
    };

    handlePlayback();
  }, [playback.isPlaying, playback.isRecording, countIn.enabled, countIn.bars, arrangement, setPosition]);

  /**
   * Update playback engine settings when they change.
   */
  useEffect(() => {
    playbackEngine.setTempoMultiplier(playback.tempoMultiplier);
  }, [playback.tempoMultiplier]);

  useEffect(() => {
    playbackEngine.setLoopEnabled(playback.loopEnabled);
  }, [playback.loopEnabled]);

  return (
    <div
      className="h-screen w-screen overflow-hidden relative"
      onClick={initializeAudio}
    >
      {/* Main grid visualization - background layer */}
      <div className="absolute inset-0 pt-24 pb-28 pl-44 pr-8">
        <Grid arrangement={arrangement} className="h-full w-full" />
      </div>

      {/* UI Overlays - Floating panes */}
      <TopBar />
      <VoiceSidebar />
      <TransportBar />

      {/* Modals */}
      <LibraryModal />
      <MicSetupModal />
      <RangeSetupModal />
      <DisplaySettingsModal />
      <CreateArrangementModal />

      {/* Count-in overlay */}
      {countInDisplay !== null && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
          <div className="text-9xl font-bold text-white animate-pulse drop-shadow-[0_0_30px_rgba(255,255,255,0.8)]">
            {countInDisplay}
          </div>
        </div>
      )}

      {/* Welcome message when no arrangement is loaded */}
      {!arrangement && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center p-8 pointer-events-auto">
            <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
              Harmony Singing
            </h1>
            <p className="text-[var(--text-secondary)] mb-6">
              Learn to sing harmony by recording yourself over guided arrangements
            </p>
            <button
              onClick={() => useAppStore.getState().setLibraryOpen(true)}
              className="
                px-6 py-3 
                bg-[var(--accent-primary)] 
                text-white 
                rounded-[var(--radius-lg)]
                font-medium
                hover:brightness-110
                transition-all
                shadow-[0_0_20px_var(--accent-primary-glow)]
              "
            >
              Choose an Arrangement
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
