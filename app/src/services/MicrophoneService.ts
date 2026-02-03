/* ============================================================
   MICROPHONE SERVICE
   
   Handles microphone access, device enumeration, and recording.
   Manages the MediaStream and audio input.
   ============================================================ */

import { AudioService } from './AudioService';
import type { AudioInputDevice, MicrophoneState } from '../types';

/**
 * Callback type for recording completion.
 */
export type RecordingCompleteCallback = (blob: Blob, duration: number) => void;

/**
 * Singleton service for microphone access and recording.
 */
class MicrophoneServiceClass {
  // Current media stream from the microphone
  private stream: MediaStream | null = null;
  
  // List of available audio input devices
  private devices: AudioInputDevice[] = [];
  
  // Currently selected device ID
  private selectedDeviceId: string | null = null;
  
  // MediaRecorder for capturing audio
  private mediaRecorder: MediaRecorder | null = null;
  
  // Recorded audio chunks
  private recordedChunks: Blob[] = [];
  
  // Recording state
  private isRecording: boolean = false;
  
  // Recording start time
  private recordingStartTime: number = 0;
  
  // Callback for recording completion
  private onRecordingComplete: RecordingCompleteCallback | null = null;
  
  // Input gain node for adjusting microphone sensitivity
  private inputGainNode: GainNode | null = null;
  
  // Monitoring (playback of mic input)
  private monitorNode: GainNode | null = null;
  private isMonitoring: boolean = false;

  /**
   * Request microphone permission and initialize.
   * @returns Promise that resolves when microphone is ready
   */
  async initialize(): Promise<void> {
    try {
      // Request microphone permission with a basic stream first
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false, // We handle gain ourselves
        },
      });
      
      // Enumerate available devices
      await this.refreshDevices();
      
      // Set up audio routing
      this.setupAudioRouting();
      
      console.log('MicrophoneService initialized');
    } catch (error) {
      console.error('Failed to initialize microphone:', error);
      throw error;
    }
  }

  /**
   * Refresh the list of available audio input devices.
   */
  async refreshDevices(): Promise<AudioInputDevice[]> {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      
      this.devices = allDevices
        .filter(device => device.kind === 'audioinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
          isDefault: device.deviceId === 'default',
        }));
      
      // Select default device if none selected
      if (!this.selectedDeviceId && this.devices.length > 0) {
        this.selectedDeviceId = this.devices[0].deviceId;
      }
      
      return this.devices;
    } catch (error) {
      console.error('Failed to enumerate devices:', error);
      return [];
    }
  }

  /**
   * Select a specific audio input device.
   * @param deviceId - Device ID to select
   */
  async selectDevice(deviceId: string): Promise<void> {
    if (deviceId === this.selectedDeviceId) return;
    
    // Stop current stream
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    
    // Get new stream with selected device
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
    });
    
    this.selectedDeviceId = deviceId;
    
    // Reconnect audio routing
    this.setupAudioRouting();
  }

  /**
   * Set up audio routing for the microphone input.
   */
  private setupAudioRouting(): void {
    if (!this.stream) return;
    
    const ctx = AudioService.getContext();
    
    // Clean up old nodes
    if (this.inputGainNode) {
      this.inputGainNode.disconnect();
    }
    if (this.monitorNode) {
      this.monitorNode.disconnect();
    }
    
    // Create input gain node for sensitivity control
    this.inputGainNode = ctx.createGain();
    this.inputGainNode.gain.value = 1.0;
    
    // Create monitor node (for listening to self)
    this.monitorNode = ctx.createGain();
    this.monitorNode.gain.value = 0; // Off by default
    this.monitorNode.connect(AudioService.getMasterGain());
    
    // Note: We don't connect the stream here - that's done by PitchDetector
    // and MediaRecorder separately to avoid conflicts
  }

  /**
   * Get the current media stream.
   * @returns The active MediaStream or null
   */
  getStream(): MediaStream | null {
    return this.stream;
  }

  /**
   * Get the list of available input devices.
   */
  getDevices(): AudioInputDevice[] {
    return this.devices;
  }

  /**
   * Get the currently selected device ID.
   */
  getSelectedDeviceId(): string | null {
    return this.selectedDeviceId;
  }

  /**
   * Set the input gain (microphone sensitivity).
   * @param gain - Gain value (0-2, where 1 is normal)
   */
  setInputGain(gain: number): void {
    if (this.inputGainNode) {
      this.inputGainNode.gain.value = Math.max(0, Math.min(2, gain));
    }
  }

  /**
   * Enable or disable monitoring (hearing yourself).
   * @param enabled - Whether to enable monitoring
   * @param volume - Monitor volume (0-1)
   */
  setMonitoring(enabled: boolean, volume: number = 0.5): void {
    this.isMonitoring = enabled;
    
    if (this.monitorNode) {
      this.monitorNode.gain.value = enabled ? volume : 0;
    }
  }

  /**
   * Start recording audio from the microphone.
   * @param onComplete - Callback when recording is finished
   */
  startRecording(onComplete: RecordingCompleteCallback): void {
    if (!this.stream || this.isRecording) {
      console.warn('Cannot start recording: no stream or already recording');
      return;
    }
    
    this.onRecordingComplete = onComplete;
    this.recordedChunks = [];
    this.recordingStartTime = performance.now();
    
    // Create MediaRecorder with optimal settings
    const mimeType = this.getSupportedMimeType();
    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType,
      audioBitsPerSecond: 128000,
    });
    
    // Collect recorded data
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };
    
    // Handle recording stop
    this.mediaRecorder.onstop = () => {
      const duration = performance.now() - this.recordingStartTime;
      const blob = new Blob(this.recordedChunks, { type: mimeType });
      
      this.isRecording = false;
      this.recordedChunks = [];
      
      if (this.onRecordingComplete) {
        this.onRecordingComplete(blob, duration);
      }
    };
    
    // Start recording
    this.mediaRecorder.start(100); // Collect data every 100ms
    this.isRecording = true;
  }

  /**
   * Stop recording and trigger the completion callback.
   */
  stopRecording(): void {
    if (!this.mediaRecorder || !this.isRecording) {
      return;
    }
    
    this.mediaRecorder.stop();
    // The onstop handler will finalize and call the callback
  }

  /**
   * Get the best supported audio MIME type.
   */
  private getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    
    return 'audio/webm'; // Fallback
  }

  /**
   * Check if microphone permission is granted.
   */
  async checkPermission(): Promise<boolean> {
    try {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return result.state === 'granted';
    } catch {
      // Permissions API not supported, try to check via stream
      return this.stream !== null;
    }
  }

  /**
   * Get the current microphone state.
   */
  getState(): MicrophoneState {
    return {
      available: this.stream !== null,
      devices: this.devices,
      selectedDeviceId: this.selectedDeviceId,
      inputGain: this.inputGainNode?.gain.value ?? 1.0,
      monitoring: this.isMonitoring,
      isRecording: this.isRecording,
    };
  }

  /**
   * Check if currently recording.
   */
  getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Clean up and release microphone resources.
   */
  dispose(): void {
    // Stop any active recording
    if (this.isRecording) {
      this.stopRecording();
    }
    
    // Stop and release the stream
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    // Disconnect audio nodes
    if (this.inputGainNode) {
      this.inputGainNode.disconnect();
      this.inputGainNode = null;
    }
    
    if (this.monitorNode) {
      this.monitorNode.disconnect();
      this.monitorNode = null;
    }
    
    this.mediaRecorder = null;
    this.onRecordingComplete = null;
  }
}

// Export singleton instance
export const MicrophoneService = new MicrophoneServiceClass();
