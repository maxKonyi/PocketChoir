/* ============================================================
   TOP BAR COMPONENT
   
   Global navigation and settings bar at the top of the app.
   Contains: Level/Preset, Range, Mic Setup, Display, Mode toggle
   ============================================================ */

import { Music, Mic, Settings, Library } from 'lucide-react';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
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
  const setLibraryOpen = useAppStore((state) => state.setLibraryOpen);
  const setMicSetupOpen = useAppStore((state) => state.setMicSetupOpen);
  const setRangeSetupOpen = useAppStore((state) => state.setRangeSetupOpen);
  const setDisplaySettingsOpen = useAppStore((state) => state.setDisplaySettingsOpen);
  const setMode = useAppStore((state) => state.setMode);
  const setTheme = useAppStore((state) => state.setTheme);

  /**
   * Handle theme change.
   */
  const handleThemeChange = (newTheme: ThemeName) => {
    setTheme(newTheme);
    applyTheme(newTheme);
  };

  return (
    <Panel 
      variant="solid" 
      className="flex items-center justify-between px-4 py-2 rounded-none border-x-0 border-t-0"
    >
      {/* Left side - Level/Preset button */}
      <div className="flex items-center gap-2">
        <Button
          variant="default"
          onClick={() => setLibraryOpen(true)}
          className="gap-2"
        >
          <Library size={16} />
          <span className="hidden sm:inline">
            {arrangement ? arrangement.title : 'Select Arrangement'}
          </span>
        </Button>
      </div>

      {/* Center - Settings buttons */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRangeSetupOpen(true)}
          title="Vocal Range Settings"
        >
          <Music size={16} />
          <span className="hidden md:inline ml-1">Range</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMicSetupOpen(true)}
          title="Microphone Setup"
        >
          <Mic size={16} />
          <span className="hidden md:inline ml-1">Mic Setup</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDisplaySettingsOpen(true)}
          title="Display Settings"
        >
          <Settings size={16} />
          <span className="hidden md:inline ml-1">Display</span>
        </Button>

        {/* Theme selector */}
        <select
          value={theme}
          onChange={(e) => handleThemeChange(e.target.value as ThemeName)}
          className="
            h-7 px-2 text-xs
            bg-[var(--button-bg)] 
            border border-[var(--border-color)]
            rounded-[var(--radius-sm)]
            text-[var(--text-primary)]
            cursor-pointer
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

      {/* Right side - Mode toggle */}
      <div className="flex items-center gap-1 bg-[var(--button-bg)] rounded-[var(--radius-md)] p-1">
        <Button
          variant={mode === 'play' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setMode('play')}
        >
          Play
        </Button>
        <Button
          variant={mode === 'create' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setMode('create')}
          disabled  // Create mode disabled for MVP
          title="Create mode coming soon"
        >
          Create
        </Button>
      </div>
    </Panel>
  );
}

export default TopBar;
