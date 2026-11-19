// One pass of a 3-pass compounded box blur along a direction (exact motion streak, no banding).
uniform sampler2D u_img;
uniform vec2 u_dir;     // unit direction (texels)
uniform float u_span;   // span of this pass in texels
in vec2 v_uv;
out vec4 o;
// bilinear in texel units (no normalised coordinates): identical arithmetic for every tile size
vec4 bilinear(vec2 p) {
  ivec2 sz = textureSize(u_img, 0) - 1;
  vec2 q = p - 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 f = q - floor(q);
  vec4 a = texelFetch(u_img, clamp(i, ivec2(0), sz), 0);
  vec4 b = texelFetch(u_img, clamp(i + ivec2(1, 0), ivec2(0), sz), 0);
  vec4 c = texelFetch(u_img, clamp(i + ivec2(0, 1), ivec2(0), sz), 0);
  vec4 d = texelFetch(u_img, clamp(i + ivec2(1, 1), ivec2(0), sz), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  vec2 p = gl_FragCoord.xy;
  vec4 acc = vec4(0.0);
  const int N = 16;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N) - 0.5;
    vec4 s = bilinear(p + u_dir * t * u_span);
    acc += vec4(s.rgb, s.a);
  }
  vec4 c = texelFetch(u_img, ivec2(p), 0);
  // keep the aperture mask of this pixel, average only image pixels (no black bleeding in)
  o = vec4(acc.a > 1e-4 ? acc.rgb / acc.a * c.a : c.rgb, c.a);
}
