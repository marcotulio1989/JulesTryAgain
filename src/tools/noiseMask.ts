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

    // prepare per-bucket noise instances and centers
    const bucketNoise: Noise[] = new Array(buckets);
    const bucketCenters: number[] = new Array(buckets);
    const fineScales: number[] = new Array(buckets);
    for (let b = 0; b < buckets; b++) {
        bucketNoise[b] = new Noise(seed + b * 97 + 13);
        bucketCenters[b] = (b + 0.5) / buckets;
        fineScales[b] = baseScale * (1.5 + b * 0.6);
    }

    // generate mask
    const mask = new Uint8Array(width * height);
    const cellW = regionW > 0 ? width / regionW : width;
    const cellH = regionH > 0 ? height / regionH : height;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const rx = Math.max(0, Math.min(regionW - 1, Math.floor(x / (cellW || 1))));
            const ry = Math.max(0, Math.min(regionH - 1, Math.floor(y / (cellH || 1))));
            const bucketId = regionMap[ry * regionW + rx];
            if (!activeBuckets.has(bucketId)) {
                mask[y * width + x] = 0;
                continue;
            }
            const noiseInst = bucketNoise[bucketId];
            const samplePt = { x: x + 0.5 + (opts.minX || 0), y: y + 0.5 + (opts.minY || 0) };
            const worldPt = (opts.mode === 'isometric') ? { x: samplePt.x, y: samplePt.y } : (opts.isoToWorld ? opts.isoToWorld(samplePt) : samplePt);
            const baseVal = sampleWarpedNoise(noiseInst, worldPt.x * baseScale, worldPt.y * baseScale, octaves, lacunarity, gain);
            const dist = Math.abs(baseVal - bucketCenters[bucketId]);
            if (dist > crackBandWidth) {
                mask[y * width + x] = 0;
                continue;
            }
            const edge = Math.max(0, (crackBandWidth - dist) / crackBandWidth);
            const fine = sampleWarpedNoise(noiseInst, worldPt.x * fineScales[bucketId] * 3.0, worldPt.y * fineScales[bucketId] * 3.0, 2, 2, 0.6);
            const modulation = Math.max(0, Math.min(1, Math.pow(edge, 1.2) * (0.35 + 0.65 * fine)));
            const keep = modulation > 0.03; // threshold similar to alpha < 12
            mask[y * width + x] = keep ? 255 : 0;
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

export interface NoiseMaskFromCrackGeneratorOptions {
    width: number;
    height: number;
    minX: number;
    minY: number;
    renderConfig: any;
    isoToWorld: (point: { x: number; y: number }) => { x: number; y: number };
    seed: number;
}

export function generateNoiseMaskFromCrackGenerator(options: NoiseMaskFromCrackGeneratorOptions) {
    const {
        width,
        height,
        minX,
        minY,
        renderConfig,
        isoToWorld,
        seed,
    } = options;

    const noiseCfg = renderConfig.crackNoiseParams || {
        baseScale: 1 / 480,
        buckets: 3,
        maxActiveBuckets: 2,
        activeBucketStrategy: 'smallest',
        crackBandWidth: 0.012,
        octaves: 4,
        lacunarity: 2,
        gain: 0.5,
    };
    const baseScale = noiseCfg.baseScale || 1 / 480;
    const octaves = Math.max(1, noiseCfg.octaves || 4);
    const lacunarity = noiseCfg.lacunarity || 2;
    const gain = noiseCfg.gain || 0.5;
    const crackBandWidth = Math.max(0.0005, Math.min(0.25, noiseCfg.crackBandWidth || 0.012));
    const buckets = Math.max(1, Math.min(8, noiseCfg.buckets || 3));
    const maxActive = Math.max(1, Math.min(buckets, noiseCfg.maxActiveBuckets || 2));
    const strategy = noiseCfg.activeBucketStrategy || 'smallest';
    const regionSample = Math.max(16, Math.min(128, Math.floor(Math.min(width, height) / 6) || 16));
    const debug_regionW = Math.max(1, Math.floor(width / regionSample));
    const debug_regionH = Math.max(1, Math.floor(height / regionSample));
    const regionNoise = new Noise(seed || 1);
    const debug_regionMap = new Uint8Array(debug_regionW * debug_regionH);
    for (let ry = 0; ry < debug_regionH; ry++) {
        for (let rx = 0; rx < debug_regionW; rx++) {
            const sampleX = ((rx + 0.5) / debug_regionW) * width;
            const sampleY = ((ry + 0.5) / debug_regionH) * height;
            const screenPt = { x: sampleX + minX, y: sampleY + minY };
            const worldPt = (renderConfig && renderConfig.mode === 'isometric')
                ? { x: screenPt.x, y: screenPt.y }
                : isoToWorld(screenPt);
            const v = sampleWarpedNoise(regionNoise, worldPt.x * baseScale, worldPt.y * baseScale, octaves, lacunarity, gain);
            let id = Math.floor(v * buckets);
            if (id < 0) id = 0;
            if (id >= buckets) id = buckets - 1;
            debug_regionMap![ry * debug_regionW + rx] = id;
        }
    }

    const debug_regionCellW = debug_regionW > 0 ? width / debug_regionW : width;
    const debug_regionCellH = debug_regionH > 0 ? height / debug_regionH : height;

    const rng = (() => {
        let t = (seed ^ 0x9E3779B9) >>> 0;
        return () => {
            t = (t * 1664525 + 1013904223) >>> 0;
            return t / 0x100000000;
        };
    })();
    const pickByStrategy = (pool: { i: number; c: number }[], count: number) => {
        if (pool.length === 0 || count <= 0) return [] as { i: number; c: number }[];
        if (strategy === 'largest') {
            return pool.slice().sort((a, b) => (b.c - a.c) || (a.i - b.i)).slice(0, count);
        }
        if (strategy === 'random') {
            const arr = pool.slice();
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                const tmp = arr[i];
                arr[i] = arr[j];
                arr[j] = tmp;
            }
            return arr.slice(0, count);
        }
        return pool.slice().sort((a, b) => (a.c - b.c) || (a.i - b.i)).slice(0, count);
    };

    const computeWorldPoint = (screenX: number, screenY: number) => {
        const screenPt = { x: screenX + minX, y: screenY + minY };
        return (renderConfig && renderConfig.mode === 'isometric') ? screenPt : isoToWorld(screenPt);
    };
    const sampleStepPixels = pickMaskSampleStep(width, height, crackBandWidth);
    const coarseW = Math.max(2, Math.floor((width + sampleStepPixels - 1) / sampleStepPixels) + 1);
    const coarseH = Math.max(2, Math.floor((height + sampleStepPixels - 1) / sampleStepPixels) + 1);
    const coarseBase = new Float32Array(coarseW * coarseH);
    const stepOffset = sampleStepPixels * 0.5;
    for (let gy = 0; gy < coarseH; gy++) {
        const sampleY = Math.min(height - 0.5, Math.max(0.5, gy * sampleStepPixels + stepOffset));
        for (let gx = 0; gx < coarseW; gx++) {
            const sampleX = Math.min(width - 0.5, Math.max(0.5, gx * sampleStepPixels + stepOffset));
            const worldPt = computeWorldPoint(sampleX, sampleY);
            const idx = gy * coarseW + gx;
            coarseBase[idx] = sampleWarpedNoise(regionNoise, worldPt.x * baseScale, worldPt.y * baseScale, octaves, lacunarity, gain);
        }
    }
    const bucketAssignment = new Uint8Array(width * height);
    const maskBucketCounts = new Array<number>(buckets).fill(0);
    for (let y = 0; y < height; y++) {
        const pixelY = Math.min(height - 0.5, Math.max(0.5, y + 0.5));
        let gyFloat = (pixelY - stepOffset) / sampleStepPixels;
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
            let gxFloat = (pixelX - stepOffset) / sampleStepPixels;
            if (!isFinite(gxFloat)) gxFloat = 0;
            if (gxFloat < 0) gxFloat = 0;
            if (gxFloat > coarseW - 1) gxFloat = coarseW - 1;
            let gx0 = Math.floor(gxFloat);
            if (gx0 >= coarseW - 1) gx0 = coarseW - 1;
            const gx1 = Math.min(gx0 + 1, coarseW - 1);
            const tx = gx1 === gx0 ? 0 : gxFloat - gx0;
            const v00 = coarseBase[row0 + gx0];
            const v10 = coarseBase[row0 + gx1];
            const v01 = coarseBase[row1 + gx0];
            const v11 = coarseBase[row1 + gx1];
            const baseVal = bilerp(v00, v10, v01, v11, tx, ty);
            let bucketId = Math.floor(baseVal * buckets);
            if (bucketId < 0) bucketId = 0;
            if (bucketId >= buckets) bucketId = buckets - 1;
            bucketAssignment[baseIndex] = bucketId;
            maskBucketCounts[bucketId]++;
        }
    }

    const statsAll = maskBucketCounts.map((c, i) => ({ i, c }));
    const positiveAll = statsAll.filter(s => s.c > 0);
    const selectionPool = positiveAll.length > 0 ? positiveAll : statsAll;

    let picked = pickByStrategy(selectionPool, maxActive);
    if (picked.length < maxActive) {
        const fallbackPoolBase = positiveAll.length > 0 ? positiveAll : statsAll;
        const fallbackPool = fallbackPoolBase.filter(item => !picked.some(p => p.i === item.i));
        const extra = pickByStrategy(fallbackPool.length > 0 ? fallbackPool : statsAll.filter(item => !picked.some(p => p.i === item.i)), maxActive - picked.length);
        picked = picked.concat(extra);
    }
    if (picked.length < maxActive) {
        for (let b = 0; picked.length < maxActive && b < buckets; b++) {
            if (picked.some(p => p.i === b)) continue;
            picked.push({ i: b, c: 0 });
        }
    }
    let selectedBuckets = new Set<number>(picked.map(p => p.i));
    if (selectedBuckets.size === 0) {
        for (let b = 0; b < buckets; b++) selectedBuckets.add(b);
    }

    if (renderConfig && Array.isArray((renderConfig as any).forceActiveBucketIds) && (renderConfig as any).forceActiveBucketIds.length > 0) {
        try {
            const forced = new Set<number>();
            for (const v of (renderConfig as any).forceActiveBucketIds) {
                const n = Number(v);
                if (isFinite(n) && n >= 0 && n < buckets) forced.add(Math.floor(n));
            }
            if (forced.size > 0) selectedBuckets = forced;
        } catch (e) {
        }
    }

    const initialActiveBuckets = new Set<number>(selectedBuckets);
    const bucketsWithCoverage = statsAll.filter(entry => entry.c > 0);

    const ensureAddBucket = (set: Set<number>, id: number) => {
        if (!set.has(id) && set.size < maxActive) {
            set.add(id);
        }
    };
    const finalActiveBuckets = new Set<number>();
    initialActiveBuckets.forEach(id => {
        if (maskBucketCounts[id] > 0) ensureAddBucket(finalActiveBuckets, id);
    });
    if (finalActiveBuckets.size < Math.min(maxActive, bucketsWithCoverage.length)) {
        const fallbackPool = bucketsWithCoverage.filter(entry => !finalActiveBuckets.has(entry.i));
        const extra = pickByStrategy(fallbackPool, maxActive - finalActiveBuckets.size);
        extra.forEach(item => ensureAddBucket(finalActiveBuckets, item.i));
    }
    if (finalActiveBuckets.size === 0 && bucketsWithCoverage.length > 0) {
        const extra = pickByStrategy(bucketsWithCoverage, maxActive);
        extra.forEach(item => ensureAddBucket(finalActiveBuckets, item.i));
    }
    if (finalActiveBuckets.size === 0) {
        for (let b = 0; b < buckets && finalActiveBuckets.size < maxActive; b++) {
            ensureAddBucket(finalActiveBuckets, b);
        }
    }

    const activeBuckets = finalActiveBuckets;
    if (activeBuckets.size === 0) {
        for (let b = 0; b < buckets; b++) activeBuckets.add(b);
    }

    const noiseMaskData = new Uint8Array(width * height);
    let noiseMaskHits = 0;
    for (let i = 0; i < bucketAssignment.length; i++) {
        const bucketId = bucketAssignment[i];
        if (activeBuckets.has(bucketId)) {
            noiseMaskData[i] = 255;
            noiseMaskHits++;
        } else {
            noiseMaskData[i] = 0;
        }
    }
    if (noiseMaskHits === 0) {
        return {
            noiseMaskData: null,
            debug_regionMap,
            debug_regionW,
            debug_regionH,
            debug_regionCellW,
            debug_regionCellH,
            debug_buckets: buckets,
            activeBuckets,
            bucketAssignment,
        };
    }

    return {
        noiseMaskData,
        debug_regionMap,
        debug_regionW,
        debug_regionH,
        debug_regionCellW,
        debug_regionCellH,
        debug_buckets: buckets,
        activeBuckets,
        bucketAssignment,
    };
}
