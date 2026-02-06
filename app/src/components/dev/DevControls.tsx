import { useEffect, useMemo, useState } from 'react';
import { X, RotateCcw } from 'lucide-react';

import { Panel } from '../ui/Panel';
import { Slider } from '../ui/Slider';

/* ============================================================
   DEV CONTROLS (Hidden Menu)

   Purpose:
   - This component adds a hidden panel you can open/close with a hotkey.
   - It lets you experiment with UI styling without touching code every time.

   How it works:
   - The controls change CSS variables on :root (document.documentElement).
   - The Grid reads those CSS variables when drawing lines.
   - Settings are saved to localStorage so they persist after refresh.

   Hotkey:
   - Ctrl + Shift + D
   ============================================================ */

// The specific CSS variables this Dev panel controls.
type GridVarKey =
  | '--grid-line-bar'
  | '--grid-line-beat'
  | '--grid-pitch-line-tonic'
  | '--grid-pitch-line';

// A simple pair of values: a color + an opacity.
interface ColorOpacity {
  // Color as hex (example: "#ffffff") because HTML color pickers use hex.
  hex: string;

  // Opacity between 0 and 1.
  opacity: number;
}

// All of the settings we want to persist.
interface DevSettings {
  // Vertical bar lines.
  bar: ColorOpacity;

  // Vertical beat lines.
  beat: ColorOpacity;

  // Horizontal note-row line for scale degree 1 (tonic).
  tonic: ColorOpacity;

  // Horizontal note-row lines for other degrees.
  other: ColorOpacity;
}

// Where we store the panel settings in the browser.
const STORAGE_KEY = 'harmonySinging.devControls.v1';

// Utility: keep numbers inside a safe range.
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Convert a hex string (#fff or #ffffff) into RGB numbers.
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.replace('#', '').trim();

  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    return { r, g, b };
  }

  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return { r, g, b };
  }

  return null;
}

// Convert a (hex color + opacity) into an rgba(...) string.
// The grid code expects rgba strings (example: rgba(255, 255, 255, 0.15)).
function rgbaFromHexAndOpacity(hex: string, opacity: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(255, 255, 255, ${opacity})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
}

// Read a CSS variable from :root.
function readCssVar(name: GridVarKey): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Convert an existing rgba(...) value (from CSS) into our {hex, opacity} structure.
function parseRgbaToColorOpacity(value: string, fallbackHex: string, fallbackOpacity: number): ColorOpacity {
  // Expected format: rgba(r, g, b, a)
  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (!match) return { hex: fallbackHex, opacity: fallbackOpacity };

  const parts = match[1].split(',').map((p) => p.trim());
  const r = Number(parts[0]);
  const g = Number(parts[1]);
  const b = Number(parts[2]);
  const a = parts[3] !== undefined ? Number(parts[3]) : fallbackOpacity;

  const toHex2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  const hex = `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;

  return {
    hex,
    opacity: clamp(Number.isFinite(a) ? a : fallbackOpacity, 0, 1),
  };
}

// Apply a CSS variable to :root.
function applyGridVar(name: GridVarKey, value: string) {
  document.documentElement.style.setProperty(name, value);
}

// Read the current theme values from CSS and treat them as "defaults".
// This means when you switch themes, Reset will go back to that theme’s values.
function getDefaultsFromCss(): DevSettings {
  // These fallbacks match index.css defaults.
  const bar = parseRgbaToColorOpacity(readCssVar('--grid-line-bar'), '#ffffff', 0.15);
  const beat = parseRgbaToColorOpacity(readCssVar('--grid-line-beat'), '#ffffff', 0.08);
  const tonic = parseRgbaToColorOpacity(readCssVar('--grid-pitch-line-tonic'), '#ffffff', 0.35);
  const other = parseRgbaToColorOpacity(readCssVar('--grid-pitch-line'), '#ffffff', 0.05);

  return { bar, beat, tonic, other };
}

// Load settings from localStorage (if any).
function loadFromStorage(): Partial<DevSettings> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<DevSettings>;
  } catch {
    return null;
  }
}

// Save settings to localStorage.
function saveToStorage(settings: DevSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures (private mode, etc.)
  }
}

export function DevControls() {
  // Whether the dev panel is visible.
  const [open, setOpen] = useState(false);

  // Initial defaults are read from the current CSS variables.
  const cssDefaults = useMemo(() => {
    // This must run in the browser; the app is client-only so this is OK.
    return getDefaultsFromCss();
  }, []);

  // Load any previously-saved dev settings.
  const [settings, setSettings] = useState<DevSettings>(() => {
    const saved = loadFromStorage();
    return {
      bar: saved?.bar ?? cssDefaults.bar,
      beat: saved?.beat ?? cssDefaults.beat,
      tonic: saved?.tonic ?? cssDefaults.tonic,
      other: saved?.other ?? cssDefaults.other,
    };
  });

  // Hotkey: Ctrl+Shift+D toggles the panel.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!(e.ctrlKey && e.shiftKey && key === 'd')) return;

      // Avoid triggering while typing in an input.
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (el as any)?.isContentEditable) return;

      e.preventDefault();
      setOpen((v) => !v);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Whenever settings change:
  // - Apply them to CSS variables immediately (so the grid updates live)
  // - Save to localStorage
  useEffect(() => {
    const barRgba = rgbaFromHexAndOpacity(settings.bar.hex, settings.bar.opacity);
    const beatRgba = rgbaFromHexAndOpacity(settings.beat.hex, settings.beat.opacity);
    const tonicRgba = rgbaFromHexAndOpacity(settings.tonic.hex, settings.tonic.opacity);
    const otherRgba = rgbaFromHexAndOpacity(settings.other.hex, settings.other.opacity);

    applyGridVar('--grid-line-bar', barRgba);
    applyGridVar('--grid-line-beat', beatRgba);
    applyGridVar('--grid-pitch-line-tonic', tonicRgba);
    applyGridVar('--grid-pitch-line', otherRgba);

    saveToStorage(settings);
  }, [settings]);

  // Helper to update a single section (bar/beat/tonic/other) without losing the rest.
  const setField = (field: keyof DevSettings, value: Partial<ColorOpacity>) => {
    setSettings((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        ...value,
      },
    }));
  };

  // Reset button:
  // - re-read default values from CSS
  // - clear localStorage so the next refresh uses the theme defaults again
  const reset = () => {
    // Reset to whatever the theme's CSS variables currently are.
    const next = getDefaultsFromCss();
    setSettings(next);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  };

  if (!open) return null;

  return (
    <div className="fixed right-6 bottom-28 z-[80] w-[360px]">
      <Panel variant="solid" className="glass-pane glass-high rounded-3xl border border-white/10 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">Dev Controls</div>
            <div className="text-[11px] text-[var(--text-dim)]">Toggle: Ctrl+Shift+D</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={reset}
              aria-label="Reset dev controls"
              className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-all duration-200 cursor-pointer"
              title="Reset"
            >
              <RotateCcw size={16} />
            </button>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close dev controls"
              className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-all duration-200 cursor-pointer"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <div className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">Grid Lines</div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-[var(--text-primary)]">Bar lines</div>
              <input
                type="color"
                value={settings.bar.hex}
                onChange={(e) => setField('bar', { hex: e.target.value })}
                aria-label="Bar line color"
                className="h-7 w-10 bg-transparent cursor-pointer"
              />
            </div>
            <Slider
              value={Math.round(settings.bar.opacity * 100)}
              min={0}
              max={100}
              onChange={(e) => setField('bar', { opacity: Number(e.target.value) / 100 })}
              aria-label="Bar line opacity"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-[var(--text-primary)]">Beat lines</div>
              <input
                type="color"
                value={settings.beat.hex}
                onChange={(e) => setField('beat', { hex: e.target.value })}
                aria-label="Beat line color"
                className="h-7 w-10 bg-transparent cursor-pointer"
              />
            </div>
            <Slider
              value={Math.round(settings.beat.opacity * 100)}
              min={0}
              max={100}
              onChange={(e) => setField('beat', { opacity: Number(e.target.value) / 100 })}
              aria-label="Beat line opacity"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-[var(--text-primary)]">Note rows (degree 1)</div>
              <input
                type="color"
                value={settings.tonic.hex}
                onChange={(e) => setField('tonic', { hex: e.target.value })}
                aria-label="Tonic note-row line color"
                className="h-7 w-10 bg-transparent cursor-pointer"
              />
            </div>
            <Slider
              value={Math.round(settings.tonic.opacity * 100)}
              min={0}
              max={100}
              onChange={(e) => setField('tonic', { opacity: Number(e.target.value) / 100 })}
              aria-label="Tonic note-row line opacity"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-[var(--text-primary)]">Note rows (other degrees)</div>
              <input
                type="color"
                value={settings.other.hex}
                onChange={(e) => setField('other', { hex: e.target.value })}
                aria-label="Other note-row line color"
                className="h-7 w-10 bg-transparent cursor-pointer"
              />
            </div>
            <Slider
              value={Math.round(settings.other.opacity * 100)}
              min={0}
              max={100}
              onChange={(e) => setField('other', { opacity: Number(e.target.value) / 100 })}
              aria-label="Other note-row line opacity"
            />
          </div>
        </div>
      </Panel>
    </div>
  );
}

export default DevControls;
