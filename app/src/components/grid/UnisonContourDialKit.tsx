/* ============================================================
   UNISON CONTOUR DIALKIT CONTROLS
   
   Real-time parameter tweaking for rainbow gradient and glow
   styling of unison contour lines (where multiple voices play
   the same notes at once).
   ============================================================ */

import { useDialKit } from 'dialkit';

/**
 * DialKit configuration for unison contour styling
 * Provides real-time controls for:
 * - Rainbow gradient colors and animation
 * - Glow intensity and styling
 * - Prism cycle speed and spacing
 */
export function useUnisonContourDialKit() {
  return useDialKit('Unison Contour', {
    // Rainbow gradient controls
    prismCyclePx: [200, 200, 800],        // Distance for one full rainbow cycle
    rainbowSaturation: [80, 30, 80],       // Color saturation (HSL percentage)
    rainbowLightness: [89, 70, 95],        // Color brightness (HSL percentage)
    rainbowStopCount: [6, 3, 12],          // Number of gradient stops
    rainbowStopSpacing: [1, 0.1, 3],       // Horizontal spacing multiplier for color segments
    
    // Glow effects
    unisonGlowIntensity: [0, 0, 3],      // Multiplier for glow on unison lines
    unisonGlowBlur: [15, 5, 30],          // Blur radius for glow effect
    unisonGlowSpread: [2, 0.5, 5],        // How much glow spreads outward
    
    // Animation and movement
    rainbowPhaseSpeed: [100, 0, 100],          // Speed of rainbow animation (0 = static)
    rainbowHueShift: [0, -180, 180],      // Overall hue offset
    
    // Visual styling
    unisonOpacity: [1, 0.3, 1],           // Overall opacity of unison lines
    
    // Advanced options
    enablePrismaticGradient: true,         // Toggle rainbow effect on/off
    enableUnisonGlow: false,               // Toggle glow on unison lines
    blendMode: 'screen',                   // CSS blend mode for glow
  });
}

/**
 * Helper function to apply DialKit settings to canvas context
 * for rendering unison contours with the tweaked parameters
 */
export function applyUnisonContourDialKitSettings(
  ctx: CanvasRenderingContext2D,
  dialKitParams: ReturnType<typeof useUnisonContourDialKit>
) {
  // Apply glow settings if enabled
  if (dialKitParams.enableUnisonGlow) {
    ctx.shadowBlur = dialKitParams.unisonGlowBlur * dialKitParams.unisonGlowIntensity;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = dialKitParams.unisonGlowSpread;
  }
  
  // Set opacity 
  ctx.globalAlpha = dialKitParams.unisonOpacity;
}

/**
 * Enhanced gradient creator that uses DialKit parameters
 */
export function createDialKitPrismaticContourGradient(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  phaseSeedX: number,
  dialKitParams: ReturnType<typeof useUnisonContourDialKit>
): CanvasGradient {
  const hasLength = Math.abs(endX - startX) > 0.001 || Math.abs(endY - startY) > 0.001;
  const safeEndX = hasLength ? endX : startX + 1;
  const safeEndY = hasLength ? endY : startY;
  const gradient = ctx.createLinearGradient(startX, startY, safeEndX, safeEndY);

  // Use DialKit parameters
  const PRISM_CYCLE_PX = dialKitParams.prismCyclePx;
  const dist = Math.sqrt((safeEndX - startX) ** 2 + (safeEndY - startY) ** 2);

  // Apply DialKit color settings
  const getRainbowColorByDistance = (distancePx: number) => {
    const hue = (((phaseSeedX + distancePx + dialKitParams.rainbowHueShift) / PRISM_CYCLE_PX) * 360) % 360;
    return `hsl(${hue.toFixed(1)} ${dialKitParams.rainbowSaturation}% ${dialKitParams.rainbowLightness}%)`;
  };

  const stopCount = Math.floor(dialKitParams.rainbowStopCount);
  const spacing = dialKitParams.rainbowStopSpacing;
  
  for (let i = 0; i <= stopCount; i++) {
    // Apply spacing multiplier to control how wide each color segment is
    // Higher values = wider color bands, lower values = more frequent color changes
    const p = (i / stopCount) * spacing;
    const clampedP = Math.min(p, 1); // Ensure we don't go beyond 1.0
    gradient.addColorStop(clampedP, getRainbowColorByDistance(dist * clampedP));
  }

  return gradient;
}

/**
 * Get prismatic color at specific phase using DialKit settings
 */
export function getDialKitPrismaticContourColorAtPhase(
  phaseSeedX: number,
  dialKitParams: ReturnType<typeof useUnisonContourDialKit>
): string {
  const PRISM_CYCLE_PX = dialKitParams.prismCyclePx;
  const hue = (((phaseSeedX + dialKitParams.rainbowHueShift) / PRISM_CYCLE_PX) * 360) % 360;
  const normalizedHue = (hue + 360) % 360;
  return `hsl(${normalizedHue.toFixed(1)} ${dialKitParams.rainbowSaturation}% ${dialKitParams.rainbowLightness}%)`;
}
