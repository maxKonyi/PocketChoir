/* ============================================================
   SERVICES INDEX
   
   Re-exports all services from a single location.
   ============================================================ */

export { AudioService } from './AudioService';
export { SynthVoice, createSynthVoice } from './SynthVoice';
export { PitchDetector, createPitchDetector } from './PitchDetector';
export type { PitchDetectionResult, PitchCallback } from './PitchDetector';
export { MicrophoneService } from './MicrophoneService';
export type { RecordingCompleteCallback } from './MicrophoneService';
