// Resample the source into tile / proxy space, then "develop in": white balance, exposure,
// flash fall-off, lens vignette, lateral chromatic aberration. Scene-linear Rec.2020 out.
uniform sampler2D u_src;
uniform vec2 u_srcSize;
uniform int u_filter;        // 0 trilinear (preview), 1 Catmull-Rom bicubic, 2 Lanczos-3
uniform vec2 u_tileOrigin;   // canvas px at texel (0,0) corner
uniform float u_k;           // canvas px per texel
uniform vec4 u_ap;           // aperture rect (canvas px)
uniform float u_apRadius;
uniform vec4 u_crop;         // source uv rect
uniform vec3 u_jit;          // x, y offset (frame-normalised), rotation (rad)
uniform float u_ca;          // lateral CA amount
uniform mat3 u_wb;
uniform float u_expo;        // linear multiplier
uniform float u_flash;
uniform vec4 u_vig;          // amount (stops), midpoint, roundness, feather
uniform float u_aspect;      // aperture w/h
in vec2 v_uv;
out vec4 o;

float lanczos(float x) {
  x = abs(x);
  if (x < 1e-5) return 1.0;
  if (x >= 3.0) return 0.0;
  float px = 3.14159265 * x;
  return 3.0 * sin(px) * sin(px / 3.0) / (px * px);
}
vec4 cubicW(float t) {
  // Catmull-Rom weights
  float t2 = t * t, t3 = t2 * t;
  return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}
vec3 fetchC(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(u_srcSize) - 1);
  return texelFetch(u_src, p, 0).rgb;
}
vec3 sampleSrc(vec2 uv, float lod) {
  if (u_filter == 0) return textureLod(u_src, uv, lod).rgb;
  vec2 p = uv * u_srcSize - 0.5;
  vec2 f = fract(p);
  ivec2 b = ivec2(floor(p));
  if (u_filter == 1) {
    vec4 wx = cubicW(f.x), wy = cubicW(f.y);
    vec3 acc = vec3(0.0);
    for (int j = 0; j < 4; j++) {
      vec3 row = fetchC(b + ivec2(-1, j - 1)) * wx.x + fetchC(b + ivec2(0, j - 1)) * wx.y + fetchC(b + ivec2(1, j - 1)) * wx.z + fetchC(b + ivec2(2, j - 1)) * wx.w;
      acc += row * wy[j];
    }
    return acc;
  }
  vec3 acc = vec3(0.0);
  float ws = 0.0;
  for (int j = -2; j <= 3; j++) {
    float wyv = lanczos(float(j) - f.y);
    for (int i = -2; i <= 3; i++) {
      float w = lanczos(float(i) - f.x) * wyv;
      acc += fetchC(b + ivec2(i, j)) * w;
      ws += w;
    }
  }
  return acc / ws;
}

void main() {
  vec2 cp = u_tileOrigin + gl_FragCoord.xy * u_k;
  vec2 fuv = (cp - u_ap.xy) / u_ap.zw;
  // rounded aperture mask (antialiased over one output pixel)
  vec2 hp = u_ap.zw * 0.5;
  vec2 q = abs(cp - (u_ap.xy + hp)) - hp + u_apRadius;
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_apRadius;
  float inside = clamp(0.5 - sd / max(u_k, 1.0), 0.0, 1.0);
  if (inside <= 0.0) { o = vec4(0.0); return; }
  // frame jitter (gate weave)
  vec2 c = fuv - 0.5;
  c.x *= u_aspect;
  float cs = cos(u_jit.z), sn = sin(u_jit.z);
  c = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y);
  c.x /= u_aspect;
  vec2 juv = c + 0.5 + u_jit.xy;
  // level of detail for the preview
  float srcPerOut = (u_crop.z * u_srcSize.x) / u_ap.z * u_k;
  float lod = max(log2(max(srcPerOut, 1e-6)), 0.0);
  vec3 col;
  if (u_ca != 0.0) {
    vec2 d = juv - 0.5;
    vec2 uR = 0.5 + d * (1.0 + u_ca), uB = 0.5 + d * (1.0 - u_ca);
    col.r = sampleSrc(u_crop.xy + clamp(uR, 0.0, 1.0) * u_crop.zw, lod).r;
    col.g = sampleSrc(u_crop.xy + clamp(juv, 0.0, 1.0) * u_crop.zw, lod).g;
    col.b = sampleSrc(u_crop.xy + clamp(uB, 0.0, 1.0) * u_crop.zw, lod).b;
  } else {
    col = sampleSrc(u_crop.xy + clamp(juv, 0.0, 1.0) * u_crop.zw, lod);
  }
  col = max(u_wb * col, 0.0) * u_expo;
  // vignette and flash, applied as exposure (in front of the film)
  vec2 v = fuv - 0.5;
  float rnd_ = mix(1.0, u_aspect, clamp(u_vig.z * 0.5 + 0.5, 0.0, 1.0));
  v.x *= rnd_;
  float r = length(v) / (0.5 * length(vec2(rnd_, 1.0)));
  if (u_vig.x != 0.0) {
    float m = smoothstep(u_vig.y, u_vig.y + max(u_vig.w, 0.02), r);
    col *= exp2(u_vig.x * m);
  }
  if (u_flash > 0.0) {
    float rf = length((fuv - 0.5) * vec2(u_aspect, 1.0)) / (0.5 * length(vec2(u_aspect, 1.0)));
    col *= exp2(u_flash * (0.5 - 2.4 * rf * rf));
  }
  o = vec4(col * inside, inside);
}
