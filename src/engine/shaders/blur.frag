uniform sampler2D u_img;
uniform vec2 u_dir;
uniform float u_sigma;
in vec2 v_uv;
out vec4 o;
void main() {
  vec2 sz = vec2(textureSize(u_img, 0));
  int r = int(ceil(u_sigma * 3.0));
  vec4 acc = vec4(0.0);
  float ws = 0.0;
  for (int i = -40; i <= 40; i++) {
    if (i < -r || i > r) continue;
    float w = exp(-0.5 * float(i * i) / (u_sigma * u_sigma));
    acc += texture(u_img, (gl_FragCoord.xy + u_dir * float(i)) / sz) * w;
    ws += w;
  }
  o = acc / ws;
}
