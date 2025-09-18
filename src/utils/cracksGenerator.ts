type CrackColor = [number, number, number];

export type VoronoiCrackOptions = {
    width: number;
    height: number;
    /**
     * Resolution multiplier. The final canvas size will be width * scale by height * scale.
     * Thickness and dilation are automatically scaled to match the higher resolution.
     */
    scale?: number;
    /**
     * Number of seed points used by the Voronoi diagram. Higher values create denser crack networks.
     */
    divisions?: number;
    /**
     * Controls how thick the crack lines are. Matches the slider used in the preview component.
     */
    thickness?: number;
    /**
     * Pixel radius used to dilate the generated cracks so they better cover curved areas.
     */
    dilateRadius?: number;
    /**
     * Seed for the pseudo-random generator. Ensures deterministic crack placement for a given seed.
     */
    seed?: number;
    /**
     * RGB color applied to the crack pixels. Defaults to a dark gray similar to asphalt fissures.
     */
    color?: CrackColor;
};

function setPixel(data: Uint8ClampedArray, idx: number, r: number, g: number, b: number, a = 255) {
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = a;
}

function clampDivisions(n: number): number {
    return Math.max(8, Math.min(2000, Math.round(n)));
}

function createRng(seed: number) {
    let t = seed >>> 0;
    return () => {
        t = (t * 1664525 + 1013904223) >>> 0;
        return t / 0x100000000;
    };
}

/**
 * Generate a Voronoi crack texture identical to the "preview rachadura" implementation.
 * Returns a canvas element containing the rendered cracks or null when the DOM is unavailable.
 */
export function generateVoronoiCrackCanvas(options: VoronoiCrackOptions): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;

    const {
        width,
        height,
        scale = 1,
        divisions = 400,
        thickness = 6,
        dilateRadius = 2,
        seed = Date.now(),
        color = [58, 58, 58] as CrackColor,
    } = options;

    const sw = Math.max(1, Math.round(width * scale));
    const sh = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return canvas;
    }

    const n = clampDivisions(divisions);
    const rng = createRng(seed);
    const pts = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
        pts[2 * i] = rng() * sw;
        pts[2 * i + 1] = rng() * sh;
    }

    const cellsPerDim = Math.max(8, Math.round(Math.sqrt(n)));
    const cellSize = sw / cellsPerDim;
    const gx = cellsPerDim;
    const gy = cellsPerDim;
    const grid: number[][] = new Array(gx * gy);
    for (let i = 0; i < grid.length; i++) grid[i] = [];
    for (let i = 0; i < n; i++) {
        const x = pts[2 * i];
        const y = pts[2 * i + 1];
        const cx = Math.min(gx - 1, Math.max(0, Math.floor(x / cellSize)));
        const cy = Math.min(gy - 1, Math.max(0, Math.floor(y / cellSize)));
        grid[cy * gx + cx].push(i);
    }

    function candidatesLocal(x: number, y: number) {
        const cx = Math.min(gx - 1, Math.max(0, Math.floor(x / cellSize)));
        const cy = Math.min(gy - 1, Math.max(0, Math.floor(y / cellSize)));
        let out: number[] = [];
        for (let r = 1; r <= 2; r++) {
            out.length = 0;
            for (let j = cy - r; j <= cy + r; j++) {
                if (j < 0 || j >= gy) continue;
                for (let i = cx - r; i <= cx + r; i++) {
                    if (i < 0 || i >= gx) continue;
                    const arr = grid[j * gx + i];
                    if (arr && arr.length) out.push(...arr);
                }
            }
            if (out.length || r === 2) return out;
        }
        return out;
    }

    const img = ctx.createImageData(sw, sh);
    const d = img.data;
    const eps = (thickness / 10) * scale;

    for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
            const cand = candidatesLocal(x, y);
            let b1 = Infinity;
            let b2 = Infinity;
            if (cand && cand.length) {
                for (let k = 0; k < cand.length; k++) {
                    const i = cand[k];
                    const dx = x - pts[2 * i];
                    const dy = y - pts[2 * i + 1];
                    const dist2 = dx * dx + dy * dy;
                    if (dist2 < b1) { b2 = b1; b1 = dist2; }
                    else if (dist2 < b2) { b2 = dist2; }
                }
            } else {
                for (let i = 0; i < n; i++) {
                    const dx = x - pts[2 * i];
                    const dy = y - pts[2 * i + 1];
                    const dist2 = dx * dx + dy * dy;
                    if (dist2 < b1) { b2 = b1; b1 = dist2; }
                    else if (dist2 < b2) { b2 = dist2; }
                }
            }
            const delta = Math.sqrt(b2) - Math.sqrt(b1);
            const p = (y * sw + x) * 4;
            if (delta < eps) {
                setPixel(d, p, color[0], color[1], color[2], 255);
            } else {
                setPixel(d, p, 0, 0, 0, 0);
            }
        }
    }

    const radius = Math.max(0, Math.min(20, Math.round(dilateRadius * scale)));
    if (radius > 0) {
        const copy = new Uint8ClampedArray(d.length);
        copy.set(d);
        const w = sw;
        const h = sh;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                if (copy[idx + 3] === 0) continue;
                const x0 = Math.max(0, x - radius);
                const x1 = Math.min(w - 1, x + radius);
                const y0 = Math.max(0, y - radius);
                const y1 = Math.min(h - 1, y + radius);
                for (let yy = y0; yy <= y1; yy++) {
                    for (let xx = x0; xx <= x1; xx++) {
                        const ii = (yy * w + xx) * 4;
                        setPixel(d, ii, color[0], color[1], color[2], 255);
                    }
                }
            }
        }
    }

    ctx.putImageData(img, 0, 0);
    return canvas;
}

