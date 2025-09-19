import { Noise } from 'noisejs';

/**
 * Sample a domain-warped simplex noise field mapped to [0, 1].
 * The number of steps controls how many successive warps are applied.
 */
export function warpedSimplexNoise(
    noise: Noise,
    x: number,
    y: number,
    steps = 3,
    lacunarity = 2,
    gain = 0.5,
): number {
    const iterations = Math.max(1, Math.floor(steps));
    let px = x;
    let py = y;
    let frequency = 1;
    let strength = 0.75;
    for (let i = 0; i < iterations; i++) {
        const offsetX = 17.27 + i * 11.73;
        const offsetY = -31.91 + i * 7.53;
        const warpX = noise.simplex2(px * frequency + offsetX, py * frequency + offsetY);
        const warpY = noise.simplex2(px * frequency - offsetY, py * frequency + offsetX);
        px += warpX * strength;
        py += warpY * strength;
        frequency *= lacunarity;
        strength *= gain;
        if (strength < 1e-4) break;
    }
    const value = noise.simplex2(px, py);
    return value * 0.5 + 0.5;
}

/**
 * Convenience helper returning a signed value in the range [-1, 1].
 */
export function warpedSimplexNoiseSigned(
    noise: Noise,
    x: number,
    y: number,
    steps = 3,
    lacunarity = 2,
    gain = 0.5,
): number {
    return warpedSimplexNoise(noise, x, y, steps, lacunarity, gain) * 2 - 1;
}
