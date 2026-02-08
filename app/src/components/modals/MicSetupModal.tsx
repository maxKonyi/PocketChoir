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
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [recordingLagMs, setRecordingLagMs] = useState(0);
  const [isCalibratingLag, setIsCalibratingLag] = useState(false);

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
      const deviceList = await MicrophoneService.refreshDevices();
      setDevices(deviceList);

      const ms = MicrophoneService.getState();
      const fallbackDevice = deviceList.find(d => d.isDefault) || deviceList[0];
      const selected = ms.selectedDeviceId ?? fallbackDevice?.deviceId ?? null;

      setSelectedDevice(selected);
      setInputGain(ms.inputGain ?? 1.0);
      setIsMonitoring(ms.monitoring ?? false);
      setRecordingLagMs(ms.recordingLagMs ?? 0);

      setMicrophoneState({
        available: true,
        devices: deviceList,
        selectedDeviceId: selected,
        inputGain: ms.inputGain ?? 1.0,
        monitoring: ms.monitoring ?? false,
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
    if (!isOpen || !microphoneState.available) return;

    if (!AudioService.isReady()) return;
    void AudioService.resume();
    AudioService.fadeTransportGain(1, 0.02);

    let mounted = true;

    // Set up analysis
    // We use the RAW stream for pitch + meter so you see your true interface level.
    const stream = MicrophoneService.getStream();
    if (stream) {
      const ctx = AudioService.getContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);

      analyserSourceRef.current = source;
      analyserRef.current = analyser;
      audioContextRef.current = ctx;
    }

    const updateVolume = () => {
      if (!mounted) return;

      if (analyserRef.current && audioContextRef.current) {
        const bufferLength = analyserRef.current.fftSize;
        const timeData = new Float32Array(bufferLength);

        analyserRef.current.getFloatTimeDomainData(timeData);

        // Calculate RMS from time domain.
        // This is closer to what you see in interface software than frequency-bin averages.
        let rmsSum = 0;
        for (let i = 0; i < timeData.length; i++) {
          const v = timeData[i];
          rmsSum += v * v;
        }
        const rms = Math.sqrt(rmsSum / timeData.length);

        // Convert to dBFS-ish scale so it doesn't instantly pin at 100.
        // Typical voice RMS tends to sit well below 0dB.
        const db = 20 * Math.log10(rms + 1e-8);

        // Map -60dB..-6dB to 0..100
        const normalized = (db + 60) / 54;
        const target = Math.max(0, Math.min(100, normalized * 100));

        // Smooth so the meter rises/falls naturally.
        setVolumeLevel((prev) => (prev * 0.85) + (target * 0.15));

      }
      volumeRaf.current = requestAnimationFrame(updateVolume);
    };

    updateVolume();

    return () => {
      mounted = false;
      if (volumeRaf.current) cancelAnimationFrame(volumeRaf.current);

      analyserSourceRef.current?.disconnect();
      analyserRef.current?.disconnect();
      analyserSourceRef.current = null;
      analyserRef.current = null;
      audioContextRef.current = null;
      setVolumeLevel(0);
    };
  }, [isOpen, microphoneState.available, microphoneState.selectedDeviceId]);


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
                  <option>No devices found</option>
                ) : (
                  devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
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

          {/* Status indicator + Volume Meter */}
          <div className="flex items-center gap-4 text-sm">
            <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--accent-primary)] transition-all duration-75"
                style={{ width: `${volumeLevel}%` }}
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
