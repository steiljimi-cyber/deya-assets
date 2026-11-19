uniform sampler2D u_img;
in vec2 v_uv;
out vec4 o;
void main() {
  vec2 sz = vec2(textureSize(u_img, 0));
  vec2 p = gl_FragCoord.xy * 2.0;
  o = 0.25 * (texture(u_img, (p + vec2(-0.5, -0.5)) / sz) + texture(u_img, (p + vec2(0.5, -0.5)) / sz) +
              texture(u_img, (p + vec2(-0.5, 0.5)) / sz) + texture(u_img, (p + vec2(0.5, 0.5)) / sz));
}
