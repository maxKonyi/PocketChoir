/* ============================================================
   PLAYBACK ENGINE
   
   Handles timeline playback, synth scheduling, and synchronization.
   Coordinates between the arrangement data and audio output.
   ============================================================ */

import * as Tone from 'tone';
import { AudioService } from './AudioService';
import { SynthVoice, createSynthVoice } from './SynthVoice';
import type { Arrangement, Voice, Node, TimeSignature } from '../types';
import { scaleDegreeToFrequency } from '../utils/music';
import { t16ToMs, sixteenthDurationMs, arrangementTotalSixteenths } from '../utils/timing';
import { MicrophoneService } from './MicrophoneService';

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
  onPositionUpdate?: (t16: number, ms: number) => void;
  onLoop?: () => void;
  onCountIn?: (beat: number, total: number) => void;
  onStart?: () => void;
  metronomeEnabled?: boolean;
}

/**
 * PlaybackEngine manages the timeline and synth voices for an arrangement.
 */
export class PlaybackEngine {
  // Current arrangement
  private arrangement: Arrangement | null = null;

  // Synth voices (one per arrangement voice)
  private synthVoices: Map<string, SynthVoice> = new Map();

  // Recorded audio
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private activeAudioSources: Map<string, AudioBufferSourceNode> = new Map();
  private lastBeatClicked: number = -1;

  // Track loop animation frame
  private animationFrameId: number | null = null;

  // Playback state
  private isPlaying: boolean = false;
  private startTime: number = 0;        // AudioContext time when playback started
  private startPosition: number = 0;    // Position in ms when playback started
  private currentPositionMs: number = 0;

  // Mute/solo state per voice (separate for synth and vocal)
  private synthVolumes: Map<string, number> = new Map();
  private synthMuted: Set<string> = new Set();
  private synthSolo: Set<string> = new Set();

  private vocalVolumes: Map<string, number> = new Map();
  private vocalMuted: Set<string> = new Set();
  private vocalSolo: Set<string> = new Set();

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

  // Animation frame for position updates
  // (animationFrameId declared above)

  // Callbacks
  private config: PlaybackConfig = {
    onPositionUpdate: () => { }, // Default no-op
  };

  // Count-in
  private isCountingIn: boolean = false;

  // Recording trigger
  private recordingVoiceId: string | null = null;
  private onRecordingComplete: ((voiceId: string, blob: Blob) => void) | null = null;

  // Vocal Gain Nodes
  private vocalGainNodes: Map<string, GainNode> = new Map();

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

    // Create synth voices and voice gain nodes for each voice in the arrangement
    this.disposeSynthVoices();
    this.vocalGainNodes.clear();

    const ctx = AudioService.getContext();
    arrangement.voices.forEach((voice, index) => {
      const synth = createSynthVoice(voice.id, index);
      if (AudioService.isReady()) {
        synth.initialize();
      }
      this.synthVoices.set(voice.id, synth);

      const gain = ctx.createGain();
      // Connect to global chorus using Tone.connect (supports both native and Tone nodes)
      Tone.connect(gain, AudioService.getChorus());
      this.vocalGainNodes.set(voice.id, gain);

      // Set initial volumes
      this.setVoiceVolume(voice.id, 0.5, 'synth');
      this.setVoiceVolume(voice.id, 0.8, 'vocal');
    });

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
   * Set a recorded audio blob for a voice.
   * Decodes the blob into an AudioBuffer for fast playback.
   */
  async setAudioRecording(voiceId: string, blob: Blob): Promise<void> {
    if (blob.size === 0) {
      this.stopAudioSource(voiceId);
      this.audioBuffers.delete(voiceId);
      return;
    }

    try {
      const buffer = await AudioService.decodeAudioBlob(blob);
      this.audioBuffers.set(voiceId, buffer);
      console.log(`Audio recording loaded for voice ${voiceId}, duration: ${buffer.duration.toFixed(2)}s`);

      // If we're already playing, start this source immediately
      if (this.isPlaying) {
        this.startAudioSource(voiceId, this.getCurrentPositionMs());
      }
    } catch (error) {
      console.error(`Failed to decode audio for voice ${voiceId}:`, error);
    }
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
  setVoiceMuted(voiceId: string, muted: boolean, part: 'synth' | 'vocal' = 'synth'): void {
    const set = part === 'synth' ? this.synthMuted : this.vocalMuted;
    if (muted) {
      set.add(voiceId);
    } else {
      set.delete(voiceId);
    }
    this.updateAllVoiceVolumes();
  }

  /**
   * Set solo state for a voice.
   */
  setVoiceSolo(voiceId: string, solo: boolean, part: 'synth' | 'vocal' = 'synth'): void {
    const set = part === 'synth' ? this.synthSolo : this.vocalSolo;
    if (solo) {
      set.add(voiceId);
    } else {
      set.delete(voiceId);
    }
    this.updateAllVoiceVolumes();
  }

  /**
   * Set volume for a voice's synth or recording.
   */
  setVoiceVolume(voiceId: string, volume: number, part: 'synth' | 'vocal' = 'synth'): void {
    const map = part === 'synth' ? this.synthVolumes : this.vocalVolumes;
    map.set(voiceId, volume);
    this.updateVoiceVolume(voiceId, part);
  }

  /**
   * Internal helper to sync gain nodes with current mute/solo/volume state.
   */
  private updateVoiceVolume(voiceId: string, part?: 'synth' | 'vocal'): void {
    // If part is specified, only update that part. Otherwise update both.

    if (!part || part === 'synth') {
      const baseVolume = this.synthVolumes.get(voiceId) ?? 0.5;
      const isAudible = this.isSynthAudible(voiceId);
      const targetVolume = isAudible ? baseVolume : 0;

      const synth = this.synthVoices.get(voiceId);
      if (synth) {
        synth.setVolume(targetVolume);
      }
    }

    if (!part || part === 'vocal') {
      const baseVolume = this.vocalVolumes.get(voiceId) ?? 0.8;
      const isAudible = this.isVocalAudible(voiceId);
      const targetVolume = isAudible ? baseVolume : 0;

      const vocalGain = this.vocalGainNodes.get(voiceId);
      if (vocalGain) {
        const ctx = AudioService.getContext();
        vocalGain.gain.setTargetAtTime(targetVolume, ctx.currentTime, 0.05);
      }

      // If vocal audibility changed during playback, we might need to start/stop the source
      // (Simplified: startAudioSource handles start, stopAudioSource handles stop)
      if (this.isPlaying) {
        const source = this.activeAudioSources.get(voiceId);
        if (isAudible && !source) {
          this.startAudioSource(voiceId, this.getCurrentPositionMs());
        } else if (!isAudible && source) {
          this.stopAudioSource(voiceId);
        }
      }
    }
  }

  private updateAllVoiceVolumes(): void {
    if (!this.arrangement) return;
    this.arrangement.voices.forEach(voice => {
      this.updateVoiceVolume(voice.id);
    });
  }

  /**
   * Cancel any active count-in.
   */
  cancelCountIn(): void {
    this.isCountingIn = false;
    this.recordingVoiceId = null;
  }

  /**
   * Start recording a vocal part synchronized with playback.
   */
  startRecordingVocal(voiceId: string, onComplete: (voiceId: string, blob: Blob) => void): void {
    this.recordingVoiceId = voiceId;
    this.onRecordingComplete = onComplete;
  }

  /**
   * Check if a synth should be audible (considering synth mute/solo).
   */
  private isSynthAudible(voiceId: string): boolean {
    const isAnySoloActive = this.synthSolo.size > 0 || this.vocalSolo.size > 0;

    if (isAnySoloActive) {
      // If ANY solo is active (vocal or synth), only play if THIS synth is soloed
      return this.synthSolo.has(voiceId);
    }
    // No solos active, check mute
    return !this.synthMuted.has(voiceId);
  }

  /**
   * Check if a recording should be audible (considering vocal mute/solo).
   */
  private isVocalAudible(voiceId: string): boolean {
    const isAnySoloActive = this.synthSolo.size > 0 || this.vocalSolo.size > 0;

    if (isAnySoloActive) {
      // If ANY solo is active (vocal or synth), only play if THIS vocal is soloed
      return this.vocalSolo.has(voiceId);
    }
    // No solos active, check mute
    return !this.vocalMuted.has(voiceId);
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
      const completed = await this.performCountIn(countInBars);
      if (!completed) {
        this.isPlaying = false;
        this.isCountingIn = false;
        return;
      }
    }

    this.isPlaying = true;
    this.startTime = AudioService.getCurrentTime();
    this.startPosition = this.currentPositionMs;

    // Start the update loop
    this.startUpdateLoop();

    // Start audio recordings
    this.startAudioSources(this.currentPositionMs);

    // Schedule initial synth notes
    this.scheduleNotesFromPosition(this.getCurrentPositionT16());

    // Trigger start callback
    if (this.config.onStart) {
      this.config.onStart();
    }

    // Start recording if armed
    if (this.recordingVoiceId && this.onRecordingComplete) {
      const vid = this.recordingVoiceId;
      const callback = this.onRecordingComplete;
      MicrophoneService.startRecording((blob: Blob) => {
        callback(vid, blob);
      });
      // Clear trigger so it doesn't double-start on loop (loop is handled by hook)
      this.recordingVoiceId = null;
    }
  }

  /**
   * Perform a count-in before playback.
   */
  private async performCountIn(bars: number): Promise<boolean> {
    this.isCountingIn = true;
    const ctx = AudioService.getContext();
    const effectiveTempo = this.baseTempo * this.tempoMultiplier;
    const beatDurationMs = 60000 / effectiveTempo;
    const totalBeats = bars * this.timeSig.numerator;

    for (let beat = 0; beat < totalBeats; beat++) {
      if (!this.isCountingIn) return false; // Cancelled

      // Play click sound
      this.playClickSound(ctx.currentTime);

      // Callback for visual count-in
      if (this.config.onCountIn) {
        this.config.onCountIn(beat + 1, totalBeats);
      }

      // Wait for next beat
      await new Promise(resolve => setTimeout(resolve, beatDurationMs));
    }

    const wasCancelled = !this.isCountingIn;
    this.isCountingIn = false;
    return !wasCancelled;
  }

  /**
   * Check if currently in count-in phase.
   */
  getIsCountingIn(): boolean {
    return this.isCountingIn;
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

    // Stop all audio recordings
    this.stopAudioSources();
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
   * Start playback of all relevant recorded audio buffers.
   */
  private startAudioSources(fromMs: number): void {
    for (const voiceId of this.audioBuffers.keys()) {
      this.startAudioSource(voiceId, fromMs);
    }
  }

  /**
   * Start playback of a single recorded audio buffer.
   */
  private startAudioSource(voiceId: string, fromMs: number): void {
    const buffer = this.audioBuffers.get(voiceId);
    if (!buffer || !this.isVocalAudible(voiceId)) return;

    const ctx = AudioService.getContext();
    const currentTime = ctx.currentTime;
    const offset = fromMs / 1000;

    // Stop existing if any
    this.stopAudioSource(voiceId);

    // Only play if the offset is within the buffer duration
    if (offset < buffer.duration) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;

      // Connect to the per-voice gain node
      const gainNode = this.vocalGainNodes.get(voiceId);
      if (gainNode) {
        source.connect(gainNode);
      } else {
        // Fallback to master if gain node missing
        source.connect(AudioService.getMasterGain());
      }

      source.start(currentTime, offset);
      this.activeAudioSources.set(voiceId, source);
    }
  }

  /**
   * Stop all active audio sources.
   */
  private stopAudioSources(): void {
    for (const voiceId of this.activeAudioSources.keys()) {
      this.stopAudioSource(voiceId);
    }
  }

  /**
   * Stop a specific audio source.
   */
  private stopAudioSource(voiceId: string): void {
    const source = this.activeAudioSources.get(voiceId);
    if (source) {
      try {
        source.stop();
      } catch (e) {
        // Source might have already ended or not started
      }
      source.disconnect();
      this.activeAudioSources.delete(voiceId);
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

      // Metronome click logic
      if (this.config.metronomeEnabled) {
        const beatDuration = 60000 / this.getEffectiveTempo();
        const beats = currentMs / beatDuration;
        const currentBeat = Math.floor(beats);

        if (this.lastBeatClicked !== currentBeat) {
          // Play click sound on the beat
          this.playClickSound(AudioService.getContext().currentTime);
          this.lastBeatClicked = currentBeat;
        }
      } else {
        this.lastBeatClicked = -1; // Reset when disabled
      }

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

        // Loop audio recordings
        this.stopAudioSources();
        this.startAudioSources(loopStartMs);

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
      const synthAudible = this.isSynthAudible(voice.id);
      if (!synthAudible) continue;

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

      const audible = this.isSynthAudible(voice.id);

      // Find which node we should be playing
      let activeNode: Node | null = null;

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
  private getNodeFrequency(_voice: Voice, node: Node): number {
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
