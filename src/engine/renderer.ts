// The render pipeline. Renders any rectangle of the output canvas at any scale, so the same code
// draws the live preview and every export tile (seamless: all randomness is keyed to canvas px).
import { GL, type Program, type Target, type UVal } from "./gl";
import developSrc from "./shaders/develop.frag?raw";
import motionSrc from "./shaders/motion.frag?raw";
import blurSrc from "./shaders/blur.frag?raw";
import downSrc from "./shaders/down.frag?raw";
import extractSrc from "./shaders/extract.frag?raw";
import mainSrc from "./shaders/main.frag?raw";
import compositeSrc from "./shaders/composite.frag?raw";
import displaySrc from "./shaders/display.frag?raw";
import resizeSrc from "./shaders/resize.frag?raw";
import { computeLayout, type Layout, type Rect } from "./layout";
import { buildStdLut, FRAME_SHORT_MM, grainRadiusPx, rMax, sampleCount, softAreaFactor, hash, grainAmplitude, amountCurve } from "./grain";
import { curveLut, curvesActive } from "./curves";
import { renderPostOverlay, renderPreOverlay } from "./overlay";
import { BLEND_MODES, HSL_BANDS, HSL_CENTERS, type Settings } from "../state/settings";
import { getStock } from "../film/stocks";
import {
  glMat3, whiteBalanceMatrix, REC2020_TO_LMS, LMS_TO_REC2020, OK_M2, OK_M2_INV, REC2020_TO_P3, REC2020_TO_SRGB,
  srgbDecode, SRGB_TO_REC2020, mul, type Mat3, type Vec3,
} from "../film/color";

export interface Source { tex: WebGLTexture; w: number; h: number; id: number }
export interface RenderOpts {
  region: Rect;
  k: number;
  exportMode?: boolean;
  interactive?: boolean;
}

export function hexToLinear(hex: string): Vec3 {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lin = v.map((x) => srgbDecode((x || 0) / 255)) as Vec3;
  return mul(SRGB_TO_REC2020, lin);
}

function hueRotation(deg: number): Mat3 {
  // rotate around the neutral axis (Rodrigues), luminance roughly preserved
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), k = 1 / Math.sqrt(3);
  const t = 1 - c;
  return [
    c + t * k * k, t * k * k - s * k, t * k * k + s * k,
    t * k * k + s * k, c + t * k * k, t * k * k - s * k,
    t * k * k - s * k, t * k * k + s * k, c + t * k * k,
  ];
}

interface Globals {
  key: string;
  hal: Target | null;
  bloom: Target | null;
  clar: Target | null;
  soft: Target | null;
  haze: Target | null;
  air: Vec3;
}

export class Renderer {
  g: GL;
  private p: Record<string, Program>;
  source: Source | null = null;
  private exportSource: { tex: WebGLTexture; w: number; h: number; key: string; t: Target } | null = null;
  private globals: Globals | null = null;
  private lutTex: WebGLTexture;
  private curveTex: WebGLTexture | null = null;
  private curveKey = "";
  textures = new Map<string, { tex: WebGLTexture; w: number; h: number }>();
  private srcCounter = 0;
  lastMs = 0;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.g = new GL(canvas);
    const g = this.g;
    this.p = {
      develop: g.program(developSrc), motion: g.program(motionSrc), blur: g.program(blurSrc), down: g.program(downSrc),
      extract: g.program(extractSrc), main: g.program(mainSrc), composite: g.program(compositeSrc), display: g.program(displaySrc),
      resize: g.program(resizeSrc),
    };
    const gl = g.gl;
    this.lutTex = g.texture(64, 64, gl.R32F, gl.RED, gl.FLOAT, buildStdLut(), { linear: g.floatLinear });
  }

  /** Upload a decoded image (RGBA half floats, linear Rec.2020). */
  setSource(w: number, h: number, rgbHalf: Uint16Array) {
    const g = this.g, gl = g.gl;
    if (w > g.maxTex || h > g.maxTex) throw new Error(`Image ${w}x${h} is larger than this GPU's ${g.maxTex}px texture limit`);
    if (this.source) gl.deleteTexture(this.source.tex);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 8);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, rgbHalf);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.source = { tex, w, h, id: ++this.srcCounter };
    this.dropGlobals();
    this.dropExportSource();
  }

  setTexture(path: string, w: number, h: number, rgbHalf: Uint16Array) {
    const g = this.g, gl = g.gl;
    const old = this.textures.get(path);
    if (old) gl.deleteTexture(old.tex);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 8);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, rgbHalf);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.textures.set(path, { tex, w, h });
  }

  layout(s: Settings, targetLong?: number): Layout {
    if (!this.source) throw new Error("no image");
    return computeLayout(s, this.source.w, this.source.h, targetLong);
  }

  private dropGlobals() {
    if (!this.globals) return;
    for (const t of [this.globals.hal, this.globals.bloom, this.globals.clar, this.globals.soft, this.globals.haze]) this.g.release(t);
    this.globals = null;
  }
  dropExportSource() {
    if (this.exportSource) { this.g.gl.deleteTexture(this.exportSource.t.tex); this.g.gl.deleteFramebuffer(this.exportSource.t.fb); }
    this.exportSource = null;
  }

  // ---------- parameter mapping ----------
  private developUniforms(s: Settings, L: Layout) {
    const st = getStock(s.film.stock);
    const look = st.def.look ?? {};
    const it = s.film.stock === "none" ? 0 : s.film.intensity / 100;
    const ap = L.aperture;
    let jit: Vec3 = [0, 0, 0];
    if (s.jitter.amount > 0) {
      const h1 = hash(s.jitter.seed * 7919 + 1) / 4294967296 - 0.5, h2 = hash(s.jitter.seed * 7919 + 2) / 4294967296 - 0.5, h3 = hash(s.jitter.seed * 7919 + 3) / 4294967296 - 0.5;
      const a = s.jitter.amount / 100;
      jit = [h1 * 0.024 * a, h2 * 0.024 * a, (h3 * 1.2 * a * Math.PI) / 180];
    }
    return {
      u_ap: [ap.x, ap.y, ap.w, ap.h], u_apRadius: L.apRadius, u_crop: [L.srcCrop.x, L.srcCrop.y, L.srcCrop.w, L.srcCrop.h],
      u_jit: jit, u_ca: (s.fringing.amount / 100) * 0.004,
      u_wb: glMat3(whiteBalanceMatrix(s.color.temperature, s.color.tint)),
      u_expo: Math.pow(2, s.light.exposure + (look.exposure ?? 0) * it),
      u_flash: (look.flash ?? 0) * it,
      u_vig: [(s.vignette.amount / 100) * 2.2, 0.15 + 0.7 * (s.vignette.midpoint / 100), s.vignette.roundness / 100, 0.05 + 0.9 * (s.vignette.feather / 100)],
      u_aspect: ap.w / ap.h,
    } as Record<string, UVal>;
  }

  private globalsKey(s: Settings, L: Layout, proxyLong: number) {
    return JSON.stringify([this.source?.id, proxyLong, L.aperture.w, L.aperture.h, L.srcCrop, s.color.temperature, s.color.tint, s.light.exposure, s.film.stock, s.film.intensity,
      s.vignette, s.fringing, s.jitter, s.halation, s.bloom, s.softFocus, s.light.clarity !== 0, s.light.dehaze !== 0]);
  }

  private blurTex(src: Target, sigma: number): Target {
    const g = this.g;
    let cur = src, owned = false, sg = sigma;
    while (sg > 6 && cur.w > 8 && cur.h > 8) {
      const d = g.target(Math.ceil(cur.w / 2), Math.ceil(cur.h / 2));
      g.draw(this.p.down, d, { u_img: { tex: cur.tex } });
      if (owned) g.release(cur);
      cur = d; owned = true; sg /= 2;
    }
    const a = g.target(cur.w, cur.h), b = g.target(cur.w, cur.h);
    g.draw(this.p.blur, a, { u_img: { tex: cur.tex }, u_dir: [1, 0], u_sigma: Math.max(sg, 0.5) });
    g.draw(this.p.blur, b, { u_img: { tex: a.tex }, u_dir: [0, 1], u_sigma: Math.max(sg, 0.5) });
    g.release(a);
    if (owned) g.release(cur);
    return b;
  }

  private ensureGlobals(s: Settings, L: Layout, proxyLong: number): Globals {
    const key = this.globalsKey(s, L, proxyLong);
    if (this.globals && this.globals.key === key) return this.globals;
    this.dropGlobals();
    const g = this.g, ap = L.aperture;
    const sc = Math.min(1, proxyLong / Math.max(ap.w, ap.h));
    const pw = Math.max(8, Math.round(ap.w * sc)), ph = Math.max(8, Math.round(ap.h * sc));
    const kp = ap.w / pw;
    const P0 = g.target(pw, ph);
    g.draw(this.p.develop, P0, { ...this.developUniforms(s, L), u_src: { tex: this.source!.tex }, u_srcSize: [this.source!.w, this.source!.h], u_filter: 0, u_tileOrigin: [ap.x, ap.y], u_k: kp });
    const short = Math.min(pw, ph);
    const st = getStock(s.film.stock);
    const out: Globals = { key, hal: null, bloom: null, clar: null, soft: null, haze: null, air: [1, 1, 1] };
    const extract = (thr: number) => {
      const t = g.target(pw, ph);
      g.draw(this.p.extract, t, { u_img: { tex: P0.tex }, u_mode: 0, u_thr: thr });
      return t;
    };
    if (s.halation.amount > 0 && st.def.halation.strength > 0) {
      const e = extract(0.18 * Math.pow(2, (s.halation.threshold / 100) * 4.5));
      out.hal = this.blurTex(e, short * 0.003 * Math.pow(2, (s.halation.spread / 100) * 4.3));
      g.release(e);
    }
    if (s.bloom.amount > 0) {
      const e = extract(0.18 * Math.pow(2, (s.bloom.threshold / 100) * 4.5));
      out.bloom = this.blurTex(e, short * 0.005 * Math.pow(2, (s.bloom.radius / 100) * 4));
      g.release(e);
    }
    if (s.light.clarity !== 0) out.clar = this.blurTex(P0, short * 0.015);
    if (s.softFocus.amount > 0) out.soft = this.blurTex(P0, short * 0.002 * Math.pow(2, (s.softFocus.radius / 100) * 4.5));
    if (s.light.dehaze !== 0) {
      // airlight: mean colour of the brightest dark-channel pixels of a small copy
      let small = P0, owned = false;
      while (small.w > 48) {
        const d = g.target(Math.ceil(small.w / 2), Math.ceil(small.h / 2));
        g.draw(this.p.down, d, { u_img: { tex: small.tex } });
        if (owned) g.release(small);
        small = d; owned = true;
      }
      const px = g.readRGBA(small);
      const list: [number, number, number, number][] = [];
      for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0.5) list.push([Math.min(px[i], px[i + 1], px[i + 2]), px[i], px[i + 1], px[i + 2]]);
      list.sort((a, b) => b[0] - a[0]);
      const top = list.slice(0, Math.max(1, Math.floor(list.length * 0.02)));
      const air = [0, 0, 0];
      for (const t of top) { air[0] += t[1]; air[1] += t[2]; air[2] += t[3]; }
      out.air = air.map((v) => Math.max(v / top.length, 0.05)) as Vec3;
      if (owned) g.release(small);
      const dc = g.target(pw, ph);
      g.draw(this.p.extract, dc, { u_img: { tex: P0.tex }, u_mode: 1, u_air: out.air });
      out.haze = this.blurTex(dc, short * 0.02);
      g.release(dc);
    }
    g.release(P0);
    this.globals = out;
    return out;
  }

  private kCache = new Map<string, number>();
  grainK(st: ReturnType<typeof getStock>, sigma: number) {
    const key = `${st.def.id}:${sigma.toFixed(3)}`;
    let k = this.kCache.get(key);
    if (k === undefined) {
      const range = st.grainStage === 0 ? st.dRange[1] : st.pRange;
      k = grainAmplitude({ rms: st.def.grain.rms ?? 12, um: st.def.grain.um, sigma, soft: st.def.grain.soft, densityRange: range });
      this.kCache.set(key, k);
    }
    return k;
  }

  private curveTexture(s: Settings) {
    const key = JSON.stringify(s.curve);
    if (this.curveTex && key === this.curveKey) return this.curveTex;
    const gl = this.g.gl;
    if (this.curveTex) gl.deleteTexture(this.curveTex);
    this.curveTex = this.g.texture(1024, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, curveLut(s), { linear: this.g.floatLinear });
    this.curveKey = key;
    return this.curveTex;
  }

  private mainUniforms(s: Settings, L: Layout, k: number, interactive: boolean, G: Globals) {
    const st = getStock(s.film.stock);
    const def = st.def;
    const look = def.look ?? {};
    const it = s.film.stock === "none" ? 0 : s.film.intensity / 100;
    const ap = L.aperture;
    const short = Math.min(ap.w, ap.h);
    // grain
    const iso = s.film.isoAuto ? def.iso : s.film.iso;
    const base = grainRadiusPx({ um: def.grain.um, frameShortMm: FRAME_SHORT_MM[s.film.format] ?? 24, frameShortPx: short, size: s.grain.size, iso, stockIso: def.iso });
    const lm = def.grain.layer ?? [1, 1.0, 1.12];
    const radii: Vec3 = [base * lm[0], base * lm[1], base * lm[2]];
    const sigma = Math.min(1, Math.max(0.02, def.grain.rough * Math.pow(2, (s.grain.roughness - 50) / 35)));
    const soft = def.grain.soft;
    const gS = 0.5 * Math.max(k, 1);
    const rM = Math.max(...radii);
    const gp = { radius: rM, sigma, soft, seed: s.grain.seed };
    const n = interactive ? 4 : sampleCount(gS, Math.min(...radii));
    const hslOn = HSL_BANDS.some((b) => s.hsl[b].h || s.hsl[b].s || s.hsl[b].l);
    const leakHue = glMat3(hueRotation(s.lightLeak.hue * 1.8));
    return {
      u_ap: [ap.x, ap.y, ap.w, ap.h],
      u_hal: G.hal ? { tex: G.hal.tex } : undefined, u_bloom: G.bloom ? { tex: G.bloom.tex } : undefined,
      u_clar: G.clar ? { tex: G.clar.tex } : undefined, u_soft: G.soft ? { tex: G.soft.tex } : undefined,
      u_haze: G.haze ? { tex: G.haze.tex } : undefined, u_air: G.air,
      u_dehaze: s.light.dehaze / 100, u_clarity: G.clar ? s.light.clarity / 100 : 0,
      u_halAmt: G.hal ? (s.halation.amount / 100) * 1.6 * def.halation.strength : 0, u_halColor: def.halation.color,
      u_bloomAmt: G.bloom ? (s.bloom.amount / 100) * 0.7 : 0, u_softAmt: G.soft ? s.softFocus.amount / 100 : 0,
      u_leakAmt: s.lightLeak.amount / 100, u_leakSize: s.lightLeak.size / 100, u_leakPos: s.lightLeak.position / 100,
      u_leakStyle: s.lightLeak.style, u_leakSeed: s.lightLeak.seed >>> 0, u_leakHue: leakHue, u_aspect: ap.w / ap.h,
      u_filmOn: s.film.stock === "none" ? 0 : 1, u_intensity: it,
      u_sens: glMat3(st.sens), u_gamma: st.gamma, u_toe: st.toe, u_width: st.shoulder.map((v, i) => v - st.toe[i]),
      u_dRange: st.dRange, u_dGrey: st.dGrey, u_tint: st.tint, u_kt: st.kt, u_ks: st.ks, u_coupling: st.coupling,
      u_pg: st.pg, u_yt: st.yt, u_pw: st.ys - st.yt, u_pkt: st.pkt, u_pks: st.pks, u_y0: st.y0, u_pRange: st.pRange,
      u_grainStage: st.grainStage, u_bw: st.bw ? 1 : 0,
      u_gAmount: this.grainK(st, sigma) * amountCurve(s.grain.amount), u_gR: radii, u_gSigma: sigma, u_gSoft: soft, u_gArea: softAreaFactor(soft),
      u_gColor: st.bw ? 0 : s.grain.color / 100, u_gSeed: (s.grain.seed * 2654435761) >>> 0, u_gS: gS, u_gN: n,
      u_gDelta: rMax(gp), u_gLut: { tex: this.lutTex },
      u_contrast: s.light.contrast / 100 + (look.contrast ?? 0) * it, u_highlights: s.light.highlights / 100, u_shadows: s.light.shadows / 100,
      u_whites: s.light.whites / 100, u_blacks: s.light.blacks / 100,
      u_vibrance: s.color.vibrance / 100 + (look.vibrance ?? 0) * it, u_saturation: s.color.saturation / 100 + (look.saturation ?? 0) * it,
      u_fade: Math.min(1, s.fade / 100 + (look.fade ?? 0) * it),
      u_hslH: HSL_BANDS.map((b) => s.hsl[b].h / 100), u_hslS: HSL_BANDS.map((b) => s.hsl[b].s / 100), u_hslL: HSL_BANDS.map((b) => s.hsl[b].l / 100),
      u_hslC: HSL_CENTERS, u_hslOn: hslOn ? 1 : 0,
      u_curve: { tex: this.curveTexture(s) }, u_curveOn: curvesActive(s) ? 1 : 0,
      u_levels: [s.levels.inBlack / 255, s.levels.inWhite / 255, s.levels.outBlack / 255, s.levels.outWhite / 255], u_levelsGamma: s.levels.gamma,
      u_toLms: glMat3(REC2020_TO_LMS), u_fromLms: glMat3(LMS_TO_REC2020), u_okM2: glMat3(OK_M2), u_okM2i: glMat3(OK_M2_INV),
      u_k: k,
    } as Record<string, UVal | undefined>;
    void short;
  }

  private borderUniforms(s: Settings, L: Layout) {
    const b = s.border;
    const id = L.borderId;
    let bg = hexToLinear(b.bgColor), paper = hexToLinear(b.color), hole = bg, nb: Vec3 = [0.004, 0.004, 0.004];
    let rough = 0;
    switch (b.type) {
      case "none": bg = hexToLinear(b.color); paper = bg; break;
      case "plain": bg = paper = hexToLinear(b.color); break;
      case "35mm": case "half-frame": case "120": paper = hexToLinear(b.rebateColor); hole = bg; break;
      case "contact-sheet": paper = hexToLinear(b.rebateColor).map((v) => v + 0.018) as Vec3; hole = [0, 0, 0]; nb = [0.004, 0.004, 0.004]; break;
      case "scan-negative":
        if (b.variant === "raw") { paper = hexToLinear("#c9783e"); hole = [1, 1, 1]; }
        else { paper = hexToLinear(b.rebateColor); hole = [0.85, 0.85, 0.85]; }
        break;
      case "torn": rough = 1 + (b.roundness / 100) * 2; break;
      case "paper": rough = 0.4 + (b.roundness / 100) * 1.2; break;
    }
    const nbs = L.neighbours.slice(0, 4);
    const nbArr: number[] = [];
    for (let i = 0; i < 4; i++) { const r = nbs[i]; nbArr.push(...(r ? [r.x, r.y, r.w, r.h] : [0, 0, 0, 0])); }
    const sp = L.sprocket;
    return {
      u_canvas: [L.canvasW, L.canvasH], u_ap: [L.aperture.x, L.aperture.y, L.aperture.w, L.aperture.h], u_apRadius: L.apRadius,
      u_border: id, u_paper: [L.paper.x, L.paper.y, L.paper.w, L.paper.h], u_paperRadius: L.paperRadius,
      u_bg: bg, u_paperCol: paper, u_holeCol: hole, u_nbCol: nb,
      u_spr: [sp.pitch, sp.w, sp.h, sp.r], u_sprRows: [sp.rowA, sp.rowB, sp.phase], u_sprOn: sp.on ? 1 : 0, u_sprAxis: sp.axis,
      u_nb: nbArr, u_nbCount: nbs.length, u_bSeed: (b.seed * 747796405) >>> 0, u_pxPerMm: Math.max(L.pxPerMm, 1e-3), u_edgeRough: rough,
    } as Record<string, UVal>;
  }

  private effectsUniforms(s: Settings) {
    const st = getStock(s.film.stock);
    const white = s.dust.mode === "white" || (s.dust.mode === "auto" && st.def.kind !== "slide");
    const slots = s.textures.filter((t) => t.enabled && t.path && this.textures.has(t.path)).slice(0, 4);
    const A: number[] = [], B: number[] = [];
    const u: Record<string, UVal | undefined> = {};
    slots.forEach((t, i) => {
      const tx = this.textures.get(t.path)!;
      A.push(t.intensity / 100, (t.rotation * Math.PI) / 180, t.scale, BLEND_MODES.indexOf(t.blend));
      B.push(t.offsetX / 100, t.offsetY / 100, (t.flipX ? 1 : 0) | (t.flipY ? 2 : 0) | (t.invert ? 4 : 0) | (t.area === "canvas" ? 8 : 0), tx.w / tx.h);
      u["u_tex" + i] = { tex: tx.tex };
    });
    while (A.length < 16) { A.push(0); B.push(0); }
    return {
      ...u, u_texCount: slots.length, u_texA: A, u_texB: B,
      u_gl: s.glitch.amount / 100, u_glShift: s.glitch.rgbShift / 100, u_glSlices: s.glitch.slices / 100, u_glBlocks: s.glitch.blocks / 100,
      u_glScan: s.glitch.scanlines / 100, u_glSeed: (s.glitch.seed * 2246822519) >>> 0,
      u_dust: s.dust.amount / 100, u_scratch: s.dust.scratches / 100, u_hairs: s.dust.hairs / 100, u_dustSize: s.dust.size / 100,
      u_dustSeed: (s.dust.seed * 3266489917) >>> 0, u_dustWhite: white ? 1 : 0,
    } as Record<string, UVal | undefined>;
  }

  /** Apron (canvas px) needed around a tile so spatial effects are exact across tile borders. */
  apron(s: Settings, L: Layout, k: number) {
    const ap = L.aperture;
    let a = 2 * k + 2;
    if (s.motionBlur.amount > 0) a += (s.motionBlur.amount / 100) * 0.08 * Math.max(ap.w, ap.h) + 2 * k;
    if (s.glitch.amount > 0) a += ap.w * (0.08 + 0.05 + 0.012) * (s.glitch.amount / 100) + ap.w * 0.05;
    return a;
  }

  /** Lanczos pre-downscale of the source for exports smaller than the original (no aliasing). */
  private prepareExportSource(L: Layout): { tex: WebGLTexture; w: number; h: number; crop: Rect } | null {
    const src = this.source!;
    const cw = src.w * L.srcCrop.w, ch = src.h * L.srcCrop.h;
    const scale = cw / L.aperture.w;
    if (scale <= 1.25) return null;
    const dw = Math.max(1, Math.round(L.aperture.w)), dh = Math.max(1, Math.round(L.aperture.h));
    const key = `${src.id}:${dw}x${dh}:${JSON.stringify(L.srcCrop)}`;
    if (this.exportSource?.key === key) return { ...this.exportSource, crop: { x: 0, y: 0, w: 1, h: 1 } };
    this.dropExportSource();
    const g = this.g;
    const h1 = g.target(dw, Math.ceil(ch));
    g.draw(this.p.resize, h1, { u_img: { tex: src.tex }, u_dir: [1, 0], u_scale: cw / dw, u_off: src.w * L.srcCrop.x, u_offOther: [0, src.h * L.srcCrop.y] });
    const v = g.target(dw, dh);
    g.draw(this.p.resize, v, { u_img: { tex: h1.tex }, u_dir: [0, 1], u_scale: ch / dh, u_off: 0, u_offOther: [0, 0] });
    g.release(h1);
    // detach the texture from the pool: it is owned by exportSource
    this.exportSource = { tex: v.tex, w: dw, h: dh, key, t: v };
    return { tex: v.tex, w: dw, h: dh, crop: { x: 0, y: 0, w: 1, h: 1 } };
  }

  /**
   * Render `region` (canvas px) at `k` canvas px per output texel. Returns a linear Rec.2020 target
   * of size ceil(region/k). Caller releases it.
   */
  renderRegion(s: Settings, L: Layout, o: RenderOpts): Target {
    if (!this.source) throw new Error("no image");
    const t0 = performance.now();
    const g = this.g;
    const k = o.k;
    const tw = Math.max(1, Math.round(o.region.w / k)), th = Math.max(1, Math.round(o.region.h / k));
    const apronT = Math.ceil(this.apron(s, L, k) / k);
    const aw = tw + 2 * apronT, ah = th + 2 * apronT;
    const origin: [number, number] = [o.region.x - apronT * k, o.region.y - apronT * k];
    const G = this.ensureGlobals(s, L, o.exportMode ? 2048 : 1024);
    // 1. develop / resample
    let srcTex = this.source.tex, srcW = this.source.w, srcH = this.source.h, crop = L.srcCrop, filter = 0;
    if (o.exportMode) {
      const pre = this.prepareExportSource(L);
      if (pre) { srcTex = pre.tex; srcW = pre.w; srcH = pre.h; crop = pre.crop; }
      filter = (srcW * crop.w) / L.aperture.w < 0.999 ? 2 : 1; // Lanczos when enlarging, bicubic otherwise
    }
    let A = g.target(aw, ah);
    g.draw(this.p.develop, A, {
      ...this.developUniforms(s, L), u_crop: [crop.x, crop.y, crop.w, crop.h],
      u_src: { tex: srcTex }, u_srcSize: [srcW, srcH], u_filter: filter, u_tileOrigin: origin, u_k: k,
    });
    // 2. motion blur (3 compounded box passes)
    if (s.motionBlur.amount > 0) {
      const len = ((s.motionBlur.amount / 100) * 0.08 * Math.max(L.aperture.w, L.aperture.h)) / k;
      const ang = (s.motionBlur.angle * Math.PI) / 180;
      const dir = [Math.cos(ang), Math.sin(ang)];
      let span = len;
      for (let i = 0; i < 3 && span >= 0.5; i++) {
        const B = g.target(aw, ah);
        g.draw(this.p.motion, B, { u_img: { tex: A.tex }, u_dir: dir, u_span: span });
        g.release(A);
        A = B;
        span /= 16;
      }
    }
    // 3. main grade (+ date stamp exposed onto film)
    const pre = renderPreOverlay(L, s, { x: origin[0], y: origin[1], w: aw * k, h: ah * k }, k, aw, ah);
    let preTex: WebGLTexture | null = null;
    const gl = g.gl;
    if (pre) preTex = this.uploadCanvas(pre.canvas);
    const M = g.target(aw, ah);
    g.draw(this.p.main, M, { ...this.mainUniforms(s, L, k, !!o.interactive, G), u_scene: { tex: A.tex }, u_tileOrigin: origin, u_pre: preTex ? { tex: preTex } : undefined, u_hasPre: preTex ? 1 : 0, u_preOff: pre?.margin ?? 0 });
    g.release(A);
    if (preTex) gl.deleteTexture(preTex);
    // 4. composite
    const post = renderPostOverlay(L, s, o.region, k, tw, th);
    const postTex = post ? this.uploadCanvas(post.canvas) : null;
    const out = g.target(tw, th);
    g.draw(this.p.composite, out, {
      ...this.borderUniforms(s, L), ...this.effectsUniforms(s), u_main: { tex: M.tex }, u_mainOrigin: origin,
      u_tileOrigin: [o.region.x, o.region.y], u_k: k, u_post: postTex ? { tex: postTex } : undefined, u_hasPost: postTex ? 1 : 0, u_postOff: post?.margin ?? 0,
    });
    g.release(M);
    if (postTex) gl.deleteTexture(postTex);
    this.lastMs = performance.now() - t0;
    return out;
  }

  private uploadCanvas(c: OffscreenCanvas | HTMLCanvasElement): WebGLTexture {
    const gl = this.g.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c as any);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Draw a rendered target to the screen canvas. view = texel rect shown across the full canvas. */
  display(img: Target, view: [number, number, number, number], rect: [number, number, number, number], opts: { nearest: boolean; clip: boolean; split?: number; before?: Target | null }) {
    const g = this.g, gl = g.gl;
    const m = g.displayP3 ? REC2020_TO_P3 : REC2020_TO_SRGB;
    const H = gl.drawingBufferHeight;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, H);
    const bgv = 0.118;
    gl.clearColor(bgv, bgv, bgv, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const [rx, ry, rw, rh] = rect.map(Math.round);
    g.draw(this.p.display, null, {
      u_img: { tex: img.tex }, u_toDisplay: glMat3(m), u_view: view, u_nearest: opts.nearest ? 1 : 0, u_clip: opts.clip ? 1 : 0,
      u_split: opts.split ?? -1, u_before: opts.before ? { tex: opts.before.tex } : { tex: img.tex },
      u_rect: [rx, ry, rw, rh], u_bufH: H,
    }, [rx, H - ry - rh, rw, rh]);
  }
}
