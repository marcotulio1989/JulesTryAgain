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

const generateBucketSeeds = (width: number, height: number, count: number, seed: number): Float32Array => {
    const rng = makeRng(seed);
    const seeds = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
        seeds[2 * i] = rng() * width;
        seeds[2 * i + 1] = rng() * height;
    }
    return seeds;
};

const nearestBucket = (x: number, y: number, seeds: Float32Array, count: number): number => {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < count; i++) {
        const dx = x - seeds[2 * i];
        const dy = y - seeds[2 * i + 1];
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
            bestDist = dist;
            best = i;
        }
    }
    return best;
};

const buildBucketAssignment = (width: number, height: number, seeds: Float32Array, count: number) => {
    const assignment = new Uint8Array(width * height);
    const counts = new Array<number>(count).fill(0);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const bucket = nearestBucket(x + 0.5, y + 0.5, seeds, count);
            assignment[y * width + x] = bucket;
            counts[bucket]++;
        }
    }
    return { assignment, counts };
};

const buildBucketRegionMapFromAssignment = (
    assignment: Uint8Array,
    width: number,
    height: number,
    regionW: number,
    regionH: number
) => {
    const map = new Uint8Array(regionW * regionH);
    for (let ry = 0; ry < regionH; ry++) {
        for (let rx = 0; rx < regionW; rx++) {
            const sampleX = Math.min(width - 1, Math.max(0, Math.floor(((rx + 0.5) / regionW) * width)));
            const sampleY = Math.min(height - 1, Math.max(0, Math.floor(((ry + 0.5) / regionH) * height)));
            map[ry * regionW + rx] = assignment[sampleY * width + sampleX];
        }
    }
    return map;
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
    // Optional debug info for bucket region visualization
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
    const seed = Math.floor((renderConfig?.crackSeed ?? Date.now())) >>> 0;
    const noiseCfg = renderConfig?.crackNoiseParams || {};
    const requestedBuckets = Math.max(1, Math.min(16, Math.floor(isFinite(noiseCfg.buckets) ? noiseCfg.buckets : 3)));
    const bucketSeed = (seed ^ 0xA511E9B3) >>> 0;

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
        // If the caller explicitly requested bucket delimitations, return a
        // tiny placeholder raster that includes a coarse `debugRegion` so the
        // UI can still visualize active bucket zones even when the full raster
        // is skipped due to clamping limits.
        if (renderConfig?.showFbmDelimitations && renderConfig?.crackUseNoise) {
            try {
                const debug_regionW = Math.max(4, Math.min(64, Math.floor(Math.min(width, height) / 32) || 8));
                const debug_regionH = Math.max(4, Math.min(64, Math.floor(Math.min(width, height) / 32) || 8));
                const seeds = generateBucketSeeds(width, height, requestedBuckets, bucketSeed);
                const debug_regionMap = new Uint8Array(debug_regionW * debug_regionH);
                for (let ry = 0; ry < debug_regionH; ry++) {
                    for (let rx = 0; rx < debug_regionW; rx++) {
                        const sampleX = ((rx + 0.5) / debug_regionW) * width;
                        const sampleY = ((ry + 0.5) / debug_regionH) * height;
                        const bucket = nearestBucket(sampleX, sampleY, seeds, requestedBuckets);
                        debug_regionMap[ry * debug_regionW + rx] = bucket;
                    }
                }
                const placeholderData = new Uint8ClampedArray(4); // 1 pixel transparent placeholder
                placeholderData[0] = 0; placeholderData[1] = 0; placeholderData[2] = 0; placeholderData[3] = 0;
                const out: CrackRaster = { data: placeholderData, width: 1, height: 1, quality, color: [24,24,24] };
                out.debugRegion = {
                    map: debug_regionMap,
                    w: debug_regionW,
                    h: debug_regionH,
                    buckets: requestedBuckets,
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

    // Debug region variables (declared in outer scope so we can attach info after noise processing)
    let debug_regionMap: Uint8Array | null = null;
    let debug_regionW = 0;
    let debug_regionH = 0;
    let debug_regionCellW = 0;
    let debug_regionCellH = 0;
    let debug_buckets = 0;
    const attachDebugRegionRequested = !!(renderConfig && renderConfig.showFbmDelimitations);
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

    let bucketAssignment: Uint8Array | null = null;
    let activeBucketFlags: boolean[] | null = null;

    if (renderConfig?.crackUseNoise) {
        const maxActive = Math.max(1, Math.min(requestedBuckets, Math.floor(isFinite(noiseCfg.maxActiveBuckets) ? noiseCfg.maxActiveBuckets : 2)));
        const strategy = typeof noiseCfg.activeBucketStrategy === 'string' ? noiseCfg.activeBucketStrategy : 'smallest';
        const seeds = generateBucketSeeds(width, height, requestedBuckets, bucketSeed);
        const { assignment, counts } = buildBucketAssignment(width, height, seeds, requestedBuckets);
        bucketAssignment = assignment;

        const stats = counts.map((c, i) => ({ i, c }));
        let picked: { i: number; c: number }[] = [];
        if (strategy === 'largest') {
            picked = stats.slice().sort((a, b) => b.c - a.c).slice(0, maxActive);
        } else if (strategy === 'random') {
            const rng = makeRng((seed ^ 0x7F4A7C15) >>> 0);
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

        let activeBuckets = new Set<number>(picked.map(p => p.i));
        if (activeBuckets.size === 0) {
            for (let b = 0; b < requestedBuckets; b++) activeBuckets.add(b);
        }

        if (renderConfig && Array.isArray((renderConfig as any).forceActiveBucketIds) && (renderConfig as any).forceActiveBucketIds.length > 0) {
            try {
                const forced = new Set<number>();
                for (const v of (renderConfig as any).forceActiveBucketIds) {
                    const n = Number(v);
                    if (isFinite(n) && n >= 0 && n < requestedBuckets) forced.add(Math.floor(n));
                }
                if (forced.size > 0) activeBuckets = forced;
            } catch (e) {
                // ignore malformed input
            }
        }

        activeBucketFlags = new Array(requestedBuckets).fill(false);
        activeBuckets.forEach(id => { if (id >= 0 && id < activeBucketFlags!.length) activeBucketFlags![id] = true; });

        const regionSample = Math.max(16, Math.min(128, Math.floor(Math.min(width, height) / 6) || 16));
        debug_regionW = Math.max(1, Math.floor(width / regionSample));
        debug_regionH = Math.max(1, Math.floor(height / regionSample));
        debug_regionMap = buildBucketRegionMapFromAssignment(assignment, width, height, debug_regionW, debug_regionH);
        debug_regionCellW = debug_regionW > 0 ? width / debug_regionW : width;
        debug_regionCellH = debug_regionH > 0 ? height / debug_regionH : height;
        debug_buckets = requestedBuckets;

        const palette: [number, number, number][] = [
            [220, 38, 38],
            [34, 197, 94],
            [37, 99, 235],
            [234, 179, 8],
            [168, 85, 247],
            [16, 185, 129],
            [251, 191, 36],
            [244, 63, 94],
        ];

        const invQuality = 1 / quality;
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
                const bucketId = assignment[baseIndex];
                if (!activeBucketFlags[bucketId]) {
                    data[idx + 3] = 0;
                    continue;
                }
                const color = palette[bucketId % palette.length];
                data[idx] = color[0];
                data[idx + 1] = color[1];
                data[idx + 2] = color[2];
            }
        }
    } else {
        const invQuality = 1 / quality;
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
                data[idx] = 24;
                data[idx + 1] = 24;
                data[idx + 2] = 24;
            }
        }
    }

    if (crashMaskData) {
        for (let i = 0; i < crashMaskData.length; i++) {
            if (debugMaskData && debugMaskData[i] === 0) continue;
            if (bucketAssignment && activeBucketFlags) {
                const bucketId = bucketAssignment[i];
                if (!activeBucketFlags[bucketId]) continue;
            }
            crashMaskData[i] = 255;
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
