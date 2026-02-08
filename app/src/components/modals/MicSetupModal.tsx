/* ============================================================
   MIC SETUP MODAL
   
   Modal for configuring microphone settings:
   - Device selection
   - Input gain
   - Monitoring toggle
   ============================================================ */

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Mic, Volume2, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { Slider } from '../ui/Slider';
import { Panel } from '../ui/Panel';
import { useAppStore } from '../../stores/appStore';
import { MicrophoneService } from '../../services/MicrophoneService';
import { AudioService } from '../../services/AudioService';
import { frequencyToNoteName } from '../../utils/music';
import type { AudioInputDevice } from '../../types';
import { PitchDetector, type PitchDetectionResult } from '../../services/PitchDetector';

/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export function MicSetupModal() {
  // Get state and actions from store
  const isOpen = useAppStore((state) => state.isMicSetupOpen);
  const microphoneState = useAppStore((state) => state.microphoneState);
  const setMicSetupOpen = useAppStore((state) => state.setMicSetupOpen);
  const setMicrophoneState = useAppStore((state) => state.setMicrophoneState);

  // Local state
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [inputGain, setInputGain] = useState(1.0);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordingLagMs, setRecordingLagMs] = useState(0);
  const [isCalibratingLag, setIsCalibratingLag] = useState(false);

  const [lowLatencyPitch, setLowLatencyPitch] = useState(false);

  // Mic level meter refs (DOM-based updates so we don't re-render 60 times/second)
  const meterFillRef = useRef<HTMLDivElement | null>(null);
  const meterLevelRef = useRef(0);
  const meterLastUiUpdateMsRef = useRef(0);
  const meterBufferRef = useRef<Float32Array | null>(null);

  // Range detection state
  const vocalRange = useAppStore((state) => state.vocalRange);
  const setVocalRange = useAppStore((state) => state.setVocalRange);
  const applyAutoTranspositionIfPossible = useAppStore((state) => state.applyAutoTranspositionIfPossible);

  const [isDetecting, setIsDetecting] = useState<'low' | 'high' | null>(null);
  const [detectedNotePreview, setDetectedNotePreview] = useState<string | null>(null);
  const stableFrameCountRef = useRef<number>(0);
  const lastPreviewNoteRef = useRef<string | null>(null);
  const listenStartMsRef = useRef<number>(0);
  const noteHistogramRef = useRef<Map<string, number>>(new Map());
  const pitchDetectorRef = useRef<PitchDetector | null>(null);
  const isDetectingRef = useRef<'low' | 'high' | null>(null);

  const pitchBufferRef = useRef<number[]>([]); // Ref is better for loops


  // Refs for volume meter loop
  const volumeRaf = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const calibrationStopRef = useRef<(() => void) | null>(null);

  // Keep a ref in sync with state so async callbacks always see the latest value.
  useEffect(() => {
    isDetectingRef.current = isDetecting;
  }, [isDetecting]);

  // Dispose pitch detector when the component unmounts.
  // (We only stop it during normal operation, but dispose is important for freeing nodes.)
  useEffect(() => {
    return () => {
      pitchDetectorRef.current?.stop();
      pitchDetectorRef.current?.dispose();
      pitchDetectorRef.current = null;
    };
  }, []);

  const handleRecordingLagChange = (valueMs: number) => {
    const clamped = Math.max(0, Math.min(500, valueMs));
    setRecordingLagMs(clamped);
    MicrophoneService.setRecordingLagMs(clamped, true);
    setMicrophoneState({ recordingLagMs: clamped, recordingLagIsManual: true });
  };

  const playCalibrationClick = (time: number) => {
    const ctx = AudioService.getContext();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = 880;

    gain.gain.setValueAtTime(0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

    osc.connect(gain);
    gain.connect(AudioService.getDryGain());

    osc.start(time);
    osc.stop(time + 0.05);
  };

  const calibrateRecordingLag = async () => {
    if (isCalibratingLag) return;
    // Don't start calibration while the app is recording a take.
    // Calibration needs to "listen" to your claps without fighting MediaRecorder.
    if (MicrophoneService.getIsRecording()) return;
    setIsCalibratingLag(true);
    setError(null);

    try {
      // Make sure audio is running so the clicks are audible.
      if (!AudioService.isReady()) {
        await AudioService.initialize();
      }
      await AudioService.resume();
      AudioService.fadeTransportGain(1, 0.02);

      // Make sure the mic stream exists so we can analyze clap peaks in real time.
      await MicrophoneService.initialize();

      const stream = MicrophoneService.getStream();
      if (!stream) {
        setError('Microphone not available.');
        return;
      }

      const ctx = AudioService.getContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);

      const timeData = new Float32Array(analyser.fftSize);

      const tempo = 120;
      const beatDurationSec = 60 / tempo;
      const leadInSec = 0.5;
      const clicksToScheduleAheadSec = 0.25;
      const maxCalibrationSec = 12;
      const minClapsNeeded = 4;

      const clickTimes: number[] = [];
      const lagsSec: number[] = [];

      let nextClickTime = ctx.currentTime + leadInSec;
      let rafId: number | null = null;
      let timeoutId: number | null = null;
      let lastPeakTime = -1;
      let wasAbove = false;
      let lastMatchedClickIndex = -1;

      const stop = () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        timeoutId = null;
        try {
          source.disconnect();
        } catch {
        }
        try {
          analyser.disconnect();
        } catch {
        }
        if (calibrationStopRef.current === stop) {
          calibrationStopRef.current = null;
        }
      };

      calibrationStopRef.current = stop;

      const finishIfPossible = () => {
        if (lagsSec.length < minClapsNeeded) return false;

        const sorted = [...lagsSec].sort((a, b) => a - b);
        const medianLagSec = sorted[Math.floor(sorted.length / 2)];
        const lagMs = Math.max(0, Math.min(500, Math.round(medianLagSec * 1000)));

        setRecordingLagMs(lagMs);
        MicrophoneService.setRecordingLagMs(lagMs, true);
        setMicrophoneState({ recordingLagMs: lagMs, recordingLagIsManual: true });
        return true;
      };

      const scheduleClicks = () => {
        const now = ctx.currentTime;
        while (nextClickTime < now + clicksToScheduleAheadSec) {
          clickTimes.push(nextClickTime);
          playCalibrationClick(nextClickTime);
          nextClickTime += beatDurationSec;
        }
      };

      const detectPeaks = () => {
        scheduleClicks();

        analyser.getFloatTimeDomainData(timeData);

        let peak = 0;
        for (let i = 0; i < timeData.length; i++) {
          const v = Math.abs(timeData[i]);
          if (v > peak) peak = v;
        }

        const above = peak > 0.25;
        const now = ctx.currentTime;
        const canTrigger = lastPeakTime < 0 || (now - lastPeakTime) > 0.18;

        if (above && !wasAbove && canTrigger) {
          lastPeakTime = now;

          let bestIndex = -1;
          let bestDt = Infinity;
          for (let i = lastMatchedClickIndex + 1; i < clickTimes.length; i++) {
            const dt = now - clickTimes[i];
            if (dt < -0.05) break;
            if (dt >= -0.05 && dt <= beatDurationSec) {
              const abs = Math.abs(dt);
              if (abs < bestDt) {
                bestDt = abs;
                bestIndex = i;
              }
            }
          }

          if (bestIndex >= 0) {
            lastMatchedClickIndex = bestIndex;
            const lag = now - clickTimes[bestIndex];
            if (Number.isFinite(lag)) {
              lagsSec.push(lag);

              if (finishIfPossible()) {
                stop();
                setIsCalibratingLag(false);
                return;
              }
            }
          }
        }

        wasAbove = above;
        rafId = requestAnimationFrame(detectPeaks);
      };

      timeoutId = window.setTimeout(() => {
        const ok = finishIfPossible();
        stop();
        if (!ok) {
          setError('Calibration failed. Try clapping louder/closer to the mic.');
        }
        setIsCalibratingLag(false);
      }, Math.ceil(maxCalibrationSec * 1000));

      detectPeaks();
    } catch (e) {
      console.error('Lag calibration failed:', e);
      setError('Calibration failed.');
      if (calibrationStopRef.current) {
        calibrationStopRef.current();
        calibrationStopRef.current = null;
      }
      setIsCalibratingLag(false);
    } finally {
      if (!calibrationStopRef.current) {
        setIsCalibratingLag(false);
      }
    }
  };

  /**
   * Initialize microphone and get device list.
   * Wrapped in useCallback so it can be a safe useEffect dependency.
   * All captured values (setState, store actions, MicrophoneService) are stable references.
   */
  const initializeMicrophone = useCallback(async () => {
    setIsInitializing(true);
    setError(null);

    try {
      if (!AudioService.isReady()) {
        await AudioService.initialize();
      }
      await AudioService.resume();
      AudioService.fadeTransportGain(1, 0.02);

      await MicrophoneService.initialize();

      // IMPORTANT:
      // The Zustand store is persisted to localStorage, but MicrophoneService is an
      // in-memory singleton that resets on page reload.
      // Here we re-apply the user's saved mic settings from the store so the mic
      // service (and the level meter / monitoring) matches what you last selected.
      const persisted = useAppStore.getState().microphoneState;
      if (persisted.selectedDeviceId) {
        try {
          await MicrophoneService.selectDevice(persisted.selectedDeviceId);
        } catch {
          // If the device no longer exists, we fall back to browser default below.
        }
      }
      if (typeof persisted.inputGain === 'number') {
        MicrophoneService.setInputGain(persisted.inputGain);
      }
      if (typeof persisted.monitoring === 'boolean') {
        MicrophoneService.setMonitoring(persisted.monitoring);
      }
      if (typeof persisted.lowLatencyPitch === 'boolean') {
        MicrophoneService.setLowLatencyPitch(persisted.lowLatencyPitch);
      }
      if (typeof persisted.recordingLagMs === 'number') {
        MicrophoneService.setRecordingLagMs(persisted.recordingLagMs, persisted.recordingLagIsManual ?? false);
      }

      const deviceList = await MicrophoneService.refreshDevices();
      setDevices(deviceList);

      const ms = MicrophoneService.getState();
      const fallbackDevice = deviceList.find(d => d.isDefault) || deviceList[0];
      const selected = ms.selectedDeviceId ?? fallbackDevice?.deviceId ?? null;

      setSelectedDevice(selected);
      setInputGain(ms.inputGain ?? 1.0);
      setIsMonitoring(ms.monitoring ?? false);
      setRecordingLagMs(ms.recordingLagMs ?? 0);
      setLowLatencyPitch(ms.lowLatencyPitch ?? false);

      setMicrophoneState({
        available: true,
        devices: deviceList,
        selectedDeviceId: selected,
        inputGain: ms.inputGain ?? 1.0,
        monitoring: ms.monitoring ?? false,
        lowLatencyPitch: ms.lowLatencyPitch ?? false,
        recordingLagMs: ms.recordingLagMs ?? 0,
        recordingLagIsManual: ms.recordingLagIsManual ?? false,
      });
    } catch (err) {
      setError('Could not access microphone. Please check permissions.');
      console.error('Mic init error:', err);
    } finally {
      setIsInitializing(false);
    }
    // All deps are stable React setState functions or Zustand actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Initialize microphone when modal opens.
   */
  useEffect(() => {
    if (isOpen) {
      initializeMicrophone();
    }
  }, [isOpen, initializeMicrophone]);

  useEffect(() => {
    if (isOpen) return;

    if (calibrationStopRef.current) {
      calibrationStopRef.current();
      calibrationStopRef.current = null;
      setIsCalibratingLag(false);
    }
  }, [isOpen]);

  /**
   * Start volume monitoring loop
   */
  useEffect(() => {
    // Don't attach the meter while we're still initializing/switching devices.
    // Otherwise we can connect to the temporary/default stream and then the real
    // selected device replaces it, leaving the meter reading silence.
    if (!isOpen || !microphoneState.available || isInitializing) return;

    let mounted = true;

    // Local handles so we can reliably tear them down in cleanup even if refs change.
    let localSource: MediaStreamAudioSourceNode | null = null;
    let localAnalyser: AnalyserNode | null = null;
    let localTapGain: GainNode | null = null;
    let localTapInput: AudioNode | null = null;

    const ensureReady = async () => {
      try {
        if (!AudioService.isReady()) {
          await AudioService.initialize();
        }
        await AudioService.resume();
        AudioService.fadeTransportGain(1, 0.02);

        // Ensure mic stream exists; if not, initialize it.
        if (!MicrophoneService.getStream()) {
          await MicrophoneService.initialize();
        }
      } catch {
        // If anything fails here, we just skip the meter (the UI will show mic error elsewhere).
      }
    };

    const setupMeter = async () => {
      await ensureReady();
      if (!mounted) return;

      const ctx = AudioService.getContext();
      localAnalyser = ctx.createAnalyser();
      localAnalyser.fftSize = 2048;

      // We do our own smoothing; keep analyser smoothing low.
      localAnalyser.smoothingTimeConstant = 0;

      // Prefer the processed node (same signal path as monitoring/recording).
      // Important: we NEVER disconnect the processed node itself in cleanup.
      const rawStream = MicrophoneService.getStream();
      const processedStream = MicrophoneService.getProcessedStream();
      const processedNode = MicrophoneService.getProcessedNodeForAnalysis?.() ?? null;

      if (processedNode) {
        localTapGain = ctx.createGain();
        localTapGain.gain.value = 1;
        localTapInput = processedNode;
        processedNode.connect(localTapGain);
        localTapGain.connect(localAnalyser);
      } else if (processedStream) {
        localSource = ctx.createMediaStreamSource(processedStream);
        localSource.connect(localAnalyser);
      } else if (rawStream) {
        localSource = ctx.createMediaStreamSource(rawStream);
        localSource.connect(localAnalyser);
      } else {
        return; // nothing to analyze
      }

      analyserSourceRef.current = localSource;
      analyserRef.current = localAnalyser;
      audioContextRef.current = ctx;

      // Kick the volume loop once we know we have a live analyser.
      updateVolume();
    };

    const updateVolume = () => {
      if (!mounted) return;

      if (analyserRef.current && audioContextRef.current) {
        const analyser = analyserRef.current;
        const bufferLength = analyser.fftSize;

        if (!meterBufferRef.current || meterBufferRef.current.length !== bufferLength) {
          meterBufferRef.current = new Float32Array(bufferLength);
        }

        const timeData = meterBufferRef.current;
        analyser.getFloatTimeDomainData(timeData as any);

        // Peak meter (0.0..1.0). Peak 0.5 is treated as 0dB reference, per your interface.
        let peak = 0;
        for (let i = 0; i < timeData.length; i++) {
          const a = Math.abs(timeData[i]);
          if (a > peak) peak = a;
        }

        // Convert to dB relative to peak=0.5.
        // 0dB means "full" on the meter.
        const minDb = -60;
        const db = peak > 0 ? 20 * Math.log10(peak / 0.5) : minDb;
        const clampedDb = Math.max(minDb, Math.min(0, db));
        const peakTarget = ((clampedDb - minDb) / (0 - minDb)) * 100;

        // Attack/release smoothing so it feels stable but responsive.
        const current = meterLevelRef.current;
        const alpha = peakTarget > current ? 0.6 : 0.2;
        const next = current + (peakTarget - current) * alpha;
        meterLevelRef.current = next;

        // Update the DOM at ~30fps (cheap and consistent).
        const nowMs = performance.now();
        if (nowMs - meterLastUiUpdateMsRef.current >= 33) {
          meterLastUiUpdateMsRef.current = nowMs;
          if (meterFillRef.current) {
            meterFillRef.current.style.width = `${next}%`;
            if (next >= 95) meterFillRef.current.style.backgroundColor = '#ff5151';
            else if (next >= 85) meterFillRef.current.style.backgroundColor = '#ffb347';
            else meterFillRef.current.style.backgroundColor = 'var(--accent-primary)';
          }
        }

      }
      volumeRaf.current = requestAnimationFrame(updateVolume);
    };

    void setupMeter();

    return () => {
      mounted = false;
      if (volumeRaf.current) cancelAnimationFrame(volumeRaf.current);

      // Disconnect whichever nodes we created.
      localSource?.disconnect();

      // If we tapped the processed node, only disconnect our tap node.
      // Never call disconnect() on the shared processed node itself.
      if (localTapInput && localTapGain) {
        try {
          localTapInput.disconnect(localTapGain);
        } catch {
          // Ignore disconnect errors; browser implementations vary.
        }
      }
      localTapGain?.disconnect();
      localAnalyser?.disconnect();

      analyserSourceRef.current?.disconnect();
      analyserRef.current?.disconnect();
      analyserSourceRef.current = null;
      analyserRef.current = null;
      audioContextRef.current = null;

      meterLevelRef.current = 0;
      meterLastUiUpdateMsRef.current = 0;
      if (meterFillRef.current) {
        meterFillRef.current.style.width = '0%';
        meterFillRef.current.style.backgroundColor = 'var(--accent-primary)';
      }
    };
  }, [isOpen, microphoneState.available, microphoneState.selectedDeviceId, isInitializing]);


  /**
   * Handle Pitch Detection (Mock for UI interaction - Logic needs real PitchDetector)
   */
  /**
   * Handle Pitch Detection
   */
  const startDetectingPitch = (type: 'low' | 'high') => {
    // Click-to-start behavior:
    // - If you're already listening for this type, clicking again stops.
    // - If you're listening for the other type, switch.
    const next = isDetecting === type ? null : type;
    setIsDetecting(next);
    pitchBufferRef.current = [];
    setDetectedNotePreview(null);
    stableFrameCountRef.current = 0;
    lastPreviewNoteRef.current = null;

    if (next) {
      listenStartMsRef.current = performance.now();
      noteHistogramRef.current = new Map();

      // Use the same (more precise) PitchDetector that recording/pitch tracing uses.
      // This runs continuously and calls our callback with smoothed MIDI + confidence.
      if (!pitchDetectorRef.current) {
        const stream = MicrophoneService.getProcessedStream();
        if (stream) {
          const detector = new PitchDetector();
          detector.setLowLatencyMode(lowLatencyPitch);
          detector.initialize(stream);
          pitchDetectorRef.current = detector;
        }
      }

      pitchDetectorRef.current?.setCallback((result: PitchDetectionResult) => {
        const mode = isDetectingRef.current;
        // Only respond while we're actively listening.
        if (!mode) return;

        const now = performance.now();

        // Hard timeout so the UI never gets stuck in listening mode.
        if (listenStartMsRef.current > 0 && now - listenStartMsRef.current > 5000) {
          const histogram = noteHistogramRef.current;
          let bestNote: string | null = null;
          let bestCount = -1;
          for (const [note, count] of histogram.entries()) {
            if (count > bestCount) {
              bestNote = note;
              bestCount = count;
            }
          }

          if (bestNote) {
            if (mode === 'low') setVocalRange({ lowNote: bestNote });
            else setVocalRange({ highNote: bestNote });
          }

          setIsDetecting(null);
          pitchBufferRef.current = [];
          setDetectedNotePreview(null);
          stableFrameCountRef.current = 0;
          lastPreviewNoteRef.current = null;
          listenStartMsRef.current = 0;
          noteHistogramRef.current = new Map();
          pitchDetectorRef.current?.stop();
          return;
        }

        // Ignore frames with no pitch.
        if (!result.frequency || result.frequency <= 0 || !result.noteNumber || result.noteNumber <= 0) return;

        // Conservative "round inward" using the detector's cents estimate.
        // We reconstruct a fractional MIDI and apply the same rule as before:
        // round DOWN unless we're safely into the next semitone.
        const fractionalMidi = result.noteNumber + (result.cents / 100);
        const floorMidi = Math.floor(fractionalMidi);
        const centsAboveFloor = (fractionalMidi - floorMidi) * 100;
        const roundedMidi = centsAboveFloor >= 85 ? floorMidi + 1 : floorMidi;

        const preview = frequencyToNoteName(440 * Math.pow(2, (roundedMidi - 69) / 12));
        setDetectedNotePreview(preview);

        const histogram = noteHistogramRef.current;
        histogram.set(preview, (histogram.get(preview) ?? 0) + 1);

        if (lastPreviewNoteRef.current === preview) {
          stableFrameCountRef.current += 1;
        } else {
          lastPreviewNoteRef.current = preview;
          stableFrameCountRef.current = 1;
        }

        // Lock after a few consistent frames.
        if (stableFrameCountRef.current >= 10) {
          if (mode === 'low') setVocalRange({ lowNote: preview });
          else setVocalRange({ highNote: preview });

          setIsDetecting(null);
          pitchBufferRef.current = [];
          setDetectedNotePreview(null);
          stableFrameCountRef.current = 0;
          lastPreviewNoteRef.current = null;
          listenStartMsRef.current = 0;
          noteHistogramRef.current = new Map();
          pitchDetectorRef.current?.stop();
        }
      });

      // Start detection (no need to record trace).
      pitchDetectorRef.current?.start(false);
    } else {
      listenStartMsRef.current = 0;
      noteHistogramRef.current = new Map();
      pitchDetectorRef.current?.stop();
    }
  };

  /**
   * Handle device selection change.
   */
  const handleDeviceChange = async (deviceId: string) => {
    setSelectedDevice(deviceId);
    try {
      await MicrophoneService.selectDevice(deviceId);
      setMicrophoneState({ selectedDeviceId: deviceId });
    } catch (err) {
      setError('Could not switch to selected device.');
    }
  };

  /**
   * Handle input gain change.
   */
  const handleGainChange = (value: number) => {
    setInputGain(value);
    MicrophoneService.setInputGain(value);
    setMicrophoneState({ inputGain: value });
  };

  /**
   * Handle monitoring toggle.
   */
  const handleMonitoringToggle = () => {
    const newState = !isMonitoring;
    setIsMonitoring(newState);
    MicrophoneService.setMonitoring(newState);
    setMicrophoneState({ monitoring: newState });
  };

  const handleLowLatencyToggle = () => {
    const next = !lowLatencyPitch;
    setLowLatencyPitch(next);
    MicrophoneService.setLowLatencyPitch(next);
    setMicrophoneState({ lowLatencyPitch: next });

    // If we already have a pitch detector instance for range detection, apply immediately.
    pitchDetectorRef.current?.setLowLatencyMode(next);
  };

  /**
   * Handle close.
   */
  const handleClose = () => {
    if (calibrationStopRef.current) {
      calibrationStopRef.current();
      calibrationStopRef.current = null;
      setIsCalibratingLag(false);
    }

    // If we were listening for a range note, stop cleanly.
    setIsDetecting(null);
    pitchBufferRef.current = [];
    setDetectedNotePreview(null);
    stableFrameCountRef.current = 0;
    lastPreviewNoteRef.current = null;
    listenStartMsRef.current = 0;
    noteHistogramRef.current = new Map();
    pitchDetectorRef.current?.stop();

    // After closing the mic modal, apply auto-transposition and announce the result.
    // This matches the requested flow: message appears AFTER you close the modal.
    applyAutoTranspositionIfPossible(true);
    setMicSetupOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md animate-[fadeInUp_0.2s_ease-out]"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Microphone Setup"
    >
      <Panel
        variant="solid"
        className="w-full max-w-md m-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Mic size={20} className="text-[var(--accent-primary)]" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Microphone Setup
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <X size={18} />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {/* Error message */}
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Device selection */}
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-secondary)]">
              Input Device
            </label>
            <div className="flex gap-2">
              <select
                value={selectedDevice || ''}
                onChange={(e) => handleDeviceChange(e.target.value)}
                disabled={isInitializing || devices.length === 0}
                style={{ backgroundColor: 'var(--button-bg)', color: 'var(--text-primary)' }}
                className="
                  flex-1 px-3 py-2
                  bg-[var(--button-bg)]
                  border border-[var(--border-color)]
                  rounded-lg
                  text-[var(--text-primary)]
                  text-sm
                "
              >
                {devices.length === 0 ? (
                  <option className="bg-[var(--button-bg)] text-[var(--text-primary)]">No devices found</option>
                ) : (
                  devices.map((device) => (
                    <option
                      key={device.deviceId}
                      value={device.deviceId}
                      className="bg-[var(--button-bg)] text-[var(--text-primary)]"
                    >
                      {device.label} {device.isDefault ? '(Default)' : ''}
                    </option>
                  ))
                )}
              </select>
              <Button
                variant="ghost"
                size="icon"
                onClick={initializeMicrophone}
                disabled={isInitializing}
                title="Refresh devices"
              >
                <RefreshCw size={16} className={isInitializing ? 'animate-spin' : ''} />
              </Button>
            </div>
          </div>

          {/* Input gain */}
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-secondary)]">
              Input Gain
            </label>
            <Slider
              value={inputGain * 100}
              min={0}
              max={200}
              onChange={(e) => handleGainChange(Number(e.target.value) / 100)}
              showValue
            />
          </div>

          {/* Monitoring */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 size={16} className="text-[var(--text-secondary)]" />
              <span className="text-sm text-[var(--text-secondary)]">
                Monitor (hear yourself)
              </span>
            </div>
            <button
              onClick={handleMonitoringToggle}
              className={`
                w-12 h-6 rounded-full transition-colors
                ${isMonitoring
                  ? 'bg-[var(--accent-primary)]'
                  : 'bg-[var(--button-bg)]'
                }
              `}
            >
              <div
                className={`
                  w-5 h-5 rounded-full bg-white shadow transition-transform
                  ${isMonitoring ? 'translate-x-6' : 'translate-x-0.5'}
                `}
              />
            </button>
          </div>

          {/* Low latency pitch */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--text-secondary)]">
                Low latency pitch
              </span>
            </div>
            <button
              onClick={handleLowLatencyToggle}
              className={
                `relative w-12 h-6 rounded-full transition-colors ${lowLatencyPitch ? 'bg-[var(--accent-primary)]' : 'bg-[var(--button-bg)]'}`
              }
              aria-label="Toggle low latency pitch"
              type="button"
            >
              <span
                className={
                  `absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${lowLatencyPitch ? 'translate-x-6' : ''}`
                }
              />
            </button>
          </div>

          {/* Recording sync */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm text-[var(--text-secondary)]">
                Recording Sync (ms)
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={calibrateRecordingLag}
                disabled={isCalibratingLag || isInitializing || !microphoneState.available}
                title="Clap along with the clicks to auto-align recordings"
              >
                {isCalibratingLag ? 'Calibrating…' : 'Calibrate Lag'}
              </Button>
            </div>
            <Slider
              value={recordingLagMs}
              min={0}
              max={250}
              onChange={(e) => handleRecordingLagChange(Number(e.target.value))}
              showValue
            />
          </div>

          {/* Level meter */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Mic Level</span>
              <span className="text-xs text-[var(--text-muted)]">0dB ≈ peak 0.5</span>
            </div>
            <div className="relative h-2 w-full rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
              <div
                ref={meterFillRef}
                className="h-full transition-all duration-75"
                style={{ width: '0%', backgroundColor: 'var(--accent-primary)' }}
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div
                className={`
                    w-2 h-2 rounded-full
                    ${microphoneState.available ? 'bg-green-400' : 'bg-red-400'}
                  `}
              />
              <span className="text-[var(--text-muted)]">
                {microphoneState.available
                  ? 'Microphone ready'
                  : 'Microphone not available'
                }
              </span>
            </div>
          </div>

          {/* Range Setup */}
          <div className="space-y-3 pt-4 border-t border-white/5">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Vocal Range</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Set your lowest and highest singable notes to auto-transpose arrangements.
            </p>

            <div className="flex gap-4">
              {/* Low Note */}
              <div className="flex-1 space-y-2">
                <label className="text-xs uppercase font-bold text-[var(--text-dim)]">Lowest Note</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startDetectingPitch('low')}
                    className={`
                             flex-1 py-2 px-3 rounded-lg text-sm font-bold transition-all
                             ${isDetecting === 'low' ? 'bg-red-500 animate-pulse text-white' : 'bg-white/5 hover:bg-white/10 text-white'}
                           `}
                  >
                    {isDetecting === 'low'
                      ? (detectedNotePreview ? `Listening… (${detectedNotePreview})` : 'Listening…')
                      : (vocalRange.lowNote || 'Set Low')}
                  </button>
                </div>
              </div>

              {/* High Note */}
              <div className="flex-1 space-y-2">
                <label className="text-xs uppercase font-bold text-[var(--text-dim)]">Highest Note</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startDetectingPitch('high')}
                    className={`
                             flex-1 py-2 px-3 rounded-lg text-sm font-bold transition-all
                             ${isDetecting === 'high' ? 'bg-red-500 animate-pulse text-white' : 'bg-white/5 hover:bg-white/10 text-white'}
                           `}
                  >
                    {isDetecting === 'high'
                      ? (detectedNotePreview ? `Listening… (${detectedNotePreview})` : 'Listening…')
                      : (vocalRange.highNote || 'Set High')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border-color)] flex justify-between items-center">
          <div className="text-xs text-[var(--text-muted)] italic">
            {vocalRange.lowNote ? `Range: ${vocalRange.lowNote} - ${vocalRange.highNote || '?'}` : 'No range set'}
          </div>
          <Button variant="primary" onClick={handleClose}>
            Done
          </Button>
        </div>
      </Panel>
    </div>
  );
}

export default MicSetupModal;
