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
 * Normalize a user-entered hex color into full 6-digit lowercase format.
 * Returns null when the input is not a valid 3- or 6-digit hex color.
 */
export function normalizeHexColor(input: string): string | null {
  const clean = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(clean)) {
    return null;
  }

  if (clean.length === 3) {
    const expanded = clean
      .split('')
      .map((char) => `${char}${char}`)
      .join('');
    return `#${expanded.toLowerCase()}`;
  }

  return `#${clean.toLowerCase()}`;
}

/**
 * True when the input can be interpreted as a 3- or 6-digit hex color.
 */
export function isValidHexColor(input: string): boolean {
  return normalizeHexColor(input) !== null;
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
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
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
 * Scale degree colors based on relationship to tonic.
 */
export const SCALE_DEGREE_COLOR_MAP: Record<string, string> = {
  '1': '#5858ff',   // Tonic (root note) - blue
  'b2': '#acff59',  // Flat second - light green
  '2': '#ff59ff',   // Second - magenta
  'b3': '#59ffac',  // Minor third - turquoise
  '3': '#ff5959',   // Major third - red
  '4': '#59acff',   // Fourth - light blue
  '#4': '#ffff59',  // Sharp fourth/tritone - yellow
  '5': '#ac59ff',   // Fifth - purple
  'b6': '#59ff59',  // Minor sixth - green
  '6': '#ff59ac',   // Major sixth - pink
  'b7': '#59ffff',  // Minor seventh - cyan
  '7': '#ffac59',   // Major seventh - orange
};

/**
 * Get the color for a specific scale degree label.
 * Fallback to a neutral gray if not found.
 */
export function getScaleDegreeColor(degreeLabel: string): string {
  // Handle sharp/flat variations if they occur
  const normalizedLabel = degreeLabel.replace('♭', 'b');
  return SCALE_DEGREE_COLOR_MAP[normalizedLabel] || '#888888';
}

/**
 * Available theme names.
 */
const THEME_NAMES = [
  'default',        // Base purple theme
  'cosmic',         // Deeper cosmic purple
  'minimal-dark',   // Clean dark
  'minimal-light',  // Clean light
  'sunset',         // Warm oranges/reds
  'ocean',          // Cool blues/teals
] as const;

export type ThemeName = typeof THEME_NAMES[number];

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

