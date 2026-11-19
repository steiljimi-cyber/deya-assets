precision highp float;
precision highp int;
precision highp sampler2D;

// ---- hashing (identical to engine/grain.ts) ----
uint hashu(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
float rnd(inout uint s) {
  s = hashu(s + 0x9e3779b9u);
  return float(s) * (1.0 / 4294967296.0);
}
float hash21(vec2 p, uint seed) {
  ivec2 i = ivec2(floor(p));
  return float(hashu(uint(i.x) * 1973u ^ uint(i.y) * 9277u ^ seed)) * (1.0 / 4294967296.0);
}
float vnoise(vec2 p, uint seed) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i, seed), b = hash21(i + vec2(1, 0), seed), c = hash21(i + vec2(0, 1), seed), d = hash21(i + vec2(1, 1), seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, uint seed) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p, seed + uint(i) * 101u);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return s;
}
float gauss1(uint seed) {
  uint s = seed;
  float u1 = max(rnd(s), 1e-7);
  float u2 = rnd(s);
  return sqrt(-2.0 * log(u1)) * cos(6.283185307 * u2);
}

// ---- transfer functions ----
float srgbEnc1(float v) {
  float a = abs(v);
  float e = a <= 0.0031308 ? a * 12.92 : 1.055 * pow(a, 1.0 / 2.4) - 0.055;
  return sign(v) * e;
}
float srgbDec1(float v) {
  float a = abs(v);
  float d = a <= 0.04045 ? a / 12.92 : pow((a + 0.055) / 1.055, 2.4);
  return sign(v) * d;
}
vec3 srgbEnc(vec3 c) { return vec3(srgbEnc1(c.r), srgbEnc1(c.g), srgbEnc1(c.b)); }
vec3 srgbDec(vec3 c) { return vec3(srgbDec1(c.r), srgbDec1(c.g), srgbDec1(c.b)); }

const vec3 LUMA = vec3(0.2627002, 0.6779981, 0.0593017); // Rec.2020
float luma(vec3 c) { return dot(c, LUMA); }

// ---- curves (identical to film/model.ts) ----
float softplus(float u, float k) {
  float z = u / k;
  if (z > 30.0) return u;
  if (z < -30.0) return k * exp(z);
  return k * log(1.0 + exp(z));
}
float sCurve(float x, float toe, float width, float kt, float ks) {
  float a = softplus(x - toe, kt);
  float f0 = -softplus(-width, ks);
  return a - softplus(a - width, ks) - f0;
}

// ---- blend modes (W3C compositing formulas), a = backdrop, b = source, encoded 0..1 ----
float lumB(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipColor(vec3 c) {
  float l = lumB(c), n = min(c.r, min(c.g, c.b)), x = max(c.r, max(c.g, c.b));
  if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-6);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-6);
  return c;
}
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lumB(c))); }
float satB(vec3 c) { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
vec3 setSat(vec3 c, float s) {
  float mn = min(c.r, min(c.g, c.b)), mx = max(c.r, max(c.g, c.b));
  if (mx - mn < 1e-6) return vec3(0.0);
  return (c - mn) * s / (mx - mn);
}
float softLight1(float a, float b) {
  if (b <= 0.5) return a - (1.0 - 2.0 * b) * a * (1.0 - a);
  float d = a <= 0.25 ? ((16.0 * a - 12.0) * a + 4.0) * a : sqrt(a);
  return a + (2.0 * b - 1.0) * (d - a);
}
float colorDodge1(float a, float b) { return a == 0.0 ? 0.0 : (b >= 1.0 ? 1.0 : min(1.0, a / (1.0 - b))); }
float colorBurn1(float a, float b) { return a >= 1.0 ? 1.0 : (b <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - a) / b)); }
float hardLight1(float a, float b) { return b <= 0.5 ? a * 2.0 * b : 1.0 - (1.0 - a) * (1.0 - (2.0 * b - 1.0)); }
float vivid1(float a, float b) { return b <= 0.5 ? colorBurn1(a, 2.0 * b) : colorDodge1(a, 2.0 * b - 1.0); }
vec3 blendMode(int m, vec3 a, vec3 b) {
  a = clamp(a, 0.0, 1.0); b = clamp(b, 0.0, 1.0);
  if (m == 0) return b;
  if (m == 1) return min(a, b);
  if (m == 2) return a * b;
  if (m == 3) return vec3(colorBurn1(a.r, b.r), colorBurn1(a.g, b.g), colorBurn1(a.b, b.b));
  if (m == 4) return max(a + b - 1.0, 0.0);
  if (m == 5) return max(a, b);
  if (m == 6) return a + b - a * b;
  if (m == 7) return vec3(colorDodge1(a.r, b.r), colorDodge1(a.g, b.g), colorDodge1(a.b, b.b));
  if (m == 8) return min(a + b, 1.0);
  if (m == 9) return vec3(hardLight1(b.r, a.r), hardLight1(b.g, a.g), hardLight1(b.b, a.b));
  if (m == 10) return vec3(softLight1(a.r, b.r), softLight1(a.g, b.g), softLight1(a.b, b.b));
  if (m == 11) return vec3(hardLight1(a.r, b.r), hardLight1(a.g, b.g), hardLight1(a.b, b.b));
  if (m == 12) return vec3(vivid1(a.r, b.r), vivid1(a.g, b.g), vivid1(a.b, b.b));
  if (m == 13) return clamp(a + 2.0 * b - 1.0, 0.0, 1.0);
  if (m == 14) return mix(min(a, 2.0 * b), max(a, 2.0 * b - 1.0), step(0.5, b));
  if (m == 15) return step(1.0, a + b);
  if (m == 16) return abs(a - b);
  if (m == 17) return a + b - 2.0 * a * b;
  if (m == 18) return max(a - b, 0.0);
  if (m == 19) return clamp(a / max(b, 1e-4), 0.0, 1.0);
  if (m == 20) return setLum(setSat(b, satB(a)), lumB(a));
  if (m == 21) return setLum(setSat(a, satB(b)), lumB(a));
  if (m == 22) return setLum(b, lumB(a));
  if (m == 23) return setLum(a, lumB(b));
  return b;
}
