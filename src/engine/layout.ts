// Canvas + border geometry. Everything is designed in millimetres of a real object
// (film strip, instant print, slide mount...) and converted to output pixels, so borders
// are rendered from vector data at full export resolution.
import type { Settings } from "../state/settings";

export type Rect = { x: number; y: number; w: number; h: number };

export interface OverlayItem {
  kind: "text" | "rect" | "barcode" | "line";
  x: number; y: number; // canvas px
  w?: number; h?: number;
  text?: string;
  size?: number; // px
  font?: string;
  weight?: number;
  color: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  rotation?: number; // radians
  letterSpacing?: number; // px
  lineWidth?: number;
  wobble?: number;
  seed?: number;
  opacity?: number;
  glow?: number;
  italic?: boolean;
}

export const BORDER_IDS: Record<string, number> = {
  none: 0, plain: 1, "35mm": 2, "120": 3, "half-frame": 4, instant: 5, "contact-sheet": 6, "slide-mount": 7,
  "scan-negative": 8, torn: 9, paper: 10,
};

export interface Layout {
  canvasW: number;
  canvasH: number;
  /** where the photo shows, canvas px */
  aperture: Rect;
  apRadius: number;
  /** source crop (uv 0..1) mapped into the aperture (cover fit) */
  srcCrop: Rect;
  pxPerMm: number;
  borderId: number;
  /** film strip / print / mount rectangle */
  paper: Rect;
  paperRadius: number;
  sprocket: { on: boolean; axis: 0 | 1; pitch: number; w: number; h: number; r: number; rowA: number; rowB: number; phase: number };
  overlay: OverlayItem[];
  /** extra frames for contact sheet / strip neighbours, canvas px */
  neighbours: Rect[];
}

interface MmDesign {
  W: number; H: number; // canvas mm
  ap: Rect; apR: number;
  paper: Rect; paperR: number;
  spr?: { axis: 0 | 1; pitch: number; w: number; h: number; r: number; rowA: number; rowB: number; phase: number };
  overlay: OverlayItem[]; // in mm units (converted later)
  neighbours?: Rect[];
}

function hex(c: string) { return c; }

/** Film-edge text: own brand-free wording. */
function edgeText(s: Settings) {
  const base = s.border.customText || "FIXER 400";
  return base.toUpperCase();
}

function stripDesign(s: Settings, apW: number, apH: number, landscape: boolean, half: boolean): MmDesign {
  // 35mm film: 35mm wide strip, KS perforations 2.8 x 1.98mm @ 4.75mm pitch, rebate 5.5mm each side
  const strip = 35;
  const gap = half ? 2 : 2.2;
  const len = apW + gap * 2 + 8; // show a little of the neighbouring frames' gap
  const W = landscape ? len : strip, H = landscape ? strip : len;
  const ap: Rect = landscape ? { x: (len - apW) / 2, y: (strip - apH) / 2, w: apW, h: apH } : { x: (strip - apH) / 2, y: (len - apW) / 2, w: apH, h: apW };
  const ov: OverlayItem[] = [];
  const tc = s.border.textColor;
  const n = s.border.frameNumber;
  if (s.border.showText) {
    const tsize = 1.55;
    if (landscape) {
      ov.push({ kind: "text", text: edgeText(s), x: ap.x + 3, y: 1.05, size: tsize, color: tc, align: "left", baseline: "middle", letterSpacing: 0.25, font: "Space Mono", weight: 700 });
      ov.push({ kind: "text", text: `${n}`, x: ap.x + apW * 0.55, y: strip - 1.05, size: tsize, color: tc, align: "center", baseline: "middle", font: "Space Mono", weight: 700 });
      ov.push({ kind: "text", text: `▸${n}A`, x: ap.x + apW * 0.82, y: strip - 1.05, size: tsize, color: tc, align: "center", baseline: "middle", font: "Space Mono", weight: 700 });
      ov.push({ kind: "barcode", x: ap.x + apW * 0.12, y: strip - 1.65, w: apW * 0.28, h: 1.2, color: tc, seed: n });
    } else {
      ov.push({ kind: "text", text: edgeText(s), x: strip - 1.05, y: ap.y + 3, size: tsize, color: tc, align: "left", baseline: "middle", rotation: Math.PI / 2, letterSpacing: 0.25, font: "Space Mono", weight: 700 });
      ov.push({ kind: "text", text: `${n}`, x: 1.05, y: ap.y + apW * 0.55, size: tsize, color: tc, align: "center", baseline: "middle", rotation: Math.PI / 2, font: "Space Mono", weight: 700 });
      ov.push({ kind: "text", text: `▸${n}A`, x: 1.05, y: ap.y + apW * 0.82, size: tsize, color: tc, align: "center", baseline: "middle", rotation: Math.PI / 2, font: "Space Mono", weight: 700 });
    }
  }
  return {
    W, H, ap, apR: 0.45, paper: { x: 0, y: 0, w: W, h: H }, paperR: 0,
    spr: { axis: landscape ? 0 : 1, pitch: 4.75, w: 1.98, h: 2.8, r: 0.5, rowA: 2.0 + 1.4, rowB: strip - 2.0 - 1.4, phase: landscape ? ap.x : ap.y },
    overlay: ov,
  };
}

function design(s: Settings, aspect: number): MmDesign | null {
  const b = s.border;
  const land = aspect >= 1;
  switch (b.type) {
    case "none":
      return null;
    case "plain": {
      const short = 100;
      const apW = land ? short * aspect : short, apH = land ? short : short / aspect;
      const m = (b.size / 100) * short;
      return { W: apW + 2 * m, H: apH + 2 * m, ap: { x: m, y: m, w: apW, h: apH }, apR: 0, paper: { x: 0, y: 0, w: apW + 2 * m, h: apH + 2 * m }, paperR: 0, overlay: [] };
    }
    case "35mm":
      return stripDesign(s, 36, 24, land, false);
    case "half-frame":
      // half-frame: 18 x 24 frames on a 35mm strip (strip runs across the long side of a portrait frame)
      return land ? stripDesign(s, 24, 18, false, true) : stripDesign(s, 18, 24, true, true);
    case "120": {
      const v = b.variant || (Math.abs(aspect - 1) < 0.08 ? "6x6" : Math.abs(aspect - 4 / 3) < 0.1 || Math.abs(aspect - 3 / 4) < 0.1 ? "6x4.5" : "6x7");
      const dims: Record<string, [number, number]> = { "6x6": [56, 56], "6x4.5": [56, 41.5], "6x7": [69.5, 56], "6x9": [84, 56] };
      let [aw, ah] = dims[v] ?? dims["6x6"];
      if (!land && aw > ah) [aw, ah] = [ah, aw];
      if (land && ah > aw) [aw, ah] = [ah, aw];
      const strip = 61.5, margin = 4;
      const landStrip = aw >= ah;
      const W = landStrip ? aw + margin * 2 : strip, H = landStrip ? strip : ah + margin * 2;
      const ap: Rect = landStrip ? { x: margin, y: (strip - ah) / 2, w: aw, h: ah } : { x: (strip - aw) / 2, y: margin, w: aw, h: ah };
      const ov: OverlayItem[] = [];
      if (b.showText) {
        const tc = b.textColor;
        if (landStrip) {
          ov.push({ kind: "text", text: edgeText(s) + "  120", x: ap.x + 4, y: (strip - ah) / 4, size: 1.6, color: tc, align: "left", baseline: "middle", font: "Space Mono", weight: 700, letterSpacing: 0.3 });
          ov.push({ kind: "text", text: `${b.frameNumber}`, x: ap.x + aw / 2, y: strip - (strip - ah) / 4, size: 1.8, color: tc, align: "center", baseline: "middle", font: "Space Mono", weight: 700 });
        } else {
          ov.push({ kind: "text", text: edgeText(s) + "  120", x: strip - (strip - aw) / 4, y: ap.y + 4, size: 1.6, color: tc, align: "left", baseline: "middle", rotation: Math.PI / 2, font: "Space Mono", weight: 700, letterSpacing: 0.3 });
          ov.push({ kind: "text", text: `${b.frameNumber}`, x: (strip - aw) / 4, y: ap.y + ah / 2, size: 1.8, color: tc, align: "center", baseline: "middle", rotation: Math.PI / 2, font: "Space Mono", weight: 700 });
        }
      }
      return { W, H, ap, apR: 0.8, paper: { x: 0, y: 0, w: W, h: H }, paperR: 0, overlay: ov };
    }
    case "instant": {
      const v = b.variant || "square";
      // [print w, print h, image w, image h, side, top]
      const spec: Record<string, number[]> = {
        square: [88, 107, 79, 79, 4.5, 6],
        wide: [108, 86, 99, 62, 4.5, 6.5],
        mini: [54, 86, 46, 62, 4, 6.5],
        go: [53.9, 66.6, 46, 47, 4, 5.5],
      };
      const [pw, ph, iw, ih, side, top] = spec[v] ?? spec.square;
      const ov: OverlayItem[] = [];
      if (b.customText && b.showText && b.customText !== "FIXER 400") {
        ov.push({ kind: "text", text: b.customText, x: pw / 2, y: top + ih + (ph - top - ih) / 2, size: (ph - top - ih) * 0.28, color: "#2a2a2a", align: "center", baseline: "middle", font: "Courier Prime", italic: false, weight: 400 });
      }
      return { W: pw, H: ph, ap: { x: side, y: top, w: iw, h: ih }, apR: 0.6, paper: { x: 0, y: 0, w: pw, h: ph }, paperR: 1.4, overlay: ov };
    }
    case "contact-sheet": {
      // a strip of 35mm frames contact-printed on paper; the chosen frame is marked with grease pencil
      const st = stripDesign({ ...s, border: { ...b } } as Settings, 36, 24, true, false);
      const pad = 8, frames = 3, pitch = 38;
      const stripLen = pitch * frames + 4;
      const W = stripLen + pad * 2, H = 35 + pad * 2 + 10;
      const sy = pad;
      const sx = pad;
      const mid = Math.floor(frames / 2);
      const ap: Rect = { x: sx + 2 + mid * pitch + 1, y: sy + 5.5, w: 36, h: 24 };
      const neighbours: Rect[] = [];
      for (let i = 0; i < frames; i++) if (i !== mid) neighbours.push({ x: sx + 2 + i * pitch + 1, y: sy + 5.5, w: 36, h: 24 });
      const ov: OverlayItem[] = [];
      if (b.showText) {
        for (let i = 0; i < frames; i++) {
          const num = b.frameNumber - mid + i;
          ov.push({ kind: "text", text: `${num}`, x: sx + 2 + i * pitch + 19, y: sy + 35 - 1.05, size: 1.5, color: "#d9d9d9", align: "center", baseline: "middle", font: "Space Mono", weight: 700 });
          ov.push({ kind: "text", text: `${num}A`, x: sx + 2 + i * pitch + 31, y: sy + 35 - 1.05, size: 1.5, color: "#d9d9d9", align: "center", baseline: "middle", font: "Space Mono", weight: 700 });
        }
        ov.push({ kind: "text", text: edgeText(s), x: sx + 6, y: sy + 1.05, size: 1.5, color: "#d9d9d9", align: "left", baseline: "middle", font: "Space Mono", weight: 700, letterSpacing: 0.25 });
        ov.push({ kind: "text", text: `ROLL ${String(b.seed).padStart(3, "0")}`, x: pad, y: H - 5, size: 3, color: "#333333", align: "left", baseline: "middle", font: "Courier Prime" });
      }
      ov.push({ kind: "rect", x: ap.x - 1.2, y: ap.y - 1.2, w: 38.4, h: 26.4, color: "#d4202a", lineWidth: 0.55, wobble: 0.5, seed: b.seed });
      return {
        W, H, ap, apR: 0.45, paper: { x: sx, y: sy, w: stripLen, h: 35 }, paperR: 0,
        spr: { ...st.spr!, axis: 0, phase: sx + 2, rowA: sy + 3.4, rowB: sy + 35 - 3.4 },
        overlay: ov, neighbours,
      };
    }
    case "slide-mount": {
      const M = 50;
      const [aw, ah] = land ? [35, 23] : [23, 35];
      const ap: Rect = { x: (M - aw) / 2, y: (M - ah) / 2, w: aw, h: ah };
      const ov: OverlayItem[] = [];
      if (b.showText) {
        const t = edgeText(s).replace("400", "CHROME");
        if (land) {
          ov.push({ kind: "text", text: t, x: M / 2, y: ap.y / 2, size: 2.4, color: "#3a3a3a", align: "center", baseline: "middle", font: "Inter", weight: 600, letterSpacing: 0.4 });
          ov.push({ kind: "text", text: `${b.frameNumber}  ·  ${s.dateStamp.text.replace(/'/g, "")}`, x: M / 2, y: M - ap.y / 2, size: 2.1, color: "#3a3a3a", align: "center", baseline: "middle", font: "Courier Prime" });
        } else {
          ov.push({ kind: "text", text: t, x: ap.x / 2, y: M / 2, size: 2.4, color: "#3a3a3a", align: "center", baseline: "middle", rotation: -Math.PI / 2, font: "Inter", weight: 600, letterSpacing: 0.4 });
        }
      }
      return { W: M, H: M, ap, apR: 1.1, paper: { x: 0, y: 0, w: M, h: M }, paperR: 2.2, overlay: ov };
    }
    case "scan-negative": {
      const st = land ? stripDesign(s, 36, 24, true, false) : stripDesign(s, 36, 24, false, false);
      // scanner carrier: dark holder around a strip that is a little narrower than the canvas
      const pad = 3;
      const W = st.W + (land ? 0 : pad * 2), H = st.H + (land ? pad * 2 : 0);
      const dx = land ? 0 : pad, dy = land ? pad : 0;
      const sh = (r: Rect): Rect => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
      return {
        W, H, ap: sh(st.ap), apR: 0.6, paper: sh(st.paper), paperR: 0,
        spr: { ...st.spr!, rowA: st.spr!.rowA + (land ? dy : dx), rowB: st.spr!.rowB + (land ? dy : dx), phase: st.spr!.phase + (land ? dx : dy) },
        overlay: st.overlay.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy })),
      };
    }
    case "torn":
    case "paper": {
      const short = 100;
      const apW = land ? short * aspect : short, apH = land ? short : short / aspect;
      const m = (Math.max(b.size, 1) / 100) * short;
      const outer = m * 1.5;
      return {
        W: apW + 2 * (m + outer), H: apH + 2 * (m + outer),
        ap: { x: m + outer, y: m + outer, w: apW, h: apH }, apR: 0,
        paper: { x: outer, y: outer, w: apW + 2 * m, h: apH + 2 * m }, paperR: 0, overlay: [],
      };
    }
  }
  return null;
}

function parseRatio(r: string): number | null {
  if (!r || r === "original") return null;
  const m = r.split(":").map(Number);
  if (m.length === 2 && m[0] > 0 && m[1] > 0) return m[0] / m[1];
  return null;
}

/**
 * @param srcW source width (px), @param srcH source height
 * @param targetLong optional output long edge for the whole canvas; default keeps the photo at native resolution
 */
export function computeLayout(s: Settings, srcW: number, srcH: number, targetLong?: number): Layout {
  const aspect = srcW / srcH;
  const d = design(s, aspect);
  let W: number, H: number, ap: Rect, apR = 0, paper: Rect, paperR = 0;
  let overlay: OverlayItem[] = [];
  let neighbours: Rect[] = [];
  let spr: MmDesign["spr"];
  if (!d) {
    W = srcW; H = srcH; ap = { x: 0, y: 0, w: W, h: H }; paper = { ...ap };
  } else {
    ({ W, H, ap, apR, paper, paperR, overlay, spr } = d);
    neighbours = d.neighbours ?? [];
  }
  // canvas ratio: extend with background colour
  const want = parseRatio(s.border.ratio);
  let ox = 0, oy = 0;
  if (want && s.border.type !== "none") {
    const cur = W / H;
    if (want > cur) { const nW = H * want; ox = (nW - W) / 2; W = nW; }
    else if (want < cur) { const nH = W / want; oy = (nH - H) / 2; H = nH; }
  } else if (want && s.border.type === "none") {
    // ratio without border: pad with plain colour
    const cur = W / H;
    if (want > cur) { const nW = H * want; ox = (nW - W) / 2; W = nW; }
    else if (want < cur) { const nH = W / want; oy = (nH - H) / 2; H = nH; }
  }
  // scale to px: photo aperture keeps native resolution on its limiting axis
  const apAspect = ap.w / ap.h;
  // crop source to aperture aspect (cover)
  let crop: Rect = { x: 0, y: 0, w: 1, h: 1 };
  if (Math.abs(apAspect - aspect) > 1e-4) {
    if (apAspect > aspect) { const h = aspect / apAspect; crop = { x: 0, y: (1 - h) / 2, w: 1, h }; }
    else { const w = apAspect / aspect; crop = { x: (1 - w) / 2, y: 0, w, h: 1 }; }
  }
  const nativePxPerUnit = Math.min((srcW * crop.w) / ap.w, (srcH * crop.h) / ap.h);
  let k = nativePxPerUnit;
  if (targetLong) k = targetLong / Math.max(W, H);
  const px = (r: Rect): Rect => ({ x: (r.x + ox) * k, y: (r.y + oy) * k, w: r.w * k, h: r.h * k });
  const canvasW = Math.max(1, Math.round(W * k)), canvasH = Math.max(1, Math.round(H * k));
  const mmScale = d ? k : 0;
  return {
    canvasW, canvasH,
    aperture: px(ap), apRadius: apR * k, srcCrop: crop, pxPerMm: mmScale,
    borderId: BORDER_IDS[s.border.type] ?? 0,
    paper: px(paper), paperRadius: paperR * k,
    sprocket: spr
      ? { on: true, axis: spr.axis, pitch: spr.pitch * k, w: spr.w * k, h: spr.h * k, r: spr.r * k, rowA: (spr.rowA + (spr.axis === 0 ? oy : ox)) * k, rowB: (spr.rowB + (spr.axis === 0 ? oy : ox)) * k, phase: (spr.phase + (spr.axis === 0 ? ox : oy)) * k }
      : { on: false, axis: 0, pitch: 1, w: 0, h: 0, r: 0, rowA: 0, rowB: 0, phase: 0 },
    overlay: overlay.map((o) => ({
      ...o, x: (o.x + ox) * k, y: (o.y + oy) * k, w: o.w !== undefined ? o.w * k : undefined, h: o.h !== undefined ? o.h * k : undefined,
      size: o.size !== undefined ? o.size * k : undefined, letterSpacing: o.letterSpacing !== undefined ? o.letterSpacing * k : undefined,
      lineWidth: o.lineWidth !== undefined ? o.lineWidth * k : undefined, wobble: o.wobble !== undefined ? o.wobble * k : undefined,
      color: hex(o.color),
    })),
    neighbours: neighbours.map(px),
  };
}
