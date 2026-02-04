/* ============================================================
   HARMONY SINGING APP - MAIN COMPONENT
   
   The root component that assembles the entire application.
   Layout: TopBar + (Sidebar + Grid) + TransportBar
   ============================================================ */

import { useEffect, useState } from 'react';
import { TopBar } from './components/topbar';
import { VoiceSidebar } from './components/sidebar';
import { TransportBar } from './components/transport';
import { Grid } from './components/grid/Grid';
import { LibraryModal, MixerModal, MicSetupModal, RangeSetupModal, DisplaySettingsModal, CreateArrangementModal } from './components/modals';
import { BackgroundVideo } from './components/ui/BackgroundVideo';
import { useAppStore } from './stores/appStore';
import { AudioService } from './services/AudioService';
import { playbackEngine } from './services/PlaybackEngine';
import { useRecording } from './hooks/useRecording';
import { applyTheme } from './utils/colors';
import { sixPartStressTest } from './data/arrangements';

function App() {
  // Get state and actions from store
  const arrangement = useAppStore((state) => state.arrangement);
  const setArrangement = useAppStore((state) => state.setArrangement);
  const playback = useAppStore((state) => state.playback);
  const countIn = useAppStore((state) => state.countIn);
  const theme = useAppStore((state) => state.theme);
  const setPosition = useAppStore((state) => state.setPosition);
  const transposition = useAppStore((state) => state.transposition);
  const autoTranspositionNotice = useAppStore((state) => state.autoTranspositionNotice);

  const globalVolume = useAppStore((state) => state.globalVolume);
  const globalReverb = useAppStore((state) => state.globalReverb);

  // Count-in visual state
  const [countInDisplay, setCountInDisplay] = useState<number | null>(null);

  /**
   * Load default arrangement on startup.
   */
  useEffect(() => {
    if (!arrangement) {
      setArrangement(sixPartStressTest);
    }
  }, [setArrangement, arrangement]);

  /**
   * Initialize audio on first user interaction.
   * Required due to browser autoplay policies.
   */
  const initializeAudio = async () => {
    if (!AudioService.isReady()) {
      try {
        await AudioService.initialize();

        // Ensure the playback engine has its nodes ready even before you press play.
        // This also ensures panning defaults + mixer settings can apply immediately.
        if (arrangement && !playbackEngine.getIsPlaying()) {
          playbackEngine.initialize(arrangement, {
            onPositionUpdate: (t16) => {
              setPosition(t16);
            },
          });
        }

        // Apply the current mixer values immediately after audio starts.
        // Without this, settings may not apply until you move a slider/toggle.
        AudioService.setMasterVolume(globalVolume);
        AudioService.setReverbLevel(globalReverb);

        voiceStates.forEach(vs => {
          playbackEngine.setVoiceVolume(vs.voiceId, vs.synthVolume, 'synth');
          playbackEngine.setVoiceMuted(vs.voiceId, vs.synthMuted, 'synth');
          playbackEngine.setVoiceSolo(vs.voiceId, vs.synthSolo, 'synth');
          playbackEngine.setVoicePan(vs.voiceId, vs.synthPan, 'synth');

          playbackEngine.setVoiceVolume(vs.voiceId, vs.vocalVolume, 'vocal');
          playbackEngine.setVoiceMuted(vs.voiceId, vs.vocalMuted, 'vocal');
          playbackEngine.setVoiceSolo(vs.voiceId, vs.vocalSolo, 'vocal');
          playbackEngine.setVoicePan(vs.voiceId, vs.vocalPan, 'vocal');
        });

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
        metronomeEnabled: playback.metronomeEnabled,
      });
    }
  }, [arrangement, setPosition]);

  // Keep the playback engine metronome setting in sync with the transport toggle.
  useEffect(() => {
    playbackEngine.setConfig({ metronomeEnabled: playback.metronomeEnabled });
  }, [playback.metronomeEnabled]);

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

  // Keep playback engine transposition in sync with the app store.
  // This is what actually transposes the arrangement playback to match your vocal range.
  useEffect(() => {
    playbackEngine.setTransposition(transposition);
  }, [transposition]);

  /**
   * Sync recorded audio with the playback engine.
   * Handles both adding/updating recordings and clearing deleted ones.
   */
  const recordings = useAppStore((state) => state.recordings);
  useEffect(() => {
    if (!arrangement) return;

    arrangement.voices.forEach((voice) => {
      const recording = recordings.get(voice.id);
      if (recording && recording.audioBlob && recording.audioBlob.size > 0) {
        playbackEngine.setAudioRecording(voice.id, recording.audioBlob);
      } else {
        // Clear recording in engine if it doesn't exist in store
        playbackEngine.setAudioRecording(voice.id, new Blob());
      }
    });
  }, [recordings, arrangement]);

  /**
   * Sync voice states (volume, mute, solo) with the playback engine.
   */
  const voiceStates = useAppStore((state) => state.voiceStates);
  useEffect(() => {
    voiceStates.forEach(vs => {
      // Synth sync
      playbackEngine.setVoiceVolume(vs.voiceId, vs.synthVolume, 'synth');
      playbackEngine.setVoiceMuted(vs.voiceId, vs.synthMuted, 'synth');
      playbackEngine.setVoiceSolo(vs.voiceId, vs.synthSolo, 'synth');
      playbackEngine.setVoicePan(vs.voiceId, vs.synthPan, 'synth');

      // Vocal sync
      playbackEngine.setVoiceVolume(vs.voiceId, vs.vocalVolume, 'vocal');
      playbackEngine.setVoiceMuted(vs.voiceId, vs.vocalMuted, 'vocal');
      playbackEngine.setVoiceSolo(vs.voiceId, vs.vocalSolo, 'vocal');
      playbackEngine.setVoicePan(vs.voiceId, vs.vocalPan, 'vocal');
    });
  }, [voiceStates]);

  // Sync the global mixer controls into the audio engine.
  useEffect(() => {
    if (!AudioService.isReady()) return;
    AudioService.setMasterVolume(globalVolume);
  }, [globalVolume]);

  useEffect(() => {
    if (!AudioService.isReady()) return;
    AudioService.setReverbLevel(globalReverb);
  }, [globalReverb]);

  /**
   * Keyboard controls (Space for play/pause/stop recording).
   */
  const { stopRecording } = useRecording();
  const setPlaying = useAppStore((state) => state.setPlaying);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();

        // 1. If counting in, cancel it
        if (playbackEngine.getIsCountingIn()) {
          console.log('Cancelling count-in via Space');
          playbackEngine.cancelCountIn();
          setPlaying(false);
          return;
        }

        // 2. If recording, stop it (and stop playback)
        if (playback.isRecording) {
          console.log('Stopping recording via Space');
          stopRecording(false); // Manual stop stops both
          return;
        }

        // 3. Otherwise, toggle play/pause
        console.log('Toggling playback via Space');
        setPlaying(!playback.isPlaying);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [playback.isPlaying, playback.isRecording, setPlaying, stopRecording]);

  return (
    <div
      className="h-screen w-screen overflow-hidden relative"
      onClick={initializeAudio}
    >
      <BackgroundVideo />

      {/* Main grid visualization - background layer (masked lines/voices) */}
      <div className="absolute inset-0 pt-24 pb-28 pl-44 pr-8 mask-vertical-fade">
        <Grid arrangement={arrangement} className="h-full w-full" hideChords={true} />
      </div>

      {/* Chord Track layer - floating on top, not masked */}
      <div className="absolute inset-0 pt-24 pb-28 pl-44 pr-8 pointer-events-none">
        <Grid arrangement={arrangement} className="h-full w-full" onlyChords={true} />
      </div>



      {/* UI Overlays - Floating panes */}
      <TopBar />
      <VoiceSidebar />
      <TransportBar />

      {/* Modals */}
      <LibraryModal />
      <MixerModal />
      <MicSetupModal />
      <RangeSetupModal />
      <DisplaySettingsModal />
      <CreateArrangementModal />

      {/* Auto-transposition message (shows after picking an arrangement or closing mic setup) */}
      {autoTranspositionNotice && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="px-4 py-2 rounded-lg bg-green-500/20 text-green-200 text-sm border border-green-500/30 shadow-lg backdrop-blur-sm">
            {autoTranspositionNotice}
          </div>
        </div>
      )}

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
