// Canvas2D vector overlays drawn per tile at the tile's exact output resolution:
// rebate text, frame numbers, DX-style barcodes, grease pencil, user text layers, LED date stamp.
import type { Layout, OverlayItem, Rect } from "./layout";
import type { Settings, TextLayer } from "../state/settings";
import { hash } from "./grain";

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

let cache: { c: OffscreenCanvas | HTMLCanvasElement; w: number; h: number }[] = [];
export function tileCanvas(w: number, h: number, slot: number) {
  let e = cache[slot];
  if (!e || e.w !== w || e.h !== h) {
    e = { c: makeCanvas(w, h), w, h };
    cache[slot] = e;
  }
  // CPU rasteriser for every size: identical anti-aliasing whatever the tile size
  const ctx = e.c.getContext("2d", { willReadFrequently: true }) as Ctx2D;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { canvas: e.c, ctx };
}

function font(o: { size?: number; font?: string; weight?: number; italic?: boolean }) {
  return `${o.italic ? "italic " : ""}${o.weight ?? 400} ${Math.max(0.5, o.size ?? 12)}px "${o.font ?? "Space Mono"}", "Helvetica Neue", Arial, sans-serif`;
}

function drawText(ctx: Ctx2D, o: OverlayItem) {
  ctx.save();
  ctx.translate(o.x, o.y);
  if (o.rotation) ctx.rotate(o.rotation);
  ctx.font = font(o);
  ctx.fillStyle = o.color;
  ctx.globalAlpha = o.opacity ?? 1;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = o.baseline ?? "alphabetic";
  if ("letterSpacing" in ctx) (ctx as any).letterSpacing = `${o.letterSpacing ?? 0}px`;
  if (o.glow) {
    ctx.shadowColor = o.color;
    ctx.shadowBlur = (o.size ?? 10) * 0.6 * o.glow;
  }
  ctx.fillText(o.text ?? "", 0, 0);
  ctx.restore();
}

function drawBarcode(ctx: Ctx2D, o: OverlayItem) {
  ctx.save();
  ctx.fillStyle = o.color;
  let s = hash(o.seed ?? 1);
  const w = o.w ?? 10, h = o.h ?? 2;
  let x = o.x;
  const unit = w / 60;
  while (x < o.x + w) {
    s = hash(s + 1);
    const bw = unit * (1 + (s % 3));
    if (s & 8) ctx.fillRect(x, o.y, bw, h);
    x += bw + unit;
  }
  ctx.restore();
}

function drawWobbleRect(ctx: Ctx2D, o: OverlayItem) {
  ctx.save();
  ctx.strokeStyle = o.color;
  ctx.lineWidth = o.lineWidth ?? 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.88;
  let s = hash(o.seed ?? 7);
  const r = () => { s = hash(s + 0x9e37); return s / 4294967296 - 0.5; };
  const wob = o.wobble ?? 0;
  const pts: [number, number][] = [[o.x, o.y], [o.x + o.w!, o.y], [o.x + o.w!, o.y + o.h!], [o.x, o.y + o.h!], [o.x, o.y]];
  ctx.beginPath();
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const n = 8;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = ax + (bx - ax) * t + r() * wob, y = ay + (by - ay) * t + r() * wob;
      if (i === 0 && k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }
  // overshoot like a real grease pencil stroke
  ctx.lineTo(o.x + (o.w! * 0.08), o.y + r() * wob);
  ctx.stroke();
  ctx.restore();
}

export function drawItems(ctx: Ctx2D, items: OverlayItem[]) {
  for (const o of items) {
    if (o.kind === "text") drawText(ctx, o);
    else if (o.kind === "barcode") drawBarcode(ctx, o);
    else if (o.kind === "rect") drawWobbleRect(ctx, o);
  }
}

export function textLayerItems(texts: TextLayer[], layout: Layout): OverlayItem[] {
  return texts.filter((t) => t.enabled && t.text).map((t) => ({
    kind: "text" as const,
    text: t.text,
    x: t.x * layout.canvasW,
    y: t.y * layout.canvasH,
    size: (t.size / 100) * layout.canvasH,
    font: t.font,
    weight: t.weight,
    italic: t.italic,
    color: t.color,
    align: t.align,
    baseline: "middle" as CanvasTextBaseline,
    rotation: (t.rotation * Math.PI) / 180,
    letterSpacing: (t.letterSpacing / 100) * (t.size / 100) * layout.canvasH,
    opacity: t.opacity / 100,
    glow: t.glow / 100,
  }));
}

// ---- LED 7-segment date stamp ----
const SEG: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc",
  "8": "abcdefg", "9": "abcdfg", "-": "g", " ": "", "'": "'", ".": ".",
};

function drawSegments(ctx: Ctx2D, ch: string, x: number, y: number, h: number) {
  const w = h * 0.55, t = h * 0.12, sk = h * 0.1;
  const P = (px: number, py: number): [number, number] => [x + px + (h - py) / h * sk, y + py];
  const bar = (x0: number, y0: number, x1: number, y1: number) => {
    const horiz = Math.abs(y1 - y0) < 1e-6;
    const pts: [number, number][] = horiz
      ? [[x0 + t * 0.5, y0], [x0 + t, y0 - t / 2], [x1 - t, y0 - t / 2], [x1 - t * 0.5, y0], [x1 - t, y0 + t / 2], [x0 + t, y0 + t / 2]]
      : [[x0, y0 + t * 0.5], [x0 + t / 2, y0 + t], [x0 + t / 2, y1 - t], [x0, y1 - t * 0.5], [x0 - t / 2, y1 - t], [x0 - t / 2, y0 + t]];
    ctx.beginPath();
    pts.forEach(([px, py], i) => { const [a, b] = P(px, py); if (i === 0) ctx.moveTo(a, b); else ctx.lineTo(a, b); });
    ctx.closePath();
    ctx.fill();
  };
  const segs = SEG[ch] ?? "";
  const m = h / 2;
  if (segs.includes("a")) bar(0, 0, w, 0);
  if (segs.includes("b")) bar(w, 0, w, m);
  if (segs.includes("c")) bar(w, m, w, h);
  if (segs.includes("d")) bar(0, h, w, h);
  if (segs.includes("e")) bar(0, m, 0, h);
  if (segs.includes("f")) bar(0, 0, 0, m);
  if (segs.includes("g")) bar(0, m, w, m);
  if (segs === "'") { const [a, b] = P(w * 0.4, 0); ctx.fillRect(a, b, t, h * 0.3); }
  if (segs === ".") { const [a, b] = P(w * 0.4, h - t); ctx.fillRect(a, b, t, t); }
  return segs === "'" || segs === "." ? w * 0.6 : w + h * 0.28;
}

export function dateStampWidth(text: string, h: number) {
  let wsum = 0;
  for (const ch of text) wsum += ch === "'" || ch === "." ? h * 0.55 * 0.6 : ch === " " ? h * 0.5 : h * 0.55 + h * 0.28;
  return wsum;
}

export function drawDateStamp(ctx: Ctx2D, s: Settings, ap: Rect) {
  const d = s.dateStamp;
  if (!d.enabled || !d.text) return;
  const short = Math.min(ap.w, ap.h);
  const h = short * (0.02 + 0.03 * (d.size / 100));
  const margin = short * 0.05;
  const tw = dateStampWidth(d.text, h);
  const right = d.corner.endsWith("r");
  const bottom = d.corner.startsWith("b");
  let x = right ? ap.x + ap.w - margin - tw : ap.x + margin;
  const y = bottom ? ap.y + ap.h - margin - h : ap.y + margin;
  ctx.save();
  ctx.fillStyle = d.color;
  const passes = d.glow > 0 ? 2 : 1;
  for (let p = 0; p < passes; p++) {
    let xx = x;
    if (p === 0 && d.glow > 0) { ctx.shadowColor = d.color; ctx.shadowBlur = h * 0.5 * (d.glow / 100); ctx.globalAlpha = 0.9; }
    else { ctx.shadowBlur = 0; ctx.globalAlpha = 1; }
    for (const ch of d.text) {
      if (ch === " ") { xx += h * 0.5; continue; }
      if (d.style === "dot") {
        ctx.font = `${h * 1.25}px "VT323", monospace`;
        ctx.textBaseline = "top";
        ctx.fillText(ch, xx, y - h * 0.12);
        xx += h * 0.62;
      } else xx += drawSegments(ctx, ch, xx, y, h);
    }
  }
  ctx.restore();
  x = 0;
}

// ---- sprites: each overlay element is rasterised once, then copied into tiles at integer offsets ----
// Canvas2D output (anti-aliasing, glow) can depend on the size of the canvas it is drawn into, so
// drawing straight into tiles of different sizes would differ at edges. Copying a pre-rendered
// sprite with drawImage at an integer offset is an exact pixel copy: seamless for any tiling.
interface Sprite { c: OffscreenCanvas | HTMLCanvasElement; x: number; y: number; w: number; h: number }
const spriteCache = new Map<string, Sprite[]>();
let measureCtx: Ctx2D | null = null;

function bboxOf(o: OverlayItem): Rect {
  if (o.kind === "barcode") return { x: o.x, y: o.y, w: o.w ?? 0, h: o.h ?? 0 };
  if (o.kind === "rect") { const m = (o.lineWidth ?? 2) + (o.wobble ?? 0) * 2 + (o.w ?? 0) * 0.1; return { x: o.x - m, y: o.y - m, w: (o.w ?? 0) + 2 * m, h: (o.h ?? 0) + 2 * m }; }
  if (!measureCtx) measureCtx = (makeCanvas(8, 8).getContext("2d") as Ctx2D);
  const ctx = measureCtx;
  ctx.font = font(o);
  if ("letterSpacing" in ctx) (ctx as any).letterSpacing = `${o.letterSpacing ?? 0}px`;
  const size = o.size ?? 12;
  const tw = ctx.measureText(o.text ?? "").width + Math.abs(o.letterSpacing ?? 0) * 2;
  const al = o.align ?? "left";
  const x0 = al === "center" ? -tw / 2 : al === "right" || al === "end" ? -tw : 0;
  const pad = size * 0.6 + (o.glow ? size * 0.6 * o.glow * 2 : 0);
  const pts = [[x0 - pad, -size * 1.2 - pad], [x0 + tw + pad, -size * 1.2 - pad], [x0 + tw + pad, size * 1.2 + pad], [x0 - pad, size * 1.2 + pad]];
  const r = o.rotation ?? 0, c = Math.cos(r), sn = Math.sin(r);
  const xs = pts.map(([px, py]) => o.x + c * px - sn * py), ys = pts.map(([px, py]) => o.y + sn * px + c * py);
  const minx = Math.min(...xs), miny = Math.min(...ys);
  return { x: minx, y: miny, w: Math.max(...xs) - minx, h: Math.max(...ys) - miny };
}

function sprite(b: Rect, k: number, draw: (ctx: Ctx2D) => void): Sprite | null {
  const x = Math.floor(b.x / k), y = Math.floor(b.y / k);
  const w = Math.ceil((b.x + b.w) / k) - x, h = Math.ceil((b.y + b.h) / k) - y;
  if (w <= 0 || h <= 0 || w * h > 120e6) return null;
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true }) as Ctx2D;
  ctx.setTransform(1 / k, 0, 0, 1 / k, -x, -y);
  draw(ctx);
  return { c, x, y, w, h };
}

function sprites(key: string, build: () => Sprite[]): Sprite[] {
  let v = spriteCache.get(key);
  if (!v) {
    if (spriteCache.size > 8) spriteCache.clear();
    v = build();
    spriteCache.set(key, v);
  }
  return v;
}

function compose(list: Sprite[], region: Rect, k: number, tw: number, th: number, slot: number) {
  const tx = Math.round(region.x / k), ty = Math.round(region.y / k);
  const hit = list.filter((s) => s.x < tx + tw && s.x + s.w > tx && s.y < ty + th && s.y + s.h > ty);
  if (!hit.length) return null;
  const { canvas, ctx } = tileCanvas(tw, th, slot);
  for (const s of hit) ctx.drawImage(s.c as any, s.x - tx, s.y - ty);
  return { canvas, margin: 0 };
}

/** The tile's post overlay (border art + text layers), or null when nothing touches the tile. */
export function renderPostOverlay(layout: Layout, s: Settings, region: Rect, k: number, tw: number, th: number) {
  const items = [...layout.overlay, ...textLayerItems(s.texts, layout)];
  if (!items.length) return null;
  const list = sprites(JSON.stringify(["post", items, k]), () =>
    items.map((it) => sprite(bboxOf(it), k, (ctx) => drawItems(ctx, [it]))).filter((x): x is Sprite => !!x));
  return compose(list, region, k, tw, th, 0);
}

/** The date stamp, exposed onto the film in the main pass. */
export function renderPreOverlay(layout: Layout, s: Settings, region: Rect, k: number, tw: number, th: number) {
  if (!s.dateStamp.enabled || !s.dateStamp.text) return null;
  const list = sprites(JSON.stringify(["pre", s.dateStamp, layout.aperture, k]), () => {
    const ap = layout.aperture;
    const d = s.dateStamp;
    const short = Math.min(ap.w, ap.h);
    const h = short * (0.02 + 0.03 * (d.size / 100));
    const pad = h * 0.5 * (d.glow / 100) * 3 + h * 0.4;
    const margin = short * 0.05;
    const tw2 = dateStampWidth(d.text, h);
    const right = d.corner.endsWith("r"), bottom = d.corner.startsWith("b");
    const x = right ? ap.x + ap.w - margin - tw2 : ap.x + margin;
    const y = bottom ? ap.y + ap.h - margin - h : ap.y + margin;
    const sp = sprite({ x: x - pad, y: y - pad, w: tw2 + 2 * pad, h: h + 2 * pad }, k, (ctx) => drawDateStamp(ctx, s, ap));
    return sp ? [sp] : [];
  });
  return compose(list, region, k, tw, th, 1);
}
