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

  // Reverb effect using ConvolverNode
  private reverbNode: ConvolverNode | null = null;
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
    this.masterGain.connect(this.context.destination);

    // Create dry/wet routing for reverb effect
    this.dryGain = this.context.createGain();
    this.dryGain.gain.value = 1.0;
    this.dryGain.connect(this.masterGain);

    this.reverbGain = this.context.createGain();
    this.reverbGain.gain.value = 0.4; // Default reverb level (matches choir_ref wet ≈ 0.40)
    this.reverbGain.connect(this.masterGain);

    // Create reverb convolver (we'll load an impulse response later)
    this.reverbNode = this.context.createConvolver();
    this.reverbNode.connect(this.reverbGain);

    // Initialize Tone.js with this context
    await Tone.setContext(this.context);

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
    this.globalChorus.connect(this.reverbNode);

    // Generate a simple synthetic reverb impulse response
    await this.createSyntheticReverb();

    // Resume context if it's suspended (browser autoplay policy)
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    this.isStarted = true;
    console.log('AudioService initialized with Tone.js and global Chorus');
  }

  /**
   * Create a simple synthetic reverb impulse response.
   * This creates a basic room-like reverb without loading external files.
   */
  private async createSyntheticReverb(): Promise<void> {
    if (!this.context || !this.reverbNode) return;

    // Match choir_ref hall-ish reverb character:
    // decay ≈ 2.9s, preDelay ≈ 10ms, wet controlled by reverbGain.
    const sampleRate = this.context.sampleRate;
    const decaySeconds = 2.9;
    const preDelaySeconds = 0.01;
    const totalSeconds = decaySeconds + preDelaySeconds;
    const length = Math.floor(sampleRate * totalSeconds);
    const preDelaySamples = Math.floor(sampleRate * preDelaySeconds);
    const impulse = this.context.createBuffer(2, length, sampleRate);

    // Fill with decaying noise for a simple reverb effect
    for (let channel = 0; channel < 2; channel++) {
      const channelData = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        if (i < preDelaySamples) {
          channelData[i] = 0;
          continue;
        }

        const t = i - preDelaySamples;
        const decayLen = Math.max(1, length - preDelaySamples);

        // Exponential decay with random noise
        const decay = Math.exp(-3 * t / decayLen);
        channelData[i] = (Math.random() * 2 - 1) * decay;
      }
    }

    this.reverbNode.buffer = impulse;
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
   */
  getReverbInput(): ConvolverNode {
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
      gain.connect(this.reverbNode);
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
