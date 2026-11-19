// Physically based film model (reference implementation; mirrored 1:1 in shaders/film.glsl).
//
// Stage 1, negative (or reversal camera film):
//   layer exposure E = S · rgb        (S: spectral sensitivity approximation, 3x3)
//   x = log10(E / 0.18)               (log exposure relative to mid grey)
//   d = γ·(sp(x−toe, kt) − sp(x−shoulder, ks))   (characteristic H&D curve, density above base)
//   interlayer (DIR coupler) effect: d' = d + c·(d − mean(d))   -> colour crossover / saturation
// Grain lives here: d is converted to developed coverage u = d / dRange and rendered as a
// Boolean model of grains (see engine/grain.ts), then back to density.
// Stage 2, print / scan:
//   printer exposure y = −(d − d_grey) + y0        (printer lights neutralise mid grey)
//   print density Dp = γp·(sp(y−yt, pkt) − sp(y−ys, pks))
//   output = 10^(−Dp)                              (paper white = 1)
// Highlight roll-off = print toe (+ negative shoulder), shadow roll-off = print shoulder (+ neg toe).
import type { Mat3, Vec3 } from "./color";
import { mul, luminance } from "./color";

export type StockKind = "color" | "bw" | "slide" | "instant";

export interface StockDef {
  id: string;
  name: string;
  kind: StockKind;
  iso: number;
  description: string;
  sens: Mat3;
  gamma: Vec3;
  toe: Vec3;
  shoulder: Vec3;
  toeSoft: number;
  shoulderSoft: number;
  coupling: number;
  printGamma: number;
  /** total print density range (black = 10^-range) */
  printRange: number;
  printToeSoft: number;
  printShoulderSoft: number;
  /** extra print exposure in stops (brighter scan/print) */
  printExposure?: number;
  /** output tint multiplier (instant/B&W toning). */
  tint?: Vec3;
  /** um: clump radius in µm; rms: diffuse RMS granularity (σD×1000 at 48 µm aperture, D=1.0) */
  grain: { um: number; rough: number; soft: number; rms?: number; layer?: Vec3 };
  halation: { strength: number; color: Vec3 };
  look?: { exposure?: number; saturation?: number; vibrance?: number; contrast?: number; flash?: number; fade?: number; warmth?: number };
}

export interface CompiledStock {
  def: StockDef;
  sens: Mat3;
  gamma: Vec3;
  toe: Vec3;
  shoulder: Vec3;
  kt: number;
  ks: number;
  coupling: number;
  dRange: Vec3;
  dGrey: Vec3;
  pg: number;
  yt: number;
  ys: number;
  pkt: number;
  pks: number;
  y0: number;
  pRange: number;
  tint: Vec3;
  bw: boolean;
  /** 0 = grain on negative density, 1 = grain on final (reversal/instant) dye density */
  grainStage: number;
}

export function softplus(u: number, k: number): number {
  const z = u / k;
  if (z > 30) return u;
  if (z < -30) return k * Math.exp(z);
  return k * Math.log1p(Math.exp(z));
}

/** Monotone S-curve: soft toe at `toe`, soft shoulder `width` above it. Starts at 0, ends at width. */
export function sCurve(x: number, toe: number, width: number, kt: number, ks: number): number {
  const a = softplus(x - toe, kt); // >= 0, monotone
  const f0 = -softplus(-width, ks);
  return a - softplus(a - width, ks) - f0; // derivative in (0,1): never decreases
}
export function sCurveMax(width: number, ks: number): number {
  return width + softplus(-width, ks);
}

export function negDensity(x: number, gamma: number, toe: number, shoulder: number, kt: number, ks: number): number {
  return gamma * sCurve(x, toe, shoulder - toe, kt, ks);
}

function rawNeg(c: CompiledStock, rgb: Vec3): Vec3 {
  const E = mul(c.sens, rgb);
  const d: number[] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const x = Math.log10(Math.max(E[i], 1e-7) / 0.18);
    d[i] = negDensity(x, c.gamma[i], c.toe[i], c.shoulder[i], c.kt, c.ks);
  }
  const m = (d[0] + d[1] + d[2]) / 3;
  return d.map((v) => v + c.coupling * (v - m)) as Vec3;
}

export function printDensity(c: CompiledStock, d: number, i: number): number {
  const y = -(d - c.dGrey[i]) + c.y0;
  return c.pg * sCurve(y, c.yt, c.ys - c.yt, c.pkt, c.pks);
}

export function compileStock(def: StockDef): CompiledStock {
  const pg = def.printGamma;
  const c: CompiledStock = {
    def,
    sens: def.kind === "bw" ? bwSens(def.sens) : def.sens,
    gamma: def.gamma,
    toe: def.toe,
    shoulder: def.shoulder,
    kt: def.toeSoft,
    ks: def.shoulderSoft,
    coupling: def.kind === "bw" ? 0 : def.coupling,
    dRange: def.gamma.map((g, i) => g * sCurveMax(def.shoulder[i] - def.toe[i], def.shoulderSoft)) as Vec3,
    dGrey: [0, 0, 0],
    pg,
    // print toe sits where grey would land 0.745 D above paper white (out = 0.18)
    yt: -0.745 / pg,
    ys: -0.745 / pg + def.printRange / pg,
    pkt: def.printToeSoft,
    pks: def.printShoulderSoft,
    y0: 0,
    pRange: def.printRange,
    tint: def.tint ?? [1, 1, 1],
    bw: def.kind === "bw",
    grainStage: def.kind === "slide" || def.kind === "instant" ? 1 : 0,
  };
  c.dGrey = rawNeg(c, [0.18, 0.18, 0.18]);
  // calibrate print exposure so mid grey -> 0.18 * 2^printExposure exactly (bisection on y0)
  const target = 0.18 * Math.pow(2, def.printExposure ?? 0);
  let lo = -2, hi = 2;
  for (let it = 0; it < 60; it++) {
    c.y0 = (lo + hi) / 2;
    const out = Math.pow(10, -printDensity(c, c.dGrey[1], 1));
    if (out > target) lo = c.y0; else hi = c.y0;
  }
  return c;
}

function bwSens(s: Mat3): Mat3 {
  // B&W: one panchromatic layer -> same exposure in all three channels
  return [s[0], s[1], s[2], s[0], s[1], s[2], s[0], s[1], s[2]];
}

export interface FilmResult {
  out: Vec3;
  /** coverage (0..1) the grain model works on */
  u: Vec3;
  d: Vec3;
}

/** Film response without grain (the grain-free expectation). */
export function filmApply(c: CompiledStock, rgb: Vec3): FilmResult {
  const d = rawNeg(c, rgb);
  const out: number[] = [0, 0, 0];
  const u: number[] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const dp = printDensity(c, d[i], i);
    out[i] = Math.pow(10, -dp) * c.tint[i];
    u[i] = c.grainStage === 0 ? clamp01(d[i] / c.dRange[i]) : clamp01(dp / c.pRange);
  }
  return { out: out as Vec3, u: u as Vec3, d };
}

/** Same as filmApply but with grain-perturbed coverage (u -> ug) injected at the grain stage. */
export function filmApplyWithCoverage(c: CompiledStock, ug: Vec3): Vec3 {
  const out: number[] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (c.grainStage === 0) {
      const dg = ug[i] * c.dRange[i];
      out[i] = Math.pow(10, -printDensity(c, dg, i)) * c.tint[i];
    } else {
      out[i] = Math.pow(10, -ug[i] * c.pRange) * c.tint[i];
    }
  }
  return out as Vec3;
}

export function clamp01(v: number) {
  return Math.min(0.9995, Math.max(0, v));
}

/** Perceptual blend used by the intensity slider. */
export function intensityMix(a: Vec3, b: Vec3, t: number): Vec3 {
  return a.map((v, i) => {
    const x = Math.cbrt(Math.max(v, 0)), y = Math.cbrt(Math.max(b[i], 0));
    const m = x + (y - x) * t;
    return m * m * m;
  }) as Vec3;
}

export function greyOut(c: CompiledStock): number {
  return luminance(filmApply(c, [0.18, 0.18, 0.18]).out);
}
