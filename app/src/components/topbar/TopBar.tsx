/* ============================================================
   TOP BAR COMPONENT
   
   Global navigation and settings bar at the top of the app.
   Controls: Library, Mic Setup, Display Settings, Theme, Mode Toggle
   ============================================================ */

import { Library, Mic, Eye, Palette } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { applyTheme, type ThemeName } from '../../utils/colors';

/* ------------------------------------------------------------
   Theme options for the dropdown
   ------------------------------------------------------------ */

const THEME_OPTIONS: { value: ThemeName; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'cosmic', label: 'Cosmic' },
  { value: 'minimal-dark', label: 'Minimal Dark' },
  { value: 'minimal-light', label: 'Minimal Light' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'ocean', label: 'Ocean' },
];

/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export function TopBar() {
  // Get state from store
  const arrangement = useAppStore((state) => state.arrangement);
  const mode = useAppStore((state) => state.mode);
  const theme = useAppStore((state) => state.theme);
  
  // Get actions from store
  const setLibraryOpen = useAppStore((state) => state.setLibraryOpen);
  const setMicSetupOpen = useAppStore((state) => state.setMicSetupOpen);
  const setDisplaySettingsOpen = useAppStore((state) => state.setDisplaySettingsOpen);
  const setMode = useAppStore((state) => state.setMode);
  const setTheme = useAppStore((state) => state.setTheme);

  /**
   * Handle theme change from dropdown.
   */
  const handleThemeChange = (newTheme: ThemeName) => {
    setTheme(newTheme);
    applyTheme(newTheme);
  };

  return (
    <header className="
      h-12 px-4
      bg-[var(--panel-bg)]/90 backdrop-blur-md
      border-b border-[var(--border-color)]
      flex items-center justify-between
      relative z-20
    ">
      {/* Left section - App title and arrangement selector */}
      <div className="flex items-center gap-4">
        {/* App logo/title */}
        <span className="text-lg font-bold text-[var(--accent-primary)]">
          ♫ Harmony
        </span>
        
        {/* Library / Arrangement selector */}
        <button 
          onClick={() => setLibraryOpen(true)}
          className="
            flex items-center gap-2 px-3 py-1.5
            bg-[var(--button-bg)] text-[var(--text-primary)]
            rounded-lg text-sm font-medium
            hover:bg-[var(--button-bg-hover)] transition-colors
            border border-[var(--border-color)]
          "
          title="Open Library"
        >
          <Library size={14} />
          <span className="max-w-[200px] truncate">
            {arrangement?.title || 'Choose Arrangement...'}
          </span>
        </button>
      </div>

      {/* Center - Arrangement info (when loaded) */}
      {arrangement && (
        <div className="flex items-center gap-4 text-sm text-[var(--text-muted)]">
          <span>Key: <span className="text-[var(--text-primary)] font-medium">{arrangement.tonic} {arrangement.scale}</span></span>
          <span>•</span>
          <span>Tempo: <span className="text-[var(--text-primary)] font-medium">{arrangement.tempo} BPM</span></span>
          <span>•</span>
          <span><span className="text-[var(--text-primary)] font-medium">{arrangement.bars}</span> bars</span>
          <span>•</span>
          <span><span className="text-[var(--text-primary)] font-medium">{arrangement.voices.length}</span> voices</span>
        </div>
      )}

      {/* Right section - Settings buttons and mode toggle */}
      <div className="flex items-center gap-2">
        {/* Mic Setup */}
        <button 
          onClick={() => setMicSetupOpen(true)}
          className="
            p-2 rounded-lg
            bg-[var(--button-bg)] text-[var(--text-secondary)]
            hover:bg-[var(--button-bg-hover)] hover:text-[var(--text-primary)]
            transition-colors
          "
          title="Microphone Setup"
        >
          <Mic size={16} />
        </button>

        {/* Display Settings */}
        <button 
          onClick={() => setDisplaySettingsOpen(true)}
          className="
            p-2 rounded-lg
            bg-[var(--button-bg)] text-[var(--text-secondary)]
            hover:bg-[var(--button-bg-hover)] hover:text-[var(--text-primary)]
            transition-colors
          "
          title="Display Settings"
        >
          <Eye size={16} />
        </button>

        {/* Theme selector */}
        <div className="flex items-center gap-1 px-2 py-1 bg-[var(--button-bg)] rounded-lg">
          <Palette size={14} className="text-[var(--text-muted)]" />
          <select
            value={theme}
            onChange={(e) => handleThemeChange(e.target.value as ThemeName)}
            className="
              bg-transparent text-[var(--text-secondary)] text-sm
              cursor-pointer outline-none
            "
            title="Change Theme"
          >
            {THEME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-[var(--border-color)] mx-1" />

        {/* Mode toggle */}
        <div className="flex items-center gap-1 bg-[var(--button-bg)] rounded-lg p-0.5">
          <button
            onClick={() => setMode('play')}
            className={`
              px-3 py-1 rounded-md text-xs font-semibold uppercase tracking-wide transition-all
              ${mode === 'play' 
                ? 'bg-[var(--accent-primary)] text-white shadow-sm' 
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }
            `}
          >
            Play
          </button>
          <button
            onClick={() => setMode('create')}
            disabled
            className={`
              px-3 py-1 rounded-md text-xs font-semibold uppercase tracking-wide transition-all
              ${mode === 'create' 
                ? 'bg-[var(--accent-primary)] text-white shadow-sm' 
                : 'text-[var(--text-muted)] cursor-not-allowed opacity-50'
              }
            `}
            title="Coming soon"
          >
            Create
          </button>
        </div>
      </div>
    </header>
  );
}

export default TopBar;
