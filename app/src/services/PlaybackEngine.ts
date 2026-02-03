/* ============================================================
   PLAYBACK ENGINE
   
   Handles timeline playback, synth scheduling, and synchronization.
   Coordinates between the arrangement data and audio output.
   ============================================================ */

import { AudioService } from './AudioService';
import { SynthVoice, createSynthVoice } from './SynthVoice';
import type { Arrangement, Voice, Node, TimeSignature } from '../types';
import { scaleDegreeToFrequency } from '../utils/music';
import { t16ToMs, sixteenthDurationMs, arrangementTotalSixteenths } from '../utils/timing';

/**
 * Callback for position updates during playback.
 */
export type PositionCallback = (t16: number, ms: number) => void;

/**
 * Callback for when playback loops or ends.
 */
export type LoopCallback = () => void;

/**
 * Callback for count-in beats.
 */
export type CountInCallback = (beatNumber: number, totalBeats: number) => void;

/**
 * Engine configuration.
 */
interface PlaybackConfig {
  onPositionUpdate?: PositionCallback;
  onLoop?: LoopCallback;
  onCountIn?: CountInCallback;
  onPlaybackEnd?: () => void;
}

/**
 * PlaybackEngine manages the timeline and synth voices for an arrangement.
 */
export class PlaybackEngine {
  // Current arrangement
  private arrangement: Arrangement | null = null;
  
  // Synth voices (one per arrangement voice)
  private synthVoices: Map<string, SynthVoice> = new Map();
  
  // Playback state
  private isPlaying: boolean = false;
  private startTime: number = 0;        // AudioContext time when playback started
  private startPosition: number = 0;    // Position in ms when playback started
  private currentPositionMs: number = 0;
  
  // Loop settings
  private loopEnabled: boolean = true;
  private loopStartT16: number = 0;
  private loopEndT16: number = 64;
  
  // Tempo
  private tempoMultiplier: number = 1.0;
  private baseTempo: number = 120;
  private timeSig: TimeSignature = { numerator: 4, denominator: 4 };
  
  // Transposition
  private transposition: number = 0;
  
  // Mute/solo state per voice
  private mutedVoices: Set<string> = new Set();
  private soloedVoices: Set<string> = new Set();
  
  // Animation frame for position updates
  private animationFrameId: number | null = null;
  
  // Scheduled note events (for cleanup)
  private scheduledEvents: Array<{ voiceId: string; nodeIndex: number; time: number }> = [];
  
  // Callbacks
  private config: PlaybackConfig = {};
  
  // Count-in
  private isCountingIn: boolean = false;
  private countInOscillator: OscillatorNode | null = null;

  /**
   * Initialize the engine with an arrangement.
   * @param arrangement - The arrangement to play
   * @param config - Callbacks and configuration
   */
  initialize(arrangement: Arrangement, config: PlaybackConfig = {}): void {
    this.arrangement = arrangement;
    this.config = config;
    this.baseTempo = arrangement.tempo;
    this.timeSig = arrangement.timeSig;
    
    // Set loop end to arrangement length
    this.loopEndT16 = arrangementTotalSixteenths(arrangement.bars, this.timeSig);
    
    // Create synth voices for each voice in the arrangement
    this.disposeSynthVoices();
    for (const voice of arrangement.voices) {
      const synth = createSynthVoice(voice.id);
      synth.setVolume(0.5);
      this.synthVoices.set(voice.id, synth);
    }
    
    console.log(`PlaybackEngine initialized with ${arrangement.voices.length} voices`);
  }

  /**
   * Set playback configuration/callbacks.
   */
  setConfig(config: Partial<PlaybackConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set the tempo multiplier (playback speed).
   * @param multiplier - Speed multiplier (0.5, 0.75, 1.0, etc.)
   */
  setTempoMultiplier(multiplier: number): void {
    // If playing, need to recalculate position
    if (this.isPlaying) {
      const currentMs = this.getCurrentPositionMs();
      this.tempoMultiplier = multiplier;
      this.startTime = AudioService.getCurrentTime();
      this.startPosition = currentMs;
    } else {
      this.tempoMultiplier = multiplier;
    }
  }

  /**
   * Set transposition in semitones.
   * @param semitones - Number of semitones to transpose
   */
  setTransposition(semitones: number): void {
    this.transposition = semitones;
  }

  /**
   * Set loop enabled/disabled.
   */
  setLoopEnabled(enabled: boolean): void {
    this.loopEnabled = enabled;
  }

  /**
   * Set loop points.
   * @param startT16 - Loop start in 16th notes
   * @param endT16 - Loop end in 16th notes
   */
  setLoopPoints(startT16: number, endT16: number): void {
    this.loopStartT16 = startT16;
    this.loopEndT16 = endT16;
  }

  /**
   * Set muted state for a voice.
   */
  setVoiceMuted(voiceId: string, muted: boolean): void {
    if (muted) {
      this.mutedVoices.add(voiceId);
    } else {
      this.mutedVoices.delete(voiceId);
    }
  }

  /**
   * Set solo state for a voice.
   */
  setVoiceSolo(voiceId: string, solo: boolean): void {
    if (solo) {
      this.soloedVoices.add(voiceId);
    } else {
      this.soloedVoices.delete(voiceId);
    }
  }

  /**
   * Set volume for a voice's synth.
   */
  setVoiceVolume(voiceId: string, volume: number): void {
    const synth = this.synthVoices.get(voiceId);
    if (synth) {
      synth.setVolume(volume);
    }
  }

  /**
   * Check if a voice should be audible (considering mute/solo).
   */
  private isVoiceAudible(voiceId: string): boolean {
    // If any voice is soloed, only soloed voices play
    if (this.soloedVoices.size > 0) {
      return this.soloedVoices.has(voiceId);
    }
    // Otherwise, check if muted
    return !this.mutedVoices.has(voiceId);
  }

  /**
   * Start playback with optional count-in.
   * @param countInBars - Number of bars to count in (0 = no count-in)
   */
  async play(countInBars: number = 0): Promise<void> {
    if (!this.arrangement) {
      console.warn('No arrangement loaded');
      return;
    }
    
    // Make sure audio context is running
    await AudioService.resume();
    
    if (countInBars > 0) {
      await this.performCountIn(countInBars);
    }
    
    this.isPlaying = true;
    this.startTime = AudioService.getCurrentTime();
    this.startPosition = this.currentPositionMs;
    
    // Start the update loop
    this.startUpdateLoop();
    
    // Schedule initial notes
    this.scheduleNotesFromPosition(this.getCurrentPositionT16());
  }

  /**
   * Perform a count-in before playback.
   */
  private async performCountIn(bars: number): Promise<void> {
    this.isCountingIn = true;
    const ctx = AudioService.getContext();
    const effectiveTempo = this.baseTempo * this.tempoMultiplier;
    const beatDurationMs = 60000 / effectiveTempo;
    const totalBeats = bars * this.timeSig.numerator;
    
    for (let beat = 0; beat < totalBeats; beat++) {
      if (!this.isCountingIn) break; // Allow cancellation
      
      // Play click sound
      this.playClickSound(ctx.currentTime);
      
      // Callback for visual count-in
      if (this.config.onCountIn) {
        this.config.onCountIn(beat + 1, totalBeats);
      }
      
      // Wait for next beat
      await new Promise(resolve => setTimeout(resolve, beatDurationMs));
    }
    
    this.isCountingIn = false;
  }

  /**
   * Play a metronome click sound.
   */
  private playClickSound(time: number): void {
    const ctx = AudioService.getContext();
    
    // Create a short click using an oscillator
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.value = 880; // A5
    
    gain.gain.setValueAtTime(0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    
    osc.connect(gain);
    gain.connect(AudioService.getMasterGain());
    
    osc.start(time);
    osc.stop(time + 0.05);
  }

  /**
   * Stop playback.
   */
  stop(): void {
    this.isPlaying = false;
    this.isCountingIn = false;
    
    // Stop the update loop
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // Stop all synth voices
    for (const synth of this.synthVoices.values()) {
      synth.noteOff();
    }
    
    // Clear scheduled events
    this.scheduledEvents = [];
  }

  /**
   * Pause playback (keeps position).
   */
  pause(): void {
    if (!this.isPlaying) return;
    
    // Save current position
    this.currentPositionMs = this.getCurrentPositionMs();
    this.stop();
  }

  /**
   * Seek to a position.
   * @param t16 - Position in 16th notes
   */
  seek(t16: number): void {
    const wasPlaying = this.isPlaying;
    
    if (wasPlaying) {
      this.stop();
    }
    
    // Convert to ms and set position
    this.currentPositionMs = t16ToMs(t16, this.getEffectiveTempo(), this.timeSig);
    
    if (wasPlaying) {
      this.play();
    }
  }

  /**
   * Get effective tempo (base * multiplier).
   */
  private getEffectiveTempo(): number {
    return this.baseTempo * this.tempoMultiplier;
  }

  /**
   * Get current position in milliseconds.
   */
  getCurrentPositionMs(): number {
    if (!this.isPlaying) {
      return this.currentPositionMs;
    }
    
    const elapsed = (AudioService.getCurrentTime() - this.startTime) * 1000;
    return this.startPosition + elapsed;
  }

  /**
   * Get current position in 16th notes.
   */
  getCurrentPositionT16(): number {
    const ms = this.getCurrentPositionMs();
    const sixteenthMs = sixteenthDurationMs(this.getEffectiveTempo(), this.timeSig);
    return ms / sixteenthMs;
  }

  /**
   * Start the animation frame update loop.
   */
  private startUpdateLoop(): void {
    const update = () => {
      if (!this.isPlaying) return;
      
      const currentMs = this.getCurrentPositionMs();
      const currentT16 = this.getCurrentPositionT16();
      
      // Check for loop
      const loopEndMs = t16ToMs(this.loopEndT16, this.getEffectiveTempo(), this.timeSig);
      if (this.loopEnabled && currentMs >= loopEndMs) {
        // Loop back to start
        const loopStartMs = t16ToMs(this.loopStartT16, this.getEffectiveTempo(), this.timeSig);
        this.startTime = AudioService.getCurrentTime();
        this.startPosition = loopStartMs;
        
        // Stop all notes and reschedule
        for (const synth of this.synthVoices.values()) {
          synth.noteOff();
        }
        this.scheduleNotesFromPosition(this.loopStartT16);
        
        if (this.config.onLoop) {
          this.config.onLoop();
        }
      }
      
      // Position update callback
      if (this.config.onPositionUpdate) {
        this.config.onPositionUpdate(currentT16, currentMs);
      }
      
      // Update notes (check if any should start/stop)
      this.updateNotes(currentT16);
      
      // Continue loop
      this.animationFrameId = requestAnimationFrame(update);
    };
    
    this.animationFrameId = requestAnimationFrame(update);
  }

  /**
   * Schedule notes from a given position.
   */
  private scheduleNotesFromPosition(fromT16: number): void {
    if (!this.arrangement) return;
    
    for (const voice of this.arrangement.voices) {
      if (!this.isVoiceAudible(voice.id)) continue;
      
      const synth = this.synthVoices.get(voice.id);
      if (!synth) continue;
      
      // Find the current or next node
      const nodeIndex = this.findNodeAtOrAfter(voice.nodes, fromT16);
      if (nodeIndex === -1) continue;
      
      // If we're in the middle of a note, start it
      const prevIndex = nodeIndex > 0 ? nodeIndex - 1 : -1;
      if (prevIndex >= 0) {
        const prevNode = voice.nodes[prevIndex];
        const currentNode = voice.nodes[nodeIndex];
        
        // Check if prev node spans to current position
        if (!prevNode.term && prevNode.t16 <= fromT16 && currentNode.t16 > fromT16) {
          const freq = this.getNodeFrequency(voice, prevNode);
          synth.noteOn(freq);
        }
      }
    }
  }

  /**
   * Find the index of the node at or after the given time.
   */
  private findNodeAtOrAfter(nodes: Node[], t16: number): number {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].t16 >= t16) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Update note playback based on current position.
   */
  private updateNotes(currentT16: number): void {
    if (!this.arrangement) return;
    
    for (const voice of this.arrangement.voices) {
      const synth = this.synthVoices.get(voice.id);
      if (!synth) continue;
      
      const audible = this.isVoiceAudible(voice.id);
      
      // Find which node we should be playing
      let activeNode: Node | null = null;
      let nextNode: Node | null = null;
      
      for (let i = 0; i < voice.nodes.length; i++) {
        const node = voice.nodes[i];
        const next = voice.nodes[i + 1];
        
        if (node.t16 <= currentT16) {
          if (node.term) {
            // Termination node - no active note
            activeNode = null;
          } else if (next && next.t16 > currentT16) {
            // We're between this node and the next
            activeNode = node;
            nextNode = next;
          } else if (!next && node.t16 <= currentT16) {
            // Last node, hold until end
            activeNode = node;
          }
        }
      }
      
      // Update synth
      if (audible && activeNode) {
        const freq = this.getNodeFrequency(voice, activeNode);
        
        if (!synth.getIsPlaying()) {
          synth.noteOn(freq);
        } else if (Math.abs(synth.getFrequency() - freq) > 1) {
          // Frequency changed, glide to it
          synth.glideTo(freq, 0.05);
        }
      } else {
        if (synth.getIsPlaying()) {
          synth.noteOff();
        }
      }
    }
  }

  /**
   * Get the frequency for a node, considering transposition.
   */
  private getNodeFrequency(voice: Voice, node: Node): number {
    if (!this.arrangement) return 440;
    
    // Get base frequency from scale degree
    let freq = scaleDegreeToFrequency(
      node.deg,
      this.arrangement.tonic,
      this.arrangement.scale,
      4,
      node.octave || 0
    );
    
    // Apply transposition
    if (this.transposition !== 0) {
      freq *= Math.pow(2, this.transposition / 12);
    }
    
    return freq;
  }

  /**
   * Check if currently playing.
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Clean up synth voices.
   */
  private disposeSynthVoices(): void {
    for (const synth of this.synthVoices.values()) {
      synth.dispose();
    }
    this.synthVoices.clear();
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    this.stop();
    this.disposeSynthVoices();
    this.arrangement = null;
  }
}

// Singleton instance
export const playbackEngine = new PlaybackEngine();
