// Boolean-model film grain. 1:1 port of engine/grain.ts (pointCoverage / pixelCoverage).
uniform float u_gAmount;   // deviation scale (0 = off)
uniform vec3 u_gR;         // mean grain radius per layer, output px
uniform float u_gSigma;    // log-normal sigma
uniform float u_gSoft;     // 0 silver .. 1 dye cloud
uniform float u_gArea;     // soft area factor
uniform float u_gColor;    // 0 mono .. 1 independent layers
uniform uint u_gSeed;
uniform float u_gS;        // pixel filter sigma, output px
uniform int u_gN;          // samples per pixel
uniform float u_gDelta;    // cell size (shared by all layers)
uniform sampler2D u_gLut;  // std LUT: x = u, y = log2(s/r) in [-3,6]

float grainProfile(float d, float inner) {
  if (d >= 1.0) return 0.0;
  if (d <= inner) return 1.0;
  float t = (d - inner) / (1.0 - inner);
  return 1.0 - t * t * (3.0 - 2.0 * t);
}

float pointCoverage(vec2 x, float u, uint layer, float radius) {
  if (u <= 0.0) return 0.0;
  float uc = min(u, 0.9995);
  float meanR2 = radius * radius * exp(u_gSigma * u_gSigma);
  float lambda = -log(1.0 - uc) / (3.14159265 * meanR2 * u_gArea);
  float delta = u_gDelta;
  ivec2 c0 = ivec2(floor(x / delta));
  float inner = 1.0 - 0.85 * u_gSoft;
  float keep = 1.0;
  float L = exp(-lambda * delta * delta);
  float rmax = delta;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 c = c0 + ivec2(dx, dy);
      uint cu = uint(c.x) * 73856093u ^ uint(c.y) * 19349663u;
      // per-cell decision: shared (monochrome) grains or this layer's own grains
      float share = float(hashu(cu ^ u_gSeed ^ 0x5bd1e995u)) * (1.0 / 4294967296.0);
      uint lay = share < (1.0 - u_gColor) ? 7u : layer;
      uint st = hashu(cu ^ lay * 83492791u ^ u_gSeed);
      int n = 0;
      float pr = rnd(st);
      while (pr > L && n < 48) { n++; pr *= rnd(st); }
      for (int k = 0; k < 48; k++) {
        if (k >= n) break;
        float gx = (float(c.x) + rnd(st)) * delta;
        float gy = (float(c.y) + rnd(st)) * delta;
        float u1 = max(rnd(st), 1e-7);
        float u2 = rnd(st);
        float g = sqrt(-2.0 * log(u1)) * cos(6.283185307 * u2);
        float r = min(radius * exp(u_gSigma * g - 0.5 * u_gSigma * u_gSigma), rmax);
        vec2 dd = x - vec2(gx, gy);
        float d2 = dot(dd, dd);
        if (d2 < r * r) {
          keep *= 1.0 - grainProfile(sqrt(d2) / r, inner);
          if (keep < 1e-4) return 1.0;
        }
      }
    }
  }
  return 1.0 - keep;
}

float lutStd(float u, float q) {
  float y = clamp((log2(max(q, 1e-6)) + 3.0) / 9.0, 0.0, 1.0);
  return texture(u_gLut, vec2((clamp(u, 0.0, 1.0) * 63.0 + 0.5) / 64.0, (y * 63.0 + 0.5) / 64.0)).r;
}

// Returns grain-perturbed coverage for the 3 layers at canvas position cp.
// pix = integer pixel id of this output sample (for per-pixel rotation / analytic noise).
vec3 applyGrain(vec3 u, vec2 cp, ivec2 pix, bool mono) {
  if (u_gAmount <= 0.0) return u;
  vec3 dev = vec3(0.0);
  float rot = float(hashu(uint(pix.x) * 1973u ^ uint(pix.y) * 9277u ^ 0x51ed27u)) * (1.0 / 4294967296.0) * 6.283185307;
  float cr = cos(rot), sr = sin(rot);
  int layers = mono ? 1 : 3;
  for (int i = 0; i < 3; i++) {
    if (i >= layers) break;
    float ui = u[i];
    float ri = u_gR[i];
    float rEff = sqrt(ri * ri * exp(u_gSigma * u_gSigma) * u_gArea);
    float q = u_gS / max(rEff, 1e-4);
    float mcW = 1.0 - smoothstep(0.6, 0.9, q);
    float dMC = 0.0, dA = 0.0;
    if (mcW > 0.0) {
      float acc = 0.0;
      for (int k = 0; k < 64; k++) {
        if (k >= u_gN) break;
        float t = (float(k) + 0.5) / float(u_gN);
        float rr = sqrt(-2.0 * log(1.0 - t * 0.999));
        float a = float(k) * 2.39996323;
        vec2 o = rr * vec2(cos(a), sin(a));
        vec2 x = cp + u_gS * vec2(cr * o.x - sr * o.y, sr * o.x + cr * o.y);
        acc += pointCoverage(x, ui, uint(i), ri);
      }
      dMC = acc / float(u_gN) - ui;
    }
    if (mcW < 1.0) {
      float ns = gauss1(hashu(uint(pix.x) * 2654435761u ^ uint(pix.y) * 2246822519u ^ u_gSeed ^ 0x77u));
      float ni = gauss1(hashu(uint(pix.x) * 2654435761u ^ uint(pix.y) * 2246822519u ^ u_gSeed ^ uint(i + 1) * 0x9e37u));
      float c = mono ? 0.0 : u_gColor;
      float n = ((1.0 - c) * ns + c * ni) / sqrt((1.0 - c) * (1.0 - c) + c * c);
      dA = lutStd(ui, q) * n;
    }
    dev[i] = mix(dA, dMC, mcW);
  }
  if (mono) dev = vec3(dev.x);
  return clamp(u + u_gAmount * dev, 0.0, 0.9995);
}
