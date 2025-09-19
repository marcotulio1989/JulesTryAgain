import { Noise } from 'noisejs';
import { sampleWarpedNoise } from '../lib/noiseField';
import { generateNoiseMaskFromCrackGenerator } from './noiseMask';

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
    // Optional debug info for noise bucket region visualization (legacy naming kept for backwards compatibility)
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
        activeBucketIds?: number[];
    };
    noiseMask?: {
        data: Uint8Array;
        width: number;
        height: number;
    };
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
    const {
        width: widthRaw,
        height: heightRaw,
        minX,
        minY,
        renderConfig,
        isoToWorld,
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
                const noiseCfg = renderConfig.crackNoiseParams || { baseScale: 1 / 480, octaves: 4, lacunarity: 2, gain: 0.5, buckets: 3, crackBandWidth: 0.012 };
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
                        const v = sampleWarpedNoise(regionNoise, worldPt.x * baseScale, worldPt.y * baseScale, octaves, lacunarity, gain);
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
    let activeBuckets: Set<number> | null = null;
    let bucketAssignment: Uint8Array | null = null;
    let noiseMaskData: Uint8Array | null = null;
    let noiseMaskHits = 0;

    if (renderConfig?.crackUseNoise) {
        const {
            noiseMaskData: generatedNoiseMask,
            debug_regionMap: generatedDebugRegionMap,
            debug_regionW: generatedDebugRegionW,
            debug_regionH: generatedDebugRegionH,
            debug_regionCellW: generatedDebugRegionCellW,
            debug_regionCellH: generatedDebugRegionCellH,
            debug_buckets: generatedDebugBuckets,
            activeBuckets: generatedActiveBuckets,
            bucketAssignment: generatedBucketAssignment,
        } = generateNoiseMaskFromCrackGenerator({
            width,
            height,
            minX,
            minY,
            renderConfig,
            isoToWorld,
            seed,
        });

        noiseMaskData = generatedNoiseMask;
        debug_regionMap = generatedDebugRegionMap;
        debug_regionW = generatedDebugRegionW;
        debug_regionH = generatedDebugRegionH;
        debug_regionCellW = generatedDebugRegionCellW;
        debug_regionCellH = generatedDebugRegionCellH;
        debug_buckets = generatedDebugBuckets;
        activeBuckets = generatedActiveBuckets;
        bucketAssignment = generatedBucketAssignment;

        const crackColor: [number, number, number] = [24, 24, 24];
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
                if (noiseMaskData && noiseMaskData[baseIndex] === 0) {
                    data[idx + 3] = 0;
                    continue;
                }
                const bucketId = bucketAssignment ? bucketAssignment[baseIndex] : 0;
                if (!activeBuckets!.has(bucketId)) {
                    data[idx + 3] = 0;
                    continue;
                }
                if (noiseMaskData) {
                    const maskAlpha = Math.max(0, Math.min(1, noiseMaskData[baseIndex] / 255));
                    const finalAlpha = Math.max(0, Math.min(255, Math.round(alpha * maskAlpha)));
                    if (finalAlpha <= 0) {
                        data[idx + 3] = 0;
                        continue;
                    }
                    data[idx + 3] = finalAlpha;
                }
                data[idx] = crackColor[0];
                data[idx + 1] = crackColor[1];
                data[idx + 2] = crackColor[2];
                hasCoverage = true;
            }
        }
        if (!hasCoverage) {
            // Restore the original Voronoi image and warn so user can adjust
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[crackGenerator] Noise bucket filtering removed all pixels; restoring fallback Voronoi image. Try adjusting crackNoiseParams (buckets/maxActiveBuckets) or change seed.');
            }
            data.set(_voronoiCopy);
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
    }

    if (noiseMaskData) {
        let hits = 0;
        for (let i = 0; i < noiseMaskData.length; i++) {
            if (noiseMaskData[i] > 0) hits++;
        }
        noiseMaskHits = hits;
        if (noiseMaskHits === 0) {
            noiseMaskData = null;
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
            activeBucketIds: activeBuckets ? Array.from(activeBuckets) : undefined,
        };
    }
    if (noiseMaskData && noiseMaskHits > 0) {
        out.noiseMask = {
            data: noiseMaskData,
            width,
            height,
        };
    }
    return out;
}
