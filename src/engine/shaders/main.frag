// Main grade: optics -> film negative (H&D curves, crossover, halation) -> grain -> print -> scan edits.
uniform sampler2D u_scene;       // developed scene-linear tile (premultiplied by aperture alpha)
uniform vec2 u_tileOrigin;
uniform float u_k;
uniform vec4 u_ap;
// global low-frequency buffers in aperture uv
uniform sampler2D u_hal;
uniform sampler2D u_bloom;
uniform sampler2D u_clar;
uniform sampler2D u_soft;
uniform sampler2D u_haze;
uniform vec3 u_air;
uniform float u_dehaze, u_clarity, u_halAmt, u_bloomAmt, u_softAmt;
uniform vec3 u_halColor;
// light leak
uniform float u_leakAmt, u_leakSize, u_leakPos;
uniform int u_leakStyle;
uniform uint u_leakSeed;
uniform mat3 u_leakHue;
uniform float u_aspect;
// date stamp (exposed onto the film)
uniform sampler2D u_pre;
uniform int u_hasPre;
uniform int u_preOff;
// film
uniform int u_filmOn;
uniform float u_intensity;
uniform mat3 u_sens;
uniform vec3 u_gamma, u_toe, u_width, u_dRange, u_dGrey, u_tint;
uniform float u_kt, u_ks, u_coupling, u_pg, u_yt, u_pw, u_pkt, u_pks, u_y0, u_pRange;
uniform int u_grainStage, u_bw;
// scan edits
uniform float u_contrast, u_highlights, u_shadows, u_whites, u_blacks, u_vibrance, u_saturation, u_fade;
uniform float u_hslH[8];
uniform float u_hslS[8];
uniform float u_hslL[8];
uniform float u_hslC[8];
uniform int u_hslOn;
uniform sampler2D u_curve;
uniform int u_curveOn;
uniform vec4 u_levels;           // inBlack, inWhite, outBlack, outWhite (0..1)
uniform float u_levelsGamma;
uniform mat3 u_toLms, u_fromLms, u_okM2, u_okM2i;
in vec2 v_uv;
out vec4 o;

#include "grain.glsl"

// ---- film ----
vec3 negDensity(vec3 rgb) {
  vec3 E = max(u_sens * rgb, vec3(1e-7));
  vec3 x = log(E / 0.18) / log(10.0);
  vec3 d;
  for (int i = 0; i < 3; i++) d[i] = u_gamma[i] * sCurve(x[i], u_toe[i], u_width[i], u_kt, u_ks);
  float m = (d.x + d.y + d.z) / 3.0;
  return d + u_coupling * (d - m);
}
float printD(float d, int i) {
  float y = -(d - u_dGrey[i]) + u_y0;
  return u_pg * sCurve(y, u_yt, u_pw, u_pkt, u_pks);
}

// ---- tone (scan edits) on sRGB-encoded luminance ----
float toneCurve(float p) {
  float pm = 0.46135;
  float x = clamp(p, 0.0, 1.0);
  float e = 1.0 + 0.8 * u_contrast;
  if (u_contrast != 0.0) {
    x = x < pm ? pm * pow(x / pm, e) : 1.0 - (1.0 - pm) * pow((1.0 - x) / (1.0 - pm), e);
  }
  x += u_shadows * 0.3 * 6.75 * x * (1.0 - x) * (1.0 - x);
  x += u_highlights * 0.3 * 6.75 * x * x * (1.0 - x);
  x += u_whites * 0.22 * x * x * x;
  x += u_blacks * 0.22 * (1.0 - x) * (1.0 - x) * (1.0 - x);
  // values above paper white (only possible without film) follow highlights/whites
  if (p > 1.0) x += (p - 1.0) * (1.0 + 0.6 * min(u_highlights + u_whites, 0.0));
  return x;
}

vec3 toLab(vec3 c) { return u_okM2 * pow(max(u_toLms * c, vec3(0.0)), vec3(1.0 / 3.0)); }
vec3 fromLab(vec3 l) { vec3 m = u_okM2i * l; return u_fromLms * (m * m * m); }

vec3 leak(vec2 fuv) {
  if (u_leakAmt <= 0.0) return vec3(0.0);
  vec2 p = (fuv - 0.5) * vec2(u_aspect, 1.0);
  float ang = u_leakPos * 6.283185307;
  vec2 dir = vec2(cos(ang), sin(ang));
  float n = fbm(fuv * 3.0 + float(u_leakSeed % 97u), u_leakSeed);
  float sz = 0.15 + 0.85 * u_leakSize;
  float shape = 0.0;
  vec2 halfExt = vec2(u_aspect, 1.0) * 0.5;
  if (u_leakStyle == 0) {
    // burn from one edge of the frame
    float edge = dot(p, dir) / dot(abs(dir), halfExt);
    shape = smoothstep(1.0 - 0.9 * sz, 1.1, edge + 0.25 * (n - 0.5));
  } else if (u_leakStyle == 1) {
    // corner flare blobs
    vec2 c = dir * length(halfExt) * 0.95;
    float d = length(p - c);
    shape = exp(-d * d / (0.18 * sz * sz)) * (0.7 + 0.6 * n);
    vec2 c2 = c * 0.55 + vec2(-dir.y, dir.x) * 0.2;
    shape += 0.5 * exp(-dot(p - c2, p - c2) / (0.05 * sz)) * n;
  } else if (u_leakStyle == 2) {
    // vertical band (camera back opened a crack)
    float x = p.x - dir.x * halfExt.x * 0.8;
    shape = exp(-x * x / (0.02 * sz * sz + 0.002)) * (0.6 + 0.8 * fbm(vec2(fuv.y * 4.0, 3.0), u_leakSeed + 9u));
  } else {
    // whole-frame fog
    shape = (0.35 + 0.65 * smoothstep(-0.6, 1.0, dot(p, dir))) * (0.6 + 0.8 * n) * sz;
  }
  shape = clamp(shape, 0.0, 2.0);
  // colour ramp: deep red edges -> orange -> hot yellow core
  vec3 red = vec3(1.0, 0.12, 0.03), orange = vec3(1.0, 0.45, 0.08), core = vec3(1.0, 0.85, 0.55);
  vec3 col = mix(red, orange, smoothstep(0.1, 0.6, shape));
  col = mix(col, core, smoothstep(0.7, 1.4, shape));
  return u_leakHue * col * shape * u_leakAmt * 6.0;
}

void main() {
  vec4 s = texelFetch(u_scene, ivec2(gl_FragCoord.xy), 0);
  if (s.a <= 0.0) { o = vec4(0.0); return; }
  vec3 c = s.rgb / s.a;
  vec2 cp = u_tileOrigin + gl_FragCoord.xy * u_k;
  vec2 fuv = (cp - u_ap.xy) / u_ap.zw;

  // ---- optics / capture ----
  if (u_dehaze != 0.0) {
    float dc = texture(u_haze, fuv).r;
    if (u_dehaze > 0.0) {
      float t = max(1.0 - 0.92 * u_dehaze * dc, 0.12);
      c = max((c - u_air) / t + u_air, 0.0);
    } else {
      c = mix(c, u_air * 0.9, -u_dehaze * 0.45 * (0.6 + 0.4 * dc));
    }
  }
  if (u_clarity != 0.0) {
    float y = max(luma(c), 1e-6);
    float yb = max(luma(texture(u_clar, fuv).rgb), 1e-6);
    float lg = log2(y), lb = log2(yb);
    float mid = exp(-0.5 * pow((lg - log2(0.18)) / 3.0, 2.0));
    float ny = exp2(lg + u_clarity * 0.6 * (lg - lb) * mid);
    c *= ny / y;
  }
  if (u_softAmt > 0.0) c = mix(c, texture(u_soft, fuv).rgb, u_softAmt * 0.65);
  if (u_bloomAmt > 0.0) c += u_bloomAmt * texture(u_bloom, fuv).rgb;
  c += leak(fuv);
  if (u_hasPre == 1) {
    vec4 pre = texelFetch(u_pre, ivec2(gl_FragCoord.xy) + u_preOff, 0);
    c += srgbDec(pre.rgb) * pre.a * 5.0;
  }

  // ---- film ----
  ivec2 pix = ivec2(floor(cp / max(u_k, 1.0)));
  vec3 outc = c;
  vec3 film = c;
  vec3 ratio = vec3(1.0);
  bool grainOn = u_gAmount > 0.0;
  {
    vec3 rgb = c;
    // halation: light scattered back from the film base re-exposes (mostly) the red layer
    vec3 hal = u_halAmt * texture(u_hal, fuv).rgb;
    vec3 E = max(u_sens * rgb, vec3(1e-7)) + u_halColor * luma(hal) + hal * 0.08;
    vec3 x = log(E / 0.18) / log(10.0);
    vec3 d;
    for (int i = 0; i < 3; i++) d[i] = u_gamma[i] * sCurve(x[i], u_toe[i], u_width[i], u_kt, u_ks);
    float m = (d.x + d.y + d.z) / 3.0;
    d = d + u_coupling * (d - m);
    vec3 dp, u;
    for (int i = 0; i < 3; i++) {
      dp[i] = printD(d[i], i);
      u[i] = u_grainStage == 0 ? clamp(d[i] / u_dRange[i], 0.0, 0.9995) : clamp(dp[i] / u_pRange, 0.0, 0.9995);
    }
    vec3 clean = pow(vec3(10.0), -dp) * u_tint;
    film = clean;
    if (grainOn) {
      vec3 ug = applyGrain(u, cp, pix, u_bw == 1);
      vec3 g;
      for (int i = 0; i < 3; i++) {
        float dg = u_grainStage == 0 ? printD(ug[i] * u_dRange[i], i) : ug[i] * u_pRange;
        g[i] = pow(10.0, -dg) * u_tint[i];
      }
      ratio = g / max(clean, vec3(1e-6));
      film = g;
    }
  }
  if (u_filmOn == 1) {
    vec3 a = pow(max(c, 0.0), vec3(1.0 / 3.0)), b = pow(max(film, 0.0), vec3(1.0 / 3.0));
    vec3 mx = mix(a, b, u_intensity);
    outc = mx * mx * mx;
    // grain survives the blend in full
    if (grainOn && u_intensity < 1.0) outc *= mix(ratio, vec3(1.0), u_intensity);
  } else {
    outc = c * ratio;
  }

  // ---- scan edits (display-referred) ----
  float Y = max(luma(outc), 1e-7);
  float p = srgbEnc1(Y);
  float p2 = toneCurve(p);
  if (p2 != p) {
    float Y2 = srgbDec1(max(p2, 0.0));
    outc *= Y2 / Y;
  }
  if (u_vibrance != 0.0 || u_saturation != 0.0 || u_hslOn == 1) {
    vec3 lab = toLab(max(outc, 0.0));
    float C = length(lab.yz);
    float h = atan(lab.z, lab.y);
    float hd = degrees(h);
    if (hd < 0.0) hd += 360.0;
    float sat = 1.0 + u_saturation;
    float vib = u_vibrance * (1.0 - smoothstep(0.0, 0.22, C));
    float skin = 1.0 - 0.5 * smoothstep(15.0, 35.0, hd) * (1.0 - smoothstep(70.0, 95.0, hd));
    sat *= 1.0 + vib * (u_vibrance > 0.0 ? skin : 1.0);
    if (u_hslOn == 1) {
      // piecewise-linear weights between neighbouring band centres (sum to 1)
      float hs = 0.0, ss = 0.0, ls = 0.0;
      for (int i = 0; i < 8; i++) {
        float c0 = u_hslC[i];
        float c1 = u_hslC[(i + 1) % 8];
        float span = mod(c1 - c0 + 360.0, 360.0);
        float t = mod(hd - c0 + 360.0, 360.0);
        if (t <= span) {
          float w = t / span;
          hs = mix(u_hslH[i], u_hslH[(i + 1) % 8], w);
          ss = mix(u_hslS[i], u_hslS[(i + 1) % 8], w);
          ls = mix(u_hslL[i], u_hslL[(i + 1) % 8], w);
        }
      }
      float chromaW = smoothstep(0.0, 0.06, C);
      h += radians(hs * 30.0) * chromaW;
      sat *= 1.0 + ss;
      lab.x *= 1.0 + ls * 0.35 * chromaW;
    }
    C *= max(sat, 0.0);
    lab.yz = C * vec2(cos(h), sin(h));
    outc = fromLab(lab);
  }
  vec3 e = srgbEnc(max(outc, 0.0));
  if (u_curveOn == 1) {
    vec3 cl = clamp(e, 0.0, 1.0);
    vec3 m;
    m.r = texture(u_curve, vec2(cl.r * (1023.0 / 1024.0) + 0.5 / 1024.0, 0.5)).a;
    m.g = texture(u_curve, vec2(cl.g * (1023.0 / 1024.0) + 0.5 / 1024.0, 0.5)).a;
    m.b = texture(u_curve, vec2(cl.b * (1023.0 / 1024.0) + 0.5 / 1024.0, 0.5)).a;
    m = clamp(m, 0.0, 1.0);
    vec3 r;
    r.r = texture(u_curve, vec2(m.r * (1023.0 / 1024.0) + 0.5 / 1024.0, 0.5)).r;
    r.g = texture(u_curve, vec2(m.g * (1023.0 / 1024.0) + 0.5 / 1024.0, 0.5)).g;
    r.b = texture(u_curve, vec2(m.b * (1023.0 / 1024.0) + 0.5 / 1024.0, 0.5)).b;
    e = r + max(e - 1.0, 0.0);
  }
  if (u_levels != vec4(0.0, 1.0, 0.0, 1.0) || u_levelsGamma != 1.0) {
    vec3 t = clamp((e - u_levels.x) / max(u_levels.y - u_levels.x, 1e-4), 0.0, 1.0);
    e = mix(vec3(u_levels.z), vec3(u_levels.w), pow(t, vec3(1.0 / u_levelsGamma)));
  }
  if (u_fade > 0.0) e = 0.18 * u_fade + e * (1.0 - 0.22 * u_fade);
  outc = srgbDec(e);
  o = vec4(outc * s.a, s.a);
}
