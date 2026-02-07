import * as Tone from 'tone';

/**
 * Singleton service for managing the Web Audio API context and routing.
 * All audio in the app flows through this service.
 */
class AudioServiceClass {
  // The main Web Audio context - all audio operations use this
  private context: AudioContext | null = null;

  // Master gain node - controls overall volume
  private masterGain: GainNode | null = null;

  // Transport gain node - used for very short fades when starting/stopping/pausing.
  // This prevents clicks without changing the user's master volume setting.
  private transportGain: GainNode | null = null;

  // Reverb effect using Tone.Reverb (matches choir_ref behavior)
  private reverbNode: Tone.Reverb | null = null;
  private reverbGain: GainNode | null = null;  // Wet signal level
  private dryGain: GainNode | null = null;     // Dry signal level

  // Track whether audio context has been started (requires user gesture)
  private isStarted = false;

  // Global Chorus effect from choir_ref
  private globalChorus: Tone.Chorus | null = null;

  /**
   * Initialize the audio context. Must be called after a user gesture.
   * @returns Promise that resolves when audio is ready
   */
  async initialize(): Promise<void> {
    // Don't re-initialize if already set up
    if (this.context && this.isStarted) {
      return;
    }

    // Create the audio context
    this.context = new AudioContext();

    // Create the master gain node (controls overall volume)
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 0.8; // Default to 80% volume

    // Create a dedicated transport gain stage after the master gain.
    // We keep this at 1.0 most of the time, and only use it for very short fades.
    this.transportGain = this.context.createGain();
    this.transportGain.gain.value = 1.0;

    this.masterGain.connect(this.transportGain);
    this.transportGain.connect(this.context.destination);

    // Create dry/wet routing for reverb effect
    this.dryGain = this.context.createGain();
    this.dryGain.gain.value = 1.0;
    this.dryGain.connect(this.masterGain);

    this.reverbGain = this.context.createGain();
    this.reverbGain.gain.value = 0.4; // Default reverb level (matches choir_ref wet ≈ 0.40)
    this.reverbGain.connect(this.masterGain);

    // Initialize Tone.js with this context
    await Tone.setContext(this.context);

    // Create Tone reverb node.
    // IMPORTANT: We keep wet=1.0 on the effect itself and control overall reverb
    // amount using `reverbGain`, so this acts like a global reverb send.
    this.reverbNode = new Tone.Reverb({
      decay: 2.9,
      preDelay: 0.01,
      wet: 1.0,
    });

    // Create global Chorus from choir_ref
    this.globalChorus = new Tone.Chorus({
      frequency: 0.1,
      delayTime: 10,
      depth: 0.71,
      feedback: 0.47,
      spread: 181,
      wet: 0.04
    }).start();

    // Route the shared mix bus through a dry path + a reverb send.
    // Dry is always full-strength (dryGain = 1.0). Wet level is controlled by reverbGain.
    this.globalChorus.connect(this.dryGain);
    // Tone nodes should connect to Tone nodes; use Tone.connect so this works
    // even though `reverbGain` is a native WebAudio GainNode.
    this.globalChorus.connect(this.reverbNode);
    Tone.connect(this.reverbNode, this.reverbGain);

    // Tone.Reverb needs to generate its internal impulse response.
    await this.reverbNode.generate();

    // Resume context if it's suspended (browser autoplay policy)
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    this.isStarted = true;
    console.log('AudioService initialized with Tone.js and global Chorus');
  }

  /**
   * Get the audio context. Throws if not initialized.
   */
  getContext(): AudioContext {
    if (!this.context) {
      throw new Error('AudioService not initialized. Call initialize() first.');
    }
    return this.context;
  }

  /**
   * Get the master gain node for connecting audio sources.
   */
  getMasterGain(): GainNode {
    if (!this.masterGain) {
      throw new Error('AudioService not initialized. Call initialize() first.');
    }
    return this.masterGain;
  }

  /**
   * Get the transport gain node.
   * This should only be used for short fades (play/pause/stop) to prevent clicks.
   */
  getTransportGain(): GainNode {
    if (!this.transportGain) {
      throw new Error('AudioService not initialized. Call initialize() first.');
    }
    return this.transportGain;
  }

  /**
   * Fade the transport gain to a target value over a short duration.
   * This is used to prevent audible clicks when audio starts/stops abruptly.
   */
  fadeTransportGain(target: number, seconds: number): void {
    if (!this.transportGain || !this.context) return;

    const clampedTarget = Math.max(0, Math.min(1, target));
    const dur = Math.max(0, seconds);
    const now = this.context.currentTime;

    this.transportGain.gain.cancelScheduledValues(now);
    this.transportGain.gain.setValueAtTime(this.transportGain.gain.value, now);
    this.transportGain.gain.linearRampToValueAtTime(clampedTarget, now + dur);
  }

  /**
   * Get the dry gain node (for signals without reverb).
   */
  getDryGain(): GainNode {
    if (!this.dryGain) {
      throw new Error('AudioService not initialized. Call initialize() first.');
    }
    return this.dryGain;
  }

  /**
   * Get the reverb input node (for signals that should have reverb).
   *
   * NOTE: This returns a Tone node. If you're connecting from a native
   * WebAudio node (like a GainNode), use `Tone.connect(nativeNode, reverbInput)`.
   */
  getReverbInput(): Tone.Reverb {
    if (!this.reverbNode) {
      throw new Error('AudioService not initialized. Call initialize() first.');
    }
    return this.reverbNode;
  }

  /**
   * Set the master volume level.
   * @param volume - Volume level (0-1)
   */
  setMasterVolume(volume: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  /**
   * Set the reverb wet/dry mix.
   * @param wetLevel - Wet (reverb) level (0-1)
   */
  setReverbLevel(wetLevel: number): void {
    if (this.reverbGain) {
      this.reverbGain.gain.value = Math.max(0, Math.min(1, wetLevel));
    }
  }

  /**
   * Get the current time from the audio context.
   * Used for precise scheduling of audio events.
   */
  getCurrentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  /**
   * Get the sample rate of the audio context.
   */
  getSampleRate(): number {
    return this.context?.sampleRate ?? 44100;
  }

  /**
   * Check if the audio service is initialized and ready.
   */
  isReady(): boolean {
    return this.isStarted && this.context !== null;
  }

  /**
   * Suspend the audio context (pause all audio processing).
   */
  async suspend(): Promise<void> {
    if (this.context && this.context.state === 'running') {
      await this.context.suspend();
    }
  }

  /**
   * Resume the audio context after suspension.
   */
  async resume(): Promise<void> {
    if (this.context && this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  /**
   * Create a gain node connected to the master output.
   * Useful for creating per-voice volume controls.
   * @param initialGain - Initial gain value (default 1.0)
   * @param connectToReverb - Whether to also connect to reverb (default false)
   */
  createGainNode(initialGain: number = 1.0, connectToReverb: boolean = false): GainNode {
    const ctx = this.getContext();
    const gain = ctx.createGain();
    gain.gain.value = initialGain;

    // Connect to dry output
    gain.connect(this.getDryGain());

    // Optionally connect to reverb
    if (connectToReverb && this.reverbNode) {
      // `gain` is a native WebAudio node and `reverbNode` is a Tone node.
      // Use Tone.connect to bridge the two safely.
      Tone.connect(gain, this.reverbNode);
    }

    return gain;
  }

  /**
   * Decode an audio blob into an AudioBuffer.
   * @param blob - Audio blob to decode
   * @returns Promise resolving to decoded AudioBuffer
   */
  async decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
    const ctx = this.getContext();
    const arrayBuffer = await blob.arrayBuffer();
    return ctx.decodeAudioData(arrayBuffer);
  }

  /**
   * Get the global Chorus node.
   */
  getChorus(): Tone.Chorus {
    if (!this.globalChorus) {
      throw new Error('AudioService not initialized. Call initialize() first.');
    }
    return this.globalChorus;
  }

  /**
   * Create an AudioBufferSourceNode for playing back recorded audio.
   * @param buffer - AudioBuffer to play
   * @returns AudioBufferSourceNode ready to be started
   */
  createBufferSource(buffer: AudioBuffer): AudioBufferSourceNode {
    const ctx = this.getContext();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    return source;
  }
}

// Export singleton instance
export const AudioService = new AudioServiceClass();
