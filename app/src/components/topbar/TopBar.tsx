/* ============================================================
   TOP BAR COMPONENT
   
   Global navigation and settings bar at the top of the app.
   Controls: Library, Mic Setup, Display Settings, Theme, Mode Toggle
   ============================================================ */

import { Library, Mic, Eye, Palette, Download, Sliders } from 'lucide-react';
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
  const setMixerOpen = useAppStore((state) => state.setMixerOpen);
  const setMicSetupOpen = useAppStore((state) => state.setMicSetupOpen);
  const setDisplaySettingsOpen = useAppStore((state) => state.setDisplaySettingsOpen);
  const setMode = useAppStore((state) => state.setMode);
  const setTheme = useAppStore((state) => state.setTheme);
  const setCreateModalOpen = useAppStore((state) => state.setCreateModalOpen);

  /**
   * Export the current arrangement as JSON file.
   */
  const handleExportArrangement = () => {
    if (!arrangement) return;

    // Create a clean copy of the arrangement for export
    const exportData = {
      id: arrangement.id,
      title: arrangement.title,
      description: arrangement.description || '',
      tonic: arrangement.tonic,
      scale: arrangement.scale,
      tempo: arrangement.tempo,
      bars: arrangement.bars,
      timeSig: arrangement.timeSig,
      voices: arrangement.voices.map(v => ({
        id: v.id,
        name: v.name,
        color: v.color,
        nodes: v.nodes,
      })),
      chords: arrangement.chords || [],
    };

    // Convert to JSON string with formatting
    const jsonString = JSON.stringify(exportData, null, 2);

    // Create a blob and download link
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Create temporary link and trigger download
    const link = document.createElement('a');
    link.href = url;
    link.download = `${arrangement.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up the URL
    URL.revokeObjectURL(url);
  };

  /**
   * Handle theme change from dropdown.
   */
  const handleThemeChange = (newTheme: ThemeName) => {
    setTheme(newTheme);
    applyTheme(newTheme);
  };

  return (
    <header className="
      absolute top-4 left-[calc(11rem+50px)] right-[calc(2rem+20px)]
      h-14 px-6
      glass-pane glass-med rounded-2xl
      flex items-center justify-between
      z-30 shadow-2xl
    ">

      {/* Left section - App title */}
      <div className="flex items-center gap-4">
        <span className="text-lg font-bold text-[var(--accent-primary)]">
          ♫ Harmony
        </span>
      </div>

      {/* Center - Library / Arrangement selector */}
      <div className="absolute left-1/2 -translate-x-1/2">
        <button
          onClick={() => setLibraryOpen(true)}
          className="
            flex items-center gap-2 px-4 py-2
            bg-[var(--button-bg)] text-[var(--text-primary)]
            rounded-full text-base font-medium
            hover:bg-[var(--button-bg-hover)] transition-all
            border border-[var(--border-color)]
            shadow-sm hover:shadow-md
          "
          title="Open Library"
        >
          <Library size={16} />
          <span className="max-w-[300px] truncate">
            {arrangement?.title || 'Choose Arrangement...'}
          </span>
        </button>
      </div>

      {/* Right section - Settings buttons and mode toggle */}
      <div className="flex items-center gap-2">
        {/* Mixer */}
        <button
          onClick={() => setMixerOpen(true)}
          className="
            p-2 rounded-lg
            bg-[var(--button-bg)] text-[var(--text-secondary)]
            hover:bg-[var(--button-bg-hover)] hover:text-[var(--text-primary)]
            transition-colors
          "
          title="Mixer"
        >
          <Sliders size={16} />
        </button>

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

        {/* Export button (only in Create mode with arrangement) */}
        {mode === 'create' && arrangement && (
          <button
            onClick={handleExportArrangement}
            className="
              p-2 rounded-lg
              bg-[var(--accent-secondary)] text-white
              hover:brightness-110
              transition-all
            "
            title="Export Arrangement as JSON"
          >
            <Download size={16} />
          </button>
        )}

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
            onClick={() => {
              setMode('create');
              setCreateModalOpen(true);
            }}
            className={`
              px-3 py-1 rounded-md text-xs font-semibold uppercase tracking-wide transition-all
              ${mode === 'create'
                ? 'bg-[var(--accent-primary)] text-white shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }
            `}
            title="Create new arrangement"
          >
            Create
          </button>
        </div>
      </div>
    </header>
  );
}

export default TopBar;
