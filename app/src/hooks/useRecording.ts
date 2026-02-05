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
  const playback = useAppStore((state) => state.playback);
  const addRecording = useAppStore((state) => state.addRecording);
  const setLivePitchTrace = useAppStore((state) => state.setLivePitchTrace);
  const setRecording = useAppStore((state) => state.setRecording);
  const setPlaying = useAppStore((state) => state.setPlaying);
  const setMicrophoneState = useAppStore((state) => state.setMicrophoneState);
  const recordingLagMs = useAppStore((state) => state.microphoneState.recordingLagMs);

  // Refs for services
  const pitchDetectorRef = useRef<PitchDetector | null>(null);

  // Timing refs - critical for proper synchronization
  const playbackActuallyStartedRef = useRef<boolean>(false);  // Has playback started?
  const pitchTraceRef = useRef<PitchPoint[]>([]);     // Local trace storage (no React re-renders)
  const isRecordingRef = useRef<boolean>(false);

  // Throttle ref for live trace updates
  const lastTraceUpdateRef = useRef<number>(0);

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
  }, [setMicrophoneState]);

  /**
   * Stop recording and save the result.
   * @param keepPlaying - If true, playback continues after recording stops (for seamless looping)
   */
  const stopRecording = useCallback((keepPlaying: boolean = false) => {
    if (!isRecordingRef.current || !armedVoiceId) return;

    console.log(`Stopping recording for voice ${armedVoiceId}, keepPlaying: ${keepPlaying}`);
    isRecordingRef.current = false;
    playbackActuallyStartedRef.current = false;

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
  }, [armedVoiceId, setPlaying, setRecording]);

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

    // Initialize microphone if not already done
    if (!pitchDetectorRef.current) {
      const success = await initMicrophone();
      if (!success) return false;
    }

    // Clear previous pitch trace
    pitchTraceRef.current = [];
    setLivePitchTrace([]);

    // Reset playhead to start of arrangement for consistent recording
    playbackEngine.seek(0);

    // Reset timing state - wait for actual playback to start
    playbackActuallyStartedRef.current = false;
    isRecordingRef.current = true;
    lastTraceUpdateRef.current = 0;

    // Set up pitch detection callback
    pitchDetectorRef.current?.setCallback((result: PitchDetectionResult) => {
      if (!isRecordingRef.current) return;

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

    // Start playback
    setRecording(true);
    setPlaying(true);

    console.log('Recording started for voice:', currentVoiceId);
    return true;
  }, [armedVoiceId, arrangement, initMicrophone, setLivePitchTrace, addRecording, setRecording, setPlaying, recordingLagMs]);

  /**
   * Toggle recording state.
   */
  const toggleRecording = useCallback(async () => {
    if (playback.isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  }, [playback.isRecording, startRecording, stopRecording]);

  /**
   * Auto-stop recording at the end of the loop.
   */
  useEffect(() => {
    if (playback.isRecording && playback.isPlaying) {
      // Stop slightly before the exact loop end to ensure we don't start recording the loop start
      if (playback.position >= playback.loopEnd - 0.2) {
        console.log('Auto-stopping recording at loop end');
        stopRecording(true); // Keep playing for seamless looping!
      }
    }
  }, [playback.position, playback.loopEnd, playback.isRecording, playback.isPlaying, stopRecording]);

  /**
   * Clean up when playback stops externally.
   */
  useEffect(() => {
    if (!playback.isPlaying && isRecordingRef.current) {
      // Playback stopped while recording - save the recording
      stopRecording();
    }
  }, [playback.isPlaying, stopRecording]);

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
    isRecording: playback.isRecording,
    armedVoiceId,
  };
}

export default useRecording;
