import React, { useEffect, useRef, useState } from 'react';

function setPixel(data: Uint8ClampedArray, idx: number, r: number, g: number, b: number, a = 255) {
    data[idx] = r; data[idx+1] = g; data[idx+2] = b; data[idx+3] = a;
}
// (clean) continued implementation follows

const DEFAULT_WIDTH = 512;
const DEFAULT_HEIGHT = 512;
const EDGE_COLOR = [58, 58, 58]; // cinza escuro

type ApplyTarget = 'road' | 'edge' | 'both';

type CracksPreviewProps = {
    width?: number;
    height?: number;
    // new signature: callback receives the canvas and the chosen target
    onApplyCanvas?: (canvas: HTMLCanvasElement, target: ApplyTarget) => void;
};

const CracksPreview: React.FC<CracksPreviewProps> = ({ width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, onApplyCanvas }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [divisions, setDivisions] = useState<number>(400);
    const [thickness, setThickness] = useState<number>(6); // corresponds to eps slider in original (div by 10 later)
    const [seed, setSeed] = useState<number>(() => Date.now());
    const [quality, setQuality] = useState<number>(1); // 1,2,4
    const [applyTarget, setApplyTarget] = useState<ApplyTarget>('road');
    const [dilateRadius, setDilateRadius] = useState<number>(2); // pixels to expand edges (helps cover curves)

    // small helper RNG (deterministic by seed)
    function makeRng(s: number) {
        let t = s >>> 0;
        return () => { t = (t * 1664525 + 1013904223) >>> 0; return t / 0x100000000; };
    }

    // Generate an image canvas for given scale multiplier. This is self-contained so we can produce high-res canvases.
    function generateCanvas(scale = 1): HTMLCanvasElement {
        const sw = Math.max(1, Math.round(width * scale));
        const sh = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = sw; canvas.height = sh;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;

        const n = Math.max(8, Math.min(1500, Math.round(divisions)));
        const rng = makeRng(seed);
        const pts = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) { pts[2 * i] = rng() * sw; pts[2 * i + 1] = rng() * sh; }

        // grid acceleration
        const cellsPerDim = Math.max(8, Math.round(Math.sqrt(n)));
        const cellSize = sw / cellsPerDim;
        const gx = cellsPerDim, gy = cellsPerDim;
        const grid: number[][] = new Array(gx * gy);
        for (let i = 0; i < grid.length; i++) grid[i] = [];
        for (let i = 0; i < n; i++) {
            const x = pts[2 * i], y = pts[2 * i + 1];
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
        const eps = (thickness / 10) * scale; // scale thickness proportionally

        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
                const cand = candidatesLocal(x, y);
                let b1 = Infinity, b2 = Infinity;
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
                if (delta < eps) { d[p] = EDGE_COLOR[0]; d[p + 1] = EDGE_COLOR[1]; d[p + 2] = EDGE_COLOR[2]; d[p + 3] = 255; }
                else { d[p] = 0; d[p + 1] = 0; d[p + 2] = 0; d[p + 3] = 0; }
            }
        }

        // dilation to cover curves/rounded areas
        const radius = Math.max(0, Math.min(20, Math.round(dilateRadius * scale)));
        if (radius > 0) {
            const copy = new Uint8ClampedArray(d.length);
            copy.set(d);
            const w = sw, h = sh;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x) * 4;
                    if (copy[idx + 3] === 0) continue;
                    // expand
                    const x0 = Math.max(0, x - radius), x1 = Math.min(w - 1, x + radius);
                    const y0 = Math.max(0, y - radius), y1 = Math.min(h - 1, y + radius);
                    for (let yy = y0; yy <= y1; yy++) {
                        for (let xx = x0; xx <= x1; xx++) {
                            const ii = (yy * w + xx) * 4;
                            d[ii] = EDGE_COLOR[0]; d[ii + 1] = EDGE_COLOR[1]; d[ii + 2] = EDGE_COLOR[2]; d[ii + 3] = 255;
                        }
                    }
                }
            }
        }

        ctx.putImageData(img, 0, 0);
        return canvas;
    }

    // redraw visible preview at base quality
    function redrawPreview() {
        const c = canvasRef.current;
        if (!c) return;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        const src = generateCanvas(1);
        // draw scaled down if needed (should be same size)
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(src, 0, 0, c.width, c.height);
    }

    useEffect(() => { redrawPreview(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [seed, divisions, thickness, dilateRadius]);

    return (
        <div style={{ display: 'inline-block', marginLeft: 12, verticalAlign: 'middle' }}>
            <div style={{ marginBottom: 8, fontWeight: 700 }}>Preview: Rachaduras → Ruas</div>
            <canvas ref={canvasRef} width={width} height={height} style={{ border: '2px solid #111' }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <label style={{ fontSize: 12 }}>Divisões
                    <input type="range" min={50} max={1500} value={divisions} onChange={(e) => setDivisions(parseInt(e.target.value || '400', 10))} />
                </label>
                <label style={{ fontSize: 12 }}>Espessura
                    <input type="range" min={2} max={20} value={thickness} onChange={(e) => setThickness(parseInt(e.target.value || '6', 10))} />
                </label>
                <label style={{ fontSize: 12 }}>Dilatar (curvas px)
                    <input type="range" min={0} max={10} value={dilateRadius} onChange={(e) => setDilateRadius(parseInt(e.target.value || '2', 10))} />
                </label>
                <label style={{ fontSize: 12 }}>Qualidade
                    <select value={quality} onChange={(e) => setQuality(parseInt(e.target.value || '1', 10))}>
                        <option value={1}>1x</option>
                        <option value={2}>2x</option>
                        <option value={4}>4x</option>
                    </select>
                </label>
                <label style={{ fontSize: 12 }}>Aplicar em
                    <select value={applyTarget} onChange={(e) => setApplyTarget(e.target.value as ApplyTarget)}>
                        <option value="road">Vias (cracks)</option>
                        <option value="edge">Bordas (concreto)</option>
                        <option value="both">Ambos</option>
                    </select>
                </label>
                <button onClick={() => { setSeed(Date.now()); redrawPreview(); }}>Re-sortear sementes</button>
                <button onClick={() => {
                    const c = generateCanvas(quality);
                    const dataUrl = c.toDataURL('image/png');
                    const a = document.createElement('a');
                    a.href = dataUrl;
                    a.download = `cracks_preview_${Date.now()}_${quality}x.png`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                }}>Salvar PNG</button>
                <button onClick={() => {
                    const c = generateCanvas(quality);
                    if (onApplyCanvas) {
                        try { onApplyCanvas(c, applyTarget); } catch (e) { console.warn('onApplyCanvas failed', e); }
                    }
                }}>Aplicar ao mapa</button>
            </div>
        </div>
    );
};

export { CracksPreview };
