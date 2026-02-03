/* ============================================================
   DISPLAY SETTINGS MODAL
   
   Modal for configuring visual display options:
   - Show/hide chord track
   - Show/hide scale degrees
   - Glow intensity
   - Label format
   ============================================================ */

import { X, Settings } from 'lucide-react';
import { Button } from '../ui/Button';
import { Slider } from '../ui/Slider';
import { Panel } from '../ui/Panel';
import { useAppStore } from '../../stores/appStore';

/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export function DisplaySettingsModal() {
  // Get state and actions from store
  const isOpen = useAppStore((state) => state.isDisplaySettingsOpen);
  const display = useAppStore((state) => state.display);
  const setDisplaySettingsOpen = useAppStore((state) => state.setDisplaySettingsOpen);
  const setDisplaySettings = useAppStore((state) => state.setDisplaySettings);

  /**
   * Handle toggle change.
   */
  const handleToggle = (key: string, value: boolean) => {
    setDisplaySettings({ [key]: value });
  };

  /**
   * Handle slider change.
   */
  const handleSliderChange = (key: string, value: number) => {
    setDisplaySettings({ [key]: value });
  };

  /**
   * Handle close.
   */
  const handleClose = () => {
    setDisplaySettingsOpen(false);
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
            <Settings size={20} className="text-[var(--accent-primary)]" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Display Settings
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <X size={18} />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {/* Show chord track */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--text-primary)]">
              Show Chord Labels
            </span>
            <button
              onClick={() => handleToggle('showChordTrack', !display.showChordTrack)}
              className={`
                w-12 h-6 rounded-full transition-colors
                ${display.showChordTrack 
                  ? 'bg-[var(--accent-primary)]' 
                  : 'bg-[var(--button-bg)]'
                }
              `}
            >
              <div 
                className={`
                  w-5 h-5 rounded-full bg-white shadow transition-transform
                  ${display.showChordTrack ? 'translate-x-6' : 'translate-x-0.5'}
                `}
              />
            </button>
          </div>

          {/* Show scale degrees */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--text-primary)]">
              Show Scale Degrees on Nodes
            </span>
            <button
              onClick={() => handleToggle('showScaleDegrees', !display.showScaleDegrees)}
              className={`
                w-12 h-6 rounded-full transition-colors
                ${display.showScaleDegrees 
                  ? 'bg-[var(--accent-primary)]' 
                  : 'bg-[var(--button-bg)]'
                }
              `}
            >
              <div 
                className={`
                  w-5 h-5 rounded-full bg-white shadow transition-transform
                  ${display.showScaleDegrees ? 'translate-x-6' : 'translate-x-0.5'}
                `}
              />
            </button>
          </div>

          {/* Show pitch labels */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--text-primary)]">
              Show Pitch Labels
            </span>
            <button
              onClick={() => handleToggle('showPitchLabels', !display.showPitchLabels)}
              className={`
                w-12 h-6 rounded-full transition-colors
                ${display.showPitchLabels 
                  ? 'bg-[var(--accent-primary)]' 
                  : 'bg-[var(--button-bg)]'
                }
              `}
            >
              <div 
                className={`
                  w-5 h-5 rounded-full bg-white shadow transition-transform
                  ${display.showPitchLabels ? 'translate-x-6' : 'translate-x-0.5'}
                `}
              />
            </button>
          </div>

          {/* Glow intensity */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-primary)]">
                Glow Intensity
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {display.glowIntensity.toFixed(1)}
              </span>
            </div>
            <Slider
              value={display.glowIntensity * 50}
              min={0}
              max={100}
              onChange={(e) => handleSliderChange('glowIntensity', Number(e.target.value) / 50)}
            />
          </div>

          {/* Label format */}
          <div className="space-y-2">
            <span className="text-sm text-[var(--text-primary)]">
              Label Format
            </span>
            <div className="flex gap-2">
              {(['degree', 'solfege', 'noteName'] as const).map((format) => (
                <button
                  key={format}
                  onClick={() => setDisplaySettings({ labelFormat: format })}
                  className={`
                    flex-1 px-3 py-2 rounded-lg text-sm transition-colors
                    ${display.labelFormat === format 
                      ? 'bg-[var(--accent-primary)] text-white' 
                      : 'bg-[var(--button-bg)] text-[var(--text-secondary)] hover:bg-[var(--button-bg-hover)]'
                    }
                  `}
                >
                  {format === 'degree' ? '1, 2, 3' : format === 'solfege' ? 'Do Re Mi' : 'C D E'}
                </button>
              ))}
            </div>
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

export default DisplaySettingsModal;
