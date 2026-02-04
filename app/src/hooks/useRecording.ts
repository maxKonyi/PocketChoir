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

      // Get the media stream
      const stream = MicrophoneService.getStream();
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
  }, []);

  /**
   * Stop recording and save the result.
   */
  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current || !armedVoiceId) return;

    isRecordingRef.current = false;
    playbackActuallyStartedRef.current = false;

    // Stop pitch detection
    pitchDetectorRef.current?.stop();

    // Stop microphone audio recording
    MicrophoneService.stopRecording();

    // Stop playback
    setPlaying(false);
    setRecording(false);
  }, [armedVoiceId, setPlaying, setRecording]);

  /**
   * Start recording on the armed voice.
   */
  const startRecording = useCallback(async () => {
    if (!armedVoiceId || !arrangement) {
      console.warn('No voice armed or no arrangement loaded');
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

      const time = playbackEngine.getCurrentPositionMs();
      if (time < 0) return;

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

    // Start audio recording via MicrophoneService
    const currentVoiceId = armedVoiceId;
    const currentTrace = pitchTraceRef;

    MicrophoneService.startRecording(async (blob) => {
      // Create the final recording object when recording stops
      const finalTrace = [...currentTrace.current];
      const recording: Recording = {
        voiceId: currentVoiceId,
        pitchTrace: finalTrace,
        audioBlob: blob,
        duration: finalTrace.length > 0 ? finalTrace[finalTrace.length - 1].time : 0,
        recordedAt: new Date().toISOString(),
      };

      // Save to store
      addRecording(currentVoiceId, recording);

      // Update PlaybackEngine with the new audio buffer
      await playbackEngine.setAudioRecording(currentVoiceId, blob);

      console.log('Recording saved with audio. Points:', finalTrace.length);
      setLivePitchTrace(finalTrace);
    });

    // Start playback
    setRecording(true);
    setPlaying(true);

    console.log('Recording started for voice:', armedVoiceId);
    return true;
  }, [armedVoiceId, arrangement, initMicrophone, setLivePitchTrace, addRecording, setRecording, setPlaying]);

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
