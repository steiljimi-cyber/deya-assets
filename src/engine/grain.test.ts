import { describe, expect, it } from "vitest";
import { filteredVariance, pixelCoverage, softAreaFactor, sampleCount, type GrainParams, grainRadiusPx, buildStdLut } from "./grain";

function render(w: number, h: number, u: number, p: GrainParams, s = 0.5) {
  const a = softAreaFactor(p.soft);
  const out = new Float32Array(w * h);
  const n = sampleCount(s, p.radius);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = pixelCoverage(x, y, u, 0, p, a, s, n);
  return out;
}
const stats = (a: Float32Array) => {
  let m = 0; for (const v of a) m += v; m /= a.length;
  let v2 = 0; for (const v of a) v2 += (v - m) ** 2;
  return { mean: m, std: Math.sqrt(v2 / a.length) };
};
function autocorr(a: Float32Array, w: number, h: number, dx: number, dy: number) {
  const { mean, std } = stats(a);
  let acc = 0, n = 0;
  for (let y = 0; y < h - dy; y++) for (let x = 0; x < w - dx; x++) { acc += (a[y * w + x] - mean) * (a[(y + dy) * w + x + dx] - mean); n++; }
  return acc / n / (std * std);
}
function downsample(a: Float32Array, w: number, h: number, f: number) {
  // area-average resampling by factor f (<1)
  const W = Math.floor(w * f), H = Math.floor(h * f);
  const out = new Float32Array(W * H);
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    let acc = 0, wt = 0;
    const x0 = X / f, x1 = (X + 1) / f, y0 = Y / f, y1 = (Y + 1) / f;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const ox = Math.min(x + 1, x1) - Math.max(x, x0), oy = Math.min(y + 1, y1) - Math.max(y, y0);
      if (ox > 0 && oy > 0) { acc += a[y * w + x] * ox * oy; wt += ox * oy; }
    }
    out[Y * W + X] = acc / wt;
  }
  return { out, W, H };
}

const P: GrainParams = { radius: 2.2, sigma: 0.3, soft: 0.8, seed: 1234 };

describe("film grain (Boolean model)", () => {
  it("preserves mean density at every exposure (unbiased)", () => {
    for (const u of [0.1, 0.5, 0.85]) {
      const s = stats(render(160, 160, u, P));
      expect(Math.abs(s.mean - u)).toBeLessThan(0.02);
    }
  });

  it("is strongest in the midtones", () => {
    const sd = (u: number) => stats(render(128, 128, u, P)).std;
    const mid = sd(0.5);
    expect(mid).toBeGreaterThan(sd(0.08));
    expect(mid).toBeGreaterThan(sd(0.95));
  });

  it("is spatially correlated (grain clumps), unlike per-pixel digital noise", () => {
    const a = render(160, 160, 0.5, P);
    expect(autocorr(a, 160, 160, 1, 0)).toBeGreaterThan(0.5);
    // isotropic: no pixel-grid structure
    expect(Math.abs(autocorr(a, 160, 160, 1, 0) - autocorr(a, 160, 160, 0, 1))).toBeLessThan(0.08);
    expect(autocorr(a, 160, 160, 12, 0)).toBeLessThan(0.1); // and decorrelates beyond grain size
  });

  it("still reads as heavy grain after an A3 -> A4 downsize (white noise would drop to 0.71x)", () => {
    const w = 240, h = 240;
    const a = render(w, h, 0.5, P);
    const { out } = downsample(a, w, h, 1 / Math.SQRT2);
    const ratio = stats(out).std / stats(a).std;
    expect(ratio).toBeGreaterThan(0.85);
    // control: white noise
    const wn = new Float32Array(w * h).map(() => Math.random());
    const r2 = stats(downsample(wn, w, h, 1 / Math.SQRT2).out).std / stats(wn).std;
    expect(r2).toBeLessThan(0.76);
  });

  it("analytic variance matches the point variance limit and the rendered field", () => {
    expect(filteredVariance(0.5, 1e-4)).toBeCloseTo(0.25, 2);
    const hard: GrainParams = { radius: 3, sigma: 0.0001, soft: 0, seed: 7 };
    const a = render(200, 200, 0.4, hard, 0.5);
    const predicted = Math.sqrt(filteredVariance(0.4, 0.5 / 3));
    expect(stats(a).std / predicted).toBeGreaterThan(0.85);
    expect(stats(a).std / predicted).toBeLessThan(1.15);
    const lut = buildStdLut();
    expect(lut.length).toBe(64 * 64);
  });

  it("grain size follows stock, format and ISO", () => {
    const base = { um: 16, frameShortMm: 24, frameShortPx: 3508, size: 50, iso: 400, stockIso: 400 };
    const r = grainRadiusPx(base);
    expect(r).toBeGreaterThan(1.5); // visible at A3 300ppi
    expect(grainRadiusPx({ ...base, iso: 1600 })).toBeCloseTo(r * 2, 6);
    expect(grainRadiusPx({ ...base, frameShortMm: 56 })).toBeLessThan(r); // medium format: finer
    expect(grainRadiusPx({ ...base, size: 75 })).toBeCloseTo(r * 2, 6);
  });
});
