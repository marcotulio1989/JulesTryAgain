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

interface BucketLayoutOptions {
    width: number;
    height: number;
    bucketCount: number;
    maxActiveBuckets: number;
    strategy: 'smallest' | 'largest' | 'random';
    seed: number;
    debugMask?: Uint8Array | null;
    forcedActive?: number[] | null;
}

interface BucketLayoutResult {
    ids: Uint8Array;
    activeBuckets: Set<number>;
    countsInsideMask: number[];
    countsTotal: number[];
    cols: number;
    rows: number;
}

function buildBucketLayout(opts: BucketLayoutOptions): BucketLayoutResult {
    const width = Math.max(1, Math.floor(opts.width));
    const height = Math.max(1, Math.floor(opts.height));
    const bucketCount = Math.max(1, Math.min(255, Math.floor(opts.bucketCount)));
    const maxActive = Math.max(1, Math.min(bucketCount, Math.floor(opts.maxActiveBuckets || bucketCount)));
    const cols = Math.max(1, Math.ceil(Math.sqrt(bucketCount)));
    const rows = Math.max(1, Math.ceil(bucketCount / cols));
    const ids = new Uint8Array(width * height);
    const countsInsideMask = new Array<number>(bucketCount).fill(0);
    const countsTotal = new Array<number>(bucketCount).fill(0);
    const debugMask = opts.debugMask;

    for (let y = 0; y < height; y++) {
        const v = (y + 0.5) / height;
        const row = Math.min(rows - 1, Math.floor(v * rows));
        for (let x = 0; x < width; x++) {
            const u = (x + 0.5) / width;
            const col = Math.min(cols - 1, Math.floor(u * cols));
            let id = row * cols + col;
            if (id >= bucketCount) id = bucketCount - 1;
            const idx = y * width + x;
            ids[idx] = id;
            countsTotal[id]++;
            if (!debugMask || debugMask[idx] > 0) {
                countsInsideMask[id]++;
            }
        }
    }

    const statsSource = (debugMask && countsInsideMask.some(c => c > 0)) ? countsInsideMask : countsTotal;
    let stats = statsSource.map((count, i) => ({ i, count }));
    const rng = makeRng(opts.seed ^ 0x9E3779B9);

    if (opts.strategy === 'largest') {
        stats = stats.sort((a, b) => b.count - a.count || a.i - b.i);
    } else if (opts.strategy === 'random') {
        for (let i = stats.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const tmp = stats[i];
            stats[i] = stats[j];
            stats[j] = tmp;
        }
    } else {
        stats = stats.sort((a, b) => a.count - b.count || a.i - b.i);
    }

    const forced = Array.isArray(opts.forcedActive) ? opts.forcedActive : null;
    const activeBuckets = new Set<number>();
    if (forced && forced.length > 0) {
        for (const v of forced) {
            const n = Math.floor(v);
            if (n >= 0 && n < bucketCount) activeBuckets.add(n);
        }
    }

    if (activeBuckets.size === 0) {
        for (const entry of stats) {
            activeBuckets.add(entry.i);
            if (activeBuckets.size >= maxActive) break;
        }
    }

    if (activeBuckets.size === 0) {
        for (let b = 0; b < Math.min(maxActive, bucketCount); b++) {
            activeBuckets.add(b);
        }
    }

    return { ids, activeBuckets, countsInsideMask, countsTotal, cols, rows };
}

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
    // Optional debug info for FBM region visualization
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
        if (renderConfig?.showFbmDelimitations && renderConfig?.crackUseNoise) {
            try {
                const seed = Math.floor((renderConfig?.crackSeed ?? Date.now())) >>> 0;
                const noiseCfg = renderConfig.crackNoiseParams || { buckets: 3, maxActiveBuckets: 2, activeBucketStrategy: 'smallest' };
                const buckets = Math.max(1, Math.min(8, noiseCfg.buckets || 3));
                const maxActive = Math.max(1, Math.min(buckets, noiseCfg.maxActiveBuckets || buckets));
                const strategyRaw = noiseCfg.activeBucketStrategy;
                const strategy: 'smallest' | 'largest' | 'random' = (strategyRaw === 'largest' || strategyRaw === 'random') ? strategyRaw : 'smallest';
                const forced = Array.isArray((renderConfig as any)?.forceActiveBucketIds) ? (renderConfig as any).forceActiveBucketIds : null;
                const layout = buildBucketLayout({
                    width,
                    height,
                    bucketCount: buckets,
                    maxActiveBuckets: maxActive,
                    strategy,
                    seed,
                    debugMask: debugMask?.data || null,
                    forcedActive: forced,
                });

                const debug_regionW = Math.max(1, layout.cols);
                const debug_regionH = Math.max(1, layout.rows);
                const debug_regionMap = new Uint8Array(debug_regionW * debug_regionH);
                for (let ry = 0; ry < debug_regionH; ry++) {
                    for (let rx = 0; rx < debug_regionW; rx++) {
                        let id = ry * debug_regionW + rx;
                        if (id >= buckets) id = buckets - 1;
                        debug_regionMap[ry * debug_regionW + rx] = id;
                    }
                }

                if (renderConfig && typeof renderConfig === 'object') {
                    try {
                        const stats: Record<number, number> = {};
                        layout.countsInsideMask.forEach((count, idx) => {
                            stats[idx] = count;
                        });
                        (renderConfig as any).detectedFbmBuckets = stats;
                    } catch (e) {
                        // ignore assignment errors
                    }
                }

                const placeholderData = new Uint8ClampedArray(4);
                placeholderData[0] = 0; placeholderData[1] = 0; placeholderData[2] = 0; placeholderData[3] = 0;
                const out: CrackRaster = { data: placeholderData, width: 1, height: 1, quality, color: [24, 24, 24] };
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
                // fall through
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
    // FBM/noise filtering removes all pixels (so the user isn't left with
    // an empty transparent result because of restrictive params).
    const _voronoiCopy = new Uint8ClampedArray(data);

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

    if (renderConfig?.crackUseNoise) {
        const noiseCfg = renderConfig.crackNoiseParams || { buckets: 3, maxActiveBuckets: 2, activeBucketStrategy: 'smallest' };
        const buckets = Math.max(1, Math.min(8, noiseCfg.buckets || 3));
        const maxActive = Math.max(1, Math.min(buckets, noiseCfg.maxActiveBuckets || buckets));
        const strategyRaw = noiseCfg.activeBucketStrategy;
        const strategy: 'smallest' | 'largest' | 'random' = (strategyRaw === 'largest' || strategyRaw === 'random') ? strategyRaw : 'smallest';
        const forced = Array.isArray((renderConfig as any)?.forceActiveBucketIds) ? (renderConfig as any).forceActiveBucketIds : null;

        const bucketLayout = buildBucketLayout({
            width,
            height,
            bucketCount: buckets,
            maxActiveBuckets: maxActive,
            strategy,
            seed,
            debugMask: debugMaskData || null,
            forcedActive: forced,
        });

        debug_regionW = bucketLayout.cols;
        debug_regionH = bucketLayout.rows;
        debug_regionCellW = debug_regionW > 0 ? width / debug_regionW : width;
        debug_regionCellH = debug_regionH > 0 ? height / debug_regionH : height;
        debug_buckets = buckets;
        debug_regionMap = new Uint8Array(debug_regionW * debug_regionH);
        for (let ry = 0; ry < debug_regionH; ry++) {
            for (let rx = 0; rx < debug_regionW; rx++) {
                let id = ry * debug_regionW + rx;
                if (id >= buckets) id = buckets - 1;
                debug_regionMap[ry * debug_regionW + rx] = id;
            }
        }

        if (renderConfig && typeof renderConfig === 'object') {
            try {
                const stats: Record<number, number> = {};
                bucketLayout.countsInsideMask.forEach((count, idx) => {
                    stats[idx] = count;
                });
                (renderConfig as any).detectedFbmBuckets = stats;
            } catch (e) {
                // ignore assignment issues
            }
        }

        const invQuality = 1 / quality;
        const palette = [
            [220, 38, 38],
            [34, 197, 94],
            [37, 99, 235],
            [234, 179, 8],
            [168, 85, 247],
            [16, 185, 129],
            [251, 191, 36],
            [244, 63, 94],
        ];

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
                const bucketId = bucketLayout.ids[baseIndex];
                if (!bucketLayout.activeBuckets.has(bucketId)) {
                    data[idx + 3] = 0;
                    continue;
                }
                const color = palette[bucketId % palette.length];
                data[idx] = color[0];
                data[idx + 1] = color[1];
                data[idx + 2] = color[2];
                if (crashMaskData) {
                    crashMaskData[baseIndex] = 255;
                }
            }
        }

        let any = false;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 0) { any = true; break; }
        }
        if (!any) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[crackGenerator] Bucket filtering removed all pixels; restoring fallback Voronoi image. Adjust crackNoiseParams or change seed.');
            }
            data.set(_voronoiCopy);
        }
    } else {
        const invQuality = 1 / quality;
        for (let y = 0; y < canvasH; y++) {
            for (let x = 0; x < canvasW; x++) {
                const idx = (y * canvasW + x) * 4;
                if (data[idx + 3] === 0) continue;
                data[idx] = 24;
                data[idx + 1] = 24;
                data[idx + 2] = 24;
                if (!crashMaskData) continue;
                const screenX = (x + 0.5) * invQuality;
                const screenY = (y + 0.5) * invQuality;
                const baseX = Math.max(0, Math.min(width - 1, Math.floor(screenX)));
                const baseY = Math.max(0, Math.min(height - 1, Math.floor(screenY)));
                const baseIndex = baseY * width + baseX;
                if (debugMaskData && debugMaskData[baseIndex] === 0) continue;
                crashMaskData[baseY * width + baseX] = 255;
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
