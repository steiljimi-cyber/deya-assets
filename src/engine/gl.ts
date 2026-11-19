// Thin WebGL2 layer: float render targets, programs with reflected uniforms, a target pool.
import common from "./shaders/common.glsl?raw";
import grain from "./shaders/grain.glsl?raw";
import vs from "./shaders/vs.glsl?raw";

export interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
  fmt: number;
}

interface UInfo { loc: WebGLUniformLocation; type: number; size: number }
export interface Program { prog: WebGLProgram; uniforms: Map<string, UInfo> }
export type UVal = number | boolean | number[] | Float32Array | Int32Array | { tex: WebGLTexture };

const INCLUDES: Record<string, string> = { "grain.glsl": grain };

export class GL {
  gl: WebGL2RenderingContext;
  vao: WebGLVertexArrayObject;
  floatLinear: boolean;
  fmt32: number;
  maxTex: number;
  private pool: Target[] = [];
  private black: WebGLTexture;

  constructor(public canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: false, powerPreference: "high-performance" }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("Float render targets (EXT_color_buffer_float) are not supported by this GPU");
    this.floatLinear = !!gl.getExtension("OES_texture_float_linear");
    // RGBA32F where filterable, RGBA16F otherwise (still float, no banding)
    this.fmt32 = this.floatLinear ? gl.RGBA32F : gl.RGBA16F;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.vao = gl.createVertexArray()!;
    this.black = this.texture(1, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, new Float32Array([0, 0, 0, 0]));
    try {
      (gl as any).drawingBufferColorSpace = "display-p3";
    } catch { /* not supported */ }
  }

  get displayP3(): boolean {
    return (this.gl as any).drawingBufferColorSpace === "display-p3";
  }

  blackTex() { return this.black; }

  program(frag: string): Program {
    const gl = this.gl;
    const src = "#version 300 es\n" + common + "\n" + frag.replace(/#include "([^"]+)"/g, (_, f) => INCLUDES[f] ?? "");
    const sh = (type: number, s: string) => {
      const o = gl.createShader(type)!;
      gl.shaderSource(o, s);
      gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(o);
        const lines = s.split("\n").map((l, i) => `${i + 1}: ${l}`);
        const m = /ERROR: \d+:(\d+)/.exec(log ?? "");
        const ctx = m ? lines.slice(Math.max(0, +m[1] - 4), +m[1] + 2).join("\n") : "";
        throw new Error("Shader compile error: " + log + "\n" + ctx);
      }
      return o;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, src));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("Program link error: " + gl.getProgramInfoLog(p));
    const uniforms = new Map<string, UInfo>();
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i)!;
      const name = info.name.replace(/\[0\]$/, "");
      uniforms.set(name, { loc: gl.getUniformLocation(p, info.name)!, type: info.type, size: info.size });
    }
    return { prog: p, uniforms };
  }

  texture(w: number, h: number, internal: number, format: number, type: number, data: ArrayBufferView | null = null, opts: { linear?: boolean; mip?: boolean; repeat?: boolean } = {}): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    const lin = opts.linear ?? true;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.mip ? gl.LINEAR_MIPMAP_LINEAR : lin ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, lin ? gl.LINEAR : gl.NEAREST);
    const wrap = opts.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (opts.mip) gl.generateMipmap(gl.TEXTURE_2D);
    return t;
  }

  /** Get a float render target of the given size from the pool. */
  target(w: number, h: number, fmt = this.fmt32): Target {
    w = Math.max(1, Math.ceil(w));
    h = Math.max(1, Math.ceil(h));
    const i = this.pool.findIndex((t) => t.w === w && t.h === h && t.fmt === fmt);
    if (i >= 0) return this.pool.splice(i, 1)[0];
    const gl = this.gl;
    if (w > this.maxTex || h > this.maxTex) throw new Error(`Render target ${w}x${h} exceeds GPU limit ${this.maxTex}`);
    const tex = this.texture(w, h, fmt, gl.RGBA, fmt === gl.RGBA16F ? gl.HALF_FLOAT : gl.FLOAT, null, { linear: true });
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Framebuffer incomplete " + st);
    return { tex, fb, w, h, fmt };
  }

  release(t: Target | null | undefined) {
    if (!t) return;
    this.pool.push(t);
    // keep the pool bounded
    while (this.pool.length > 24) {
      const o = this.pool.shift()!;
      this.gl.deleteTexture(o.tex);
      this.gl.deleteFramebuffer(o.fb);
    }
  }

  trimPool() {
    for (const o of this.pool) {
      this.gl.deleteTexture(o.tex);
      this.gl.deleteFramebuffer(o.fb);
    }
    this.pool = [];
  }

  draw(p: Program, target: Target | null, uniforms: Record<string, UVal | undefined>, viewport?: [number, number, number, number]) {
    const gl = this.gl;
    gl.useProgram(p.prog);
    let unit = 0;
    for (const [name, info] of p.uniforms) {
      const v = uniforms[name];
      if (v === undefined) {
        if (info.type === gl.SAMPLER_2D) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, this.black);
          gl.uniform1i(info.loc, unit++);
        }
        continue;
      }
      if (typeof v === "object" && "tex" in v) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, v.tex);
        gl.uniform1i(info.loc, unit++);
        continue;
      }
      const arr = typeof v === "number" ? [v] : typeof v === "boolean" ? [v ? 1 : 0] : v;
      switch (info.type) {
        case gl.FLOAT: gl.uniform1fv(info.loc, arr as any); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(info.loc, arr as any); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(info.loc, arr as any); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(info.loc, arr as any); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(info.loc, false, arr as any); break;
        case gl.INT: case gl.BOOL: gl.uniform1iv(info.loc, Int32Array.from(arr as any, (x: number) => Math.round(x))); break;
        case gl.UNSIGNED_INT: gl.uniform1uiv(info.loc, Uint32Array.from(arr as any, (x: number) => x >>> 0)); break;
        default: throw new Error("unhandled uniform type for " + name);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    const [x, y, w, h] = viewport ?? (target ? [0, 0, target.w, target.h] : [0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight]);
    gl.viewport(x, y, w, h);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  readRGBA(t: Target, x = 0, y = 0, w = t.w, h = t.h): Float32Array {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    const out = new Float32Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, out);
    return out;
  }
}
