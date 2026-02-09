/* ============================================================
   PLAYBACK ENGINE
   
   Handles timeline playback, synth scheduling, and synchronization.
   Coordinates between the arrangement data and audio output.
   ============================================================ */

import * as Tone from 'tone';
import { AudioService } from './AudioService';
import { SynthVoice, createSynthVoice } from './SynthVoice';
import type { Arrangement, Voice, Node, TimeSignature } from '../types';
import { midiToFrequency, noteNameToMidi, scaleDegreeToFrequency } from '../utils/music';
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
  // Positive values make recordings play earlier (skip initial input latency).
  recordingLagMs?: number;
}

/**
 * PlaybackEngine manages the timeline and synth voices for an arrangement.
 */
export class PlaybackEngine {
  // Current arrangement
  private arrangement: Arrangement | null = null;

  // Synth voices (one per arrangement voice)
  private synthVoices: Map<string, SynthVoice> = new Map();

  // Separate synth voices used only for Create-mode preview/auditioning.
  // This avoids fighting the normal playback scheduler.
  private previewSynthVoices: Map<string, SynthVoice> = new Map();

  // Recorded audio
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private activeAudioSources: Map<string, AudioBufferSourceNode> = new Map();
  // We schedule clicks ahead of time so they land exactly on the beat.
  private nextMetronomeBeatToSchedule: number = 0;

  // Track loop animation frame
  private animationFrameId: number | null = null;

  // Playback state
  private isPlaying: boolean = false;
  private startTime: number = 0;        // AudioContext time when playback started
  private startPosition: number = 0;    // Position in ms when playback started
  private currentPositionMs: number = 0;

  // Scheduling (for tight sync)
  // We schedule a short time window ahead of the playhead so audio events fire
  // exactly on time, instead of being delayed until the next animation frame.
  private readonly scheduleLookaheadMs: number = 150;

  // For each voice, track which node index we should schedule next.
  private nextNodeIndexToSchedule: Map<string, number> = new Map();

  // For each voice, track the last scheduled state so we can decide between
  // starting a note (attack) vs gliding an already-playing note.
  private scheduledSynthIsPlaying: Map<string, boolean> = new Map();

  // Separate state for Create-mode preview notes.
  // We keep this independent from timeline scheduling so auditioning doesn't
  // interfere with playback.
  private previewSynthIsPlaying: Map<string, boolean> = new Map();

  // Create-mode preview behavior tuning.
  private readonly previewMinDurationMs: number = 90;
  private readonly previewReleaseMs: number = 35;

  // When you preview while playback is running, we temporarily override the synth.
  // On release, we restore the synth to whatever pitch the playhead is currently on.
  private previewOverrideUntilMs: Map<string, number> = new Map();

  // Mute/solo state per voice (separate for synth and vocal)
  private synthVolumes: Map<string, number> = new Map();
  private synthMuted: Set<string> = new Set();
  private synthSolo: Set<string> = new Set();

  private vocalVolumes: Map<string, number> = new Map();
  private vocalMuted: Set<string> = new Set();
  private vocalSolo: Set<string> = new Set();

  // Short fade used whenever recorded audio starts/stops abruptly.
  // This helps prevent clicks.
  private readonly recordingFadeSeconds: number = 0.015;

  // Short fade used for transport start/stop/pause to prevent clicks.
  private readonly transportFadeSeconds: number = 0.02;

  // Used to prevent re-scheduling loop boundary fades multiple times per loop.
  private lastLoopBoundaryFadeLoopCount: number = -1;

  // Per-voice pan (stereo position) for each part.
  // We keep vocal panners as native WebAudio nodes because recorded audio uses WebAudio.
  private vocalPannerNodes: Map<string, StereoPannerNode> = new Map();

  // Loop settings
  private loopEnabled: boolean = true;
  private loopStartT16: number = 0;
  private loopEndT16: number = 64;

  // World time tracking: counts how many complete loops have occurred.
  // Used by follow-mode to compute a monotonically increasing world position
  // (worldT16 = loopCount * loopLengthT16 + currentLoopPositionT16).
  private loopCount: number = 0;

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
    // Selecting/loading a new arrangement should always reset playback state.
    // Otherwise the Play-mode camera (which follows world time) will appear to
    // "stay" at the previous arrangement's position.
    this.stop();
    this.resetLoopCount();
    this.currentPositionMs = 0;
    this.startPosition = 0;
    this.startTime = 0;

    this.arrangement = arrangement;
    this.config = config;
    this.baseTempo = arrangement.tempo;
    this.timeSig = arrangement.timeSig;

    // Set loop end to arrangement length
    this.loopEndT16 = arrangementTotalSixteenths(arrangement.bars, this.timeSig);

    // Create synth voices and voice gain nodes for each voice in the arrangement
    this.disposeSynthVoices();
    this.vocalGainNodes.clear();
    this.vocalPannerNodes.clear();

    const ctx = AudioService.getContext();
    arrangement.voices.forEach((voice, index) => {
      const synth = createSynthVoice(voice.id, index);
      if (AudioService.isReady()) {
        synth.initialize();
      }
      this.synthVoices.set(voice.id, synth);

      const previewSynth = createSynthVoice(`${voice.id}__preview`, index);
      if (AudioService.isReady()) {
        previewSynth.initialize();
      }

      // Make preview note-offs short and clean (reduce clicks).
      previewSynth.setReleaseTime(this.previewReleaseMs / 1000);
      this.previewSynthVoices.set(voice.id, previewSynth);

      const gain = ctx.createGain();

      // Recorded vocal routing:
      // source -> gain (volume/mute/solo) -> stereo panner -> global chorus
      // (Chorus is the shared "mix bus" for everything in the app.)
      const panner = ctx.createStereoPanner();
      gain.connect(panner);

      // Connect to global chorus using Tone.connect (supports both native and Tone nodes)
      Tone.connect(panner, AudioService.getChorus());

      this.vocalPannerNodes.set(voice.id, panner);
      this.vocalGainNodes.set(voice.id, gain);

      // Set initial volumes
      this.setVoiceVolume(voice.id, 0.5, 'synth');
      this.setVoiceVolume(voice.id, 0.8, 'vocal');

      // Reset scheduling state for this voice.
      this.nextNodeIndexToSchedule.set(voice.id, 0);
      this.scheduledSynthIsPlaying.set(voice.id, false);

      // Reset preview state for this voice.
      this.previewSynthIsPlaying.set(voice.id, false);
      this.previewOverrideUntilMs.set(voice.id, 0);
    });

    console.log(`PlaybackEngine initialized with ${arrangement.voices.length} voices`);
  }

  /**
   * Update the arrangement data WITHOUT recreating audio nodes.
   *
   * This is important in Create mode: editing nodes produces a new arrangement
   * object, and we want playback to reflect those edits without restarting.
   */
  updateArrangement(arrangement: Arrangement): void {
    // Update the data reference.
    this.arrangement = arrangement;
    this.baseTempo = arrangement.tempo;
    this.timeSig = arrangement.timeSig;
    this.loopEndT16 = arrangementTotalSixteenths(arrangement.bars, this.timeSig);

    // If new voices were added while editing (Create mode), make sure we create
    // the corresponding synth + preview synth voices and routing nodes.
    // `updateArrangement` normally avoids re-initializing the engine so playback
    // doesn't restart, but we still need audio nodes for any new tracks.
    const ctx = AudioService.getContext();
    arrangement.voices.forEach((voice, index) => {
      if (!this.synthVoices.has(voice.id)) {
        const synth = createSynthVoice(voice.id, index);
        if (AudioService.isReady()) {
          synth.initialize();
        }
        this.synthVoices.set(voice.id, synth);

        const previewSynth = createSynthVoice(`${voice.id}__preview`, index);
        if (AudioService.isReady()) {
          previewSynth.initialize();
        }
        previewSynth.setReleaseTime(this.previewReleaseMs / 1000);
        this.previewSynthVoices.set(voice.id, previewSynth);

        const gain = ctx.createGain();
        const panner = ctx.createStereoPanner();
        gain.connect(panner);
        Tone.connect(panner, AudioService.getChorus());

        this.vocalPannerNodes.set(voice.id, panner);
        this.vocalGainNodes.set(voice.id, gain);

        // Ensure default volume/mute/solo/pan maps are applied for the new voice.
        this.setVoiceVolume(voice.id, 0.5, 'synth');
        this.setVoiceVolume(voice.id, 0.8, 'vocal');
        this.setVoiceMuted(voice.id, false, 'synth');
        this.setVoiceMuted(voice.id, false, 'vocal');
        this.setVoiceSolo(voice.id, false, 'synth');
        this.setVoiceSolo(voice.id, false, 'vocal');

        this.nextNodeIndexToSchedule.set(voice.id, 0);
        this.scheduledSynthIsPlaying.set(voice.id, false);
        this.previewSynthIsPlaying.set(voice.id, false);
        this.previewOverrideUntilMs.set(voice.id, 0);
      }
    });

    // Ensure loop end is valid.
    if (this.loopEndT16 <= this.loopStartT16) {
      this.loopStartT16 = 0;
      this.loopEndT16 = this.loopEndT16;
    }

    // If we are currently playing, refresh scheduling markers from the current playhead.
    // IMPORTANT: Do NOT call `primeSynthSchedulingFromPosition()` here.
    // That method schedules "held" notes at `this.startTime` (playback start) and can
    // reset indices in a way that replays from the beginning, which feels like the
    // playhead jumped backwards.
    if (this.isPlaying) {
      const fromT16 = this.getCurrentPositionT16();

      for (const voice of arrangement.voices) {
        const synth = this.synthVoices.get(voice.id);
        if (!synth) continue;

        const nodeIndex = this.findNodeAtOrAfter(voice.nodes, fromT16);
        const nextIndex = nodeIndex < 0 ? voice.nodes.length : nodeIndex;
        this.nextNodeIndexToSchedule.set(voice.id, nextIndex);

        // If a preview is currently overriding this voice, don't fight it.
        const isPreviewing = this.previewSynthIsPlaying.get(voice.id) ?? false;
        if (isPreviewing) continue;

        // Ensure the synth is in a sensible state at the playhead.
        // Find the most recent node at or before the playhead.
        let activeNode: Node | null = null;
        for (const node of voice.nodes) {
          if (node.t16 <= fromT16) activeNode = node;
          else break;
        }

        if (!activeNode || activeNode.term || !this.isSynthAudible(voice.id)) {
          synth.noteOff();
          this.scheduledSynthIsPlaying.set(voice.id, false);
          continue;
        }

        const freq = this.getNodeFrequency(voice, activeNode);
        if (synth.getIsPlaying()) {
          synth.glideTo(freq);
          this.scheduledSynthIsPlaying.set(voice.id, true);
        } else {
          synth.noteOn(freq);
          this.scheduledSynthIsPlaying.set(voice.id, true);
        }
      }

      // Now schedule upcoming events from the current playhead.
      this.scheduleAheadFromCurrentPosition();
    }
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
   * Apply a short fade-out to the last few milliseconds of an AudioBuffer.
   * This modifies the actual sample data so the audio can never pop/click
   * when it stops — whether at a loop boundary, auto-stop, or manual stop.
   */
  private applyTailFade(buffer: AudioBuffer, fadeSeconds: number = 0.015): void {
    const fadeSamples = Math.min(
      Math.floor(fadeSeconds * buffer.sampleRate),
      buffer.length
    );
    if (fadeSamples <= 0) return;

    // Apply a linear fade-out to the last `fadeSamples` of every channel.
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      const startIndex = data.length - fadeSamples;
      for (let i = 0; i < fadeSamples; i++) {
        // Linear ramp from 1.0 down to 0.0
        data[startIndex + i] *= 1 - (i / fadeSamples);
      }
    }
  }

  /**
   * Set a recorded audio blob for a voice.
   * Decodes the blob into an AudioBuffer for fast playback.
   * Automatically applies a tail fade to prevent pops at the end.
   */
  async setAudioRecording(voiceId: string, blob: Blob): Promise<void> {
    if (blob.size === 0) {
      // Clearing a recording can happen while audio is playing (ex: overwrite take).
      // Fade out briefly to avoid an abrupt stop click.
      this.stopAudioSourceWithFade(voiceId, this.recordingFadeSeconds);
      this.audioBuffers.delete(voiceId);
      return;
    }

    try {
      const buffer = await AudioService.decodeAudioBlob(blob);

      // Apply a fade-out to the very end of the buffer so it never pops
      // when playback reaches the last sample (loop boundary, auto-stop, etc.).
      this.applyTailFade(buffer, this.recordingFadeSeconds);

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
   * Set pan for a voice's synth or vocal track.
   * @param pan - Stereo pan (-1 = left, 0 = center, 1 = right)
   */
  setVoicePan(voiceId: string, pan: number, part: 'synth' | 'vocal' = 'synth'): void {
    const clamped = Math.max(-1, Math.min(1, pan));

    if (part === 'synth') {
      const synth = this.synthVoices.get(voiceId);
      if (synth) {
        synth.setPan(clamped);
      }

      // Keep preview synth panning consistent.
      const previewSynth = this.previewSynthVoices.get(voiceId);
      if (previewSynth) {
        previewSynth.setPan(clamped);
      }
      return;
    }

    const panner = this.vocalPannerNodes.get(voiceId);
    if (!panner) return;

    const ctx = AudioService.getContext();
    panner.pan.setTargetAtTime(clamped, ctx.currentTime, 0.05);
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

      const previewSynth = this.previewSynthVoices.get(voiceId);
      if (previewSynth) {
        previewSynth.setVolume(targetVolume);
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
          // Fade out briefly before stopping the buffer source to reduce clicks.
          this.stopAudioSourceWithFade(voiceId, this.recordingFadeSeconds);
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
    // Clear the pending recording trigger so a subsequent play() doesn't
    // accidentally start a microphone recording from a stale request.
    this.recordingVoiceId = null;
    this.onRecordingComplete = null;
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
    // SOLO RULE (global):
    // If ANY solo is active anywhere (SYN or VOX), then ONLY synth tracks whose
    // synth-solo button is enabled are audible.
    // Example: if you solo a VOX track, all SYN tracks mute unless they are also soloed.
    const anySoloActive = this.synthSolo.size > 0 || this.vocalSolo.size > 0;
    if (anySoloActive) {
      return this.synthSolo.has(voiceId);
    }

    // Otherwise (no solos active), normal mute rules apply.
    return !this.synthMuted.has(voiceId);
  }

  /**
   * Check if a recording should be audible (considering vocal mute/solo).
   */
  private isVocalAudible(voiceId: string): boolean {
    // SOLO RULE (global):
    // If ANY solo is active anywhere (SYN or VOX), then ONLY vocal tracks whose
    // vocal-solo button is enabled are audible.
    // Example: if you solo a SYN track, all VOX tracks mute unless they are also soloed.
    const anySoloActive = this.synthSolo.size > 0 || this.vocalSolo.size > 0;
    if (anySoloActive) {
      return this.vocalSolo.has(voiceId);
    }

    // Otherwise (no solos active), normal mute rules apply.
    return !this.vocalMuted.has(voiceId);
  }

  /**
   * Compute a frequency for a (deg/octave) OR a chromatic semitone override.
   */
  private getPreviewFrequency(deg: number, octaveOffset: number, semi?: number): number {
    if (!this.arrangement) return 440;

    // If `semi` is provided, it is an absolute chromatic semitone offset from tonic.
    if (semi !== undefined) {
      const tonicMidi = noteNameToMidi(`${this.arrangement.tonic}4`) || 60;
      const effectiveTonicMidi = tonicMidi + (this.transposition || 0);
      return midiToFrequency(effectiveTonicMidi + semi);
    }

    let freq = scaleDegreeToFrequency(
      deg,
      this.arrangement.tonic,
      this.arrangement.scale,
      4,
      octaveOffset
    );
    freq = freq * Math.pow(2, this.transposition / 12);
    return freq;
  }

  /**
   * Restore the synth voice to whatever note should currently be sounding
   * at the playhead (if playback is running).
   */
  private restoreVoiceToPlayhead(voiceId: string): void {
    if (!this.arrangement) return;

    const synth = this.synthVoices.get(voiceId);
    if (!synth) return;

    // If playback isn't running, restoring just means silence.
    if (!this.isPlaying) {
      synth.noteOff();
      return;
    }

    const voice = this.arrangement.voices.find(v => v.id === voiceId);
    if (!voice) {
      synth.noteOff();
      return;
    }

    const t16 = this.getCurrentPositionT16();

    // Find the most recent node at or before the playhead.
    // If it's a termination node, the correct state is silence.
    let activeNode: Node | null = null;
    for (const node of voice.nodes) {
      if (node.t16 <= t16) activeNode = node;
      else break;
    }

    if (!activeNode || activeNode.term) {
      synth.noteOff();
      return;
    }

    const freq = this.getPreviewFrequency(activeNode.deg ?? 0, activeNode.octave || 0, activeNode.semi);

    // If already playing, glide; otherwise attack.
    if (synth.getIsPlaying()) {
      synth.glideTo(freq);
    } else {
      synth.noteOn(freq);
    }
  }

  /**
   * Preview (audition) a single synth note for Create mode.
   * These helpers are intended for mouse-down / drag / mouse-up interactions.
   */
  previewSynthAttack(voiceId: string, deg: number, octaveOffset: number = 0, semi?: number): void {
    if (!this.arrangement) return;
    if (!AudioService.isReady()) return;
    if (this.isCountingIn) return;
    if (!this.isSynthAudible(voiceId)) return;

    const previewSynth = this.previewSynthVoices.get(voiceId);
    if (!previewSynth) return;

    // While previewing during playback, mute the scheduled playback synth for this voice.
    // This makes preview feel like a true temporary override.
    if (this.isPlaying) {
      const synth = this.synthVoices.get(voiceId);
      synth?.setVolume(0);
    }

    // Ensure the audio context is running (safe to call inside a user gesture).
    void AudioService.resume();

    // Preview auditioning should be audible even when transport playback is stopped.
    // stop()/pause() fade the shared transport gain to 0 to prevent clicks.
    // play() fades it back up, but preview notes can happen while not playing.
    AudioService.fadeTransportGain(1, this.transportFadeSeconds);

    const freq = this.getPreviewFrequency(deg, octaveOffset, semi);
    previewSynth.noteOn(freq);

    const nowMs = window.performance.now();
    this.previewSynthIsPlaying.set(voiceId, true);
    this.previewOverrideUntilMs.set(voiceId, nowMs + this.previewMinDurationMs);
  }

  previewSynthGlide(voiceId: string, deg: number, octaveOffset: number = 0, semi?: number): void {
    if (!this.arrangement) return;
    if (!AudioService.isReady()) return;
    if (this.isCountingIn) return;
    if (!this.isSynthAudible(voiceId)) return;

    const previewSynth = this.previewSynthVoices.get(voiceId);
    if (!previewSynth) return;

    // While previewing during playback, mute the scheduled playback synth for this voice.
    if (this.isPlaying) {
      const synth = this.synthVoices.get(voiceId);
      synth?.setVolume(0);
    }

    const freq = this.getPreviewFrequency(deg, octaveOffset, semi);

    const wasPlaying = this.previewSynthIsPlaying.get(voiceId) ?? false;
    if (!wasPlaying) {
      // Ensure the shared transport output is audible for preview notes.
      AudioService.fadeTransportGain(1, this.transportFadeSeconds);
      previewSynth.noteOn(freq);
      const nowMs = window.performance.now();
      this.previewSynthIsPlaying.set(voiceId, true);
      this.previewOverrideUntilMs.set(voiceId, nowMs + this.previewMinDurationMs);
      return;
    }

    previewSynth.glideTo(freq);
  }

  previewSynthRelease(voiceId: string): void {
    if (!AudioService.isReady()) return;
    if (this.isCountingIn) return;

    const previewSynth = this.previewSynthVoices.get(voiceId);
    if (!previewSynth) return;

    const wasPlaying = this.previewSynthIsPlaying.get(voiceId) ?? false;
    if (!wasPlaying) return;

    const nowMs = window.performance.now();
    const untilMs = this.previewOverrideUntilMs.get(voiceId) ?? 0;

    const doRelease = () => {
      // Trigger release now; the preview synth has a short envelope release time.
      previewSynth.noteOff();
      this.previewSynthIsPlaying.set(voiceId, false);
      this.previewOverrideUntilMs.set(voiceId, 0);

      // Restore the playback synth volume (in case we muted it while previewing).
      // This also re-applies mute/solo rules.
      this.updateVoiceVolume(voiceId, 'synth');

      // If playback is running, restore the voice to the playhead pitch.
      // This makes previewing feel like a temporary override.
      this.restoreVoiceToPlayhead(voiceId);
    };

    if (nowMs < untilMs) {
      // Ensure a minimum audible note length.
      window.setTimeout(doRelease, Math.max(0, untilMs - nowMs));
      return;
    }

    doRelease();
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

    // Safety: ensure synth volumes are restored before starting playback.
    // Preview auditioning can temporarily set a synth voice volume to 0.
    // If mouse-up is missed for any reason, this prevents "silent" playback.
    this.updateAllVoiceVolumes();

    // Make sure audio context is running
    await AudioService.resume();

    // Fade in the overall transport output so play/count-in doesn't click.
    AudioService.fadeTransportGain(1, this.transportFadeSeconds);

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

    // If starting from position 0 (beginning), reset the world-time loop counter.
    // This ensures worldT starts at 0 for a fresh playback.
    if (this.currentPositionMs <= 0) {
      this.loopCount = 0;
    }

    // Reset metronome scheduling so beat 0 is aligned with the timeline.
    // If we start from the middle, we start scheduling from the *current* beat.
    const beatDurationMs = 60000 / this.getEffectiveTempo();
    this.nextMetronomeBeatToSchedule = Math.floor(this.currentPositionMs / beatDurationMs);

    // Start the update loop
    this.startUpdateLoop();

    // Start audio recordings
    this.startAudioSources(this.currentPositionMs);

    // Schedule initial synth notes and then schedule upcoming changes.
    this.primeSynthSchedulingFromPosition(this.getCurrentPositionT16());
    this.scheduleAheadFromCurrentPosition();

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

    // Metronome should be DRY (excluded from reverb).
    gain.connect(AudioService.getDryGain());

    osc.start(time);
    osc.stop(time + 0.05);

    // IMPORTANT: Disconnect both nodes after the oscillator finishes.
    // Without this, every beat leaks 2 WebAudio nodes into the audio graph.
    // At 120 BPM that's ~240 zombie nodes per minute, which progressively
    // degrades audio thread performance and causes stutter over time.
    osc.onended = () => {
      try { osc.disconnect(); } catch { /* already disconnected */ }
      try { gain.disconnect(); } catch { /* already disconnected */ }
    };
  }

  /**
   * Stop playback.
   */
  stop(): void {
    // Fade out the overall transport output before stopping anything abruptly.
    // This is a safety net against clicks from sudden note/source stops.
    AudioService.fadeTransportGain(0, this.transportFadeSeconds);

    this.isPlaying = false;
    this.isCountingIn = false;

    // Clear any pending recording trigger so a subsequent play() doesn't
    // accidentally start a microphone recording from a stale request.
    // Without this, cancelling a count-in leaves the trigger armed.
    this.recordingVoiceId = null;
    this.onRecordingComplete = null;

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
   * Seek to a world-time position (converts to loop-relative for the engine).
   * Also updates loopCount so worldT stays consistent.
   * @param worldT16 - Monotonic world position in 16th notes (clamped >= 0)
   */
  seekWorld(worldT16: number): void {
    const clamped = Math.max(0, worldT16);
    const loopLength = this.getLoopLengthT16();
    if (loopLength <= 0) {
      this.seek(clamped);
      return;
    }
    // Compute which loop iteration this lands in and the position within the loop.
    const loopsCompleted = Math.floor(clamped / loopLength);
    const positionInLoop = clamped - loopsCompleted * loopLength;
    this.loopCount = loopsCompleted;
    this.seek(this.loopStartT16 + positionInLoop);
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
    // Align recorded audio starts to the same clock as the playhead.
    // If we're playing, compute the exact AudioContext time that corresponds
    // to this timeline position.
    const computedWhen = this.isPlaying ? this.getAudioTimeForTimelineMs(fromMs) : ctx.currentTime;
    // Never schedule in the past (can cause immediate/late starts depending on browser).
    const when = Math.max(ctx.currentTime, computedWhen);
    // Recording lag compensation: recorded audio often starts "late" due to
    // input + encoding latency. We compensate by skipping forward slightly in
    // the buffer so the audible content lands on the beat.
    const lagMs = Math.max(0, this.config.recordingLagMs ?? 0);
    const offset = Math.max(0, (fromMs + lagMs) / 1000);

    // Stop existing if any.
    // We use a very short fade so restarting a source doesn't click.
    this.stopAudioSourceWithFade(voiceId, this.recordingFadeSeconds);

    // Only play if the offset is within the buffer duration
    if (offset < buffer.duration) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;

      // Connect to the per-voice gain node
      const gainNode = this.vocalGainNodes.get(voiceId);
      if (gainNode) {
        // Fade in recorded audio very quickly so the source start doesn't click.
        // We compute the intended target volume the same way as updateVoiceVolume.
        const baseVolume = this.vocalVolumes.get(voiceId) ?? 0.8;
        const targetVolume = this.isVocalAudible(voiceId) ? baseVolume : 0;

        gainNode.gain.cancelScheduledValues(when);
        gainNode.gain.setValueAtTime(0, when);
        gainNode.gain.linearRampToValueAtTime(targetVolume, when + this.recordingFadeSeconds);

        source.connect(gainNode);
      } else {
        // Fallback to master if gain node missing
        source.connect(AudioService.getMasterGain());
      }

      source.start(when, offset);
      this.activeAudioSources.set(voiceId, source);
    }
  }

  /**
   * Stop all active audio sources.
   */
  private stopAudioSources(): void {
    // Copy keys first because we mutate the map while stopping.
    const voiceIds = Array.from(this.activeAudioSources.keys());
    for (const voiceId of voiceIds) {
      this.stopAudioSourceWithFade(voiceId, this.recordingFadeSeconds);
    }
  }

  /**
   * Stop a specific audio source with a short fade-out.
   * This avoids clicks from abruptly stopping an AudioBufferSourceNode.
   */
  private stopAudioSourceWithFade(voiceId: string, fadeSeconds: number): void {
    const source = this.activeAudioSources.get(voiceId);
    if (!source) return;

    const ctx = AudioService.getContext();
    const now = ctx.currentTime;
    const stopAt = now + Math.max(0, fadeSeconds);

    // Remove it immediately so we don't try to stop it twice.
    this.activeAudioSources.delete(voiceId);

    // Fade the per-voice gain to zero quickly.
    const gainNode = this.vocalGainNodes.get(voiceId);
    if (gainNode) {
      const current = gainNode.gain.value;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(current, now);
      gainNode.gain.linearRampToValueAtTime(0, stopAt);
    }

    // Disconnect after the node actually ends.
    source.onended = () => {
      try {
        source.disconnect();
      } catch {
        // Ignore disconnect errors.
      }
    };

    try {
      source.stop(stopAt);
    } catch {
      // If scheduling fails (already stopped), fall back to immediate stop.
      try {
        source.stop();
      } catch {
        // Ignore.
      }
      try {
        source.disconnect();
      } catch {
        // Ignore.
      }
    }
  }

  /**
   * Get effective tempo (base * multiplier).
   */
  private getEffectiveTempo(): number {
    return this.baseTempo * this.tempoMultiplier;
  }

  /**
   * Read the engine's current base tempo (BPM).
   * This is typically set from the arrangement during `initialize()`.
   */
  getBaseTempo(): number {
    return this.baseTempo;
  }

  /**
   * Read the engine's current tempo multiplier (playback speed).
   * This is controlled by `setTempoMultiplier()`.
   */
  getTempoMultiplier(): number {
    return this.tempoMultiplier;
  }

  /**
   * Read the engine's current effective tempo (base * multiplier).
   */
  getEffectiveTempoBpm(): number {
    return this.getEffectiveTempo();
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
   * Get current position in 16th notes (loops back within the arrangement).
   */
  getCurrentPositionT16(): number {
    const ms = this.getCurrentPositionMs();
    const sixteenthMs = sixteenthDurationMs(this.getEffectiveTempo(), this.timeSig);
    return ms / sixteenthMs;
  }

  /**
   * Get the monotonically increasing "world" position in 16th notes.
   * This never resets on loop — it keeps increasing so the follow-mode
   * timeline scrolls seamlessly forward.
   *   worldT16 = loopCount * loopLengthT16 + currentLoopPositionT16
   */
  getWorldPositionT16(): number {
    const loopLengthT16 = this.loopEndT16 - this.loopStartT16;
    const loopPositionT16 = this.getCurrentPositionT16() - this.loopStartT16;
    return this.loopCount * loopLengthT16 + this.loopStartT16 + loopPositionT16;
  }

  /**
   * Get the total length of the loop in 16th notes.
   */
  getLoopLengthT16(): number {
    return this.loopEndT16 - this.loopStartT16;
  }

  /**
   * Get the current loop count (how many full loops have completed).
   */
  getLoopCount(): number {
    return this.loopCount;
  }

  /**
   * Reset the loop counter back to 0 (first repetition).
   * Called before recording starts so the playhead returns to the very
   * beginning of the arrangement, not just the start of a later tile.
   */
  resetLoopCount(): void {
    this.loopCount = 0;
    this.lastLoopBoundaryFadeLoopCount = -1;
  }

  /**
   * Start the animation frame update loop.
   */
  private startUpdateLoop(): void {
    const update = () => {
      if (!this.isPlaying) return;

      const currentMs = this.getCurrentPositionMs();
      const currentT16 = this.getCurrentPositionT16();

      // ── One-shot auto-stop: stop one bar past the loop end ──
      const loopEndMs = t16ToMs(this.loopEndT16, this.getEffectiveTempo(), this.timeSig);
      if (!this.loopEnabled) {
        const oneBarT16 = this.timeSig.numerator * 4;
        const oneShotEndMs = t16ToMs(this.loopEndT16 + oneBarT16, this.getEffectiveTempo(), this.timeSig);
        if (currentMs >= oneShotEndMs) {
          this.stop();
          return;
        }
      }

      // If we're approaching the end of the loop, schedule a quick fade-down of
      // recorded audio right AT the loop boundary. This helps prevent clicks.
      // We only do this once per loop iteration.
      if (this.loopEnabled && this.loopCount !== this.lastLoopBoundaryFadeLoopCount) {
        const msUntilLoopEnd = loopEndMs - currentMs;
        if (msUntilLoopEnd > 0 && msUntilLoopEnd <= 60) {
          const when = this.getAudioTimeForTimelineMs(loopEndMs);
          for (const [voiceId, gainNode] of this.vocalGainNodes.entries()) {
            const baseVolume = this.vocalVolumes.get(voiceId) ?? 0.8;
            const targetVolume = this.isVocalAudible(voiceId) ? baseVolume : 0;

            gainNode.gain.cancelScheduledValues(when);
            gainNode.gain.setValueAtTime(targetVolume, when);
            gainNode.gain.linearRampToValueAtTime(0, when + this.recordingFadeSeconds);
          }

          this.lastLoopBoundaryFadeLoopCount = this.loopCount;
        }
      }

      // Check for loop
      if (this.loopEnabled && currentMs >= loopEndMs) {
        // Loop back to start
        const loopStartMs = t16ToMs(this.loopStartT16, this.getEffectiveTempo(), this.timeSig);
        this.startTime = AudioService.getCurrentTime();
        this.startPosition = loopStartMs;

        // Reset metronome scheduling to match the loop start.
        const beatDurationMs = 60000 / this.getEffectiveTempo();
        this.nextMetronomeBeatToSchedule = Math.floor(loopStartMs / beatDurationMs);

        // Stop all notes and reschedule
        for (const synth of this.synthVoices.values()) {
          synth.noteOff();
        }

        // Loop audio recordings
        // NOTE:
        // We fade out recorded audio before stopping, then restart slightly AFTER
        // the boundary. This avoids clicks when the loop ends exactly on a
        // non-zero sample value.
        this.stopAudioSources();
        const restartDelayMs = Math.max(1, this.recordingFadeSeconds * 1000);
        window.setTimeout(() => {
          // Only restart if we are still playing (user may have stopped during the delay).
          if (!this.isPlaying) return;
          this.startAudioSources(loopStartMs);
        }, restartDelayMs);

        // Increment the world-time loop counter so follow-mode visuals
        // keep scrolling forward instead of jumping back.
        this.loopCount += 1;

        // Allow the next loop iteration to schedule its own loop-end fade.
        // (We only schedule the fade when we're close to the loop end, so resetting
        // this here is safe and prevents "only the first loop fades" bugs.)
        this.lastLoopBoundaryFadeLoopCount = -1;

        // Re-prime and schedule notes from the loop start.
        this.primeSynthSchedulingFromPosition(this.loopStartT16);

        // Do not schedule until after we've updated all loop state.
        // (Prevents doubled downbeat clicks when a "pre-loop" schedule and a
        // "post-loop" schedule both include beat 0.)

        if (this.config.onLoop) {
          this.config.onLoop();
        }
      }

      // Schedule upcoming metronome clicks and note changes.
      // This must happen AFTER loop handling so we don't schedule overlapping
      // clicks at the loop boundary.
      this.scheduleAheadFromCurrentPosition();

      // Position update callback
      if (this.config.onPositionUpdate) {
        this.config.onPositionUpdate(currentT16, currentMs);
      }

      // Continue loop
      this.animationFrameId = requestAnimationFrame(update);
    };

    this.animationFrameId = requestAnimationFrame(update);
  }

  /**
   * Convert a timeline position in ms to the exact AudioContext time when that
   * position should occur.
   */
  private getAudioTimeForTimelineMs(timelineMs: number): number {
    // startTime is the AudioContext time at which startPosition (timeline ms)
    // occurred.
    return this.startTime + (timelineMs - this.startPosition) / 1000;
  }

  /**
   * Determine which synth notes should already be sounding at a given timeline
   * position, and schedule them to start exactly at the playback start time.
   */
  private primeSynthSchedulingFromPosition(fromT16: number): void {
    if (!this.arrangement) return;

    for (const voice of this.arrangement.voices) {
      const synth = this.synthVoices.get(voice.id);
      if (!synth) continue;

      // Reset per-voice scheduling markers.
      this.scheduledSynthIsPlaying.set(voice.id, false);

      // Find the first node at/after the current position.
      const nodeIndex = this.findNodeAtOrAfter(voice.nodes, fromT16);
      this.nextNodeIndexToSchedule.set(voice.id, Math.max(0, nodeIndex));

      // If we're already inside a held note (previous node spans over fromT16),
      // schedule that note to start exactly at the current startTime.
      const prevIndex = nodeIndex > 0 ? nodeIndex - 1 : -1;
      if (prevIndex >= 0) {
        const prevNode = voice.nodes[prevIndex];
        const currentNode = voice.nodes[nodeIndex];

        if (!prevNode.term && prevNode.t16 <= fromT16 && currentNode.t16 > fromT16) {
          if (this.isSynthAudible(voice.id)) {
            const freq = this.getNodeFrequency(voice, prevNode);
            synth.noteOn(freq, this.startTime);
            this.scheduledSynthIsPlaying.set(voice.id, true);
          }
        }
      }
    }
  }

  /**
   * Schedule metronome clicks + synth node changes a short time ahead of the
   * playhead so they fire exactly on time.
   */
  private scheduleAheadFromCurrentPosition(): void {
    if (!this.arrangement) return;

    const currentMs = this.getCurrentPositionMs();
    let lookaheadUntilMs = currentMs + this.scheduleLookaheadMs;

    // If looping is enabled and we're close to the loop end, do NOT schedule
    // events that land exactly on/after the loop boundary.
    // Those events will be scheduled after the loop reset, and scheduling them
    // both before and after the reset causes a doubled downbeat click.
    if (this.loopEnabled) {
      const loopEndMs = t16ToMs(this.loopEndT16, this.getEffectiveTempo(), this.timeSig);
      if (currentMs < loopEndMs && lookaheadUntilMs >= loopEndMs) {
        // Use a small safety margin because floating point rounding can cause
        // a "loop end" beat to land a hair before loopEndMs.
        lookaheadUntilMs = Math.max(currentMs, loopEndMs - 5);
      }
    }

    // 1) Metronome: schedule each beat click at its exact AudioContext time.
    if (this.config.metronomeEnabled) {
      const beatDurationMs = 60000 / this.getEffectiveTempo();

      while ((this.nextMetronomeBeatToSchedule * beatDurationMs) <= lookaheadUntilMs) {
        const beatMs = this.nextMetronomeBeatToSchedule * beatDurationMs;

        // Only schedule future (or "now") clicks. If we've fallen behind,
        // advance without trying to schedule in the past.
        if (beatMs >= currentMs - 1) {
          const ctxTime = AudioService.getCurrentTime();
          const clickTime = Math.max(ctxTime, this.getAudioTimeForTimelineMs(beatMs));
          this.playClickSound(clickTime);
        }

        this.nextMetronomeBeatToSchedule += 1;
      }
    } else {
      // Keep the next beat marker consistent with the current playhead.
      const beatDurationMs = 60000 / this.getEffectiveTempo();
      this.nextMetronomeBeatToSchedule = Math.floor(currentMs / beatDurationMs);
    }

    // 2) Synth notes: schedule node events (attack / glide / release) ahead of time.
    const lookaheadUntilT16 = this.msToT16(lookaheadUntilMs);

    for (const voice of this.arrangement.voices) {
      const synth = this.synthVoices.get(voice.id);
      if (!synth) continue;

      // If this synth is muted/unsoloed, don't schedule any future events.
      if (!this.isSynthAudible(voice.id)) continue;

      let nextIndex = this.nextNodeIndexToSchedule.get(voice.id) ?? 0;
      let isPlaying = this.scheduledSynthIsPlaying.get(voice.id) ?? false;

      while (nextIndex >= 0 && nextIndex < voice.nodes.length) {
        const node = voice.nodes[nextIndex];

        if (node.t16 > lookaheadUntilT16) {
          break;
        }

        // Convert the node's musical time to an exact AudioContext time.
        const nodeMs = this.t16ToTimelineMs(node.t16);
        const eventTime = this.getAudioTimeForTimelineMs(nodeMs);

        if (node.term) {
          // Termination node means silence.
          synth.noteOff(eventTime);
          isPlaying = false;
        } else {
          const freq = this.getNodeFrequency(voice, node);

          if (!isPlaying) {
            synth.noteOn(freq, eventTime);
            isPlaying = true;
          } else {
            // Already sounding: glide to the new pitch instead of re-attacking.
            synth.glideTo(freq, 0.05, eventTime);
          }
        }

        nextIndex += 1;
      }

      this.nextNodeIndexToSchedule.set(voice.id, nextIndex);
      this.scheduledSynthIsPlaying.set(voice.id, isPlaying);
    }
  }

  /**
   * Convert t16 -> timeline ms using the current tempo/time signature.
   */
  private t16ToTimelineMs(t16: number): number {
    return t16ToMs(t16, this.getEffectiveTempo(), this.timeSig);
  }

  /**
   * Convert timeline ms -> t16 using the current tempo/time signature.
   */
  private msToT16(ms: number): number {
    const sixteenthMs = sixteenthDurationMs(this.getEffectiveTempo(), this.timeSig);
    return ms / sixteenthMs;
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
   * Get the frequency for a node, considering transposition.
   */
  private getNodeFrequency(_voice: Voice, node: Node): number {
    if (!this.arrangement) return 440;

    // If the node provides a chromatic semitone offset, use it directly.
    if (node.semi !== undefined) {
      const tonicMidi = noteNameToMidi(`${this.arrangement.tonic}4`) || 60;
      const effectiveTonicMidi = tonicMidi + (this.transposition || 0);
      return midiToFrequency(effectiveTonicMidi + node.semi);
    }

    // Otherwise use scale-degree mapping.
    let freq = scaleDegreeToFrequency(
      node.deg ?? 0,
      this.arrangement.tonic,
      this.arrangement.scale,
      4,
      node.octave || 0
    );

    // Apply transposition as a frequency ratio.
    freq = freq * Math.pow(2, this.transposition / 12);
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

    for (const synth of this.previewSynthVoices.values()) {
      synth.dispose();
    }
    this.previewSynthVoices.clear();
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

// Shared singleton instance used throughout the app.
// This keeps playback state consistent between the Grid, Transport, and recording.
export const playbackEngine = new PlaybackEngine();
