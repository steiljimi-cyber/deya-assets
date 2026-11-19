// Separable Lanczos-3 resampling with a kernel widened by the downscale factor (no aliasing).
uniform sampler2D u_img;
uniform vec2 u_dir;      // (1,0) horizontal pass, (0,1) vertical
uniform float u_scale;   // source texels per destination texel along u_dir
uniform float u_off;     // source texel coordinate of the region start along u_dir
uniform vec2 u_offOther; // source texel offset for the other axis (1:1 mapping)
in vec2 v_uv;
out vec4 o;
float lanczos(float x) {
  x = abs(x);
  if (x < 1e-5) return 1.0;
  if (x >= 3.0) return 0.0;
  float px = 3.14159265 * x;
  return 3.0 * sin(px) * sin(px / 3.0) / (px * px);
}
void main() {
  ivec2 sz = textureSize(u_img, 0);
  vec2 dst = gl_FragCoord.xy;
  float along = dot(dst, u_dir);
  float c = u_off + along * u_scale;          // centre in source texel units
  float s = max(u_scale, 1.0);
  int lo = int(floor(c - 3.0 * s)), hi = int(ceil(c + 3.0 * s));
  ivec2 other = ivec2(floor(dst * (vec2(1.0) - u_dir) + u_offOther));
  vec4 acc = vec4(0.0);
  float ws = 0.0;
  for (int i = 0; i < 256; i++) {
    int ix = lo + i;
    if (ix > hi) break;
    float w = lanczos((float(ix) + 0.5 - c) / s);
    ivec2 p = u_dir.x > 0.5 ? ivec2(ix, other.y) : ivec2(other.x, ix);
    p = clamp(p, ivec2(0), sz - 1);
    acc += texelFetch(u_img, p, 0) * w;
    ws += w;
  }
  o = acc / ws;
}
