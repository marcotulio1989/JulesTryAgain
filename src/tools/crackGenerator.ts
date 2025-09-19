import { Noise } from 'noisejs';
import { warpedSimplexNoise } from './noiseSampler';

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

export const warpedNoise = (
    noise: Noise,
    x: number,
    y: number,
    octaves = 3,
    lacunarity = 2,
    gain = 0.5,
) => warpedSimplexNoise(noise, x, y, octaves, lacunarity, gain);

export function generateVoronoiCrackImage(width: number, height: number, options: CrackGeneratorOptions): Uint8ClampedArray {
    const sw = Math.max(1, Math.round(width));
    const sh = Math.max(1, Math.round(height));
    const scale = options.scale ?? 1;
    const color: [number, number, number] = options.color ?? [58, 58, 58];
    const baseDivisions = Math.max(8, Math.min(5000, Math.round(options.divisions)));
    const referenceArea = 512 * 512;
    const areaScale = Math.max(0.25, Math.min(8, (sw * sh) / referenceArea));
    const divisions = Math.max(8, Math.min(5000, Math.round(baseDivisions * areaScale)));
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
    // Optional debug info for noise bucket region visualization
    debugRegion?: {
        map: Uint8Array;
        w: number;
        h: number;
        buckets: number;
        cellW: number;
        cellH: number;
        minX: number;
        minY: number;
        quality: number;
    };
    crashMask?: {
        data: Uint8Array;
        width: number;
        height: number;
        minX: number;
        minY: number;
        quality: number;
    };
}

export interface CrackRasterOptions {
    width: number;
    height: number;
    minX: number;
    minY: number;
    renderConfig: any;
    isoToWorld: (point: { x: number; y: number }) => { x: number; y: number };
    debugMask?: { data: Uint8Array; width: number; height: number };
    captureCrashMask?: boolean;
}

export function generateCrackRaster(options: CrackRasterOptions): CrackRaster | null {
    const {
        width: widthRaw,
        height: heightRaw,
        minX,
        minY,
        renderConfig,
        isoToWorld,
        debugMask,
        captureCrashMask,
    } = options;
    const width = Math.max(1, Math.round(widthRaw));
    const height = Math.max(1, Math.round(heightRaw));
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
        // If the caller explicitly requested legacy noise debug delimitations, return a
        // tiny placeholder raster that includes a coarse `debugRegion` so the
        // UI can still visualize noise buckets even when the full raster is
        // skipped due to clamping limits.
    if (renderConfig?.showNoiseDelimitations && renderConfig?.crackUseNoise) {
            try {
                const seed = Math.floor((renderConfig?.crackSeed ?? Date.now())) >>> 0;
                const noiseCfg = renderConfig.crackNoiseParams || { baseScale: 1 / 480, octaves: 4, lacunarity: 2, gain: 0.5, buckets: 3 };
                const baseScale = noiseCfg.baseScale || 1 / 480;
                const octaves = noiseCfg.octaves || 4;
                const lacunarity = noiseCfg.lacunarity || 2;
                const gain = noiseCfg.gain || 0.5;
                const buckets = Math.max(1, Math.min(8, noiseCfg.buckets || 3));
                const debug_regionW = Math.max(4, Math.min(64, Math.floor(Math.min(width, height) / 32) || 8));
                const debug_regionH = Math.max(4, Math.min(64, Math.floor(Math.min(width, height) / 32) || 8));
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
                        const v = warpedNoise(regionNoise, worldPt.x * baseScale, worldPt.y * baseScale, octaves, lacunarity, gain);
                        let id = Math.floor(v * buckets);
                        if (id < 0) id = 0;
                        if (id >= buckets) id = buckets - 1;
                        debug_regionMap[ry * debug_regionW + rx] = id;
                    }
                }
                const placeholderData = new Uint8ClampedArray(4); // 1 pixel transparent placeholder
                placeholderData[0] = 0; placeholderData[1] = 0; placeholderData[2] = 0; placeholderData[3] = 0;
                const out: CrackRaster = { data: placeholderData, width: 1, height: 1, quality, color: [24,24,24] };
                out.debugRegion = {
                    map: debug_regionMap,
                    w: debug_regionW,
                    h: debug_regionH,
                    buckets,
                    cellW: debug_regionW > 0 ? width / debug_regionW : width,
                    cellH: debug_regionH > 0 ? height / debug_regionH : height,
                    minX,
                    minY,
                    quality,
                };
                return out;
            } catch (e) {
                // fall through to returning null if debug computation fails
            }
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

    // Keep a copy of the raw Voronoi result as a fallback in case later
    // noise filtering removes all pixels (so the user isn't left with
    // an empty transparent result because of restrictive params).
    const _voronoiCopy = new Uint8ClampedArray(data);
    const invQuality = 1 / quality;

    // Debug region variables (declared in outer scope so we can attach info after noise processing)
    let debug_regionMap: Uint8Array | null = null;
    let debug_regionW = 0;
    let debug_regionH = 0;
    let debug_regionCellW = 0;
    let debug_regionCellH = 0;
    let debug_buckets = 0;
    const attachDebugRegionRequested = !!(renderConfig && renderConfig.showNoiseDelimitations);
    let debugMaskData: Uint8Array | null = null;
    if (debugMask && debugMask.data) {
        if (debugMask.width === width && debugMask.height === height) {
            debugMaskData = debugMask.data;
        } else if (typeof console !== 'undefined' && console.warn) {
            console.warn('[crackGenerator] Ignoring debugMask due to dimension mismatch', {
                expected: { width, height }, provided: { width: debugMask.width, height: debugMask.height }
            });
        }
    }
    const captureCrashMaskActual = !!(captureCrashMask && debugMaskData);
    const crashMaskData = captureCrashMaskActual ? new Uint8Array(width * height) : null;
    let crashMaskCount = 0;
    let activeBuckets: Set<number> | null = null;
    let sampleBucketId: ((screenX: number, screenY: number) => number) | null = null;

    if (renderConfig?.crackUseNoise) {
        const noiseCfg = renderConfig.crackNoiseParams || { baseScale: 1 / 480, buckets: 3, maxActiveBuckets: 2, activeBucketStrategy: 'smallest' };
        const baseScale = noiseCfg.baseScale || 1 / 480;
        const buckets = Math.max(1, Math.min(8, noiseCfg.buckets || 3));
        const maxActive = Math.max(1, Math.min(buckets, noiseCfg.maxActiveBuckets || 2));
        const strategy = noiseCfg.activeBucketStrategy || 'smallest';
        const regionSample = Math.max(16, Math.min(128, Math.floor(Math.min(width, height) / 6) || 16));
        debug_regionW = Math.max(1, Math.floor(width / regionSample));
        debug_regionH = Math.max(1, Math.floor(height / regionSample));
        const regionNoise = new Noise(seed || 1);
        debug_regionMap = new Uint8Array(debug_regionW * debug_regionH);
        const countsAll = new Array<number>(buckets).fill(0);
        const countsInMask = new Array<number>(buckets).fill(0);
        for (let ry = 0; ry < debug_regionH; ry++) {
            for (let rx = 0; rx < debug_regionW; rx++) {
                const sampleX = ((rx + 0.5) / debug_regionW) * width;
                const sampleY = ((ry + 0.5) / debug_regionH) * height;
                const screenPt = { x: sampleX + minX, y: sampleY + minY };
                // In isometric mode other overlays (NoiseZoning) sample noise using
                // projected/screen coordinates (they map canvas pixels -> scene using
                // cameraX/cameraY/zoom). To keep behavior consistent and ensure the
                // Noise area follows zoom/pan, when renderConfig indicates isometric
                // mode we sample directly in projected coordinates. For non-
                // isometric mode fall back to the provided isoToWorld mapping.
                const worldPt = (renderConfig && renderConfig.mode === 'isometric')
                    ? { x: screenPt.x, y: screenPt.y }
                    : isoToWorld(screenPt);
                const v = warpedNoise(regionNoise, worldPt.x * baseScale, worldPt.y * baseScale);
                let id = Math.floor(v * buckets);
                if (id < 0) id = 0;
                if (id >= buckets) id = buckets - 1;
                debug_regionMap![ry * debug_regionW + rx] = id;
                countsAll[id]++;
                if (!debugMaskData) {
                    countsInMask[id]++;
                } else {
                    const baseX = Math.max(0, Math.min(width - 1, Math.floor(sampleX)));
                    const baseY = Math.max(0, Math.min(height - 1, Math.floor(sampleY)));
                    const baseIndex = baseY * width + baseX;
                    if (debugMaskData[baseIndex] !== 0) {
                        countsInMask[id]++;
                    }
                }
            }
        }

        if (renderConfig) {
            const detectedBuckets: Record<number, number> = {};
            for (let i = 0; i < countsAll.length; i++) {
                detectedBuckets[i] = countsAll[i];
            }
            (renderConfig as any).detectedNoiseBuckets = detectedBuckets;
            if ((renderConfig as any).detectedFbmBuckets) {
                delete (renderConfig as any).detectedFbmBuckets;
            }
        }

        const statsAll = countsAll.map((c, i) => ({ i, c }));
        const statsMask = countsInMask.map((c, i) => ({ i, c }));
        const positiveMask = statsMask.filter(s => s.c > 0);
        const positiveAll = statsAll.filter(s => s.c > 0);
        const selectionPool = debugMaskData
            ? (positiveMask.length > 0 ? positiveMask : (positiveAll.length > 0 ? positiveAll : statsMask))
            : (positiveAll.length > 0 ? positiveAll : statsAll);
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
        activeBuckets = new Set<number>(picked.map(p => p.i));
        if (activeBuckets.size === 0) {
            for (let b = 0; b < buckets; b++) activeBuckets.add(b);
        }

        // Allow callers to explicitly force which bucket ids are active by
        // providing `renderConfig.forceActiveBucketIds` (array of numbers).
        if (renderConfig && Array.isArray((renderConfig as any).forceActiveBucketIds) && (renderConfig as any).forceActiveBucketIds.length > 0) {
            try {
                const forced = new Set<number>();
                for (const v of (renderConfig as any).forceActiveBucketIds) {
                    const n = Number(v);
                    if (isFinite(n) && n >= 0 && n < buckets) forced.add(Math.floor(n));
                }
                if (forced.size > 0) activeBuckets = forced;
            } catch (e) {
                // ignore malformed input
            }
        }

        debug_regionCellW = debug_regionW > 0 ? width / debug_regionW : width;
        debug_regionCellH = debug_regionH > 0 ? height / debug_regionH : height;
        debug_buckets = buckets;
        sampleBucketId = (screenX: number, screenY: number) => {
            const rx = Math.max(0, Math.min(debug_regionW - 1, Math.floor(screenX / (debug_regionCellW || 1))));
            const ry = Math.max(0, Math.min(debug_regionH - 1, Math.floor(screenY / (debug_regionCellH || 1))));
            return debug_regionMap![ry * debug_regionW + rx];
        };

        const palette = [
            [220, 38, 38],    // vermelho
            [34, 197, 94],    // verde
            [37, 99, 235],    // azul
            [234, 179, 8],    // amarelo
            [168, 85, 247],   // roxo
            [16, 185, 129],   // teal
            [251, 191, 36],   // laranja
            [244, 63, 94],    // rosa
        ];
        let hasCoverage = false;
        for (let y = 0; y < canvasH; y++) {
            for (let x = 0; x < canvasW; x++) {
                const idx = (y * canvasW + x) * 4;
                const alpha = data[idx + 3];
                if (alpha === 0) continue;
                const screenX = (x + 0.5) * invQuality;
                const screenY = (y + 0.5) * invQuality;
                const baseX = Math.max(0, Math.min(width - 1, Math.floor(screenX)));
                const baseY = Math.max(0, Math.min(height - 1, Math.floor(screenY)));
                const baseIndex = baseY * width + baseX;
                if (debugMaskData && debugMaskData[baseIndex] === 0) {
                    data[idx + 3] = 0;
                    continue;
                }
                const bucketId = sampleBucketId!(screenX, screenY);
                if (!activeBuckets!.has(bucketId)) {
                    data[idx + 3] = 0;
                    continue;
                }
                const color = palette[bucketId % palette.length];
                data[idx] = color[0];
                data[idx + 1] = color[1];
                data[idx + 2] = color[2];
                hasCoverage = true;
            }
        }
        if (crashMaskData) {
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const baseIndex = y * width + x;
                    if (debugMaskData && debugMaskData[baseIndex] === 0) continue;
                    const bucketId = sampleBucketId!(x + 0.5, y + 0.5);
                    if (activeBuckets!.has(bucketId) && crashMaskData[baseIndex] === 0) {
                        crashMaskData[baseIndex] = 255;
                        crashMaskCount++;
                    }
                }
            }
        }
        if (crashMaskData && crashMaskCount === 0 && debugMaskData) {
            for (let i = 0; i < debugMaskData.length; i++) {
                if (debugMaskData[i] !== 0) {
                    crashMaskData[i] = 255;
                    crashMaskCount++;
                }
            }
        }
        if (!hasCoverage) {
            // Restore the original Voronoi image and warn so user can adjust
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[crackGenerator] Noise bucket filtering removed all pixels; restoring fallback Voronoi image. Try adjusting crackNoiseParams (buckets/maxActiveBuckets) or change seed.');
            }
            let fallbackHits = 0;
            for (let y = 0; y < canvasH; y++) {
                for (let x = 0; x < canvasW; x++) {
                    const idx = (y * canvasW + x) * 4;
                    const srcAlpha = _voronoiCopy[idx + 3];
                    if (srcAlpha === 0) {
                        data[idx] = 0;
                        data[idx + 1] = 0;
                        data[idx + 2] = 0;
                        data[idx + 3] = 0;
                        continue;
                    }
                    const screenX = (x + 0.5) * invQuality;
                    const screenY = (y + 0.5) * invQuality;
                    const baseX = Math.max(0, Math.min(width - 1, Math.floor(screenX)));
                    const baseY = Math.max(0, Math.min(height - 1, Math.floor(screenY)));
                    const baseIndex = baseY * width + baseX;
                    if (debugMaskData && debugMaskData[baseIndex] === 0) {
                        data[idx] = 0;
                        data[idx + 1] = 0;
                        data[idx + 2] = 0;
                        data[idx + 3] = 0;
                        continue;
                    }
                    data[idx] = _voronoiCopy[idx];
                    data[idx + 1] = _voronoiCopy[idx + 1];
                    data[idx + 2] = _voronoiCopy[idx + 2];
                    data[idx + 3] = srcAlpha;
                    fallbackHits++;
                }
            }
            hasCoverage = fallbackHits > 0;
            if (crashMaskData && debugMaskData) {
                crashMaskData.fill(0);
                crashMaskCount = 0;
                for (let i = 0; i < debugMaskData.length; i++) {
                    if (debugMaskData[i] !== 0) {
                        crashMaskData[i] = 255;
                        crashMaskCount++;
                    }
                }
            }
        }
    } else {
        for (let y = 0; y < canvasH; y++) {
            for (let x = 0; x < canvasW; x++) {
                const idx = (y * canvasW + x) * 4;
                if (data[idx + 3] === 0) continue;
                data[idx] = 24;
                data[idx + 1] = 24;
                data[idx + 2] = 24;
            }
        }
        if (crashMaskData) {
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const baseIndex = y * width + x;
                    if (debugMaskData && debugMaskData[baseIndex] === 0) continue;
                    crashMaskData[baseIndex] = 255;
                }
            }
        }
    }

    const out: CrackRaster = { data, width: canvasW, height: canvasH, quality, color: [24, 24, 24] };
    if (attachDebugRegionRequested && debug_regionMap) {
        out.debugRegion = {
            map: debug_regionMap,
            w: debug_regionW,
            h: debug_regionH,
            buckets: debug_buckets,
            cellW: debug_regionCellW,
            cellH: debug_regionCellH,
            minX,
            minY,
            quality,
        };
    }
    if (crashMaskData) {
        out.crashMask = {
            data: crashMaskData,
            width,
            height,
            minX,
            minY,
            quality,
        };
    }

    return out;
}
