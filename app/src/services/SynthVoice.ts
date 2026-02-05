/* ============================================================
   SYNTH VOICE
   
   A synthesizer voice for playing reference tones, rewritten to 
   match the look and feel of choir_ref.html using Tone.js.
   ============================================================ */

import * as Tone from 'tone';
import { AudioService } from './AudioService';

/**
 * A single synthesizer voice that can play one note at a time.
 * Uses Tone.Synth with matching parameters from choir_ref.
 */
export class SynthVoice {
  // Tone.js Synth
  private synth: Tone.Synth;

  // Per-voice filter and panner
  private filter: Tone.Filter;
  private panner: Tone.Panner;
  private voiceGain: Tone.Gain;

  // Voice identifier
  public readonly voiceId: string;
  private voiceIndex: number;

  constructor(voiceId: string, voiceIndex: number = 0) {
    this.voiceId = voiceId;
    this.voiceIndex = voiceIndex;

    // Create Tone objects without connecting them yet
    this.synth = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.2 },
      volume: -10,
      portamento: 0.1
    });

    this.filter = new Tone.Filter({
      frequency: 1200,
      type: "lowpass",
      rolloff: -12
    });

    // Baseline gain adjustment from choir_ref: Math.pow(10, -6 / 20)
    const baseGain = Math.pow(10, -6 / 20);
    this.voiceGain = new Tone.Gain(baseGain);

    this.panner = new Tone.Panner(0);
  }

  /**
   * Initialize routing. Must be called after AudioService/Tone is ready.
   */
  initialize(): void {
    // Define voice-specific parameters (from choir_ref)
    let filterFreq = 1200;
    let panVal = 0;

    // Match the voice-specific settings from choir_ref
    // Logic: Soprano=0, Alto=1, Tenor=2, Bass=3
    if (this.voiceIndex === 1) { // Alto
      filterFreq = 2000;
      panVal = -0.8;
    } else if (this.voiceIndex === 2) { // Tenor
      filterFreq = 2500;
      panVal = 0.8;
    }

    this.filter.frequency.value = filterFreq;
    this.panner.pan.value = panVal;

    // Chain: Synth -> Filter -> Gain -> Panner -> Chorus -> Destination
    // Connect to global chorus via AudioService
    this.synth.chain(
      this.filter,
      this.voiceGain,
      this.panner,
      AudioService.getChorus()
    );
  }

  /**
   * Set the waveform type for this voice.
   * @param type - Oscillator type ('sine', 'triangle', 'square', 'sawtooth')
   */
  setWaveform(type: OscillatorType): void {
    this.synth.oscillator.type = type;
  }

  /**
   * Set the volume for this voice.
   * @param volume - Volume level (0-1)
   */
  setVolume(volume: number): void {
    this.voiceGain.gain.rampTo(volume, 0.1);
  }

  /**
   * Set stereo pan for this synth voice.
   * @param pan - Stereo position (-1 = left, 0 = center, 1 = right)
   */
  setPan(pan: number): void {
    const clamped = Math.max(-1, Math.min(1, pan));
    this.panner.pan.rampTo(clamped, 0.05);
  }

  /**
   * Set the envelope release time (in seconds).
   * Smaller values make note-off sound tighter and reduce clicks.
   */
  setReleaseTime(seconds: number): void {
    const clamped = Math.max(0.001, Math.min(2, seconds));
    (this.synth.envelope as any).release = clamped;
  }

  /**
   * Start playing a note at the given frequency.
   * @param frequency - Frequency in Hz
   * @param startTime - Optional start time (audio context time)
   */
  noteOn(frequency: number, startTime?: number): void {
    this.synth.triggerAttack(frequency, startTime);
  }

  /**
   * Stop the currently playing note.
   * @param stopTime - Optional stop time (audio context time)
   */
  noteOff(stopTime?: number): void {
    this.synth.triggerRelease(stopTime);
  }

  /**
   * Glide (portamento) to a new frequency.
   * @param frequency - Target frequency in Hz
   * @param _glideTime - Unused, uses synth.portamento (0.1s) to match choir_ref
   * @param startTime - Optional start time for the glide
   */
  glideTo(frequency: number, _glideTime: number = 0.1, startTime?: number): void {
    // Use setNote to trigger the internal portamento logic of Tone.Synth
    (this.synth as any).setNote(frequency, startTime);
  }

  /**
   * Get the current frequency.
   */
  getFrequency(): number {
    return this.synth.frequency.value as number;
  }

  /**
   * Check if this voice is currently playing.
   */
  getIsPlaying(): boolean {
    return (this.synth.envelope as any).state === 'started';
  }

  /**
   * Immediately stop and clean up this voice.
   */
  dispose(): void {
    this.synth.dispose();
    this.filter.dispose();
    this.voiceGain.dispose();
    this.panner.dispose();
  }
}

/**
 * Factory function to create a new SynthVoice.
 * @param voiceId - Unique identifier for this voice
 * @param voiceIndex - Index of the voice (0-3) for pan/filter assignment
 * @returns Initialized SynthVoice
 */
export function createSynthVoice(voiceId: string, voiceIndex: number = 0): SynthVoice {
  return new SynthVoice(voiceId, voiceIndex);
}
