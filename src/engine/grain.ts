// Film grain: Boolean model of grains (Poisson-distributed discs with log-normal radii),
// after Newson, Delon & Galerne, "A Stochastic Film Grain Model for Resolution-Independent
// Rendering" (2017). This file is the CPU reference; shaders/grain.glsl is a 1:1 port.
//
// For a developed layer with coverage u (0..1), grains of mean area a = E[∫ a_i] are placed with
// Poisson intensity λ = −ln(1−u)/a. Then E[coverage] = u exactly (also for soft "dye cloud" edges,
// by Campbell's theorem), the variance peaks at u = 0.5 (midtones) and the spatial correlation
// length is the grain size, so grain is never per-pixel digital noise. Grain is evaluated at
// absolute output-pixel positions: identical across tiles, and the preview at 1:1 is the export.

export function hash(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}
export const U32 = 4294967296;

export interface GrainParams {
  /** mean grain radius in output pixels */
  radius: number;
  /** log-normal sigma of radius (roughness) */
  sigma: number;
  /** 0 = hard silver grain edge, 1 = soft dye cloud */
  soft: number;
  seed: number;
}

/** Fraction of the disc area covered by a soft-edged grain profile. */
export function softAreaFactor(soft: number): number {
  const inner = 1 - 0.85 * soft;
  // a(d) = 1 - smoothstep(inner, 1, d) for unit radius; integrate 2πd a(d) dd / π
  const n = 400;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = (i + 0.5) / n;
    s += 2 * d * grainProfile(d, inner) / n;
  }
  return s;
}

export function grainProfile(dOverR: number, inner: number): number {
  if (dOverR >= 1) return 0;
  if (dOverR <= inner) return 1;
  const t = (dOverR - inner) / (1 - inner);
  return 1 - t * t * (3 - 2 * t);
}

/** Max radius used for the cell grid (radii beyond are clamped). */
export function rMax(p: GrainParams) {
  return p.radius * Math.exp(2.5 * p.sigma - 0.5 * p.sigma * p.sigma);
}

/** E[r^2] for the clamped log-normal (close enough to unclamped: 99.4% mass inside). */
export function meanR2(p: GrainParams) {
  return p.radius * p.radius * Math.exp(p.sigma * p.sigma);
}

function rand(state: { s: number }): number {
  state.s = hash(state.s + 0x9e3779b9);
  return state.s / U32;
}

/** Coverage of a single point (x,y) in output px, layer coverage u. Mirrors pointCoverage() in grain.glsl. */
export function pointCoverage(x: number, y: number, u: number, layer: number, p: GrainParams, areaF: number, delta = rMax(p), colour = 1): number {
  if (u <= 0) return 0;
  const uc = Math.min(u, 0.9995);
  const lambda = -Math.log(1 - uc) / (Math.PI * meanR2(p) * areaF);
  const cx0 = Math.floor(x / delta), cy0 = Math.floor(y / delta);
  const inner = 1 - 0.85 * p.soft;
  let keep = 1; // product of (1 - a_i)
  const L = Math.exp(-lambda * delta * delta);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = cx0 + dx, cy = cy0 + dy;
      const cu = (Math.imul(cx | 0, 73856093) ^ Math.imul(cy | 0, 19349663)) >>> 0;
      const share = hash((cu ^ p.seed ^ 0x5bd1e995) >>> 0) / U32;
      const lay = share < 1 - colour ? 7 : layer;
      const st = { s: hash((cu ^ Math.imul(lay, 83492791) ^ p.seed) >>> 0) };
      let n = 0, pr = rand(st);
      while (pr > L && n < 48) { n++; pr *= rand(st); }
      for (let k = 0; k < n; k++) {
        const gx = (cx + rand(st)) * delta, gy = (cy + rand(st)) * delta;
        const u1 = Math.max(rand(st), 1e-7), u2 = rand(st);
        const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(6.283185307 * u2);
        const r = Math.min(p.radius * Math.exp(p.sigma * g - 0.5 * p.sigma * p.sigma), delta);
        const ddx = x - gx, ddy = y - gy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < r * r) {
          keep *= 1 - grainProfile(Math.sqrt(d2) / r, inner);
          if (keep < 1e-4) return 1;
        }
      }
    }
  }
  return 1 - keep;
}

/** Sample pattern inside the pixel footprint: Vogel spiral, gaussian radial distribution. */
export function samplePattern(n: number): [number, number][] {
  const out: [number, number][] = [];
  const ga = 2.39996323;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const rr = Math.sqrt(-2 * Math.log(1 - t * 0.999)); // gaussian radial CDF inverse
    out.push([rr * Math.cos(i * ga), rr * Math.sin(i * ga)]);
  }
  return out;
}

/** Filtered coverage of the pixel at integer position (px,py) with filter sigma s (output px). */
export function pixelCoverage(px: number, py: number, u: number, layer: number, p: GrainParams, areaF: number, s: number, n: number, delta = rMax(p), colour = 1): number {
  const pat = samplePattern(n);
  const rot = (hash((Math.imul(px, 1973) ^ Math.imul(py, 9277) ^ 0x51ed27) >>> 0) / U32) * 6.283185307;
  const c = Math.cos(rot), sn = Math.sin(rot);
  let acc = 0;
  for (const [ox, oy] of pat) {
    const x = px + 0.5 + s * (c * ox - sn * oy);
    const y = py + 0.5 + s * (sn * ox + c * oy);
    acc += pointCoverage(x, y, u, layer, p, areaF, delta, colour);
  }
  return acc / n;
}

/** Samples per pixel used by the GPU: more when the footprint is large relative to grains. */
export function sampleCount(s: number, radius: number): number {
  const q = s / Math.max(radius, 1e-3);
  return Math.max(8, Math.min(24, Math.round(8 + 24 * q * q)));
}

// ---- analytic variance of the filtered grain field (used when zoomed far out) ----
function lensArea(h: number, r: number) {
  if (h >= 2 * r) return 0;
  return 2 * r * r * Math.acos(h / (2 * r)) - (h / 2) * Math.sqrt(4 * r * r - h * h);
}

/** Variance of coverage after Gaussian filtering with sigma s, unit effective radius. */
export function filteredVariance(u: number, sOverR: number): number {
  if (u <= 0 || u >= 1) return 0;
  const r = 1;
  const lambda = -Math.log(1 - u) / (Math.PI * r * r);
  const s = Math.max(sOverR, 1e-4);
  // the pair filter (gaussian * gaussian) has sigma sqrt(2)*s; integrate where it has mass
  const hmax = Math.min(2 * r, 12 * s);
  const n = 512;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const h = ((i + 0.5) / n) * hmax;
    const cov = (1 - u) * (1 - u) * (Math.exp(lambda * lensArea(h, r)) - 1);
    const g = Math.exp(-(h * h) / (4 * s * s)) / (4 * Math.PI * s * s);
    acc += cov * g * 2 * Math.PI * h * (hmax / n);
  }
  return Math.min(acc, u * (1 - u));
}

export const VAR_LUT_U = 64;
export const VAR_LUT_S = 64;
export const VAR_LUT_LOG_MIN = -3;
export const VAR_LUT_LOG_MAX = 6;

/** std-dev LUT: rows = log2(s/r) from -3..6, cols = u 0..1 */
export function buildStdLut(): Float32Array {
  const out = new Float32Array(VAR_LUT_U * VAR_LUT_S);
  for (let j = 0; j < VAR_LUT_S; j++) {
    const lg = VAR_LUT_LOG_MIN + ((VAR_LUT_LOG_MAX - VAR_LUT_LOG_MIN) * j) / (VAR_LUT_S - 1);
    const s = Math.pow(2, lg);
    for (let i = 0; i < VAR_LUT_U; i++) {
      const u = Math.min(0.999, i / (VAR_LUT_U - 1));
      out[j * VAR_LUT_U + i] = Math.sqrt(filteredVariance(u, s));
    }
  }
  return out;
}

/** Map UI + stock values to physical grain radius in output pixels. */
export function grainRadiusPx(opts: { um: number; frameShortMm: number; frameShortPx: number; size: number; iso: number; stockIso: number }) {
  const sizeMul = Math.pow(2, (opts.size - 50) / 25);
  const isoMul = Math.sqrt(Math.max(opts.iso, 6) / Math.max(opts.stockIso, 6));
  return (opts.um / (opts.frameShortMm * 1000)) * opts.frameShortPx * sizeMul * isoMul;
}

export const FRAME_SHORT_MM: Record<string, number> = { "35mm": 24, half: 18, "120": 56, "4x5": 102, instant: 79, "110": 13 };

/**
 * Amplitude calibration. A single Boolean layer has far more contrast than a real emulsion, which
 * stacks many grains through its depth. We keep the Boolean field's spatial structure and scale its
 * deviation so the negative's RMS granularity (σD at a 48 µm aperture, density 1.0 above base)
 * matches the stock's published-style figure. Amount 50 = that physical level, 100 = 4x.
 */
export function grainAmplitude(opts: { rms: number; um: number; sigma: number; soft: number; densityRange: number }) {
  const rEff = opts.um * Math.sqrt(Math.exp(opts.sigma * opts.sigma) * softAreaFactor(opts.soft));
  const s48 = 12; // gaussian sigma (µm) equivalent of a 48 µm circular aperture
  const uRef = Math.min(0.95, Math.max(0.05, 1 / opts.densityRange));
  const std = Math.sqrt(filteredVariance(uRef, s48 / rEff));
  return opts.rms / 1000 / Math.max(std * opts.densityRange, 1e-6);
}

export function amountCurve(amount: number) {
  return Math.pow(Math.max(amount, 0) / 50, 2);
}
