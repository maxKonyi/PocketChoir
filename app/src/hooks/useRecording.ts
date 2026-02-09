/* ============================================================
   USE RECORDING HOOK
   
   Manages the recording flow:
   1. Arms a voice for recording
   2. Starts microphone and pitch detection
   3. Captures pitch trace during playback
   4. Saves recording when done
   
   Key timing approach (from reference):
   - Recording starts from position 0
   - Time is calculated as (performance.now() - playbackStartTime)
   - Pitch trace is stored locally, only sent to store on save
   - This prevents React re-renders during recording
   ============================================================ */

import { useCallback, useRef, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { MicrophoneService } from '../services/MicrophoneService';
import { PitchDetector, type PitchDetectionResult } from '../services/PitchDetector';
import { playbackEngine } from '../services/PlaybackEngine';
import type { PitchPoint, Recording } from '../types';

// Throttle interval for live trace updates (ms)
// Lower = smoother trace but more re-renders
// Higher = choppier trace but better performance
const LIVE_TRACE_UPDATE_INTERVAL = 33; // ~30fps like reference

/**
 * Hook for managing voice recording with pitch detection.
 */
export function useRecording() {
  // Get state and actions from store
  const arrangement = useAppStore((state) => state.arrangement);
  const armedVoiceId = useAppStore((state) => state.armedVoiceId);
  // Subscribe to ONLY the playback fields this hook needs for React re-renders.
  // CRITICAL: Do NOT subscribe to the entire playback object or to playback.position!
  // This hook runs inside App.tsx (the ROOT component). setPosition() fires ~30fps,
  // creating a new playback object each time. Subscribing to the whole object (or to
  // position) would re-render the ROOT component 30fps, cascading to ALL children
  // and creating massive GC pressure that progressively degrades performance.
  const pbIsPlaying = useAppStore((state) => state.playback.isPlaying);
  const pbIsRecording = useAppStore((state) => state.playback.isRecording);
  const recordings = useAppStore((state) => state.recordings);
  const addRecording = useAppStore((state) => state.addRecording);
  const clearRecording = useAppStore((state) => state.clearRecording);
  const setLivePitchTrace = useAppStore((state) => state.setLivePitchTrace);
  const setRecording = useAppStore((state) => state.setRecording);
  const setPlaying = useAppStore((state) => state.setPlaying);
  const setPosition = useAppStore((state) => state.setPosition);
  const setMicrophoneState = useAppStore((state) => state.setMicrophoneState);
  const recordingLagMs = useAppStore((state) => state.microphoneState.recordingLagMs);
  const lowLatencyPitch = useAppStore((state) => state.microphoneState.lowLatencyPitch);

  // Refs for services
  const pitchDetectorRef = useRef<PitchDetector | null>(null);

  // Timing refs - critical for proper synchronization
  const playbackActuallyStartedRef = useRef<boolean>(false);  // Has playback started?
  const pitchTraceRef = useRef<PitchPoint[]>([]);     // Local trace storage (no React re-renders)
  const isRecordingRef = useRef<boolean>(false);

  // Lock to prevent overlapping startRecording calls (rapid toggle protection).
  const startInProgressRef = useRef<boolean>(false);

  // Session counter: incremented every time startRecording is called.
  // Pitch detection callbacks check this to discard results from stale sessions.
  const recordingSessionRef = useRef<number>(0);

  // Keep a ref copy of armedVoiceId so stopRecording always has the latest value,
  // even when called from a stale closure (e.g. the Space key handler).
  const armedVoiceIdRef = useRef<string | null>(armedVoiceId);
  armedVoiceIdRef.current = armedVoiceId;

  // Throttle ref for live trace updates
  const lastTraceUpdateRef = useRef<number>(0);

  // Timestamp when the current recording session actually started playback.
  // Used to prevent the auto-stop effect from firing with stale store position
  // during the first moments of a new recording session.
  const recordingStartTimeRef = useRef<number>(0);

  /**
   * Initialize microphone access.
   */
  const initMicrophone = useCallback(async () => {
    try {
      // Initialize microphone service (requests permission)
      await MicrophoneService.initialize();

      // Keep the store in sync with the actual mic settings (including lag estimate).
      setMicrophoneState(MicrophoneService.getState());

      // Get the processed media stream (with gain and mono summing)
      const stream = MicrophoneService.getProcessedStream();
      if (stream) {
        // Initialize pitch detector with the stream
        const detector = new PitchDetector();
        detector.setLowLatencyMode(lowLatencyPitch);
        detector.initialize(stream);
        pitchDetectorRef.current = detector;
      }

      console.log('Microphone initialized for recording');
      return true;
    } catch (error) {
      console.error('Failed to initialize microphone:', error);
      alert('Could not access microphone. Please check permissions.');
      return false;
    }
  }, [setMicrophoneState, lowLatencyPitch]);

  /**
   * Stop recording and save the result.
   * @param keepPlaying - If true, playback continues after recording stops (for seamless looping)
   */
  const stopRecording = useCallback((keepPlaying: boolean = false) => {
    // Read the SHARED store state so this works no matter which hook
    // instance calls it (App.tsx vs VoiceSidebar vs anywhere else).
    // Instance-local refs (isRecordingRef) are unreliable because each
    // useRecording() call creates its own independent set of refs.
    const storeState = useAppStore.getState();
    const isCurrentlyRecording = storeState.playback.isRecording;
    const isCountingIn = playbackEngine.getIsCountingIn();

    if (!isCurrentlyRecording && !isCountingIn && !startInProgressRef.current) return;

    const voiceId = armedVoiceIdRef.current;
    console.log(`Stopping recording for voice ${voiceId}, keepPlaying: ${keepPlaying}`);

    // Reset all local refs.
    isRecordingRef.current = false;
    startInProgressRef.current = false;
    playbackActuallyStartedRef.current = false;

    // Cancel any pending count-in in the engine.
    playbackEngine.cancelCountIn();

    // Stop pitch detection
    pitchDetectorRef.current?.stop();

    // Stop microphone audio recording
    MicrophoneService.stopRecording();

    // Stop playback status for recording
    setRecording(false);

    // Only stop playback entirely if not keepPlaying
    if (!keepPlaying) {
      setPlaying(false);
    }
  }, [setPlaying, setRecording]);

  /**
   * Start recording on the armed voice.
   * @param targetVoiceId - Optional ID of the voice to record. If not provided, uses armedVoiceId.
   */
  const startRecording = useCallback(async (targetVoiceId?: string) => {
    const voiceId = targetVoiceId || armedVoiceId;

    if (!voiceId || !arrangement) {
      console.warn('No voice specified or no arrangement loaded');
      return false;
    }

    // ── STEP 0: Tear down anything from a previous session. ──
    // Increment the session counter so any stale pitch callbacks are ignored.
    recordingSessionRef.current += 1;
    const thisSession = recordingSessionRef.current;

    // Always stop the engine directly — no matter what state it's in.
    // This is the most robust approach: we talk to the engine directly
    // instead of relying on React state propagation (which is async and
    // can race with other effects).
    playbackEngine.stop();

    // Also stop any in-progress pitch detection and microphone recording
    // from a previous session.
    pitchDetectorRef.current?.stop();
    MicrophoneService.stopRecording();

    // Reset local refs.
    isRecordingRef.current = false;
    startInProgressRef.current = true;
    playbackActuallyStartedRef.current = false;

    // Clear live trace immediately and tag it with the new voice being recorded.
    // This sets livePitchTraceVoiceId so the Grid knows which voice the trace
    // belongs to BEFORE any pitch data arrives.
    pitchTraceRef.current = [];
    setLivePitchTrace([], voiceId);

    // If this voice already has a take, immediately clear it BEFORE count-in begins.
    // This ensures the old audio + pitch trace disappear right away when you re-record.
    const existing = recordings.get(voiceId);
    if (existing) {
      console.log(`Clearing existing recording for voice ${voiceId} before re-recording`);

      // 1) Remove the saved take from the app state (pitch trace + blob).
      clearRecording(voiceId);

      // 2) Remove the decoded audio buffer from the audio engine.
      // Using an empty blob is our existing "clear" API.
      await playbackEngine.setAudioRecording(voiceId, new Blob());
    }

    // Bail out if a newer session started while we were clearing.
    if (recordingSessionRef.current !== thisSession) return false;

    // Initialize microphone if not already done
    if (!pitchDetectorRef.current) {
      const success = await initMicrophone();
      if (!success) {
        startInProgressRef.current = false;
        return false;
      }
    }

    // Re-apply in case the user toggled low-latency mode since the detector was created.
    pitchDetectorRef.current?.setLowLatencyMode(lowLatencyPitch);

    // Bail out if a newer session started while we were initializing.
    if (recordingSessionRef.current !== thisSession) {
      startInProgressRef.current = false;
      return false;
    }

    // ── STEP 1: Rewind to the very beginning (first loop repetition). ──
    // Reset the world-time loop counter so we start at repetition 0,
    // not just the loop start point of whatever repetition we were on.
    playbackEngine.resetLoopCount();
    playbackEngine.seek(0);

    // Reset timing state - wait for actual playback to start
    playbackActuallyStartedRef.current = false;
    isRecordingRef.current = true;
    lastTraceUpdateRef.current = 0;

    // Set up pitch detection callback.
    // The session check ensures that if startRecording is called again
    // rapidly, stale callbacks from this session are silently discarded.
    pitchDetectorRef.current?.setCallback((result: PitchDetectionResult) => {
      // Discard if this session has been superseded or stopped.
      if (!isRecordingRef.current || recordingSessionRef.current !== thisSession) return;

      // Wait for playback to actually start before recording points
      if (!playbackActuallyStartedRef.current) {
        if (playbackEngine.getIsPlaying()) {
          playbackActuallyStartedRef.current = true;
          console.log('Playback detected as started, recording pitch trace');
        } else {
          return;
        }
      }

      const rawTime = playbackEngine.getCurrentPositionMs();
      if (rawTime < 0) return;

      const pitchDetectorLatencyMs = pitchDetectorRef.current?.getEstimatedLatencyMs?.() ?? 0;

      const time = Math.max(0, rawTime - (recordingLagMs ?? 0) - pitchDetectorLatencyMs);

      const point: PitchPoint = {
        time,
        frequency: result.frequency,
        confidence: result.confidence,
      };

      pitchTraceRef.current.push(point);

      const now = performance.now();
      if (now - lastTraceUpdateRef.current > LIVE_TRACE_UPDATE_INTERVAL) {
        lastTraceUpdateRef.current = now;
        setLivePitchTrace([...pitchTraceRef.current]);
      }
    });

    // Start pitch detection
    pitchDetectorRef.current?.start(true);

    // Start recording via PlaybackEngine (synced with actual playback start)
    const currentVoiceId = voiceId as string;
    const currentTrace = pitchTraceRef;

    playbackEngine.startRecordingVocal(currentVoiceId, async (vid, blob) => {
      // Ignore if this session has been superseded.
      if (recordingSessionRef.current !== thisSession) return;

      // Create the final recording object when recording stops
      const finalTrace = [...currentTrace.current];
      const recording: Recording = {
        voiceId: vid,
        pitchTrace: finalTrace,
        audioBlob: blob,
        duration: finalTrace.length > 0 ? finalTrace[finalTrace.length - 1].time : 0,
        recordedAt: new Date().toISOString(),
      };

      // Save to store
      addRecording(vid, recording);

      // Update PlaybackEngine with the new audio buffer
      await playbackEngine.setAudioRecording(vid, blob);

      console.log('Recording saved with audio. Points:', finalTrace.length);

      // Clear live trace now that it's persistent in recordings map
      setLivePitchTrace([]);
    });

    // ── STEP 2: Start playback (which triggers count-in then recording). ──
    // CRITICAL: Reset the store position to 0 BEFORE setting isRecording/isPlaying.
    // Without this, the auto-stop effect can see the old position (e.g. near loop end
    // from a previous playback) and immediately fire stopRecording, killing the
    // recording before it even starts. This was the root cause of "plays without
    // recording" and "certain tracks have no pitch trace" bugs.
    setPosition(0);

    // Record the time so the auto-stop effect knows to ignore early position updates.
    recordingStartTimeRef.current = performance.now();

    // We set both flags in one go so the App.tsx effect sees a single
    // transition (isPlaying: false→true, isRecording: false→true) and
    // calls playbackEngine.play() exactly once.
    setRecording(true);
    setPlaying(true);

    // Release the lock — the recording flow is now running.
    startInProgressRef.current = false;

    console.log('Recording started for voice:', currentVoiceId);
    return true;
  }, [armedVoiceId, arrangement, recordings, clearRecording, initMicrophone, setLivePitchTrace, addRecording, setRecording, setPlaying, setPosition, recordingLagMs, lowLatencyPitch]);

  /**
   * Toggle recording state.
   */
  const toggleRecording = useCallback(async () => {
    if (pbIsRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  }, [pbIsRecording, startRecording, stopRecording]);

  /**
   * Auto-stop recording at the end of the loop.
   *
   * Uses a polling interval instead of a React effect on playback.position.
   * WHY: subscribing to position via React causes the host component (App.tsx,
   * the ROOT) to re-render ~30fps, cascading re-renders to ALL children and
   * progressively degrading performance. Polling the store directly avoids
   * any React re-renders.
   *
   * IMPORTANT: We guard with a 1-second grace period after recording starts.
   * Without this, stale position from previous playback can kill the recording.
   */
  useEffect(() => {
    if (!pbIsRecording || !pbIsPlaying) return;

    const intervalId = window.setInterval(() => {
      const state = useAppStore.getState();
      if (!state.playback.isRecording || !state.playback.isPlaying) return;

      // Grace period: ignore for 1 second after recording starts.
      const elapsed = performance.now() - recordingStartTimeRef.current;
      if (elapsed < 1000) return;

      // Stop slightly before the exact loop end
      if (state.playback.position >= state.playback.loopEnd - 0.2) {
        console.log('Auto-stopping recording at loop end');
        stopRecording(true); // Keep playing for seamless looping!
      }
    }, 100); // Check every 100ms — plenty fast for auto-stop

    return () => window.clearInterval(intervalId);
  }, [pbIsRecording, pbIsPlaying, stopRecording]);

  /**
   * Clean up when playback stops externally.
   * Uses the shared store state (not instance-local isRecordingRef) so this
   * works correctly regardless of which useRecording() instance it runs in.
   */
  useEffect(() => {
    if (!pbIsPlaying && pbIsRecording) {
      // Playback stopped while recording — stop and save the recording.
      stopRecording();
    }
  }, [pbIsPlaying, pbIsRecording, stopRecording]);

  /**
   * Clean up on unmount.
   */
  useEffect(() => {
    return () => {
      if (pitchDetectorRef.current) {
        pitchDetectorRef.current.stop();
        pitchDetectorRef.current.dispose();
      }
    };
  }, []);

  return {
    initMicrophone,
    startRecording,
    stopRecording,
    toggleRecording,
    isRecording: pbIsRecording,
    armedVoiceId,
  };
}

export default useRecording;
