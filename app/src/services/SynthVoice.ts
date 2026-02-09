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
      portamento: 0.05
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
    // Voice-specific filter frequency and stereo pan position.
    // Spreads up to 6 voices across the stereo field with distinct timbres.
    // Index mapping: 0=Soprano1, 1=Alto/Soprano2, 2=Tenor/Alto2, 3=Bass/Tenor2, 4=Voice5, 5=Voice6
    const voiceSettings: [number, number][] = [
      [1200,  0.0],   // 0 - Soprano 1: center, warm
      [2000, -0.8],   // 1 - Alto:       left, brighter
      [2500,  0.8],   // 2 - Tenor:      right, brightest
      [1400, -0.4],   // 3 - Bass:       slight left, warm
      [1800,  0.5],   // 4 - Voice 5:    slight right, mid-bright
      [1600, -0.6],   // 5 - Voice 6:    left, mid
    ];

    // Fall back to center/warm if the voice index exceeds the table.
    const [filterFreq, panVal] = voiceSettings[this.voiceIndex] ?? [1200, 0];

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
   * Clear accumulated AudioParam automation events on this voice's synth.
   *
   * Tone.js's triggerAttack/triggerRelease/setNote schedule AudioParam events
   * (frequency ramps, envelope gain ramps). While each call uses cancelScheduledValues
   * to clear FUTURE events, PAST events remain in both the WebAudio AudioParam
   * timeline and Tone.js's internal JavaScript Timeline objects.
   *
   * Over hundreds of loop iterations, these past events accumulate and can
   * progressively degrade performance. Call this at loop boundaries (after noteOff)
   * to flush the entire history.
   */
  cancelScheduledEvents(): void {
    try {
      // Clear the frequency AudioParam timeline.
      // Tone.Signal wraps an AudioParam; cancelScheduledValues(0) clears everything.
      this.synth.frequency.cancelScheduledValues(0);
    } catch { /* ignore if not connected */ }
    try {
      // Clear the envelope's internal signal timeline.
      // The envelope uses a Tone.Signal internally for its ADSR ramps.
      (this.synth.envelope as any)._sig?.cancelScheduledValues?.(0);
    } catch { /* ignore if internal API changed */ }
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
