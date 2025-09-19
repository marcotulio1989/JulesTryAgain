import { Noise } from 'noisejs';
import { sampleWarpedNoise } from '../lib/noiseField';

export interface NoiseMaskOptions {
    width: number;
    height: number;
    minX: number;
    minY: number;
    seed?: number;
    baseScale?: number;
    octaves?: number;
    lacunarity?: number;
    gain?: number;
    buckets?: number;
    maxActiveBuckets?: number;
    activeBucketStrategy?: 'smallest' | 'largest' | 'random';
    crackBandWidth?: number; // used for soft banding
    mode?: 'isometric' | 'normal';
    isoToWorld?: (p: { x: number; y: number }) => { x: number; y: number };
}

const bilerp = (v00: number, v10: number, v01: number, v11: number, tx: number, ty: number) => {
    const top = v00 + (v10 - v00) * tx;
    const bottom = v01 + (v11 - v01) * tx;
    return top + (bottom - top) * ty;
};

const pickMaskSampleStep = (width: number, height: number, bandWidth: number) => {
    const area = Math.max(1, width * height);
    const diag = Math.sqrt(area);
    const base = diag / 320;
    const bandRatio = bandWidth > 0 ? bandWidth / 0.012 : 1;
    const bandFactor = Math.max(0.45, Math.min(1.8, bandRatio));
    const raw = base * bandFactor;
    const step = Math.round(raw);
    return Math.max(1, Math.min(6, step || 1));
};

const mapBandWidthToHalfWindow = (bandWidth: number) => {
    const clamped = Math.max(0.0005, Math.min(0.25, bandWidth || 0));
    const scaled = clamped * 6 + 0.02;
    return Math.max(0.035, Math.min(0.5, scaled));
};

/**
 * Generate a binary (0/255) mask using the same warped-noise bucket strategy used by
 * the crack generator. Returns a Uint8Array of length width*height where 255 = allowed.
 */
export function generateNoiseMask(opts: NoiseMaskOptions): Uint8Array {
    const width = Math.max(1, Math.round(opts.width));
    const height = Math.max(1, Math.round(opts.height));
    const seed = (typeof opts.seed === 'number') ? (opts.seed >>> 0) : (Date.now() >>> 0);
    const baseScale = opts.baseScale ?? 1 / 480;
    const octaves = opts.octaves ?? 4;
    const lacunarity = opts.lacunarity ?? 2;
    const gain = opts.gain ?? 0.5;
    const buckets = Math.max(1, Math.min(8, opts.buckets ?? 3));
    const maxActive = Math.max(1, Math.min(buckets, opts.maxActiveBuckets ?? 2));
    const strategy = opts.activeBucketStrategy ?? 'smallest';
    const crackBandWidth = Math.max(0.0001, Math.min(1, opts.crackBandWidth ?? 0.012));

    // build coarse region map (similar to debug_region in crackGenerator)
    const regionSample = Math.max(8, Math.min(128, Math.floor(Math.min(width, height) / 6) || 16));
    const regionW = Math.max(1, Math.floor(width / regionSample));
    const regionH = Math.max(1, Math.floor(height / regionSample));
    const regionNoise = new Noise(seed || 1);
    const regionMap = new Uint8Array(regionW * regionH);
    const counts = new Array<number>(buckets).fill(0);
    for (let ry = 0; ry < regionH; ry++) {
        for (let rx = 0; rx < regionW; rx++) {
            const sampleX = ((rx + 0.5) / regionW) * width;
            const sampleY = ((ry + 0.5) / regionH) * height;
            const screenPt = { x: sampleX + (opts.minX || 0), y: sampleY + (opts.minY || 0) };
            const worldPt = (opts.mode === 'isometric') ? { x: screenPt.x, y: screenPt.y } : (opts.isoToWorld ? opts.isoToWorld(screenPt) : screenPt);
            const v = sampleWarpedNoise(regionNoise, worldPt.x * baseScale, worldPt.y * baseScale, octaves, lacunarity, gain);
            let id = Math.floor(v * buckets);
            if (id < 0) id = 0;
            if (id >= buckets) id = buckets - 1;
            regionMap[ry * regionW + rx] = id;
            counts[id]++;
        }
    }

    // pick active buckets
    const stats = counts.map((c, i) => ({ i, c }));
    let picked: { i: number; c: number }[] = [];
    if (strategy === 'largest') {
        picked = stats.slice().sort((a, b) => b.c - a.c).slice(0, maxActive);
    } else if (strategy === 'random') {
        const rng = (() => {
            let t = (seed ^ 0x9E3779B9) >>> 0;
            return () => {
                t = (t * 1664525 + 1013904223) >>> 0;
                return t / 0x100000000;
            };
        })();
        const arr = stats.slice();
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        }
        picked = arr.slice(0, maxActive);
    } else {
        picked = stats.slice().sort((a, b) => a.c - b.c).slice(0, maxActive);
    }
    const activeBuckets = new Set<number>(picked.map(p => p.i));
    if (activeBuckets.size === 0) for (let b = 0; b < buckets; b++) activeBuckets.add(b);

    // generate mask using coarse sampling aligned with crack generator
    const mask = new Uint8Array(width * height);
    const computeWorldPoint = (screenX: number, screenY: number) => {
        const screenPt = { x: screenX + (opts.minX || 0), y: screenY + (opts.minY || 0) };
        return (opts.mode === 'isometric') ? screenPt : (opts.isoToWorld ? opts.isoToWorld(screenPt) : screenPt);
    };
    const sampleStep = pickMaskSampleStep(width, height, crackBandWidth);
    const coarseW = Math.max(2, Math.floor((width + sampleStep - 1) / sampleStep) + 1);
    const coarseH = Math.max(2, Math.floor((height + sampleStep - 1) / sampleStep) + 1);
    const coarseRegion = new Float32Array(coarseW * coarseH);
    const coarseDetail = new Float32Array(coarseW * coarseH);
    const detailNoise = new Noise((seed ^ 0xA511E9B3) >>> 0);
    const bandHalfWidth = mapBandWidthToHalfWindow(crackBandWidth);
    const stepOffset = sampleStep * 0.5;
    for (let gy = 0; gy < coarseH; gy++) {
        const sampleY = Math.min(height - 0.5, Math.max(0.5, gy * sampleStep + stepOffset));
        for (let gx = 0; gx < coarseW; gx++) {
            const sampleX = Math.min(width - 0.5, Math.max(0.5, gx * sampleStep + stepOffset));
            const worldPt = computeWorldPoint(sampleX, sampleY);
            const idx = gy * coarseW + gx;
            const baseVal = sampleWarpedNoise(regionNoise, worldPt.x * baseScale, worldPt.y * baseScale, octaves, lacunarity, gain);
            coarseRegion[idx] = baseVal;
            coarseDetail[idx] = sampleWarpedNoise(detailNoise, worldPt.x * baseScale * 2.35, worldPt.y * baseScale * 2.35, 2, 2, 0.55);
        }
    }

    for (let y = 0; y < height; y++) {
        const pixelY = Math.min(height - 0.5, Math.max(0.5, y + 0.5));
        let gyFloat = (pixelY - stepOffset) / sampleStep;
        if (!isFinite(gyFloat)) gyFloat = 0;
        if (gyFloat < 0) gyFloat = 0;
        if (gyFloat > coarseH - 1) gyFloat = coarseH - 1;
        let gy0 = Math.floor(gyFloat);
        if (gy0 >= coarseH - 1) gy0 = coarseH - 1;
        const gy1 = Math.min(gy0 + 1, coarseH - 1);
        const ty = gy1 === gy0 ? 0 : gyFloat - gy0;
        const row0 = gy0 * coarseW;
        const row1 = gy1 * coarseW;
        for (let x = 0; x < width; x++) {
            const baseIndex = y * width + x;
            const pixelX = Math.min(width - 0.5, Math.max(0.5, x + 0.5));
            let gxFloat = (pixelX - stepOffset) / sampleStep;
            if (!isFinite(gxFloat)) gxFloat = 0;
            if (gxFloat < 0) gxFloat = 0;
            if (gxFloat > coarseW - 1) gxFloat = coarseW - 1;
            let gx0 = Math.floor(gxFloat);
            if (gx0 >= coarseW - 1) gx0 = coarseW - 1;
            const gx1 = Math.min(gx0 + 1, coarseW - 1);
            const tx = gx1 === gx0 ? 0 : gxFloat - gx0;

            const r00 = coarseRegion[row0 + gx0];
            const r10 = coarseRegion[row0 + gx1];
            const r01 = coarseRegion[row1 + gx0];
            const r11 = coarseRegion[row1 + gx1];
            let regionValue = bilerp(r00, r10, r01, r11, tx, ty);
            if (!isFinite(regionValue)) regionValue = 0;
            let bucketCoord = regionValue * buckets;
            if (!isFinite(bucketCoord)) bucketCoord = 0;
            let bucketId = Math.floor(bucketCoord);
            if (bucketId < 0) bucketId = 0;
            if (bucketId >= buckets) bucketId = buckets - 1;
            if (!activeBuckets.has(bucketId)) {
                mask[baseIndex] = 0;
                continue;
            }

            const frac = bucketCoord - bucketId;
            const distFromCenter = Math.abs(frac - 0.5);
            if (!isFinite(distFromCenter) || distFromCenter > bandHalfWidth) {
                mask[baseIndex] = 0;
                continue;
            }
            const falloff = bandHalfWidth <= 0
                ? 0
                : 1 - Math.min(1, distFromCenter / Math.max(1e-6, bandHalfWidth));
            const d00 = coarseDetail[row0 + gx0];
            const d10 = coarseDetail[row0 + gx1];
            const d01 = coarseDetail[row1 + gx0];
            const d11 = coarseDetail[row1 + gx1];
            let detailVal = bilerp(d00, d10, d01, d11, tx, ty);
            if (!isFinite(detailVal)) detailVal = 0.5;
            const modulation = Math.max(0, Math.min(1, Math.pow(Math.max(0, falloff), 1.32) * (0.6 + 0.4 * detailVal)));
            mask[baseIndex] = modulation > 0.12 ? 255 : 0;
        }
    }

    return mask;
}

export interface NoiseRegion {
    map: Uint8Array;
    w: number;
    h: number;
    buckets: number;
}

/**
 * Generate the coarse bucket region map (values 0..buckets-1) without per-pixel
 * band filtering. Useful for visual debugging.
 */
export function generateNoiseRegionMap(opts: NoiseMaskOptions): NoiseRegion {
    const width = Math.max(1, Math.round(opts.width));
    const height = Math.max(1, Math.round(opts.height));
    const seed = (typeof opts.seed === 'number') ? (opts.seed >>> 0) : (Date.now() >>> 0);
    const baseScale = opts.baseScale ?? 1 / 480;
    const octaves = opts.octaves ?? 4;
    const lacunarity = opts.lacunarity ?? 2;
    const gain = opts.gain ?? 0.5;
    const buckets = Math.max(1, Math.min(8, opts.buckets ?? 3));

    const regionSample = Math.max(8, Math.min(128, Math.floor(Math.min(width, height) / 6) || 16));
    const regionW = Math.max(1, Math.floor(width / regionSample));
    const regionH = Math.max(1, Math.floor(height / regionSample));
    const regionNoise = new Noise(seed || 1);
    const regionMap = new Uint8Array(regionW * regionH);
    for (let ry = 0; ry < regionH; ry++) {
        for (let rx = 0; rx < regionW; rx++) {
            const sampleX = ((rx + 0.5) / regionW) * width;
            const sampleY = ((ry + 0.5) / regionH) * height;
            const screenPt = { x: sampleX + (opts.minX || 0), y: sampleY + (opts.minY || 0) };
            const worldPt = (opts.mode === 'isometric') ? { x: screenPt.x, y: screenPt.y } : (opts.isoToWorld ? opts.isoToWorld(screenPt) : screenPt);
            const v = sampleWarpedNoise(regionNoise, worldPt.x * baseScale, worldPt.y * baseScale, octaves, lacunarity, gain);
            let id = Math.floor(v * buckets);
            if (id < 0) id = 0;
            if (id >= buckets) id = buckets - 1;
            regionMap[ry * regionW + rx] = id;
        }
    }
    return { map: regionMap, w: regionW, h: regionH, buckets };
}

/**
 * Convert a coarse region map to a visual RGBA image stretched to target width/height.
 * Each bucket gets a simple color; colors are deterministic but arbitrary for debugging.
 */
export function regionMapToRgbaImage(region: NoiseRegion, targetW: number, targetH: number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(targetW * targetH * 4);
    // simple color palette (repeatable)
    const palette: [number, number, number][] = [
        [200, 40, 40], [40, 200, 40], [40, 40, 200], [200, 200, 40], [200, 40, 200], [40, 200, 200], [120,120,120], [220,120,40]
    ];
    const cellW = region.w > 0 ? Math.max(1, Math.floor(targetW / region.w)) : targetW;
    const cellH = region.h > 0 ? Math.max(1, Math.floor(targetH / region.h)) : targetH;
    for (let ry = 0; ry < region.h; ry++) {
        for (let rx = 0; rx < region.w; rx++) {
            const id = region.map[ry * region.w + rx];
            const col = palette[id % palette.length];
            const x0 = Math.min(targetW, rx * cellW);
            const y0 = Math.min(targetH, ry * cellH);
            const x1 = Math.min(targetW, x0 + cellW);
            const y1 = Math.min(targetH, y0 + cellH);
            for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                    const i = (y * targetW + x) * 4;
                    out[i] = col[0]; out[i+1] = col[1]; out[i+2] = col[2]; out[i+3] = 255;
                }
            }
        }
    }
    return out;
}
