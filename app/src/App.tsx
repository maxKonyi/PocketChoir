/* ============================================================
   HARMONY SINGING APP - MAIN COMPONENT
   
   The root component that assembles the entire application.
   Layout: TopBar + (Sidebar + Grid) + TransportBar
   ============================================================ */

import { useEffect } from 'react';
import { TopBar } from './components/topbar';
import { VoiceSidebar } from './components/sidebar';
import { TransportBar } from './components/transport';
import { Grid } from './components/grid';
import { LibraryModal } from './components/modals';
import { useAppStore } from './stores/appStore';
import { AudioService } from './services/AudioService';
import { playbackEngine } from './services/PlaybackEngine';
import { applyTheme } from './utils/colors';

function App() {
  // Get state and actions from store
  const arrangement = useAppStore((state) => state.arrangement);
  const playback = useAppStore((state) => state.playback);
  const theme = useAppStore((state) => state.theme);
  const setPosition = useAppStore((state) => state.setPosition);
  const setPlaying = useAppStore((state) => state.setPlaying);

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
        });
      }

      if (playback.isPlaying) {
        playbackEngine.play();
      } else {
        playbackEngine.pause();
      }
    };

    handlePlayback();
  }, [playback.isPlaying, arrangement, setPosition]);

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
      className="h-screen w-screen flex flex-col bg-[var(--bg-primary)] overflow-hidden"
      onClick={initializeAudio}
    >
      {/* Top bar with global controls */}
      <TopBar />

      {/* Main content area: Sidebar + Grid */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar with voice controls */}
        <VoiceSidebar />

        {/* Main grid visualization */}
        <div className="flex-1 p-2">
          <Grid arrangement={arrangement} className="h-full" />
        </div>
      </div>

      {/* Bottom transport bar */}
      <TransportBar />

      {/* Modals */}
      <LibraryModal />

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
