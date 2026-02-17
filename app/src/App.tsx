/* ============================================================
   HARMONY SINGING APP - MAIN COMPONENT
   
   The root component that assembles the entire application.
   Layout: TopBar + (Sidebar + Grid) + TransportBar
   ============================================================ */

import { useEffect, useRef, useState } from 'react';
import { TopBar } from './components/topbar';
import { VoiceSidebar } from './components/sidebar';
import { TransportBar } from './components/transport';
import { Grid } from './components/grid/Grid';
import { Minimap } from './components/grid/Minimap';
import { LibraryModal, MixerModal, MicSetupModal, DisplaySettingsModal, CreateArrangementModal } from './components/modals';
import { BackgroundVideo } from './components/ui/BackgroundVideo';
import { DevControls } from './components/dev/DevControls';
import { useAppStore } from './stores/appStore';
import { AudioService } from './services/AudioService';
import { playbackEngine } from './services/PlaybackEngine';
import { useRecording } from './hooks/useRecording';
import { applyTheme } from './utils/colors';
import { dragPixelsToTimeDelta } from './utils/followCamera';
import { getCameraCenterWorldT, setCameraCenterWorldT, setFreeLook } from './utils/cameraState';
import { sixPartStressTest } from './data/arrangements';

function App() {
  // Get state and actions from store
  const arrangement = useAppStore((state) => state.arrangement);
  const setArrangement = useAppStore((state) => state.setArrangement);
  // Subscribe to ONLY the playback fields this component uses.
  // CRITICAL: Do NOT subscribe to the entire playback object!
  // setPosition() fires ~30fps during playback, creating a new playback object
  // each time. Subscribing to the whole object would re-render App (the ROOT
  // component) 30fps, cascading re-renders to ALL children and creating
  // massive GC pressure that progressively degrades performance.
  const pbIsPlaying = useAppStore((state) => state.playback.isPlaying);
  const pbIsRecording = useAppStore((state) => state.playback.isRecording);
  const pbTempoMultiplier = useAppStore((state) => state.playback.tempoMultiplier);
  const pbLoopEnabled = useAppStore((state) => state.playback.loopEnabled);
  const pbLoopStart = useAppStore((state) => state.playback.loopStart);
  const pbLoopEnd = useAppStore((state) => state.playback.loopEnd);
  const pbMetronomeEnabled = useAppStore((state) => state.playback.metronomeEnabled);
  const countIn = useAppStore((state) => state.countIn);
  const theme = useAppStore((state) => state.theme);
  const setPosition = useAppStore((state) => state.setPosition);
  const transposition = useAppStore((state) => state.transposition);
  const autoTranspositionNotice = useAppStore((state) => state.autoTranspositionNotice);
  const mode = useAppStore((state) => state.mode);
  const showMinimap = useAppStore((state) => state.display.showMinimap);
  const showChordTrack = useAppStore((state) => state.display.showChordTrack);
  const setPlaying = useAppStore((state) => state.setPlaying);
  const voiceStates = useAppStore((state) => state.voiceStates);
  const disableChordTrack = useAppStore((state) => state.disableChordTrack);
  const undo = useAppStore((state) => state.undo);
  const redo = useAppStore((state) => state.redo);
  const canUndo = useAppStore((state) => state.canUndo);
  const canRedo = useAppStore((state) => state.canRedo);
  const isAnyModalOpen = useAppStore((state) => (
    state.isLibraryOpen ||
    state.isMixerOpen ||
    state.isMicSetupOpen ||
    state.isDisplaySettingsOpen ||
    state.isSaveLoadOpen ||
    state.isCreateModalOpen
  ));

  const microphoneState = useAppStore((state) => state.microphoneState);

  const globalVolume = useAppStore((state) => state.globalVolume);
  const globalReverb = useAppStore((state) => state.globalReverb);

  // Count-in visual state
  const [countInDisplay, setCountInDisplay] = useState<number | null>(null);

  // Throttle UI position updates during normal playback.
  // The engine emits position updates every animation frame (~60fps).
  // Writing those into the Zustand store at 60fps forces many React components
  // (including BOTH Grid layers) to re-render at 60fps, which can cause stutter.
  //
  // IMPORTANT:
  // - While recording, we do NOT throttle because auto-stop logic depends on
  //   receiving the near-end position before the loop wraps.
  const lastUiPositionUpdateMsRef = useRef<number>(0);
  const onEnginePositionUpdate = (t16: number) => {
    const storeState = useAppStore.getState();
    const isRecording = storeState.playback.isRecording;

    if (isRecording) {
      setPosition(t16);
      return;
    }

    const nowMs = performance.now();
    const UI_POSITION_THROTTLE_MS = 33; // ~30fps
    if (nowMs - lastUiPositionUpdateMsRef.current < UI_POSITION_THROTTLE_MS) return;

    lastUiPositionUpdateMsRef.current = nowMs;
    setPosition(t16);
  };

  // Track the previous transport flags so we can tell the difference between:
  // - starting playback
  // - starting recording (which may want count-in)
  // - stopping recording (which should NOT restart playback)
  const prevTransportFlagsRef = useRef<{ isPlaying: boolean; isRecording: boolean }>({
    isPlaying: pbIsPlaying,
    isRecording: pbIsRecording,
  });

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
            onPositionUpdate: onEnginePositionUpdate,
            onAutoStop: () => setPlaying(false),
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
    if (!arrangement) return;

    // IMPORTANT:
    // The Play-mode camera follows the PlaybackEngine world-time.
    // So on arrangement switch we must reset the engine position immediately,
    // even if audio hasn't been initialized yet.
    playbackEngine.resetLoopCount();
    playbackEngine.seek(0);
    setPosition(0);

    if (AudioService.isReady()) {
      playbackEngine.initialize(arrangement, {
        onPositionUpdate: onEnginePositionUpdate,
        onAutoStop: () => setPlaying(false),
        onLoop: () => {
          // Intentionally empty — loop transitions are handled by the engine.
          // NOTE: Do NOT add console.log here. It fires every loop iteration
          // and the browser's console buffer grows unbounded, causing
          // progressive slowdown over long playback sessions.
        },
      });
    }
  }, [arrangement?.id, setPosition]);

  // When switching modes, make sure Play mode always starts from the beginning.
  useEffect(() => {
    if (mode !== 'play') return;
    if (!arrangement) return;

    // Always reset the engine position when entering Play mode.
    // (This works even before audio is initialized; it just sets internal time state.)
    playbackEngine.resetLoopCount();
    playbackEngine.seek(0);
    setPosition(0);
  }, [mode, arrangement?.id, setPosition]);

  // Keep the playback engine's arrangement data in sync while editing.
  // This allows Create-mode edits (node placements) to be heard during playback
  // without re-initializing the engine (which would restart playback).
  useEffect(() => {
    if (!arrangement) return;
    if (!AudioService.isReady()) return;
    playbackEngine.updateArrangement(arrangement);
  }, [arrangement]);

  // Keep the playback engine metronome setting in sync with the transport toggle.
  useEffect(() => {
    playbackEngine.setConfig({ metronomeEnabled: pbMetronomeEnabled });
  }, [pbMetronomeEnabled]);

  // Keep recorded vocal lag compensation in sync with mic settings.
  useEffect(() => {
    playbackEngine.setConfig({ recordingLagMs: microphoneState.recordingLagMs });
  }, [microphoneState.recordingLagMs]);

  /**
   * Handle play/pause state changes.
   */
  useEffect(() => {
    if (!arrangement) return;

    const prevIsPlaying = prevTransportFlagsRef.current.isPlaying;
    const prevIsRecording = prevTransportFlagsRef.current.isRecording;

    // Store current flags for the next effect run.
    prevTransportFlagsRef.current = {
      isPlaying: pbIsPlaying,
      isRecording: pbIsRecording,
    };

    const handlePlayback = async () => {
      // Make sure audio is initialized
      await initializeAudio();

      // Re-initialize playback engine if needed
      if (!playbackEngine.getIsPlaying() && !AudioService.isReady()) {
        await AudioService.initialize();
        playbackEngine.initialize(arrangement, {
          onPositionUpdate: onEnginePositionUpdate,
          onAutoStop: () => setPlaying(false),
          onCountIn: (beat, total) => {
            // Show count-in visual feedback
            setCountInDisplay(total - beat + 1);
          },
        });
      }

      // Only start/restart playback when:
      // 1) the user toggles play ON, or
      // 2) recording just started (so we can apply count-in behavior)
      //
      // IMPORTANT: when recording ENDS but playback stays ON (loop continues),
      // we must NOT call play() again, because that can restart timing and cause
      // a visible/audible "jump" at the loop boundary.
      const recordingJustStarted = !prevIsRecording && pbIsRecording;
      const playJustStarted = !prevIsPlaying && pbIsPlaying;
      const shouldStartOrRestart = pbIsPlaying && (playJustStarted || recordingJustStarted);

      if (shouldStartOrRestart) {
        // Guard: don't call play() if the engine is already playing or
        // counting in. This prevents double play() calls when
        // startRecording() stops the engine directly and then sets
        // React state, causing multiple effect firings.
        if (playbackEngine.getIsPlaying() || playbackEngine.getIsCountingIn()) {
          return;
        }

        // Use count-in only when recording is active.
        const countInBars = (pbIsRecording && countIn.enabled) ? countIn.bars : 0;

        // If the user pressed Play (not starting a recording), seek to the
        // correct start position:
        // - Loop ON  → start from the loop start point
        // - Loop OFF → start from the very beginning (bar 1)
        if (playJustStarted && !recordingJustStarted) {
          playbackEngine.resetLoopCount();
          const seekTarget = pbLoopEnabled ? pbLoopStart : 0;
          playbackEngine.seek(seekTarget);
        }

        playbackEngine.play(countInBars).then(() => {
          setCountInDisplay(null);
        });
        return;
      }

      // Only pause when play is toggled OFF.
      if (!pbIsPlaying && prevIsPlaying) {
        // Guard: don't pause if the engine was already stopped directly.
        if (playbackEngine.getIsPlaying()) {
          playbackEngine.pause();
        }
        setCountInDisplay(null);
      }
    };

    handlePlayback();
  }, [pbIsPlaying, pbIsRecording, countIn.enabled, countIn.bars, arrangement?.id, setPosition]);

  /**
   * Update playback engine settings when they change.
   */
  useEffect(() => {
    playbackEngine.setTempoMultiplier(pbTempoMultiplier);
  }, [pbTempoMultiplier]);

  useEffect(() => {
    playbackEngine.setLoopEnabled(pbLoopEnabled);
  }, [pbLoopEnabled]);

  // Keep the playback engine's loop points in sync with the store.
  useEffect(() => {
    playbackEngine.setLoopPoints(pbLoopStart, pbLoopEnd);
  }, [pbLoopStart, pbLoopEnd]);

  // Keep playback engine transposition in sync with the app store.
  // This is what actually transposes the arrangement playback to match your vocal range.
  useEffect(() => {
    playbackEngine.setTransposition(transposition);
  }, [transposition]);

  /**
   * Sync recorded audio with the playback engine.
   * Uses a blob-reference cache so we only decode audio that actually changed,
   * instead of re-decoding ALL voices on every store update.
   */
  const recordings = useAppStore((state) => state.recordings);
  // Cache: maps voiceId → the Blob reference we last sent to the engine.
  // If the reference hasn't changed, we skip the expensive async decode.
  const lastSyncedBlobsRef = useRef<Map<string, Blob | null>>(new Map());

  useEffect(() => {
    if (!arrangement) return;

    const synced = lastSyncedBlobsRef.current;

    arrangement.voices.forEach((voice) => {
      const recording = recordings.get(voice.id);
      const blob = (recording && recording.audioBlob && recording.audioBlob.size > 0)
        ? recording.audioBlob
        : null;

      // Skip if the blob reference hasn't changed since we last synced.
      if (synced.get(voice.id) === blob) return;

      // Update the cache and tell the engine.
      synced.set(voice.id, blob);
      playbackEngine.setAudioRecording(voice.id, blob ?? new Blob());
    });
  }, [recordings, arrangement]);

  /**
   * Sync voice states (volume, mute, solo) with the playback engine.
   */
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
  const { startRecording, stopRecording } = useRecording();

  useEffect(() => {
    const blurIfButtonFocused = () => {
      const active = document.activeElement;
      if (!active) return;
      if (active instanceof HTMLButtonElement) {
        active.blur();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();

        // Ensure Space never "clicks" a focused button.
        blurIfButtonFocused();

        // Read the LATEST state directly from the store so we never act on
        // stale closure values. This is the key fix for Space not working
        // during active recording.
        const currentPlayback = useAppStore.getState().playback;

        // 1. If counting in, cancel it AND stop everything
        if (playbackEngine.getIsCountingIn()) {
          console.log('Cancelling count-in via Space');
          stopRecording(false);
          setPlaying(false);
          return;
        }

        // 2. If recording, stop it (and stop playback)
        if (currentPlayback.isRecording) {
          console.log('Stopping recording via Space');
          stopRecording(false); // Manual stop stops both
          return;
        }

        // 3. Otherwise, toggle play/pause
        console.log('Toggling playback via Space');
        setPlaying(!currentPlayback.isPlaying);
      }
    };

    const handlePointerDown = (e: MouseEvent) => {
      // If you click a button, immediately blur it so keyboard shortcuts keep working.
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLButtonElement) {
        window.setTimeout(() => target.blur(), 0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handlePointerDown);
    };
    // We read fresh state via useAppStore.getState() inside the handler,
    // so we only need to re-register when the callback references change.
  }, [setPlaying, stopRecording]);

  // ── Global middle-mouse-button pan ──
  // Holding middle-mouse (button 1) and dragging pans the camera in both
  // directions simultaneously. In Play mode this enters FREE_LOOK (camera
  // pans freely, playhead is unaffected). Vertical pitch pan is gated by
  // mode so Play-mode panning doesn't corrupt Create-mode state.
  const adjustPlayPitchPanSemitones = useAppStore((state) => state.adjustPlayPitchPanSemitones);

  useEffect(() => {
    let middleDrag: {
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      startCameraWorldT: number;
      modeAtStart: 'create' | 'play';
    } | null = null;

    const onMouseDown = (e: MouseEvent) => {
      // Middle mouse button = button 1
      if (e.button !== 1) return;
      e.preventDefault();
      const modeAtStart = useAppStore.getState().mode;

      // Read the shared camera center for both modes.
      const startCameraWorldT = getCameraCenterWorldT();

      middleDrag = {
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        startCameraWorldT,
        modeAtStart,
      };

      // In Play mode, panning enters FREE_LOOK.
      // If we were in Follow mode, switch to Smart first so FREE_LOOK can apply.
      if (modeAtStart === 'play') {
        const curCameraMode = useAppStore.getState().followMode.cameraMode;
        if (curCameraMode === 'follow') {
          useAppStore.getState().setCameraMode('smart');
        }
        setFreeLook(true);
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!middleDrag) return;
      // Horizontal delta → camera pan (both modes)
      const dx = e.clientX - middleDrag.lastX;
      if (dx !== 0) {
        const pxPerT = useAppStore.getState().followMode.pxPerT;
        const dT = dragPixelsToTimeDelta(dx, pxPerT);

        // Shared camera in both modes: pan the camera (not seek the playhead).
        const currentCam = getCameraCenterWorldT();
        setCameraCenterWorldT(Math.max(0, currentCam + dT));
      }

      // Vertical delta → pitch pan, gated by mode
      const dy = e.clientY - middleDrag.lastY;
      if (dy !== 0) {
        const semitonesPerPixel = 0.05;
        // Shared pitch-pan behavior in both modes.
        adjustPlayPitchPanSemitones(dy * semitonesPerPixel);
      }

      middleDrag.lastX = e.clientX;
      middleDrag.lastY = e.clientY;
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 1) {
        // Middle-drag now pans (no seek-on-release needed).
        middleDrag = null;
      }
    };

    // Prevent default middle-click behavior (auto-scroll on some browsers).
    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('auxclick', onAuxClick);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('auxclick', onAuxClick);
    };
  }, [adjustPlayPitchPanSemitones]);

  useEffect(() => {
    const handleUndoRedo = (e: KeyboardEvent) => {
      // Only allow shortcuts while editing in Create mode with no blocking UI.
      if (mode !== 'create' || isAnyModalOpen) return;

      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const isEditable = target.isContentEditable
          || tag === 'INPUT'
          || tag === 'TEXTAREA'
          || (target as HTMLInputElement).type === 'text';
        if (isEditable) return;
      }

      const modifierHeld = e.ctrlKey || e.metaKey;
      if (!modifierHeld) return;

      const key = e.key.toLowerCase();

      // Ctrl/Cmd + Z => undo (unless Shift is also held, which maps to redo)
      if (key === 'z' && !e.shiftKey) {
        if (!canUndo) return;
        e.preventDefault();
        undo();
        return;
      }

      // Ctrl/Cmd + Shift + Z => redo
      if (key === 'z' && e.shiftKey) {
        if (!canRedo) return;
        e.preventDefault();
        redo();
        return;
      }

      // Ctrl/Cmd + Y => redo
      if (key === 'y') {
        if (!canRedo) return;
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleUndoRedo);
    return () => window.removeEventListener('keydown', handleUndoRedo);
  }, [mode, isAnyModalOpen, undo, redo, canUndo, canRedo]);

  return (
    <div
      className="h-screen w-screen overflow-hidden relative"
      onClick={initializeAudio}
    >
      {/* Hidden SVG filter used by .glass-liquid CSS class for distortion */}
      <svg className="absolute w-0 h-0" aria-hidden="true">
        <defs>
          <filter id="liquid-glass">
            {/* Turbulence creates organic, wavy distortion */}
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.015"
              numOctaves="3"
              seed="2"
              result="noise"
            />
            {/* Displacement map warps the image using the noise */}
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="6"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      <BackgroundVideo />

      {/* Minimap - compressed contour preview above the chord bar, between top bar and grid */}
      {arrangement && showMinimap && (
        <div className="absolute top-[5.25rem] left-[calc(11rem+50px)] right-[calc(2rem+20px)] z-30">
          <Minimap arrangement={arrangement} className="w-full" />
        </div>
      )}

      {/* Main grid visualization - background layer (masked lines/voices) */}
      {/* Extra top padding (pt-[7.5rem]) makes room for top bar + minimap above chord bar */}
      <div className={`absolute inset-0 ${showMinimap ? 'pt-[9rem]' : 'pt-[6rem]'} pb-20 pl-44 pr-8`}>
        {/*
          This wrapper is the positioning context for any UI that must sit ABOVE the
          grid fade masks (for example, the Recenter pill).
        */}
        <div className="relative h-full w-full">
          {/*
            Grid layers are stacked here.
            Fades are applied inside Grid canvas rendering for consistent visuals.
          */}
          <div className="relative h-full w-full">
            <Grid arrangement={arrangement} className="h-full w-full" hideChords={true} />

            {/* Chord/Lyric overlay layer: side fades are handled in this layer's canvas draw pass. */}
            <div className="absolute inset-0 pointer-events-none">
              <Grid arrangement={arrangement} className="h-full w-full" onlyChords={true} />
            </div>
          </div>

          {/*
            Overlay root for UI that must NOT be affected by the grid masks.
            - pointer-events-none so it does not block grid interaction.
            - children (like buttons) should use pointer-events-auto.
          */}
          <div
            id="grid-overlay-root"
            data-grid-overlay-root
            className="absolute inset-0 z-40 pointer-events-none"
          />

          {/* Chord Track disable button rendered ABOVE the right-edge fade mask. */}
          {mode === 'create' && showChordTrack && arrangement?.chords && arrangement.chords.length > 0 && (
            <button
              type="button"
              className="absolute pointer-events-auto w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-[var(--text-muted)] hover:text-red-300 hover:bg-red-500/10 hover:border-red-500/20 transition-colors"
              style={{
                right: '2.25rem',
                top: showMinimap ? '9.25rem' : '6.25rem',
              }}
              title="Disable Chord Track"
              onClick={(e) => {
                e.stopPropagation();
                disableChordTrack();
              }}
            >
              🗑
            </button>
          )}
        </div>
      </div>

      {/* UI Overlays - Floating panes */}
      <TopBar />
      <VoiceSidebar startRecording={startRecording} stopRecording={stopRecording} />
      <TransportBar />
      <DevControls />

      {/* Modals */}
      <LibraryModal />
      <MixerModal />
      <MicSetupModal />
      <DisplaySettingsModal />
      <CreateArrangementModal />

      {/* Auto-transposition message (shows after picking an arrangement or closing mic setup) */}
      {autoTranspositionNotice && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-[fadeInUp_0.3s_ease-out]">
          <div className="
            px-5 py-2.5 rounded-full
            bg-green-500/15 text-green-200 text-xs font-medium
            border border-green-500/20
            shadow-[0_8px_30px_rgba(0,0,0,0.3),0_0_20px_-5px_rgba(34,197,94,0.15)]
            backdrop-blur-md
          ">
            {autoTranspositionNotice}
          </div>
        </div>
      )}

      {/* Count-in overlay - dramatic scale-in with glass backdrop */}
      {countInDisplay !== null && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
          {/* Subtle darkened backdrop */}
          <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
          {/* Number with scale-in animation */}
          <div
            className="
              relative text-[12rem] font-black text-white
              drop-shadow-[0_0_60px_rgba(255,255,255,0.6)]
              animate-[countIn_0.4s_ease-out]
            "
            style={{ textShadow: '0 0 80px rgba(var(--accent-rgb, 139, 92, 246), 0.5)' }}
          >
            {countInDisplay}
          </div>
        </div>
      )}

      {/* Welcome message when no arrangement is loaded */}
      {!arrangement && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="
            text-center p-10 pointer-events-auto
            glass-pane glass-high rounded-3xl
            max-w-md
            animate-[fadeInUp_0.6s_ease-out]
          ">
            <h1 className="
              text-4xl font-black mb-3 tracking-tight
              bg-gradient-to-r from-[var(--accent-primary)] via-white to-[var(--accent-secondary)]
              bg-clip-text text-transparent
              drop-shadow-[0_0_20px_var(--accent-primary-glow)]
            ">
              Harmony Singing
            </h1>
            <p className="text-[var(--text-secondary)] mb-8 text-sm leading-relaxed">
              Learn to sing harmony by recording yourself over guided arrangements
            </p>
            <button
              onClick={() => useAppStore.getState().setLibraryOpen(true)}
              aria-label="Choose an Arrangement"
              className="
                px-7 py-3
                bg-[var(--accent-primary)] text-white
                rounded-full font-semibold text-sm
                hover:brightness-110 hover:scale-105
                active:scale-95
                transition-all duration-200 cursor-pointer
                shadow-[0_0_30px_var(--accent-primary-glow),0_4px_15px_rgba(0,0,0,0.3)]
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
