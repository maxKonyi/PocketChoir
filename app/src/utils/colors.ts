/* ============================================================
   COLOR UTILITIES
   
   Helper functions for working with colors in the app.
   Handles voice colors, theme colors, and color manipulation.
   ============================================================ */

/**
 * Default voice colors matching the CSS variables.
 * These are used when an arrangement doesn't specify custom colors.
 */
export const DEFAULT_VOICE_COLORS = [
  { color: '#ff6b9d', glow: 'rgba(255, 107, 157, 0.5)' }, // Voice 1 - Pink
  { color: '#4ecdc4', glow: 'rgba(78, 205, 196, 0.5)' },  // Voice 2 - Teal
  { color: '#ffe66d', glow: 'rgba(255, 230, 109, 0.5)' }, // Voice 3 - Yellow
  { color: '#ff8c42', glow: 'rgba(255, 140, 66, 0.5)' },  // Voice 4 - Orange
  { color: '#a78bfa', glow: 'rgba(167, 139, 250, 0.5)' }, // Voice 5 - Purple
  { color: '#34d399', glow: 'rgba(52, 211, 153, 0.5)' },  // Voice 6 - Green
];

/**
 * Get the color for a voice by index.
 * @param voiceIndex - 0-based voice index
 * @returns Object with color and glow color
 */
export function getVoiceColor(voiceIndex: number): { color: string; glow: string } {
  return DEFAULT_VOICE_COLORS[voiceIndex % DEFAULT_VOICE_COLORS.length];
}

/**
 * Get a CSS variable name for a voice color.
 * @param voiceIndex - 0-based voice index
 * @returns CSS variable name (e.g., "--voice-1")
 */
export function getVoiceColorVar(voiceIndex: number): string {
  return `--voice-${voiceIndex + 1}`;
}

/**
 * Get a CSS variable name for a voice glow color.
 * @param voiceIndex - 0-based voice index
 * @returns CSS variable name (e.g., "--voice-1-glow")
 */
export function getVoiceGlowVar(voiceIndex: number): string {
  return `--voice-${voiceIndex + 1}-glow`;
}

/**
 * Parse a hex color to RGB components.
 * @param hex - Hex color string (e.g., "#ff6b9d" or "ff6b9d")
 * @returns Object with r, g, b values (0-255)
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  // Remove # if present
  const cleanHex = hex.replace(/^#/, '');
  
  // Parse 3-character or 6-character hex
  let r: number, g: number, b: number;
  
  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16);
    g = parseInt(cleanHex[1] + cleanHex[1], 16);
    b = parseInt(cleanHex[2] + cleanHex[2], 16);
  } else if (cleanHex.length === 6) {
    r = parseInt(cleanHex.slice(0, 2), 16);
    g = parseInt(cleanHex.slice(2, 4), 16);
    b = parseInt(cleanHex.slice(4, 6), 16);
  } else {
    return null;
  }
  
  return { r, g, b };
}

/**
 * Convert RGB to hex color string.
 * @param r - Red (0-255)
 * @param g - Green (0-255)
 * @param b - Blue (0-255)
 * @returns Hex color string (e.g., "#ff6b9d")
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Create an RGBA color string from hex and alpha.
 * @param hex - Hex color string
 * @param alpha - Alpha value (0-1)
 * @returns RGBA color string
 */
export function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(0, 0, 0, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/**
 * Lighten a color by a percentage.
 * @param hex - Hex color string
 * @param percent - Percentage to lighten (0-100)
 * @returns Lightened hex color
 */
export function lightenColor(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  
  const factor = percent / 100;
  const r = Math.min(255, rgb.r + (255 - rgb.r) * factor);
  const g = Math.min(255, rgb.g + (255 - rgb.g) * factor);
  const b = Math.min(255, rgb.b + (255 - rgb.b) * factor);
  
  return rgbToHex(r, g, b);
}

/**
 * Darken a color by a percentage.
 * @param hex - Hex color string
 * @param percent - Percentage to darken (0-100)
 * @returns Darkened hex color
 */
export function darkenColor(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  
  const factor = 1 - percent / 100;
  const r = rgb.r * factor;
  const g = rgb.g * factor;
  const b = rgb.b * factor;
  
  return rgbToHex(r, g, b);
}

/**
 * Available theme names.
 */
export const THEME_NAMES = [
  'default',        // Base purple theme
  'cosmic',         // Deeper cosmic purple
  'minimal-dark',   // Clean dark
  'minimal-light',  // Clean light
  'sunset',         // Warm oranges/reds
  'ocean',          // Cool blues/teals
] as const;

export type ThemeName = typeof THEME_NAMES[number];

/**
 * Get a human-readable label for a theme.
 * @param theme - Theme name
 * @returns Display label
 */
export function getThemeLabel(theme: ThemeName): string {
  const labels: Record<ThemeName, string> = {
    'default': 'Default',
    'cosmic': 'Cosmic',
    'minimal-dark': 'Minimal Dark',
    'minimal-light': 'Minimal Light',
    'sunset': 'Sunset',
    'ocean': 'Ocean',
  };
  return labels[theme];
}

/**
 * Apply a theme to the document.
 * @param theme - Theme name to apply
 */
export function applyTheme(theme: ThemeName): void {
  if (theme === 'default') {
    // Remove data-theme attribute to use :root defaults
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

/**
 * Get the currently applied theme.
 * @returns Current theme name
 */
export function getCurrentTheme(): ThemeName {
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme && THEME_NAMES.includes(theme as ThemeName)) {
    return theme as ThemeName;
  }
  return 'default';
}
