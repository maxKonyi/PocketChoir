/* ============================================================
   USE RECORDING HOOK
   
   Manages the recording flow:
   1. Arms a voice for recording
   2. Starts microphone and pitch detection
   3. Captures pitch trace during playback
   4. Saves recording when done
   ============================================================ */

import { useCallback, useRef, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { MicrophoneService } from '../services/MicrophoneService';
import { PitchDetector, type PitchDetectionResult } from '../services/PitchDetector';
import type { PitchPoint, Recording } from '../types';

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
  const addPitchPoint = useAppStore((state) => state.addPitchPoint);
  const setRecording = useAppStore((state) => state.setRecording);
  const setPlaying = useAppStore((state) => state.setPlaying);
  
  // Refs for services
  const pitchDetectorRef = useRef<PitchDetector | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const pitchTraceRef = useRef<PitchPoint[]>([]);
  const isRecordingRef = useRef<boolean>(false);

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
    
    // Record the start time
    recordingStartTimeRef.current = performance.now();
    isRecordingRef.current = true;

    // Set up pitch detection callback
    pitchDetectorRef.current?.setCallback((result: PitchDetectionResult) => {
      if (!isRecordingRef.current) return;
      
      // Calculate time since recording started
      const time = performance.now() - recordingStartTimeRef.current;
      
      // Create pitch point
      const point: PitchPoint = {
        time,
        frequency: result.frequency,
        confidence: result.confidence,
      };
      
      // Add to trace
      pitchTraceRef.current.push(point);
      addPitchPoint(point);
    });

    // Start pitch detection with trace recording
    pitchDetectorRef.current?.start(true);

    // Start playback and set recording state
    setRecording(true);
    setPlaying(true);

    console.log('Recording started for voice:', armedVoiceId);
    return true;
  }, [armedVoiceId, arrangement, initMicrophone, setLivePitchTrace, addPitchPoint, setRecording, setPlaying]);

  /**
   * Stop recording and save the result.
   */
  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current || !armedVoiceId) return;

    isRecordingRef.current = false;

    // Stop pitch detection and get the trace
    const trace = pitchDetectorRef.current?.stop() || [];

    // Stop playback
    setPlaying(false);
    setRecording(false);

    // Create the recording object
    const recording: Recording = {
      voiceId: armedVoiceId,
      pitchTrace: trace.length > 0 ? trace : pitchTraceRef.current,
      audioBlob: new Blob(), // Empty blob for now - full audio recording not implemented
      duration: performance.now() - recordingStartTimeRef.current,
      recordedAt: new Date().toISOString(),
    };

    // Save the recording
    addRecording(armedVoiceId, recording);

    console.log('Recording saved, Points:', recording.pitchTrace.length);
    
    // Clear live trace (it's now saved as a recording)
    setLivePitchTrace([]);
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
