/* ============================================================
   PITCH DETECTION UTILITY
   
   A simple adaptation of the McLeod Pitch Method (MPM) or YIN 
   algorithm concept for finding fundamental frequency (f0) 
   from a time-domain audio buffer.
   ============================================================ */



/**
 * Detect pitch from an audio buffer using autocorrelation.
 * Returns the fundamental frequency (Hz) or null if no clear pitch found.
 * 
 * @param buffer - Float32Array of audio samples
 * @param sampleRate - Sample rate of the audio context
 * @returns frequency (Hz) or null
 */
export function detectPitch(buffer: Float32Array, sampleRate: number): number | null {
    const SIZE = buffer.length;

    // Quick RMS check for silence.
    let rmsSum = 0;
    for (let i = 0; i < SIZE; i++) {
        const v = buffer[i];
        rmsSum += v * v;
    }
    const rms = Math.sqrt(rmsSum / SIZE);
    if (rms < 0.008) return null;

    // Frequency search range.
    // We extend lower than 80Hz for low voices.
    const minFreq = 50;
    const maxFreq = 1200;
    const minPeriod = Math.floor(sampleRate / maxFreq);
    const maxPeriod = Math.min(Math.floor(sampleRate / minFreq), Math.floor(SIZE / 2));

    // Normalized autocorrelation: corr(p) = sum(x[i]*x[i+p]) / sqrt(sum(x[i]^2)*sum(x[i+p]^2))
    // We keep an array so we can find local peaks.
    const correlations = new Float32Array(maxPeriod + 1);
    let absoluteBest = -1;

    for (let p = minPeriod; p <= maxPeriod; p++) {
        let sum = 0;
        let norm1 = 0;
        let norm2 = 0;

        // Limit work for performance.
        const len = Math.min(SIZE - p, 1024);
        for (let i = 0; i < len; i++) {
            const a = buffer[i];
            const b = buffer[i + p];
            sum += a * b;
            norm1 += a * a;
            norm2 += b * b;
        }

        const denom = Math.sqrt(norm1 * norm2);
        const corr = denom > 0 ? (sum / denom) : 0;
        correlations[p] = corr;
        if (corr > absoluteBest) absoluteBest = corr;
    }

    // If correlation is weak, give up.
    if (absoluteBest < 0.35) return null;

    // Prefer the FIRST strong peak (shortest period => higher fundamental).
    // This reduces octave-halving errors.
    const peakThreshold = absoluteBest * 0.85;
    let bestPeriod = -1;
    for (let p = minPeriod + 1; p < maxPeriod; p++) {
        const c = correlations[p];
        if (c > peakThreshold && c > correlations[p - 1] && c > correlations[p + 1]) {
            bestPeriod = p;
            break;
        }
    }

    // Fallback: use absolute best if we didn't find a clear local peak.
    if (bestPeriod === -1) {
        let best = -1;
        for (let p = minPeriod; p <= maxPeriod; p++) {
            if (correlations[p] > best) {
                best = correlations[p];
                bestPeriod = p;
            }
        }
    }

    if (bestPeriod <= 0) return null;

    // Parabolic interpolation around the peak for slightly better precision.
    // We interpolate the period, not the frequency.
    const p0 = Math.max(minPeriod, bestPeriod - 1);
    const p1 = bestPeriod;
    const p2 = Math.min(maxPeriod, bestPeriod + 1);

    const y0 = correlations[p0];
    const y1 = correlations[p1];
    const y2 = correlations[p2];

    const denom = 2 * (y0 - 2 * y1 + y2);
    const delta = Math.abs(denom) > 1e-6 ? (y0 - y2) / denom : 0;
    const refinedPeriod = p1 + delta;

    const frequency = sampleRate / refinedPeriod;
    if (!Number.isFinite(frequency) || frequency < minFreq || frequency > maxFreq) return null;
    return frequency;
}
