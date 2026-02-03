/* ============================================================
   SYNTH VOICE
   
   A simple synthesizer voice for playing reference tones.
   Uses basic waveforms with ADSR envelope for smooth, musical sound.
   ============================================================ */

import { AudioService } from './AudioService';

/**
 * ADSR envelope settings for controlling note shape.
 * Times are in seconds.
 */
interface EnvelopeSettings {
  attack: number;   // Time to reach peak volume
  decay: number;    // Time to fall to sustain level
  sustain: number;  // Sustain level (0-1)
  release: number;  // Time to fade out after note off
}

/**
 * A single synthesizer voice that can play one note at a time.
 * Uses Web Audio API oscillator with gain envelope.
 */
export class SynthVoice {
  // Current oscillator (recreated for each note)
  private oscillator: OscillatorNode | null = null;
  
  // Gain node for volume envelope
  private gainNode: GainNode | null = null;
  
  // Per-voice volume control
  private volumeNode: GainNode | null = null;
  
  // Current frequency (for gliding)
  private currentFrequency: number = 440;
  
  // Whether a note is currently playing
  private isPlaying: boolean = false;
  
  // Waveform type for this voice
  private waveform: OscillatorType = 'triangle';
  
  // Envelope settings
  private envelope: EnvelopeSettings = {
    attack: 0.02,   // 20ms attack - quick but not clicky
    decay: 0.1,     // 100ms decay
    sustain: 0.7,   // 70% sustain level
    release: 0.15,  // 150ms release - smooth fadeout
  };

  // Voice identifier
  public readonly voiceId: string;

  constructor(voiceId: string) {
    this.voiceId = voiceId;
  }

  /**
   * Initialize the voice by creating the volume node.
   * Must be called after AudioService is initialized.
   */
  initialize(): void {
    const ctx = AudioService.getContext();
    
    // Create per-voice volume control
    this.volumeNode = ctx.createGain();
    this.volumeNode.gain.value = 0.5; // Default 50% volume
    this.volumeNode.connect(AudioService.getDryGain());
  }

  /**
   * Set the waveform type for this voice.
   * @param type - Oscillator type ('sine', 'triangle', 'square', 'sawtooth')
   */
  setWaveform(type: OscillatorType): void {
    this.waveform = type;
    // Update current oscillator if playing
    if (this.oscillator) {
      this.oscillator.type = type;
    }
  }

  /**
   * Set the volume for this voice.
   * @param volume - Volume level (0-1)
   */
  setVolume(volume: number): void {
    if (this.volumeNode) {
      this.volumeNode.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  /**
   * Set envelope parameters.
   * @param settings - Partial envelope settings to update
   */
  setEnvelope(settings: Partial<EnvelopeSettings>): void {
    this.envelope = { ...this.envelope, ...settings };
  }

  /**
   * Start playing a note at the given frequency.
   * @param frequency - Frequency in Hz
   * @param startTime - Optional start time (audio context time)
   */
  noteOn(frequency: number, startTime?: number): void {
    if (!this.volumeNode) {
      console.warn('SynthVoice not initialized');
      return;
    }

    const ctx = AudioService.getContext();
    const time = startTime ?? ctx.currentTime;
    
    // Stop any currently playing note
    this.noteOff(time);
    
    // Create new oscillator
    this.oscillator = ctx.createOscillator();
    this.oscillator.type = this.waveform;
    this.oscillator.frequency.value = frequency;
    this.currentFrequency = frequency;
    
    // Create gain node for envelope
    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = 0;
    
    // Connect oscillator -> envelope gain -> volume -> output
    this.oscillator.connect(this.gainNode);
    this.gainNode.connect(this.volumeNode);
    
    // Apply attack-decay-sustain envelope
    const { attack, decay, sustain } = this.envelope;
    this.gainNode.gain.setValueAtTime(0, time);
    this.gainNode.gain.linearRampToValueAtTime(1, time + attack);
    this.gainNode.gain.linearRampToValueAtTime(sustain, time + attack + decay);
    
    // Start the oscillator
    this.oscillator.start(time);
    this.isPlaying = true;
  }

  /**
   * Stop the currently playing note.
   * @param stopTime - Optional stop time (audio context time)
   */
  noteOff(stopTime?: number): void {
    if (!this.oscillator || !this.gainNode || !this.isPlaying) {
      return;
    }

    const ctx = AudioService.getContext();
    const time = stopTime ?? ctx.currentTime;
    const { release } = this.envelope;
    
    // Apply release envelope
    this.gainNode.gain.cancelScheduledValues(time);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, time);
    this.gainNode.gain.linearRampToValueAtTime(0, time + release);
    
    // Stop oscillator after release
    this.oscillator.stop(time + release + 0.01);
    
    // Clean up references (after release time)
    const oscToClean = this.oscillator;
    const gainToClean = this.gainNode;
    setTimeout(() => {
      oscToClean.disconnect();
      gainToClean.disconnect();
    }, (release + 0.1) * 1000);
    
    this.oscillator = null;
    this.gainNode = null;
    this.isPlaying = false;
  }

  /**
   * Glide (portamento) to a new frequency.
   * @param frequency - Target frequency in Hz
   * @param glideTime - Time to glide in seconds
   * @param startTime - Optional start time for the glide
   */
  glideTo(frequency: number, glideTime: number = 0.1, startTime?: number): void {
    if (!this.oscillator) {
      // If not playing, just start at the new frequency
      this.noteOn(frequency, startTime);
      return;
    }

    const ctx = AudioService.getContext();
    const time = startTime ?? ctx.currentTime;
    
    // Exponential ramp sounds more natural for pitch
    this.oscillator.frequency.exponentialRampToValueAtTime(frequency, time + glideTime);
    this.currentFrequency = frequency;
  }

  /**
   * Get the current frequency.
   */
  getFrequency(): number {
    return this.currentFrequency;
  }

  /**
   * Check if this voice is currently playing.
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Immediately stop and clean up this voice.
   */
  dispose(): void {
    if (this.oscillator) {
      try {
        this.oscillator.stop();
        this.oscillator.disconnect();
      } catch {
        // Ignore errors if already stopped
      }
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
    }
    if (this.volumeNode) {
      this.volumeNode.disconnect();
    }
    this.oscillator = null;
    this.gainNode = null;
    this.volumeNode = null;
    this.isPlaying = false;
  }
}

/**
 * Factory function to create a new SynthVoice.
 * @param voiceId - Unique identifier for this voice
 * @returns Initialized SynthVoice
 */
export function createSynthVoice(voiceId: string): SynthVoice {
  const voice = new SynthVoice(voiceId);
  voice.initialize();
  return voice;
}
