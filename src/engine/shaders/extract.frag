// Highlight extraction for halation / bloom, and dark channel for dehaze.
uniform sampler2D u_img;
uniform int u_mode;       // 0 = highlights above threshold, 1 = dark channel, 2 = copy
uniform float u_thr;
uniform vec3 u_air;
in vec2 v_uv;
out vec4 o;
void main() {
  vec4 c = texelFetch(u_img, ivec2(gl_FragCoord.xy), 0);
  if (u_mode == 0) {
    float l = luma(c.rgb);
    float w = smoothstep(u_thr * 0.6, u_thr * 1.6, l);
    o = vec4(c.rgb * w, c.a);
  } else if (u_mode == 1) {
    vec3 n = c.rgb / max(u_air, vec3(1e-3));
    o = vec4(vec3(min(n.r, min(n.g, n.b))), c.a);
  } else {
    o = c;
  }
}
