/* ============================================================
   DISPLAY SETTINGS MODAL
   
   Modal for configuring visual display options:
   - Show/hide minimap
   - Show/hide chord labels
   - Show/hide lyrics track
   - Show/hide note labels (with label style selector)
   - Note size scaling
   - Line thickness scaling
   - Glow intensity
   - Grid opacity
   - Background / environment settings
   ============================================================ */

import { X, Settings, ChevronDown } from 'lucide-react';

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
   * Dynamically discover background videos from the data folder.
   */
  const backgrounds = Object.entries(import.meta.glob('../../data/backgrounds/*.mp4', { eager: true }))
    .map(([path, module]) => {
      const fileName = path.split('/').pop() || '';
      const label = fileName
        .replace(/\.[^/.]+$/, "") // Remove extension
        .replace(/(\d+)$/, " $1") // Add space before numbers
        .replace(/([A-Z])/g, ' $1') // Add space before capital letters
        .trim();

      // Vite exposes the final resolved asset URL at module.default.
      // Using this URL prevents broken <video src> values in both dev and production builds.
      const resolvedUrl = typeof module === 'string'
        ? module
        : (module as { default?: string }).default ?? '';

      return {
        id: resolvedUrl,
        label
      };
    })
    .filter((bg) => bg.id.length > 0);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md animate-[fadeInUp_0.2s_ease-out]"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Display Settings"
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
          {/* Show minimap */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--text-primary)]">
              Show Minimap
            </span>
            <button
              onClick={() => handleToggle('showMinimap', !display.showMinimap)}
              className={`
                w-12 h-6 rounded-full transition-colors
                ${display.showMinimap
                  ? 'bg-[var(--accent-primary)]'
                  : 'bg-[var(--button-bg)]'
                }
              `}
            >
              <div
                className={`
                  w-5 h-5 rounded-full bg-white shadow transition-transform
                  ${display.showMinimap ? 'translate-x-6' : 'translate-x-0.5'}
                `}
              />
            </button>
          </div>

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

          {/* Show lyrics track */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--text-primary)]">
              Show Lyrics Track
            </span>
            <button
              onClick={() => handleToggle('showLyricsTrack', !display.showLyricsTrack)}
              className={`
                w-12 h-6 rounded-full transition-colors
                ${display.showLyricsTrack
                  ? 'bg-[var(--accent-primary)]'
                  : 'bg-[var(--button-bg)]'
                }
              `}
            >
              <div
                className={`
                  w-5 h-5 rounded-full bg-white shadow transition-transform
                  ${display.showLyricsTrack ? 'translate-x-6' : 'translate-x-0.5'}
                `}
              />
            </button>
          </div>

          {/* Show note labels */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-primary)]">
                Show Note Labels
              </span>
              <button
                onClick={() => handleToggle('showNoteLabels', !display.showNoteLabels)}
                className={`
                  w-12 h-6 rounded-full transition-colors
                  ${display.showNoteLabels
                    ? 'bg-[var(--accent-primary)]'
                    : 'bg-[var(--button-bg)]'
                  }
                `}
              >
                <div
                  className={`
                    w-5 h-5 rounded-full bg-white shadow transition-transform
                    ${display.showNoteLabels ? 'translate-x-6' : 'translate-x-0.5'}
                  `}
                />
              </button>
            </div>

            {/* Label Style — nested under Show Note Labels, only interactive when labels are ON */}
            <div className={`space-y-2 transition-opacity ${display.showNoteLabels ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
              <span className="text-xs text-[var(--text-muted)]">
                Label Style
              </span>
              <div className="flex gap-2">
                {(['degree', 'solfege', 'noteName'] as const).map((format) => (
                  <button
                    key={format}
                    onClick={() => setDisplaySettings({ labelFormat: format })}
                    className={`
                      flex-1 px-3 py-2 rounded-xl text-sm transition-colors
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

          {/* Note Size */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-primary)]">
                Note Size
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {Math.round(display.noteSize * 100)}%
              </span>
            </div>
            <Slider
              value={(display.noteSize - 0.5) / 1.5 * 100}
              min={0}
              max={100}
              onChange={(e) => handleSliderChange('noteSize', 0.5 + Number(e.target.value) / 100 * 1.5)}
            />
          </div>

          {/* Line Thickness */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-primary)]">
                Line Thickness
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {Math.round(display.lineThickness * 100)}%
              </span>
            </div>
            <Slider
              value={(display.lineThickness - 0.25) / 3.75 * 100}
              min={0}
              max={100}
              onChange={(e) => handleSliderChange('lineThickness', 0.25 + (Number(e.target.value) / 100) * 3.75)}
            />
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

          {/* Grid opacity */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-primary)]">
                Grid Opacity
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {Math.round(display.gridOpacity * 100)}%
              </span>
            </div>
            <Slider
              value={display.gridOpacity * 100}
              min={0}
              max={100}
              onChange={(e) => handleSliderChange('gridOpacity', Number(e.target.value) / 100)}
            />
          </div>

          <div className="w-full h-px bg-[var(--border-color)]" />

          {/* Contour Color Mode */}
          <div className="space-y-3">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              Contour Colors
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setDisplaySettings({ contourColorMode: 'voice' })}
                className={`
                  flex-1 px-3 py-2 rounded-xl text-sm transition-colors
                  ${display.contourColorMode === 'voice'
                    ? 'bg-[var(--accent-primary)] text-white'
                    : 'bg-[var(--button-bg)] text-[var(--text-secondary)] hover:bg-[var(--button-bg-hover)]'
                  }
                `}
              >
                By Voice
              </button>
              <button
                onClick={() => setDisplaySettings({ contourColorMode: 'scaleDegree' })}
                className={`
                  flex-1 px-3 py-2 rounded-xl text-sm transition-colors
                  ${display.contourColorMode === 'scaleDegree'
                    ? 'bg-[var(--accent-primary)] text-white'
                    : 'bg-[var(--button-bg)] text-[var(--text-secondary)] hover:bg-[var(--button-bg-hover)]'
                  }
                `}
              >
                By Scale Degree
              </button>
            </div>
          </div>

          <div className="w-full h-px bg-[var(--border-color)]" />

          {/* Background Selection */}
          <div className="space-y-3">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              Environment
            </span>

            <div className="space-y-2">
              <span className="text-xs text-[var(--text-muted)]">Background</span>
              <div className="relative group">
                <select
                  value={display.backgroundVideo}
                  onChange={(e) => setDisplaySettings({ backgroundVideo: e.target.value })}
                  className="
                    w-full appearance-none px-4 py-2.5 rounded-xl text-sm
                    bg-[var(--button-bg)] border border-white/5 text-[var(--text-primary)]
                    hover:bg-[var(--button-bg-hover)] transition-all cursor-pointer
                    focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50
                  "
                >
                  <option value="none" className="bg-[#1a1f2e]">Solid (Cosmic Gradient)</option>
                  {backgrounds.map((bg) => (
                    <option key={bg.id} value={bg.id} className="bg-[#1a1f2e]">
                      {bg.label}
                    </option>
                  ))}
                </select>

                <ChevronDown
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-muted)] group-hover:text-white transition-colors"
                />
              </div>
            </div>


            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">Background Brightness</span>
                <span className="text-xs text-[var(--text-muted)]">{Math.round(display.backgroundBrightness * 100)}%</span>
              </div>
              <Slider
                value={display.backgroundBrightness * 100}
                min={0}
                max={100}
                onChange={(e) => handleSliderChange('backgroundBrightness', Number(e.target.value) / 100)}
              />
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">Background Blur</span>
                <span className="text-xs text-[var(--text-muted)]">{display.backgroundBlur}px</span>
              </div>
              <Slider
                value={display.backgroundBlur * 5}
                min={0}
                max={100}
                onChange={(e) => handleSliderChange('backgroundBlur', Math.round(Number(e.target.value) / 5))}
              />
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
