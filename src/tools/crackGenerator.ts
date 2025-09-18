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
