// Final composite in canvas space: glitch, texture slots, dust & scratches, borders, text/border art.
uniform sampler2D u_main;        // graded tile incl. apron (premultiplied by aperture alpha)
uniform vec2 u_mainOrigin;       // canvas px at texel (0,0) of u_main
uniform vec2 u_tileOrigin;       // canvas px at texel (0,0) of this output
uniform float u_k;
uniform vec2 u_canvas;
uniform vec4 u_ap;
uniform float u_apRadius;
uniform int u_border;
uniform vec4 u_paper;
uniform float u_paperRadius;
uniform vec3 u_bg, u_paperCol, u_holeCol, u_nbCol;
uniform vec4 u_spr;              // pitch, w, h, r
uniform vec3 u_sprRows;          // rowA, rowB, phase
uniform int u_sprOn, u_sprAxis;
uniform vec4 u_nb[4];
uniform int u_nbCount;
uniform uint u_bSeed;
uniform float u_pxPerMm;
uniform float u_edgeRough;
// overlay (text, border art) drawn by Canvas2D for exactly this tile
uniform sampler2D u_post;
uniform int u_hasPost;
uniform int u_postOff;
// glitch
uniform float u_gl, u_glShift, u_glSlices, u_glBlocks, u_glScan;
uniform uint u_glSeed;
// dust & scratches
uniform float u_dust, u_scratch, u_hairs, u_dustSize;
uniform uint u_dustSeed;
uniform int u_dustWhite;
// texture slots
uniform sampler2D u_tex0;
uniform sampler2D u_tex1;
uniform sampler2D u_tex2;
uniform sampler2D u_tex3;
uniform int u_texCount;
uniform vec4 u_texA[4];          // intensity, rotation(rad), scale, blend
uniform vec4 u_texB[4];          // offsetX, offsetY, flags(flipX 1, flipY 2, invert 4, canvas 8), aspect
in vec2 v_uv;
out vec4 o;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float sdRect(vec2 cp, vec4 r, float rad) { return sdRoundBox(cp - (r.xy + r.zw * 0.5), r.zw * 0.5, rad); }
float aa(float sd) { return clamp(0.5 - sd / max(u_k, 1.0), 0.0, 1.0); }

vec4 fetchMain(vec2 cp) {
  vec2 t = (cp - u_mainOrigin) / u_k;
  ivec2 sz = textureSize(u_main, 0);
  ivec2 i = clamp(ivec2(floor(t)), ivec2(0), sz - 1);
  return texelFetch(u_main, i, 0);
}

vec3 sampleTex(int i, vec2 uv) {
  if (i == 0) return texture(u_tex0, uv).rgb;
  if (i == 1) return texture(u_tex1, uv).rgb;
  if (i == 2) return texture(u_tex2, uv).rgb;
  return texture(u_tex3, uv).rgb;
}

vec3 applyTextures(vec3 base, vec2 cp, bool canvasPass) {
  vec3 e = srgbEnc(max(base, 0.0));
  for (int i = 0; i < 4; i++) {
    if (i >= u_texCount) break;
    vec4 A = u_texA[i], B = u_texB[i];
    int flags = int(B.z);
    bool onCanvas = (flags & 8) != 0;
    if (onCanvas != canvasPass) continue;
    vec4 area = onCanvas ? vec4(0.0, 0.0, u_canvas) : u_ap;
    vec2 p = (cp - (area.xy + area.zw * 0.5)) / area.zw; // -0.5..0.5
    float aspA = area.z / area.w;
    p.x *= aspA;
    float cr = cos(-A.y), sr = sin(-A.y);
    p = vec2(cr * p.x - sr * p.y, sr * p.x + cr * p.y);
    // cover-fit the (rotated) area with the texture
    float tA = B.w;
    float rot = abs(sin(A.y)), rc = abs(cos(A.y));
    float bw = aspA * rc + rot, bh = aspA * rot + rc;
    float s = max(bw / tA, bh);
    vec2 tuv = p / (s / (A.z / 100.0));
    tuv.x /= tA;
    tuv += 0.5 - B.xy * 0.5;
    if ((flags & 1) != 0) tuv.x = 1.0 - tuv.x;
    if ((flags & 2) != 0) tuv.y = 1.0 - tuv.y;
    vec3 t = srgbEnc(max(sampleTex(i, fract(tuv)), 0.0));
    if ((flags & 4) != 0) t = 1.0 - t;
    vec3 bl = blendMode(int(A.w), clamp(e, 0.0, 1.0), clamp(t, 0.0, 1.0));
    e = mix(e, bl, A.x);
  }
  return srgbDec(e);
}

// ---- dust, hairs and scratches: procedural, seeded, resolution independent ----
float dustMask(vec2 cp) {
  float shortS = min(u_ap.z, u_ap.w);
  vec2 p = (cp - u_ap.xy);
  float m = 0.0;
  float sz = pow(2.0, (u_dustSize - 0.5) * 2.0);
  if (u_dust > 0.0) {
    float cs = shortS * 0.035;
    vec2 cell = floor(p / cs);
    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
      vec2 c = cell + vec2(dx, dy);
      uint st = hashu(uint(int(c.x)) * 374761393u ^ uint(int(c.y)) * 668265263u ^ u_dustSeed);
      if (rnd(st) > u_dust * 0.55) continue;
      vec2 ctr = (c + vec2(rnd(st), rnd(st))) * cs;
      float r = cs * sz * (0.012 + 0.07 * pow(rnd(st), 3.0));
      vec2 d = p - ctr;
      float ang = atan(d.y, d.x);
      float wob = 1.0 + 0.35 * sin(3.0 * ang + rnd(st) * 6.28) + 0.2 * sin(5.0 * ang + rnd(st) * 6.28);
      float sd = length(d) - r * wob;
      m = max(m, clamp(0.5 - sd / max(u_k, 0.7), 0.0, 1.0) * (0.65 + 0.35 * rnd(st)));
    }
  }
  if (u_hairs > 0.0) {
    float cs = shortS * 0.16;
    vec2 cell = floor(p / cs);
    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
      vec2 c = cell + vec2(dx, dy);
      uint st = hashu(uint(int(c.x)) * 2246822519u ^ uint(int(c.y)) * 3266489917u ^ u_dustSeed ^ 0x1234u);
      if (rnd(st) > u_hairs * 0.35) continue;
      vec2 a = (c + vec2(rnd(st), rnd(st))) * cs;
      float ang = rnd(st) * 6.283;
      float len = cs * (0.25 + 0.6 * rnd(st)) * sz;
      vec2 b = a + len * vec2(cos(ang), sin(ang));
      vec2 ctrl = (a + b) * 0.5 + len * 0.35 * (vec2(rnd(st), rnd(st)) - 0.5);
      float w = shortS * 0.00045 * sz * (0.7 + 0.6 * rnd(st));
      float best = 1e9;
      vec2 prev = a;
      for (int k = 1; k <= 10; k++) {
        float t = float(k) / 10.0;
        vec2 q = mix(mix(a, ctrl, t), mix(ctrl, b, t), t);
        vec2 pa = p - prev, ba = q - prev;
        float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
        best = min(best, length(pa - ba * h));
        prev = q;
      }
      m = max(m, clamp(0.5 - (best - w) / max(u_k, 0.7), 0.0, 1.0) * 0.85);
    }
  }
  if (u_scratch > 0.0) {
    float cw = u_ap.z * 0.04;
    float col = floor(p.x / cw);
    for (int dx = -1; dx <= 1; dx++) {
      float cc = col + float(dx);
      uint st = hashu(uint(int(cc)) * 2654435761u ^ u_dustSeed ^ 0xabcdu);
      if (rnd(st) > u_scratch * 0.45) continue;
      float x0 = (cc + rnd(st)) * cw;
      float ph = rnd(st) * 100.0;
      float x = x0 + shortS * 0.004 * sin(p.y / u_ap.w * 3.0 + ph);
      float w = shortS * (0.00025 + 0.0006 * rnd(st));
      float on = smoothstep(0.35, 0.6, vnoise(vec2(p.y / u_ap.w * 6.0, ph), u_dustSeed));
      m = max(m, clamp(0.5 - (abs(p.x - x) - w) / max(u_k, 0.7), 0.0, 1.0) * on * 0.8);
    }
  }
  return m;
}

vec2 glitchPos(vec2 cp, out float rgbOff) {
  rgbOff = 0.0;
  if (u_gl <= 0.0) return cp;
  // glitch only corrupts the photo itself, never the border
  if (any(lessThan(cp, u_ap.xy)) || any(greaterThan(cp, u_ap.xy + u_ap.zw))) return cp;
  vec2 p = cp;
  float W = u_ap.z, H = u_ap.w;
  // slices: horizontal bands shifted sideways
  float bandH = H * 0.025;
  float band = floor((p.y - u_ap.y) / bandH);
  uint st = hashu(uint(int(band)) * 2246822519u ^ u_glSeed);
  float r0 = rnd(st);
  float hmul = 1.0 + floor(rnd(st) * 4.0);
  float band2 = floor((p.y - u_ap.y) / (bandH * hmul));
  uint st2 = hashu(uint(int(band2)) * 3266489917u ^ u_glSeed);
  if (rnd(st2) < u_glSlices * 0.35 * u_gl) p.x += (rnd(st2) - 0.5) * 2.0 * W * 0.08 * u_gl;
  // blocks
  float bs = W * 0.05;
  vec2 bc = floor((p - u_ap.xy) / vec2(bs, bs * 0.5));
  uint sb = hashu(uint(int(bc.x)) * 73856093u ^ uint(int(bc.y)) * 19349663u ^ u_glSeed ^ 0x55u);
  if (rnd(sb) < u_glBlocks * 0.12 * u_gl) p += (vec2(rnd(sb), rnd(sb)) - 0.5) * bs * 2.0;
  rgbOff = u_glShift * W * 0.006 * u_gl * (0.4 + r0);
  // displaced samples smear the photo's own edge instead of revealing the background
  if (p != cp) p = clamp(p, u_ap.xy + 0.5 + rgbOff, u_ap.xy + u_ap.zw - 0.5 - rgbOff);
  return p;
}

void main() {
  // clamp to the canvas so a partially covered edge texel never samples outside it
  vec2 cp = min(u_tileOrigin + gl_FragCoord.xy * u_k, u_canvas - 0.5);
  // ---- image ----
  float rgbOff;
  vec2 gp = glitchPos(cp, rgbOff);
  vec4 im = fetchMain(gp);
  if (rgbOff > 0.0) {
    vec4 ir = fetchMain(gp + vec2(rgbOff, 0.0)), ib = fetchMain(gp - vec2(rgbOff, 0.0));
    im.r = ir.r; im.b = ib.b;
  }
  float a = im.a;
  vec3 img = a > 0.0 ? im.rgb / a : vec3(0.0);
  if (u_gl > 0.0 && u_glScan > 0.0) {
    float period = max(u_ap.w * 0.003, 2.0);
    img *= 1.0 - u_glScan * 0.35 * u_gl * step(0.5, fract((cp.y - u_ap.y) / period));
    uint sl = hashu(uint(int(floor(cp.y / max(u_k, 1.0)))) ^ u_glSeed ^ 0x99u);
    if (rnd(sl) < 0.004 * u_glScan * u_gl) img = vec3(rnd(sl), rnd(sl), rnd(sl)) * 0.8;
  }
  if (a > 0.0 && u_texCount > 0) img = applyTextures(img, cp, false);
  float dm = (u_dust > 0.0 || u_scratch > 0.0 || u_hairs > 0.0) ? dustMask(cp) : 0.0;
  if (dm > 0.0) img = mix(img, u_dustWhite == 1 ? vec3(0.92) : vec3(0.008), dm);

  // ---- border ----
  vec3 col = u_bg;
  if (u_border != 0) {
    float rough = 0.0;
    if (u_border == 9 || u_border == 10) {
      float sc = u_pxPerMm * (u_border == 9 ? 2.5 : 0.8);
      rough = (fbm(cp / max(sc, 1e-3), u_bSeed) - 0.5) * u_pxPerMm * u_edgeRough;
    }
    float sdP = sdRect(cp, u_paper, u_paperRadius) + (u_border == 10 ? rough : 0.0);
    // soft shadow of the print on the background
    if (u_border == 5 || u_border == 7 || u_border == 10) {
      float sh = sdRect(cp - vec2(0.0, u_pxPerMm * 0.6), u_paper, u_paperRadius);
      col *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, u_pxPerMm * 2.5, sh));
    }
    vec3 paper = u_paperCol;
    if (u_border == 5 || u_border == 7 || u_border == 10 || u_border == 1) {
      float n = fbm(cp / max(u_pxPerMm * 0.35, 0.5), u_bSeed + 3u) - 0.5;
      paper *= 1.0 + n * (u_border == 1 ? 0.0 : 0.035);
    }
    if (u_border == 8) {
      float n = fbm(cp / max(u_pxPerMm * 0.6, 0.5), u_bSeed + 5u) - 0.5;
      paper *= 1.0 + n * 0.08;
    }
    col = mix(col, paper, aa(sdP));
    if (u_sprOn == 1) {
      float along = u_sprAxis == 0 ? cp.x : cp.y;
      float across = u_sprAxis == 0 ? cp.y : cp.x;
      float t = mod(along - u_sprRows.z, u_spr.x) - u_spr.x * 0.5;
      vec2 hs = u_sprAxis == 0 ? vec2(u_spr.y, u_spr.z) * 0.5 : vec2(u_spr.z, u_spr.y) * 0.5;
      vec2 q1 = u_sprAxis == 0 ? vec2(t, across - u_sprRows.x) : vec2(across - u_sprRows.x, t);
      vec2 q2 = u_sprAxis == 0 ? vec2(t, across - u_sprRows.y) : vec2(across - u_sprRows.y, t);
      float sd = min(sdRoundBox(q1, hs, u_spr.w), sdRoundBox(q2, hs, u_spr.w));
      col = mix(col, u_holeCol, aa(sd) * aa(sdP));
    }
    for (int i = 0; i < 4; i++) {
      if (i >= u_nbCount) break;
      col = mix(col, u_nbCol, aa(sdRect(cp, u_nb[i], u_apRadius)));
    }
  }
  // aperture edge: torn edges and rough scanner gate
  float edgeA = 1.0;
  if (u_border == 9) {
    float n = (fbm(cp / max(u_pxPerMm * 2.0, 0.5), u_bSeed) - 0.5) * u_pxPerMm * u_edgeRough * 2.5;
    float n2 = (fbm(cp / max(u_pxPerMm * 0.25, 0.5), u_bSeed + 7u) - 0.5) * u_pxPerMm * 0.6;
    float sdA = sdRect(cp, u_ap, 0.0) + n + n2;
    // paper fibres at the tear
    float fib = aa(sdA - u_pxPerMm * (0.5 + 0.6 * fbm(cp / max(u_pxPerMm * 0.5, 0.5), u_bSeed + 11u)));
    col = mix(col, vec3(0.93, 0.92, 0.9), fib);
    edgeA = aa(sdA);
  } else if (u_border == 8) {
    float n = (fbm(cp / max(u_pxPerMm * 0.7, 0.5), u_bSeed + 13u) - 0.5) * u_pxPerMm * 0.35;
    edgeA = aa(sdRect(cp, u_ap, u_apRadius) + n);
  }
  vec3 outc = mix(col, img, a * edgeA);
  if (u_border == 8 || u_border == 6) outc = mix(outc, img, 0.0);
  if (u_texCount > 0) outc = applyTextures(outc, cp, true);
  if (u_hasPost == 1) {
    vec4 ov = texelFetch(u_post, ivec2(gl_FragCoord.xy) + u_postOff, 0);
    outc = mix(outc, srgbDec(ov.rgb), ov.a);
  }
  o = vec4(outc, 1.0);
}
