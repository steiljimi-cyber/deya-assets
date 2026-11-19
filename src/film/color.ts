// Colour science helpers. Working space: linear Rec.2020, D65.
export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number]; // row-major

export const D65: [number, number] = [0.3127, 0.329];

export function mul(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function mmul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

export function inv(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function xyToXYZ(x: number, y: number): Vec3 {
  return [x / y, 1, (1 - x - y) / y];
}

/** RGB->XYZ matrix from chromaticities. */
export function rgbToXYZ(r: [number, number], g: [number, number], b: [number, number], w: [number, number]): Mat3 {
  const R = xyToXYZ(...r), G = xyToXYZ(...g), B = xyToXYZ(...b), W = xyToXYZ(...w);
  const P: Mat3 = [R[0], G[0], B[0], R[1], G[1], B[1], R[2], G[2], B[2]];
  const S = mul(inv(P), W);
  return [P[0] * S[0], P[1] * S[1], P[2] * S[2], P[3] * S[0], P[4] * S[1], P[5] * S[2], P[6] * S[0], P[7] * S[1], P[8] * S[2]];
}

export const REC2020_TO_XYZ = rgbToXYZ([0.708, 0.292], [0.17, 0.797], [0.131, 0.046], D65);
export const XYZ_TO_REC2020 = inv(REC2020_TO_XYZ);
export const SRGB_TO_XYZ = rgbToXYZ([0.64, 0.33], [0.3, 0.6], [0.15, 0.06], D65);
export const P3_TO_XYZ = rgbToXYZ([0.68, 0.32], [0.265, 0.69], [0.15, 0.06], D65);
export const REC2020_TO_SRGB = mmul(inv(SRGB_TO_XYZ), REC2020_TO_XYZ);
export const SRGB_TO_REC2020 = inv(REC2020_TO_SRGB);
export const REC2020_TO_P3 = mmul(inv(P3_TO_XYZ), REC2020_TO_XYZ);
/** Luminance weights of Rec.2020. */
export const LUMA: Vec3 = [REC2020_TO_XYZ[3], REC2020_TO_XYZ[4], REC2020_TO_XYZ[5]];

export function luminance(c: Vec3): number {
  return LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];
}

// ---- OKLab (Björn Ottosson, public domain) ----
const OK_M1_XYZ: Mat3 = [0.8189330101, 0.3618667424, -0.1288597137, 0.0329845436, 0.9293118715, 0.0361456387, 0.0482003018, 0.2643662691, 0.633851707];
export const OK_M2: Mat3 = [0.2104542553, 0.793617785, -0.0040720468, 1.9779984951, -2.428592205, 0.4505937099, 0.0259040371, 0.7827717662, -0.808675766];
export const REC2020_TO_LMS = mmul(OK_M1_XYZ, REC2020_TO_XYZ);
export const LMS_TO_REC2020 = inv(REC2020_TO_LMS);
export const OK_M2_INV = inv(OK_M2);

export function toOklab(c: Vec3): Vec3 {
  const l = mul(REC2020_TO_LMS, c).map((v) => Math.cbrt(v)) as Vec3;
  return mul(OK_M2, l);
}
export function fromOklab(lab: Vec3): Vec3 {
  const l = mul(OK_M2_INV, lab).map((v) => v * v * v) as Vec3;
  return mul(LMS_TO_REC2020, l);
}

// ---- white balance: CCT + tint -> Bradford adaptation matrix ----
const BRADFORD: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];

export function planckXY(T: number): [number, number] {
  T = Math.min(25000, Math.max(1667, T));
  const t = T, t2 = t * t, t3 = t2 * t;
  const x = t <= 4000
    ? -0.2661239e9 / t3 - 0.2343589e6 / t2 + 0.8776956e3 / t + 0.17991
    : -3.0258469e9 / t3 + 2.1070379e6 / t2 + 0.2226347e3 / t + 0.24039;
  const x2 = x * x, x3 = x2 * x;
  const y = t <= 2222
    ? -1.1063814 * x3 - 1.3481102 * x2 + 2.18555832 * x - 0.20219683
    : t <= 4000
      ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
      : 3.081758 * x3 - 5.8733867 * x2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

function xyToUv(x: number, y: number): [number, number] {
  const d = -2 * x + 12 * y + 3;
  return [(4 * x) / d, (6 * y) / d];
}
function uvToXy(u: number, v: number): [number, number] {
  const d = 2 * u - 8 * v + 4;
  return [(3 * u) / d, (2 * v) / d];
}

/** temp/tint in -100..100. temp > 0 warms the image, tint > 0 adds magenta. Identity at 0/0. */
export function whiteBalanceMatrix(temp: number, tint: number): Mat3 {
  if (temp === 0 && tint === 0) return IDENTITY;
  const T = 6504 * Math.pow(2, (temp / 100) * 1.25);
  const [u0, v0] = xyToUv(...planckXY(6504));
  const [u1, v1] = xyToUv(...planckXY(T));
  const [ud, vd] = xyToUv(...D65);
  // tint: shift perpendicular to the locus (approx along v in CIE1960)
  const [x, y] = uvToXy(ud + (u1 - u0), vd + (v1 - v0) + (tint / 100) * 0.025);
  const src = mul(BRADFORD, xyToXYZ(x, y));
  const dst = mul(BRADFORD, xyToXYZ(...D65));
  const S: Mat3 = [dst[0] / src[0], 0, 0, 0, dst[1] / src[1], 0, 0, 0, dst[2] / src[2]];
  const adaptXYZ = mmul(inv(BRADFORD), mmul(S, BRADFORD));
  const m = mmul(XYZ_TO_REC2020, mmul(adaptXYZ, REC2020_TO_XYZ));
  // keep luminance of neutral grey constant (WB should not change exposure)
  const g = luminance(mul(m, [1, 1, 1]));
  return m.map((v) => v / g) as Mat3;
}

export function srgbEncode(v: number): number {
  const a = Math.abs(v);
  const e = a <= 0.0031308 ? a * 12.92 : 1.055 * Math.pow(a, 1 / 2.4) - 0.055;
  return Math.sign(v) * e;
}
export function srgbDecode(v: number): number {
  const a = Math.abs(v);
  const d = a <= 0.04045 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4);
  return Math.sign(v) * d;
}

/** GLSL mat3 is column-major; give it the transpose of our row-major matrix. */
export function glMat3(m: Mat3): Float32Array {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}
