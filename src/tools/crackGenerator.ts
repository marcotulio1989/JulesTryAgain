import { Noise } from 'noisejs';

export interface CrackGeneratorOptions {
    divisions: number;
    thickness: number;
    dilateRadius: number;
    seed: number;
    scale?: number;
    color?: [number, number, number];
}

function makeRng(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

const fbmNoise = (noise: Noise, x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5) => {
    let freq = 1;
    let amp = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
        sum += noise.perlin2(x * freq, y * freq) * amp;
        norm += amp;
        freq *= lacunarity;
        amp *= gain;
    }
    const normalized = norm ? sum / norm : 0;
    return normalized * 0.5 + 0.5;
};

export function generateVoronoiCrackImage(width: number, height: number, options: CrackGeneratorOptions): Uint8ClampedArray {
    const sw = Math.max(1, Math.round(width));
    const sh = Math.max(1, Math.round(height));
    const scale = options.scale ?? 1;
    const color: [number, number, number] = options.color ?? [58, 58, 58];
    const divisions = Math.max(8, Math.min(5000, Math.round(options.divisions)));
    const rng = makeRng(Math.floor(options.seed) || 1);
    const pts = new Float32Array(divisions * 2);
    for (let i = 0; i < divisions; i++) {
        pts[2 * i] = rng() * sw;
        pts[2 * i + 1] = rng() * sh;
    }

    const cellsPerDim = Math.max(8, Math.round(Math.sqrt(divisions)));
    const cellSizeX = sw / cellsPerDim;
    const cellSizeY = sh / cellsPerDim;
    const grid: number[][] = new Array(cellsPerDim * cellsPerDim);
    for (let i = 0; i < grid.length; i++) grid[i] = [];
    for (let i = 0; i < divisions; i++) {
        const x = pts[2 * i];
        const y = pts[2 * i + 1];
        const cx = Math.min(cellsPerDim - 1, Math.max(0, Math.floor(x / cellSizeX)));
        const cy = Math.min(cellsPerDim - 1, Math.max(0, Math.floor(y / cellSizeY)));
        grid[cy * cellsPerDim + cx].push(i);
    }

    const candidatesLocal = (x: number, y: number) => {
        const cx = Math.min(cellsPerDim - 1, Math.max(0, Math.floor(x / cellSizeX)));
        const cy = Math.min(cellsPerDim - 1, Math.max(0, Math.floor(y / cellSizeY)));
        const out: number[] = [];
        for (let r = 1; r <= 2; r++) {
            out.length = 0;
            for (let yy = cy - r; yy <= cy + r; yy++) {
                if (yy < 0 || yy >= cellsPerDim) continue;
                for (let xx = cx - r; xx <= cx + r; xx++) {
                    if (xx < 0 || xx >= cellsPerDim) continue;
                    const bucket = grid[yy * cellsPerDim + xx];
                    if (bucket && bucket.length) out.push(...bucket);
                }
            }
            if (out.length || r === 2) return out;
        }
        return out;
    };

    const data = new Uint8ClampedArray(sw * sh * 4);
    const eps = (options.thickness / 10) * scale;

    for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
            const candidates = candidatesLocal(x, y);
            let b1 = Infinity;
            let b2 = Infinity;
            if (candidates.length) {
                for (let k = 0; k < candidates.length; k++) {
                    const idx = candidates[k];
                    const dx = x - pts[2 * idx];
                    const dy = y - pts[2 * idx + 1];
                    const dist2 = dx * dx + dy * dy;
                    if (dist2 < b1) {
                        b2 = b1;
                        b1 = dist2;
                    } else if (dist2 < b2) {
                        b2 = dist2;
                    }
                }
            } else {
                for (let i = 0; i < divisions; i++) {
                    const dx = x - pts[2 * i];
                    const dy = y - pts[2 * i + 1];
                    const dist2 = dx * dx + dy * dy;
                    if (dist2 < b1) {
                        b2 = b1;
                        b1 = dist2;
                    } else if (dist2 < b2) {
                        b2 = dist2;
                    }
                }
            }
            const delta = Math.sqrt(b2) - Math.sqrt(b1);
            const p = (y * sw + x) * 4;
            if (delta < eps) {
                data[p] = color[0];
                data[p + 1] = color[1];
                data[p + 2] = color[2];
                data[p + 3] = 255;
            } else {
                data[p] = 0;
                data[p + 1] = 0;
                data[p + 2] = 0;
                data[p + 3] = 0;
            }
        }
    }

    const radius = Math.max(0, Math.min(20, Math.round(options.dilateRadius * scale)));
    if (radius > 0) {
        const copy = new Uint8ClampedArray(data);
        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
                const idx = (y * sw + x) * 4;
                if (copy[idx + 3] === 0) continue;
                const x0 = Math.max(0, x - radius);
                const x1 = Math.min(sw - 1, x + radius);
                const y0 = Math.max(0, y - radius);
                const y1 = Math.min(sh - 1, y + radius);
                for (let yy = y0; yy <= y1; yy++) {
                    for (let xx = x0; xx <= x1; xx++) {
                        const ii = (yy * sw + xx) * 4;
                        data[ii] = color[0];
                        data[ii + 1] = color[1];
                        data[ii + 2] = color[2];
                        data[ii + 3] = 255;
                    }
                }
            }
        }
    }

    return data;
}

export interface CrackRaster {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    quality: number;
    color: [number, number, number];
}

export interface CrackRasterOptions {
    width: number;
    height: number;
    minX: number;
    minY: number;
    renderConfig: any;
    isoToWorld: (point: { x: number; y: number }) => { x: number; y: number };
}

export function generateCrackRaster(options: CrackRasterOptions): CrackRaster | null {
    const { width, height, minX, minY, renderConfig, isoToWorld } = options;
    const crackCfg = renderConfig?.crackProceduralParams || {};
    const fallbackQuality = (typeof crackCfg.quality === 'number' && isFinite(crackCfg.quality))
        ? crackCfg.quality
        : ((typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number') ? window.devicePixelRatio : 1);
    const minQuality = Math.max(0.1, Math.min(1, (typeof crackCfg.minQuality === 'number' && isFinite(crackCfg.minQuality)) ? crackCfg.minQuality : 0.25));
    const clampQuality = (q: number) => Math.max(minQuality, Math.min(4, q || minQuality));
    const maxCanvasDimension = Math.max(64, Math.min(8192, (typeof crackCfg.maxCanvasDimension === 'number' && isFinite(crackCfg.maxCanvasDimension)) ? crackCfg.maxCanvasDimension : 4096));
    const maxCanvasPixels = Math.max(16384, Math.min(67108864, (typeof crackCfg.maxCanvasPixels === 'number' && isFinite(crackCfg.maxCanvasPixels)) ? crackCfg.maxCanvasPixels : 5_000_000));

    let quality = clampQuality(fallbackQuality || 1);
    let canvasW = Math.max(1, Math.round(width * quality));
    let canvasH = Math.max(1, Math.round(height * quality));

    const applyQualityReduction = (factor: number) => {
        if (!(factor > 1)) return;
        quality = clampQuality(quality / factor);
        canvasW = Math.max(1, Math.round(width * quality));
        canvasH = Math.max(1, Math.round(height * quality));
    };

    if (canvasW > maxCanvasDimension || canvasH > maxCanvasDimension) {
        const factor = Math.max(canvasW / maxCanvasDimension, canvasH / maxCanvasDimension);
        applyQualityReduction(factor);
    }

    if (canvasW * canvasH > maxCanvasPixels) {
        const factor = Math.sqrt((canvasW * canvasH) / maxCanvasPixels);
        applyQualityReduction(factor);
    }

    if (canvasW > maxCanvasDimension || canvasH > maxCanvasDimension || canvasW * canvasH > maxCanvasPixels) {
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[crackGenerator] Procedural crack raster skipped – area too large after clamping', { canvasW, canvasH, quality });
        }
        return null;
    }

    const seed = Math.floor((renderConfig?.crackSeed ?? Date.now())) >>> 0;
    const divisions = (typeof crackCfg.divisions === 'number' && crackCfg.divisions > 0) ? crackCfg.divisions : 400;
    const thickness = (typeof crackCfg.thickness === 'number' && crackCfg.thickness > 0) ? crackCfg.thickness : 6;
    const dilateRadius = (typeof crackCfg.dilateRadius === 'number' && crackCfg.dilateRadius >= 0) ? crackCfg.dilateRadius : 2;

    const data = generateVoronoiCrackImage(canvasW, canvasH, {
        divisions,
        thickness,
        dilateRadius,
        seed,
        scale: quality,
        color: [24, 24, 24],
    });

    if (renderConfig?.crackUseNoise) {
        const noiseCfg = renderConfig.crackNoiseParams || { baseScale: 1 / 480, octaves: 4, lacunarity: 2, gain: 0.5, buckets: 3, crackBandWidth: 0.012, maxActiveBuckets: 2, activeBucketStrategy: 'smallest' };
        const baseScale = noiseCfg.baseScale || 1 / 480;
        const octaves = noiseCfg.octaves || 4;
        const lacunarity = noiseCfg.lacunarity || 2;
        const gain = noiseCfg.gain || 0.5;
        const buckets = Math.max(1, Math.min(8, noiseCfg.buckets || 3));
        const crackBandWidth = Math.max(0.002, Math.min(0.1, noiseCfg.crackBandWidth || 0.012));
        const maxActive = Math.max(1, Math.min(buckets, noiseCfg.maxActiveBuckets || 2));
        const strategy = noiseCfg.activeBucketStrategy || 'smallest';
        const regionSample = Math.max(16, Math.min(128, Math.floor(Math.min(width, height) / 6) || 16));
        const regionW = Math.max(1, Math.floor(width / regionSample));
        const regionH = Math.max(1, Math.floor(height / regionSample));
        const regionNoise = new Noise(seed || 1);
        const regionMap = new Uint8Array(regionW * regionH);
        const counts = new Array<number>(buckets).fill(0);
        for (let ry = 0; ry < regionH; ry++) {
            for (let rx = 0; rx < regionW; rx++) {
                const sampleX = ((rx + 0.5) / regionW) * width;
                const sampleY = ((ry + 0.5) / regionH) * height;
                const screenPt = { x: sampleX + minX, y: sampleY + minY };
                const worldPt = isoToWorld(screenPt);
                const v = fbmNoise(regionNoise, worldPt.x * baseScale, worldPt.y * baseScale, octaves, lacunarity, gain);
                let id = Math.floor(v * buckets);
                if (id < 0) id = 0;
                if (id >= buckets) id = buckets - 1;
                regionMap[ry * regionW + rx] = id;
                counts[id]++;
            }
        }

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
                const tmp = arr[i];
                arr[i] = arr[j];
                arr[j] = tmp;
            }
            picked = arr.slice(0, maxActive);
        } else {
            picked = stats.slice().sort((a, b) => a.c - b.c).slice(0, maxActive);
        }
        const activeBuckets = new Set<number>(picked.map(p => p.i));
        if (activeBuckets.size === 0) {
            for (let b = 0; b < buckets; b++) activeBuckets.add(b);
        }

        const bucketNoise: Noise[] = new Array(buckets);
        const bucketCenters: number[] = new Array(buckets);
        const fineScales: number[] = new Array(buckets);
        for (let b = 0; b < buckets; b++) {
            bucketNoise[b] = new Noise(seed + b * 97 + 13);
            bucketCenters[b] = (b + 0.5) / buckets;
            fineScales[b] = baseScale * (1.5 + b * 0.6);
        }

        const invQuality = 1 / quality;
        const regionCellW = regionW > 0 ? width / regionW : width;
        const regionCellH = regionH > 0 ? height / regionH : height;
        for (let y = 0; y < canvasH; y++) {
            for (let x = 0; x < canvasW; x++) {
                const idx = (y * canvasW + x) * 4;
                const alpha = data[idx + 3];
                if (alpha === 0) continue;
                const screenX = (x + 0.5) * invQuality;
                const screenY = (y + 0.5) * invQuality;
                const rx = Math.max(0, Math.min(regionW - 1, Math.floor(screenX / (regionCellW || 1))));
                const ry = Math.max(0, Math.min(regionH - 1, Math.floor(screenY / (regionCellH || 1))));
                const bucketId = regionMap[ry * regionW + rx];
                if (!activeBuckets.has(bucketId)) {
                    data[idx + 3] = 0;
                    continue;
                }
                const noiseInst = bucketNoise[bucketId];
                const worldPt = isoToWorld({ x: screenX + minX, y: screenY + minY });
                const baseVal = fbmNoise(noiseInst, worldPt.x * baseScale, worldPt.y * baseScale, octaves, lacunarity, gain);
                const dist = Math.abs(baseVal - bucketCenters[bucketId]);
                if (dist > crackBandWidth) {
                    data[idx + 3] = 0;
                    continue;
                }
                const edge = Math.max(0, (crackBandWidth - dist) / crackBandWidth);
                const edgeSoft = Math.pow(edge, 1.2);
                const fine = fbmNoise(noiseInst, worldPt.x * fineScales[bucketId] * 3.0, worldPt.y * fineScales[bucketId] * 3.0, 2, 2, 0.6);
                const modulation = Math.max(0, Math.min(1, edgeSoft * (0.35 + 0.65 * fine)));
                const newAlpha = Math.round(alpha * modulation);
                if (newAlpha < 12) {
                    data[idx + 3] = 0;
                } else {
                    data[idx + 3] = newAlpha;
                    data[idx] = 24;
                    data[idx + 1] = 24;
                    data[idx + 2] = 24;
                }
            }
        }
    } else {
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 0) {
                data[i] = 24;
                data[i + 1] = 24;
                data[i + 2] = 24;
            }
        }
    }

    return { data, width: canvasW, height: canvasH, quality, color: [24, 24, 24] };
}
