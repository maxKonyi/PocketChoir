/* ============================================================
   TOP BAR COMPONENT
   
   Global navigation and settings bar at the top of the app.
   Matches mockup: Synth controls | Level/Preset | Range | Mic Setup | Display | Play/Create
   ============================================================ */

import { Play, SkipForward } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { THEME_NAMES, getThemeLabel, applyTheme } from '../../utils/colors';
import type { ThemeName } from '../../utils/colors';

/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export function TopBar() {
  // Get state and actions from store
  const arrangement = useAppStore((state) => state.arrangement);
  const mode = useAppStore((state) => state.mode);
  const theme = useAppStore((state) => state.theme);
  const playback = useAppStore((state) => state.playback);
  const setLibraryOpen = useAppStore((state) => state.setLibraryOpen);
  const setMicSetupOpen = useAppStore((state) => state.setMicSetupOpen);
  const setRangeSetupOpen = useAppStore((state) => state.setRangeSetupOpen);
  const setDisplaySettingsOpen = useAppStore((state) => state.setDisplaySettingsOpen);
  const setMode = useAppStore((state) => state.setMode);
  const setTheme = useAppStore((state) => state.setTheme);
  const setPlaying = useAppStore((state) => state.setPlaying);

  /**
   * Handle theme change.
   */
  const handleThemeChange = (newTheme: ThemeName) => {
    setTheme(newTheme);
    applyTheme(newTheme);
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-[var(--bg-secondary)]/60 backdrop-blur-md border-b border-white/5">
      {/* Left side - Synth controls (like mockup) */}
      <div className="flex items-center gap-2">
        {/* Synth play button */}
        <button
          onClick={() => setPlaying(!playback.isPlaying)}
          className="
            flex items-center gap-2 px-3 py-1.5
            bg-[var(--accent-primary)]/20 
            hover:bg-[var(--accent-primary)]/30
            border border-[var(--accent-primary)]/30
            rounded-full
            text-[var(--text-primary)] text-sm font-medium
            transition-all
          "
          disabled={!arrangement}
        >
          <Play size={14} fill="currentColor" className={playback.isPlaying ? 'text-[var(--accent-primary)]' : ''} />
          <span>Synth</span>
        </button>
        
        {/* Skip forward */}
        <button
          className="
            p-1.5 rounded-full
            text-[var(--text-secondary)]
            hover:text-[var(--text-primary)]
            hover:bg-white/5
            transition-colors
          "
          title="Skip forward"
        >
          <SkipForward size={14} />
        </button>
      </div>

      {/* Center - Navigation buttons (pill-shaped like mockup) */}
      <div className="flex items-center gap-2">
        {/* Level/Preset button */}
        <button
          onClick={() => setLibraryOpen(true)}
          className="
            px-4 py-1.5
            bg-[var(--button-bg)]/60 hover:bg-[var(--button-bg)]
            border border-white/10
            rounded-full
            text-[var(--text-primary)] text-sm
            transition-colors
          "
        >
          {arrangement ? arrangement.title : 'LEVEL/PRESET'}
        </button>

        <button
          onClick={() => setRangeSetupOpen(true)}
          className="
            px-4 py-1.5
            bg-[var(--button-bg)]/60 hover:bg-[var(--button-bg)]
            border border-white/10
            rounded-full
            text-[var(--text-primary)] text-sm
            transition-colors
          "
          title="Vocal Range Settings"
        >
          RANGE
        </button>

        <button
          onClick={() => setMicSetupOpen(true)}
          className="
            px-4 py-1.5
            bg-[var(--button-bg)]/60 hover:bg-[var(--button-bg)]
            border border-white/10
            rounded-full
            text-[var(--text-primary)] text-sm
            transition-colors
          "
          title="Microphone Setup"
        >
          MIC SETUP
        </button>

        <button
          onClick={() => setDisplaySettingsOpen(true)}
          className="
            px-4 py-1.5
            bg-[var(--button-bg)]/60 hover:bg-[var(--button-bg)]
            border border-white/10
            rounded-full
            text-[var(--text-primary)] text-sm
            transition-colors
          "
          title="Display Settings"
        >
          DISPLAY
        </button>

        {/* Theme selector (compact) */}
        <select
          value={theme}
          onChange={(e) => handleThemeChange(e.target.value as ThemeName)}
          className="
            px-3 py-1.5 text-xs
            bg-[var(--button-bg)]/60
            border border-white/10
            rounded-full
            text-[var(--text-primary)]
            cursor-pointer
            appearance-none
          "
          title="Change Theme"
        >
          {THEME_NAMES.map((t) => (
            <option key={t} value={t}>
              {getThemeLabel(t)}
            </option>
          ))}
        </select>
      </div>

      {/* Right side - Mode toggle (pill style) */}
      <div className="flex items-center">
        <div className="flex bg-[var(--button-bg)]/60 rounded-full border border-white/10 p-0.5">
          <button
            onClick={() => setMode('play')}
            className={`
              px-4 py-1 text-sm font-medium rounded-full transition-all
              ${mode === 'play' 
                ? 'bg-[var(--accent-secondary)] text-white shadow-lg' 
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }
            `}
          >
            PLAY
          </button>
          <button
            onClick={() => setMode('create')}
            disabled
            className={`
              px-4 py-1 text-sm font-medium rounded-full transition-all
              ${mode === 'create' 
                ? 'bg-[var(--accent-secondary)] text-white shadow-lg' 
                : 'text-[var(--text-muted)] cursor-not-allowed'
              }
            `}
            title="Create mode coming soon"
          >
            CREATE
          </button>
        </div>
      </div>
    </div>
  );
}

export default TopBar;
