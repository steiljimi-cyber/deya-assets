import type { CurvePoint, Settings } from "../state/settings";

/** Monotone cubic (Fritsch–Carlson) interpolation through the control points. Never overshoots. */
export function monotoneCurve(pts: CurvePoint[]): (x: number) => number {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  const n = p.length;
  if (n < 2) return (x) => x;
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(xs[i + 1] - xs[i], 1e-9));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

export function isIdentity(pts: CurvePoint[]) {
  return pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1;
}

export function curvesActive(s: Settings) {
  return !(isIdentity(s.curve.rgb) && isIdentity(s.curve.r) && isIdentity(s.curve.g) && isIdentity(s.curve.b));
}

/** 1024-entry RGBA LUT: r, g, b channel curves and master curve in alpha. */
export function curveLut(s: Settings): Float32Array {
  const fs = [monotoneCurve(s.curve.r), monotoneCurve(s.curve.g), monotoneCurve(s.curve.b), monotoneCurve(s.curve.rgb)];
  const out = new Float32Array(1024 * 4);
  for (let i = 0; i < 1024; i++) {
    const x = i / 1023;
    for (let c = 0; c < 4; c++) out[i * 4 + c] = fs[c](x);
  }
  return out;
}
