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
const LIVE_TRACE_UPDATE_INTERVAL = 100; // 10fps for React updates

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
   * Start recording on the armed voice.
   * Resets to the start of the arrangement for consistent timing.
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

      // Only record if we have valid pitch data
      if (result.frequency <= 0) return;

      // Wait for playback to actually start before recording points
      if (!playbackActuallyStartedRef.current) {
        if (playbackEngine.getIsPlaying()) {
          playbackActuallyStartedRef.current = true;
          console.log('Playback detected as started, recording pitch trace');
        } else {
          return;
        }
      }

      // Use the playback engine's current position directly
      // This ensures perfect sync with the playhead
      const time = playbackEngine.getCurrentPositionMs();

      // Skip if we somehow get a negative time
      if (time < 0) return;

      // Create pitch point
      const point: PitchPoint = {
        time,
        frequency: result.frequency,
        confidence: result.confidence,
      };

      // Add to local trace (no React re-render)
      pitchTraceRef.current.push(point);

      // Throttled update to React state for live visualization
      // This prevents performance issues from too many state updates
      const now = performance.now();
      if (now - lastTraceUpdateRef.current > LIVE_TRACE_UPDATE_INTERVAL) {
        lastTraceUpdateRef.current = now;
        // Send a copy of the entire trace to React
        setLivePitchTrace([...pitchTraceRef.current]);
      }
    });

    // Start pitch detection with trace recording
    pitchDetectorRef.current?.start(true);

    // Start playback and set recording state
    // The App.tsx effect will handle starting the playback engine
    setRecording(true);
    setPlaying(true);

    console.log('Recording started for voice:', armedVoiceId);
    return true;
  }, [armedVoiceId, arrangement, initMicrophone, setLivePitchTrace, setRecording, setPlaying]);

  /**
   * Stop recording and save the result.
   */
  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current || !armedVoiceId) return;

    isRecordingRef.current = false;
    playbackActuallyStartedRef.current = false;

    // Stop pitch detection
    pitchDetectorRef.current?.stop();

    // Stop playback
    setPlaying(false);
    setRecording(false);

    // Use the locally stored trace (not the throttled React state)
    const finalTrace = [...pitchTraceRef.current];

    // Create the recording object
    const recording: Recording = {
      voiceId: armedVoiceId,
      pitchTrace: finalTrace,
      audioBlob: new Blob(), // Empty blob for now - full audio recording not implemented
      duration: finalTrace.length > 0 ? finalTrace[finalTrace.length - 1].time : 0,
      recordedAt: new Date().toISOString(),
    };

    // Save the recording
    addRecording(armedVoiceId, recording);

    console.log('Recording saved, Points:', recording.pitchTrace.length);

    // Final update to live trace to show complete recording
    setLivePitchTrace(finalTrace);
  }, [armedVoiceId, addRecording, setLivePitchTrace, setPlaying, setRecording]);

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
