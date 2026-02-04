/* ============================================================
   PITCH DETECTOR
   
   Real-time pitch detection using autocorrelation (YIN-style).
   Analyzes microphone input to determine the sung pitch.
   Includes smoothing and confidence gating to reduce jitter.
   ============================================================ */

import { AudioService } from './AudioService';
import type { PitchPoint, PitchDetectionSettings } from '../types';

/**
 * Result of a single pitch detection frame.
 */
export interface PitchDetectionResult {
  frequency: number;    // Detected frequency in Hz (0 if no pitch detected)
  confidence: number;   // Confidence level (0-1)
  noteNumber: number;   // MIDI note number (0 if no pitch)
  cents: number;        // Cents offset from nearest note (-50 to +50)
}

/**
 * Callback function type for pitch detection updates.
 */
export type PitchCallback = (result: PitchDetectionResult) => void;

/**
 * Pitch detector class using autocorrelation algorithm.
 * Analyzes audio input in real-time to detect sung pitch.
 */
export class PitchDetector {
  // Audio nodes for input analysis
  private analyser: AnalyserNode | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;

  // Buffer for frequency data
  private dataBuffer: Float32Array | null = null;

  // Detection settings
  private settings: PitchDetectionSettings = {
    minFrequency: 65,        // Extended bass range (C2) - from reference
    maxFrequency: 1200,      // Extended soprano range - from reference
    smoothingFactor: 0.5,    // Higher = smoother (0.3 in reference but we want smoother visual)
    confidenceThreshold: 0.5, // Slightly higher to reduce noise
    updateInterval: 33,      // ~30fps like reference
  };

  // Callback for pitch updates
  private callback: PitchCallback | null = null;

  // Animation frame ID for the detection loop
  private animationFrameId: number | null = null;

  // Smoothing state - ported from reference implementation
  private medianBuffer: number[] = [];
  private medianSize: number = 9; // Increased from 7 for better outlier rejection
  private smoothedMidi: number | null = null;

  // Last detected pitch (for legacy compatibility)
  private lastFrequency: number = 0;
  private lastConfidence: number = 0;

  // Recording state
  private isRunning: boolean = false;

  // Pitch trace for recording
  private pitchTrace: PitchPoint[] = [];
  private recordingStartTime: number = 0;

  /**
   * Initialize the pitch detector with a media stream.
   * @param stream - MediaStream from getUserMedia
   */
  initialize(stream: MediaStream): void {
    const ctx = AudioService.getContext();

    // Create media stream source from microphone
    this.mediaStreamSource = ctx.createMediaStreamSource(stream);

    // Create analyser node for frequency analysis
    // Using larger FFT size for better low-frequency resolution (from reference)
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096; // Larger for better bass detection
    this.analyser.smoothingTimeConstant = 0; // We do our own smoothing

    // Connect microphone to analyser (but not to output - we don't want feedback)
    this.mediaStreamSource.connect(this.analyser);

    // Create buffer for time-domain data
    this.dataBuffer = new Float32Array(this.analyser.fftSize);

    console.log('PitchDetector initialized with improved smoothing');
  }

  /**
   * Update detection settings.
   * @param settings - Partial settings to update
   */
  setSettings(settings: Partial<PitchDetectionSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  /**
   * Set the callback function for pitch updates.
   * @param callback - Function to call with each pitch detection result
   */
  setCallback(callback: PitchCallback): void {
    this.callback = callback;
  }

  /**
   * Start pitch detection.
   * @param recordTrace - Whether to record the pitch trace for saving
   */
  start(recordTrace: boolean = false): void {
    if (this.isRunning) return;
    if (!this.analyser || !this.dataBuffer) {
      console.warn('PitchDetector not initialized');
      return;
    }

    this.isRunning = true;

    // Reset smoothing state (from reference)
    this.medianBuffer = [];
    this.smoothedMidi = null;
    this.lastFrequency = 0;
    this.lastConfidence = 0;

    // Clear and start recording pitch trace if requested
    if (recordTrace) {
      this.pitchTrace = [];
      this.recordingStartTime = performance.now();
    }

    // Start the detection loop with reference-style smoothing
    this.detectLoopWithSmoothing();
  }

  /**
   * Stop pitch detection.
   * @returns The recorded pitch trace (if recording was enabled)
   */
  stop(): PitchPoint[] {
    this.isRunning = false;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Return the recorded trace
    const trace = [...this.pitchTrace];
    this.pitchTrace = [];
    return trace;
  }

  /**
   * Detection loop with median filtering and exponential smoothing.
   * Ported from the reference choir_ref.html implementation for better accuracy.
   */
  private detectLoopWithSmoothing = (): void => {
    if (!this.isRunning) return;
    if (!this.analyser || !this.dataBuffer) {
      this.animationFrameId = requestAnimationFrame(this.detectLoopWithSmoothing);
      return;
    }

    // Get time-domain data
    this.analyser.getFloatTimeDomainData(this.dataBuffer as unknown as Float32Array<ArrayBuffer>);

    // Run autocorrelation to find pitch
    const { frequency, confidence } = this.autocorrelate(this.dataBuffer as Float32Array);

    // Convert to MIDI for processing (like reference)
    const midi = frequency > 0 ? 12 * Math.log2(frequency / 440) + 69 : -1;

    let resultFrequency = 0;
    let resultConfidence = confidence;
    let resultMidi = 0;

    // Process pitch if we have signal above threshold (from reference)
    if (midi > 0 && confidence > this.settings.confidenceThreshold) {
      this.medianBuffer.push(midi);
      if (this.medianBuffer.length > this.medianSize) {
        this.medianBuffer.shift();
      }

      // Only emit points once we have a stable buffer (from reference)
      if (this.medianBuffer.length >= 3) {
        // Calculate median to remove outliers
        const sorted = [...this.medianBuffer].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];

        // Apply exponential smoothing (from reference)
        if (this.smoothedMidi === null) {
          this.smoothedMidi = median;
        } else {
          // If the jump is large (possible octave error or new phrase), reset smoothing
          // Threshold of 4 semitones catches most octave errors while allowing glides
          if (Math.abs(this.smoothedMidi - median) > 4) {
            this.smoothedMidi = median;
          } else {
            this.smoothedMidi = this.smoothedMidi * (1 - this.settings.smoothingFactor) + median * this.settings.smoothingFactor;
          }
        }

        // Convert back to frequency and note number
        resultMidi = Math.round(this.smoothedMidi);
        resultFrequency = 440 * Math.pow(2, (this.smoothedMidi - 69) / 12);
        this.lastFrequency = resultFrequency;
        this.lastConfidence = confidence;
      }
    } else {
      // Signal lost - drain buffer for bridging short gaps (from reference)
      if (this.medianBuffer.length > 0) this.medianBuffer.shift();
      if (this.medianBuffer.length === 0) this.smoothedMidi = null;
    }

    // Create result
    const result: PitchDetectionResult = {
      frequency: resultFrequency,
      confidence: resultConfidence,
      noteNumber: resultMidi,
      cents: resultMidi > 0 && this.smoothedMidi ? (this.smoothedMidi - resultMidi) * 100 : 0,
    };

    // Record to trace if recording
    if (this.recordingStartTime > 0 && resultFrequency > 0) {
      this.pitchTrace.push({
        time: performance.now() - this.recordingStartTime,
        frequency: resultFrequency,
        confidence: resultConfidence,
      });
    }

    // Call callback if set
    if (this.callback) {
      this.callback(result);
    }

    // Schedule next frame
    this.animationFrameId = requestAnimationFrame(this.detectLoopWithSmoothing);
  };

  /**
   * Perform pitch detection on current audio data.
   * Uses autocorrelation (simplified YIN algorithm).
   * (Legacy method kept for compatibility)
   */
  private detectPitch(): PitchDetectionResult {
    if (!this.analyser || !this.dataBuffer) {
      return { frequency: 0, confidence: 0, noteNumber: 0, cents: 0 };
    }

    // Get time-domain data
    // Note: Type assertion needed due to TypeScript's strict ArrayBuffer typing
    this.analyser.getFloatTimeDomainData(this.dataBuffer as unknown as Float32Array<ArrayBuffer>);

    // Run autocorrelation to find pitch
    const { frequency, confidence } = this.autocorrelate(this.dataBuffer as Float32Array);

    // Apply smoothing
    let smoothedFreq = frequency;
    let smoothedConf = confidence;

    if (this.lastFrequency > 0 && frequency > 0) {
      // Only smooth if both current and last readings are valid
      const factor = this.settings.smoothingFactor;
      smoothedFreq = frequency * (1 - factor) + this.lastFrequency * factor;
      smoothedConf = confidence * (1 - factor) + this.lastConfidence * factor;
    }

    // Update last values
    this.lastFrequency = smoothedFreq > 0 ? smoothedFreq : this.lastFrequency * 0.9;
    this.lastConfidence = smoothedConf;

    // Apply confidence threshold
    if (smoothedConf < this.settings.confidenceThreshold) {
      return { frequency: 0, confidence: smoothedConf, noteNumber: 0, cents: 0 };
    }

    // Check frequency range
    if (smoothedFreq < this.settings.minFrequency || smoothedFreq > this.settings.maxFrequency) {
      return { frequency: 0, confidence: smoothedConf, noteNumber: 0, cents: 0 };
    }

    // Calculate MIDI note and cents offset
    const noteNumber = 12 * Math.log2(smoothedFreq / 440) + 69;
    const roundedNote = Math.round(noteNumber);
    const cents = (noteNumber - roundedNote) * 100;

    return {
      frequency: smoothedFreq,
      confidence: smoothedConf,
      noteNumber: roundedNote,
      cents,
    };
  }

  /**
   * Autocorrelation pitch detection algorithm.
   * Based on the YIN algorithm, simplified for real-time use.
   * @param buffer - Time-domain audio samples
   * @returns Detected frequency and confidence
   */
  private autocorrelate(buffer: Float32Array): { frequency: number; confidence: number } {
    const sampleRate = AudioService.getSampleRate();
    const bufferSize = buffer.length;

    // Find the RMS (root mean square) to check if there's enough signal
    let rms = 0;
    for (let i = 0; i < bufferSize; i++) {
      rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / bufferSize);

    // If the signal is too quiet, return no pitch
    if (rms < 0.01) {
      return { frequency: 0, confidence: 0 };
    }

    // Calculate lag range based on frequency limits
    const minLag = Math.floor(sampleRate / this.settings.maxFrequency);
    const maxLag = Math.ceil(sampleRate / this.settings.minFrequency);

    // Compute the difference function (simplified YIN)
    let bestLag = 0;
    let bestConfidence = 0;

    for (let lag = minLag; lag < maxLag && lag < bufferSize / 2; lag++) {
      let correlation = 0;
      let norm1 = 0;
      let norm2 = 0;

      for (let i = 0; i < bufferSize - lag; i++) {
        correlation += buffer[i] * buffer[i + lag];
        norm1 += buffer[i] * buffer[i];
        norm2 += buffer[i + lag] * buffer[i + lag];
      }

      // Normalized correlation coefficient
      const normalization = Math.sqrt(norm1 * norm2);
      const normalizedCorrelation = normalization > 0 ? correlation / normalization : 0;

      if (normalizedCorrelation > bestConfidence) {
        bestConfidence = normalizedCorrelation;
        bestLag = lag;
      }
    }

    // Convert lag to frequency
    if (bestLag === 0) {
      return { frequency: 0, confidence: 0 };
    }

    // Parabolic interpolation for better precision
    const frequency = sampleRate / this.interpolateLag(buffer, bestLag);

    return { frequency, confidence: bestConfidence };
  }

  /**
   * Parabolic interpolation to refine the lag estimate.
   * Provides sub-sample accuracy for better pitch precision.
   */
  private interpolateLag(buffer: Float32Array, lag: number): number {
    if (lag <= 1 || lag >= buffer.length / 2 - 1) {
      return lag;
    }

    // Get correlation at lag-1, lag, and lag+1
    const s0 = this.correlationAtLag(buffer, lag - 1);
    const s1 = this.correlationAtLag(buffer, lag);
    const s2 = this.correlationAtLag(buffer, lag + 1);

    // Parabolic interpolation
    const denominator = s0 - 2 * s1 + s2;
    if (Math.abs(denominator) < 0.0001) {
      return lag;
    }

    const delta = 0.5 * (s0 - s2) / denominator;
    return lag + delta;
  }

  /**
   * Calculate correlation at a specific lag.
   */
  private correlationAtLag(buffer: Float32Array, lag: number): number {
    let correlation = 0;
    const length = buffer.length - lag;

    for (let i = 0; i < length; i++) {
      correlation += buffer[i] * buffer[i + lag];
    }

    return correlation;
  }

  /**
   * Check if the detector is currently running.
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Clean up and dispose of audio nodes.
   */
  dispose(): void {
    this.stop();

    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    this.dataBuffer = null;
    this.callback = null;
  }
}

/**
 * Factory function to create a new PitchDetector.
 * @param stream - MediaStream from getUserMedia
 * @returns Initialized PitchDetector
 */
export function createPitchDetector(stream: MediaStream): PitchDetector {
  const detector = new PitchDetector();
  detector.initialize(stream);
  return detector;
}
