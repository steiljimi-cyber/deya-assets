// To the screen: working space -> display (P3 or sRGB), TPDF dither (no banding), clipping warnings.
uniform sampler2D u_img;
uniform mat3 u_toDisplay;
uniform vec4 u_view;      // dst rect in img texels: x, y, w, h (for nearest-neighbour zoom > 100%)
uniform int u_nearest;
uniform int u_clip;       // show clipping
uniform float u_split;    // before/after split position (0..1) or -1
uniform sampler2D u_before;
uniform vec4 u_rect;     // destination rect on screen, drawing-buffer px, top-left origin
uniform float u_bufH;
in vec2 v_uv;
out vec4 o;
void main() {
  vec2 sp = vec2(gl_FragCoord.x - u_rect.x, (u_bufH - gl_FragCoord.y) - u_rect.y);
  vec2 t = u_view.xy + (sp / u_rect.zw) * u_view.zw;
  vec2 sz = vec2(textureSize(u_img, 0));
  vec3 c;
  bool before = u_split >= 0.0 && sp.x / u_rect.z < u_split;
  if (u_nearest == 1) c = (before ? texelFetch(u_before, ivec2(t), 0) : texelFetch(u_img, ivec2(t), 0)).rgb;
  else c = (before ? texture(u_before, t / sz) : texture(u_img, t / sz)).rgb;
  vec3 d = u_toDisplay * c;
  if (u_clip == 1) {
    if (max(d.r, max(d.g, d.b)) >= 0.999) d = vec3(1.0, 0.0, 0.0);
    else if (min(d.r, min(d.g, d.b)) <= 0.0005) d = vec3(0.0, 0.3, 1.0);
  }
  vec3 e = srgbEnc(clamp(d, 0.0, 1.0));
  uint h = hashu(uint(gl_FragCoord.x) * 1973u ^ uint(gl_FragCoord.y) * 9277u);
  uint h2 = hashu(h);
  float dith = (float(h) - float(h2)) * (1.0 / 4294967296.0) / 255.0;
  if (u_split >= 0.0 && abs(sp.x / u_rect.z - u_split) * u_rect.z < 1.0) e = vec3(0.85);
  o = vec4(e + dith, 1.0);
}
