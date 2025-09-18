import React, { useEffect, useRef, useState } from 'react';
import { Noise } from 'noisejs';
import { config } from '../game_modules/config';
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
        return (sum / (norm || 1)) * 0.5 + 0.5;
    };

    function applyNoiseMask(data: Uint8ClampedArray, canvasW: number, canvasH: number, seed: number) {
        const renderCfg = (config as any).render || {};
        if (!renderCfg.crackUseNoise) {
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] > 0) {
                    data[i] = 24;
                    data[i + 1] = 24;
                    data[i + 2] = 24;
                }
            }
            return;
        }

        const noiseCfg = renderCfg.crackNoiseParams || { baseScale: 1 / 480, octaves: 4, lacunarity: 2, gain: 0.5, buckets: 3, crackBandWidth: 0.012, maxActiveBuckets: 2, activeBucketStrategy: 'smallest' };
        const baseScale = noiseCfg.baseScale || 1 / 480;
        const octaves = noiseCfg.octaves || 4;
        const lacunarity = noiseCfg.lacunarity || 2;
        const gain = noiseCfg.gain || 0.5;
        const buckets = Math.max(1, Math.min(8, noiseCfg.buckets || 3));
        const crackBandWidth = Math.max(0.002, Math.min(0.1, noiseCfg.crackBandWidth || 0.012));
        const maxActive = Math.max(1, Math.min(buckets, noiseCfg.maxActiveBuckets || 2));
        const strategy = noiseCfg.activeBucketStrategy || 'smallest';
        const regionSample = Math.max(16, Math.min(128, Math.floor(Math.min(canvasW, canvasH) / 6) || 16));
        const regionW = Math.max(1, Math.floor(canvasW / regionSample));
        const regionH = Math.max(1, Math.floor(canvasH / regionSample));
        const regionNoise = new Noise(seed || 1);
        const regionMap = new Uint8Array(regionW * regionH);
        const counts = new Array<number>(buckets).fill(0);
        for (let ry = 0; ry < regionH; ry++) {
            for (let rx = 0; rx < regionW; rx++) {
                const sampleX = ((rx + 0.5) / regionW) * canvasW;
                const sampleY = ((ry + 0.5) / regionH) * canvasH;
                const v = fbmNoise(regionNoise, sampleX * baseScale, sampleY * baseScale, octaves, lacunarity, gain);
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
                return () => { t = (t * 1664525 + 1013904223) >>> 0; return t / 0x100000000; };
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

        const regionCellW = regionW > 0 ? canvasW / regionW : canvasW;
        const regionCellH = regionH > 0 ? canvasH / regionH : canvasH;
        for (let y = 0; y < canvasH; y++) {
            for (let x = 0; x < canvasW; x++) {
                const idx = (y * canvasW + x) * 4;
                const alpha = data[idx + 3];
                if (alpha === 0) continue;
                const screenX = x + 0.5;
                const screenY = y + 0.5;
                const rx = Math.max(0, Math.min(regionW - 1, Math.floor(screenX / (regionCellW || 1))));
                const ry = Math.max(0, Math.min(regionH - 1, Math.floor(screenY / (regionCellH || 1))));
                const bucketId = regionMap[ry * regionW + rx];
                if (!activeBuckets.has(bucketId)) {
                    data[idx + 3] = 0;
                    continue;
                }
                const noiseInst = bucketNoise[bucketId];
                const baseVal = fbmNoise(noiseInst, screenX * baseScale, screenY * baseScale, octaves, lacunarity, gain);
                const dist = Math.abs(baseVal - bucketCenters[bucketId]);
                if (dist > crackBandWidth) {
                    data[idx + 3] = 0;
                    continue;
                }
                const edge = Math.max(0, (crackBandWidth - dist) / crackBandWidth);
                const edgeSoft = Math.pow(edge, 1.2);
                const fine = fbmNoise(noiseInst, screenX * fineScales[bucketId] * 3.0, screenY * fineScales[bucketId] * 3.0, 2, 2, 0.6);
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
    }

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
        applyNoiseMask(pixels, sw, sh, seed);
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
