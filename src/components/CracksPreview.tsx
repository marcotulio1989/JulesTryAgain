import React, { useEffect, useRef, useState } from 'react';
import { generateVoronoiCrackImage } from '../tools/crackGenerator';
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

    // Generate an image canvas for given scale multiplier. This is self-contained so we can produce high-res canvases.
    function generateCanvas(scale = 1): HTMLCanvasElement {
        const sw = Math.max(1, Math.round(width * scale));
        const sh = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = sw; canvas.height = sh;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;
        const pixels = generateVoronoiCrackImage(sw, sh, {
            divisions,
            thickness,
            dilateRadius,
            seed,
            scale,
            color: EDGE_COLOR as [number, number, number],
        });
        const img = ctx.createImageData(sw, sh);
        img.data.set(pixels);
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
