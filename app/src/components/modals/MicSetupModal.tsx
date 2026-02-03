/* ============================================================
   MIC SETUP MODAL
   
   Modal for configuring microphone settings:
   - Device selection
   - Input gain
   - Monitoring toggle
   ============================================================ */

import { useState, useEffect } from 'react';
import { X, Mic, Volume2, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { Slider } from '../ui/Slider';
import { Panel } from '../ui/Panel';
import { useAppStore } from '../../stores/appStore';
import { MicrophoneService } from '../../services/MicrophoneService';
import type { AudioInputDevice } from '../../types';

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

  /**
   * Initialize microphone when modal opens.
   */
  useEffect(() => {
    if (isOpen) {
      initializeMicrophone();
    }
  }, [isOpen]);

  /**
   * Initialize microphone and get device list.
   */
  const initializeMicrophone = async () => {
    setIsInitializing(true);
    setError(null);
    
    try {
      await MicrophoneService.initialize();
      const deviceList = await MicrophoneService.getDevices();
      setDevices(deviceList);
      
      // Set default device
      const defaultDevice = deviceList.find(d => d.isDefault) || deviceList[0];
      if (defaultDevice) {
        setSelectedDevice(defaultDevice.deviceId);
      }
      
      setMicrophoneState({ available: true, devices: deviceList });
    } catch (err) {
      setError('Could not access microphone. Please check permissions.');
      console.error('Mic init error:', err);
    } finally {
      setIsInitializing(false);
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
    setMicSetupOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleClose}
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

          {/* Status indicator */}
          <div className="flex items-center gap-2 text-sm">
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

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border-color)] flex justify-end">
          <Button variant="primary" onClick={handleClose}>
            Done
          </Button>
        </div>
      </Panel>
    </div>
  );
}

export default MicSetupModal;
