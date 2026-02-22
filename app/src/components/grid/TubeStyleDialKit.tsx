/* ============================================================
   TUBE STYLE DIALKIT CONTROLS
   
   Real-time parameter tweaking for the 3D tube effect of the
   melody contours.
   ============================================================ */

import { useDialKit } from 'dialkit';

/**
 * DialKit configuration for 3D tube styling
 */
export function useTubeStyleDialKit() {
    return useDialKit('Tube Style', {
        // Shading layers
        baseDarkness: [50, 0, 100],          // How much to darken the shadow pass (%)
        bodyWidth: [0.65, 0.1, 0.95],        // Width of the main color pass (multiplier)
        highlightWidth: [0.18, 0.05, 0.5],    // Width of the specular highlight (multiplier)
        highlightOpacity: [0.5, 0, 1.0],      // Opacity of the specular highlight

        // Smoothing / Gradient simulation
        blurAmount: [0, 0, 10],               // Optional blur to soften edges
        shadowOpacity: [1.0, 0.1, 1.0],       // Opacity of the base shadow layer

        // Pass counts (Advanced)
        numSoftPasses: [3, 0, 5],             // Number of intermediate passes for smoother gradients
    });
}

export type TubeStyleDialKitParams = ReturnType<typeof useTubeStyleDialKit>;
