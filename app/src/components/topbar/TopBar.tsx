/* ============================================================
   TOP BAR COMPONENT
   
   Global navigation and settings bar at the top of the app.
   Controls: Library, Mic Setup, Display Settings, Theme, Mode Toggle
   ============================================================ */

import { Library, Mic, Eye, Palette, Download, Sliders } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { applyTheme, type ThemeName } from '../../utils/colors';
import { AudioService } from '../../services/AudioService';

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
  const setCreateModalMode = useAppStore((state) => state.setCreateModalMode);

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
      z-30 shadow-2xl shimmer
    ">

      {/* Left section - App title with gradient text */}
      <div className="flex items-center gap-3">
        <span className="
          text-lg font-bold tracking-wide
          bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-secondary)]
          bg-clip-text text-transparent
          drop-shadow-[0_0_12px_var(--accent-primary-glow)]
        ">
          ♫ Harmony
        </span>
      </div>

      {/* Center - Library / Arrangement selector */}
      <div className="absolute left-1/2 -translate-x-1/2">
        <button
          onClick={() => {
            // In Create mode, clicking the arrangement name should edit the current arrangement
            // (do not jump to the library / other arrangements).
            if (mode === 'create' && arrangement) {
              setCreateModalMode('edit');
              setCreateModalOpen(true);
              return;
            }

            setLibraryOpen(true);
          }}
          aria-label={mode === 'create' && arrangement ? 'Edit Arrangement' : 'Open Library'}
          className="
            flex items-center gap-2.5 px-5 py-2
            bg-[var(--button-bg)] text-[var(--text-primary)]
            rounded-full text-sm font-medium
            hover:bg-[var(--button-bg-hover)] transition-all duration-200
            border border-[var(--border-color)] hover:border-[var(--border-color-strong)]
            shadow-sm hover:shadow-[0_0_20px_-5px_var(--accent-primary-glow)]
            cursor-pointer group
          "
          title={mode === 'create' && arrangement ? 'Edit Arrangement' : 'Open Library'}
        >
          <Library size={15} className="text-[var(--accent-primary)] group-hover:scale-110 transition-transform duration-200" />
          <span className="max-w-[280px] truncate">
            {arrangement?.title || 'Choose Arrangement...'}
          </span>
        </button>
      </div>

      {/* Right section - Settings buttons and mode toggle */}
      <div className="flex items-center gap-1.5">
        {/* Mixer */}
        <button
          onClick={() => setMixerOpen(true)}
          aria-label="Open Mixer"
          className="
            p-2.5 rounded-xl
            text-[var(--text-secondary)]
            hover:bg-white/10 hover:text-[var(--text-primary)]
            hover:shadow-[0_0_15px_-3px_rgba(255,255,255,0.1)]
            transition-all duration-200 cursor-pointer
          "
          title="Mixer"
        >
          <Sliders size={16} />
        </button>

        {/* Mic Setup */}
        <button
          onClick={() => {
            void (async () => {
              try {
                if (!AudioService.isReady()) {
                  await AudioService.initialize();
                }
                await AudioService.resume();
                AudioService.fadeTransportGain(1, 0.02);
              } catch (e) {
                console.warn('Failed to initialize audio for Mic Setup:', e);
              }
            })();

            setMicSetupOpen(true);
          }}
          aria-label="Microphone Setup"
          className="
            p-2.5 rounded-xl
            text-[var(--text-secondary)]
            hover:bg-white/10 hover:text-[var(--text-primary)]
            hover:shadow-[0_0_15px_-3px_rgba(255,255,255,0.1)]
            transition-all duration-200 cursor-pointer
          "
          title="Microphone Setup"
        >
          <Mic size={16} />
        </button>

        {/* Display Settings */}
        <button
          onClick={() => setDisplaySettingsOpen(true)}
          aria-label="Display Settings"
          className="
            p-2.5 rounded-xl
            text-[var(--text-secondary)]
            hover:bg-white/10 hover:text-[var(--text-primary)]
            hover:shadow-[0_0_15px_-3px_rgba(255,255,255,0.1)]
            transition-all duration-200 cursor-pointer
          "
          title="Display Settings"
        >
          <Eye size={16} />
        </button>

        {/* Subtle divider */}
        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Theme selector */}
        <div className="
          flex items-center gap-1.5 px-2.5 py-1.5
          bg-white/5 rounded-xl border border-white/5
          hover:bg-white/8 transition-all duration-200
        ">
          <Palette size={13} className="text-[var(--accent-primary)] opacity-70" />
          <select
            value={theme}
            onChange={(e) => handleThemeChange(e.target.value as ThemeName)}
            className="
              bg-transparent text-[var(--text-secondary)] text-xs font-medium
              cursor-pointer outline-none
            "
            title="Change Theme"
            aria-label="Change Theme"
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
            aria-label="Export Arrangement"
            className="
              p-2.5 rounded-xl
              bg-[var(--accent-secondary)]/20 text-[var(--accent-secondary-light)]
              border border-[var(--accent-secondary)]/20
              hover:bg-[var(--accent-secondary)]/30 hover:border-[var(--accent-secondary)]/40
              hover:shadow-[0_0_20px_-5px_var(--accent-secondary-glow)]
              transition-all duration-200 cursor-pointer
            "
            title="Export Arrangement as JSON"
          >
            <Download size={16} />
          </button>
        )}

        {/* Subtle divider */}
        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Mode toggle - pill style */}
        <div className="flex items-center gap-0.5 bg-white/5 rounded-xl p-1 border border-white/5">
          <button
            onClick={() => setMode('play')}
            aria-label="Play Mode"
            className={`
              px-3.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all duration-200 cursor-pointer
              ${mode === 'play'
                ? 'bg-[var(--accent-primary)] text-white shadow-[0_0_15px_-3px_var(--accent-primary-glow)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5'
              }
            `}
          >
            Play
          </button>
          <button
            onClick={() => {
              setCreateModalMode('create');
              setMode('create');
              setCreateModalOpen(true);
            }}
            aria-label="Create Mode"
            className={`
              px-3.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all duration-200 cursor-pointer
              ${mode === 'create'
                ? 'bg-[var(--accent-primary)] text-white shadow-[0_0_15px_-3px_var(--accent-primary-glow)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5'
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
