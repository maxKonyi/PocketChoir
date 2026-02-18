/* ============================================================
   UNISON CONTOUR DIALKIT DEMO
   
   Shows the current DialKit control values.
   This component receives the params as props to avoid creating
   duplicate DialKit panels - the hook should only be called once.
   ============================================================ */

import type { useUnisonContourDialKit } from './UnisonContourDialKit';

// Type for the DialKit parameters
type DialKitParams = ReturnType<typeof useUnisonContourDialKit>;

interface UnisonContourDemoProps {
  params: DialKitParams;
}

/**
 * Demo component that shows the current DialKit settings
 * Receives params as props to avoid duplicate panels
 */
export function UnisonContourDemo({ params }: UnisonContourDemoProps) {
  return (
    <div className="text-xs text-[var(--text-secondary)] space-y-1">
      <p className="font-semibold text-[var(--text-primary)]">Unison Contour DialKit Active</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="text-[var(--accent-primary-light)]">Rainbow:</span> {params.enablePrismaticGradient ? 'ON' : 'OFF'}
        </div>
        <div>
          <span className="text-[var(--accent-primary-light)]">Glow:</span> {params.enableUnisonGlow ? 'ON' : 'OFF'}
        </div>
        <div>
          <span className="text-[var(--accent-primary-light)]">Cycle:</span> {params.prismCyclePx.toFixed(0)}px
        </div>
        <div>
          <span className="text-[var(--accent-primary-light)]">Spacing:</span> {params.rainbowStopSpacing.toFixed(1)}x
        </div>
        <div>
          <span className="text-[var(--accent-primary-light)]">Saturation:</span> {params.rainbowSaturation.toFixed(0)}%
        </div>
        <div>
          <span className="text-[var(--accent-primary-light)]">Lightness:</span> {params.rainbowLightness.toFixed(0)}%
        </div>
        <div>
          <span className="text-[var(--accent-primary-light)]">Glow Intensity:</span> {params.unisonGlowIntensity.toFixed(1)}
        </div>
        <div>
          <span className="text-[var(--accent-primary-light)]">Glow Blur:</span> {params.unisonGlowBlur.toFixed(0)}px
        </div>
        <div>
          <span className="text-[var(--accent-primary-light)]">Hue Shift:</span> {params.rainbowHueShift.toFixed(0)}°
        </div>
        <div>
          <span className="text-[var(--accent-primary-light)]">Opacity:</span> {params.unisonOpacity.toFixed(2)}
        </div>
      </div>
    </div>
  );
}
