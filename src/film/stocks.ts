// Film stock library. All names are this app's own; the looks are modelled on the
// general character of classic emulsions, not copied from any app's presets.
import type { Mat3, Vec3 } from "./color";
import { compileStock, type CompiledStock, type StockDef } from "./model";

const SENS_NEUTRAL: Mat3 = [0.92, 0.08, 0.0, 0.05, 0.9, 0.05, 0.0, 0.08, 0.92];
const SENS_KODAK: Mat3 = [0.88, 0.12, 0.0, 0.06, 0.86, 0.08, 0.0, 0.1, 0.9];
const SENS_FUJI: Mat3 = [0.9, 0.1, 0.0, 0.03, 0.92, 0.05, 0.0, 0.14, 0.86];
const PAN: Mat3 = [0.27, 0.55, 0.18, 0, 0, 0, 0, 0, 0];
const ORTHO_ISH: Mat3 = [0.2, 0.58, 0.22, 0, 0, 0, 0, 0, 0];
const HAL_RED: { strength: number; color: Vec3 } = { strength: 1, color: [1.0, 0.28, 0.04] };

function neg(p: Partial<StockDef> & Pick<StockDef, "id" | "name" | "iso" | "description">): StockDef {
  return {
    kind: "color",
    sens: SENS_NEUTRAL,
    gamma: [0.6, 0.6, 0.6],
    toe: [-1.0, -1.0, -1.0],
    shoulder: [2.4, 2.4, 2.4],
    toeSoft: 0.2,
    shoulderSoft: 0.45,
    coupling: 0.15,
    printGamma: 2.05,
    printRange: 2.3,
    printToeSoft: 0.2,
    printShoulderSoft: 0.24,
    grain: { um: 13, rough: 0.4, soft: 0.85 },
    halation: HAL_RED,
    ...p,
  };
}

export const STOCKS: StockDef[] = [
  neg({
    id: "everyday-400", name: "Everyday 400", iso: 400,
    description: "Kodak-style consumer 400 colour negative: warm golden highlights, punchy saturation, cyan-green shadow crossover, visible grain.",
    sens: SENS_KODAK, gamma: [0.67, 0.64, 0.61], toe: [-0.93, -1.0, -1.06], shoulder: [2.3, 2.36, 2.18],
    coupling: 0.24, printGamma: 2.15, grain: { rms: 13, um: 16, rough: 0.5, soft: 0.8, layer: [1.0, 0.95, 1.15] },
  }),
  neg({
    id: "portrait-400", name: "Portrait 400", iso: 400,
    description: "Professional portrait negative: soft contrast, natural warm skin, gentle saturation, huge highlight latitude.",
    sens: SENS_KODAK, gamma: [0.58, 0.6, 0.62], toe: [-1.05, -1.0, -0.96], shoulder: [2.7, 2.65, 2.55],
    coupling: 0.1, printGamma: 1.92, printToeSoft: 0.26, grain: { rms: 11, um: 12, rough: 0.35, soft: 0.88 },
  }),
  neg({
    id: "portrait-160", name: "Portrait 160", iso: 160,
    description: "Fine-grain portrait negative: pastel, low contrast, smooth tonality.",
    sens: SENS_KODAK, gamma: [0.56, 0.57, 0.59], toe: [-1.1, -1.08, -1.02], shoulder: [2.8, 2.75, 2.7],
    coupling: 0.06, printGamma: 1.86, printToeSoft: 0.28, grain: { rms: 8, um: 9, rough: 0.3, soft: 0.9 },
  }),
  neg({
    id: "portrait-800", name: "Portrait 800", iso: 800,
    description: "Fast portrait negative: warm, slightly more contrast and coarser grain.",
    sens: SENS_KODAK, gamma: [0.62, 0.61, 0.6], toe: [-0.95, -0.95, -0.92], shoulder: [2.5, 2.45, 2.35],
    coupling: 0.14, printGamma: 2.0, grain: { rms: 15, um: 19, rough: 0.5, soft: 0.8 },
  }),
  neg({
    id: "gold-200", name: "Gold 200", iso: 200,
    description: "Warm, saturated consumer 200: sunny yellows, rich reds.",
    sens: SENS_KODAK, gamma: [0.66, 0.63, 0.6], toe: [-0.95, -1.0, -1.08], shoulder: [2.3, 2.3, 2.15],
    coupling: 0.22, printGamma: 2.12, printExposure: 0.1, grain: { rms: 10, um: 11, rough: 0.45, soft: 0.85 },
  }),
  neg({
    id: "verde-400", name: "Verde 400", iso: 400,
    description: "Japanese-style consumer 400: cool greens, magenta-leaning skin, cyan shadows.",
    sens: SENS_FUJI, gamma: [0.62, 0.66, 0.62], toe: [-0.96, -1.06, -0.98], shoulder: [2.35, 2.3, 2.3],
    coupling: 0.2, printGamma: 2.1, grain: { rms: 12, um: 15, rough: 0.5, soft: 0.8 },
  }),
  neg({
    id: "cine-500t", name: "Cine 500T", iso: 500,
    description: "Tungsten cine negative: cool in daylight, warm under lamps, low contrast, creamy highlights.",
    sens: [0.8, 0.12, 0.0, 0.05, 0.86, 0.09, 0.0, 0.08, 1.05], gamma: [0.56, 0.57, 0.58],
    toe: [-1.1, -1.08, -1.05], shoulder: [2.8, 2.8, 2.75], coupling: 0.12, printGamma: 2.0,
    grain: { rms: 12, um: 13, rough: 0.4, soft: 0.85 }, halation: { strength: 1.2, color: [1, 0.3, 0.05] },
  }),
  neg({
    id: "cine-800t-halo", name: "Night 800T Halo", iso: 800,
    description: "Tungsten cine stock without anti-halation backing: glowing red halos around every light.",
    sens: [0.82, 0.12, 0.0, 0.05, 0.86, 0.09, 0.0, 0.08, 1.02], gamma: [0.58, 0.58, 0.58],
    toe: [-1.05, -1.05, -1.0], shoulder: [2.6, 2.6, 2.55], coupling: 0.14, printGamma: 2.05,
    grain: { rms: 15, um: 17, rough: 0.5, soft: 0.82 }, halation: { strength: 2.6, color: [1, 0.2, 0.02] },
  }),
  neg({
    id: "cine-250d", name: "Cine 250D", iso: 250,
    description: "Daylight cine negative: neutral, wide latitude, filmic roll-off.",
    gamma: [0.57, 0.57, 0.58], toe: [-1.1, -1.1, -1.08], shoulder: [2.9, 2.9, 2.85], coupling: 0.1,
    printGamma: 2.05, grain: { rms: 9, um: 11, rough: 0.35, soft: 0.88 },
  }),
  neg({
    id: "snapshot-97", name: "Snapshot '97 (Hiromix look)", iso: 400,
    description: "1990s Japanese point-and-shoot: direct on-camera flash, bright and slightly over, almost unreal saturation, cool shadows, snapshot grain. Leaves motion blur untouched.",
    sens: SENS_FUJI, gamma: [0.68, 0.7, 0.64], toe: [-0.9, -1.0, -0.92], shoulder: [2.2, 2.2, 2.1],
    coupling: 0.34, printGamma: 2.2, printExposure: 0.25, grain: { rms: 14, um: 15, rough: 0.55, soft: 0.8 },
    look: { exposure: 0.55, saturation: 0.3, vibrance: 0.2, contrast: 0.12, flash: 0.6 },
  }),
  neg({
    id: "expired-200", name: "Expired 200", iso: 200,
    description: "Long-expired consumer film: base fog, lifted muddy shadows, magenta-cyan shift, low contrast.",
    sens: [0.84, 0.12, 0.04, 0.08, 0.82, 0.1, 0.02, 0.12, 0.86], gamma: [0.5, 0.46, 0.52],
    toe: [-0.7, -0.65, -0.75], shoulder: [2.0, 1.9, 2.0], coupling: -0.05, printGamma: 1.9,
    printRange: 1.9, grain: { rms: 16, um: 18, rough: 0.65, soft: 0.75 },
  }),
  neg({
    id: "cross-100", name: "Cross 100 (slide in C-41)", iso: 100,
    description: "Cross-processed slide film: yellow-green highlights, cyan shadows, harsh contrast.",
    gamma: [0.82, 0.74, 0.52], toe: [-0.8, -0.95, -1.2], shoulder: [1.9, 2.1, 2.5], coupling: 0.32,
    printGamma: 2.3, printRange: 2.4, grain: { rms: 11, um: 10, rough: 0.45, soft: 0.85 },
  }),
  {
    id: "velvet-50", name: "Velvet 50 (slide)", kind: "slide", iso: 50,
    description: "Saturated landscape slide film: deep blacks, vivid greens and blues, tight latitude.",
    sens: [0.93, 0.07, 0, 0.04, 0.9, 0.06, 0, 0.06, 0.94], gamma: [1, 1, 1], toe: [-9, -9, -9], shoulder: [9, 9, 9],
    toeSoft: 0.2, shoulderSoft: 0.2, coupling: 0.0, printGamma: 1.75, printRange: 3.2, printToeSoft: 0.14,
    printShoulderSoft: 0.16, grain: { rms: 8, um: 7, rough: 0.3, soft: 0.9 }, halation: { strength: 0.4, color: [1, 0.35, 0.1] },
    look: { saturation: 0.32, vibrance: 0.1 },
  },
  {
    id: "chrome-100", name: "Chrome 100 (slide)", kind: "slide", iso: 100,
    description: "Neutral-cool E-6 slide: clean whites, crisp contrast, fine grain.",
    sens: [0.92, 0.08, 0, 0.04, 0.9, 0.06, 0, 0.05, 0.95], gamma: [1, 1, 1], toe: [-9, -9, -9], shoulder: [9, 9, 9],
    toeSoft: 0.2, shoulderSoft: 0.2, coupling: 0.0, printGamma: 1.6, printRange: 3.0, printToeSoft: 0.16,
    printShoulderSoft: 0.18, tint: [0.99, 1.0, 1.02], grain: { rms: 8, um: 8, rough: 0.3, soft: 0.9 },
    halation: { strength: 0.4, color: [1, 0.35, 0.1] }, look: { saturation: 0.12 },
  },
  {
    id: "tri-400", name: "Tri 400 (B&W)", kind: "bw", iso: 400,
    description: "Classic 400 B&W: gritty silver grain, strong mid contrast, deep blacks.",
    sens: PAN, gamma: [0.7, 0.7, 0.7], toe: [-0.95, -0.95, -0.95], shoulder: [2.2, 2.2, 2.2], toeSoft: 0.2,
    shoulderSoft: 0.4, coupling: 0, printGamma: 2.2, printRange: 2.4, printToeSoft: 0.18, printShoulderSoft: 0.2,
    tint: [1.0, 0.995, 0.985], grain: { rms: 17, um: 17, rough: 0.6, soft: 0.15 }, halation: { strength: 0.5, color: [1, 1, 1] },
  },
  {
    id: "hp-400", name: "HP 400 (B&W)", kind: "bw", iso: 400,
    description: "Forgiving 400 B&W: softer contrast, open shadows, classic grain.",
    sens: PAN, gamma: [0.62, 0.62, 0.62], toe: [-1.05, -1.05, -1.05], shoulder: [2.5, 2.5, 2.5], toeSoft: 0.22,
    shoulderSoft: 0.45, coupling: 0, printGamma: 2.05, printRange: 2.3, printToeSoft: 0.22, printShoulderSoft: 0.22,
    grain: { rms: 16, um: 16, rough: 0.55, soft: 0.2 }, halation: { strength: 0.5, color: [1, 1, 1] },
  },
  {
    id: "night-3200", name: "Night 3200 (B&W)", kind: "bw", iso: 3200,
    description: "Pushed high-speed B&W: huge grain, crushed blacks, glowing highlights.",
    sens: ORTHO_ISH, gamma: [0.75, 0.75, 0.75], toe: [-0.8, -0.8, -0.8], shoulder: [1.9, 1.9, 1.9], toeSoft: 0.18,
    shoulderSoft: 0.5, coupling: 0, printGamma: 2.3, printRange: 2.5, printToeSoft: 0.2, printShoulderSoft: 0.18,
    grain: { rms: 27, um: 30, rough: 0.8, soft: 0.2 }, halation: { strength: 0.8, color: [1, 1, 1] },
  },
  {
    id: "pan-50", name: "Pan 50 (B&W)", kind: "bw", iso: 50,
    description: "Slow, ultra fine-grain B&W with brilliant contrast.",
    sens: PAN, gamma: [0.78, 0.78, 0.78], toe: [-0.95, -0.95, -0.95], shoulder: [2.0, 2.0, 2.0], toeSoft: 0.16,
    shoulderSoft: 0.35, coupling: 0, printGamma: 2.15, printRange: 2.5, printToeSoft: 0.16, printShoulderSoft: 0.18,
    grain: { rms: 7, um: 6, rough: 0.35, soft: 0.2 }, halation: { strength: 0.3, color: [1, 1, 1] },
  },
  {
    id: "instant-color", name: "Instant Colour", kind: "instant", iso: 640,
    description: "Integral instant film: lifted creamy blacks, warm yellow highlights, cyan shadows, soft contrast.",
    sens: [0.9, 0.1, 0, 0.06, 0.86, 0.08, 0.02, 0.12, 0.86], gamma: [1, 1, 1], toe: [-9, -9, -9], shoulder: [9, 9, 9],
    toeSoft: 0.2, shoulderSoft: 0.2, coupling: 0.0, printGamma: 1.35, printRange: 1.45, printToeSoft: 0.3,
    printShoulderSoft: 0.35, printExposure: 0.15, tint: [1.02, 0.99, 0.9], grain: { rms: 10, um: 9, rough: 0.3, soft: 0.95 },
    halation: { strength: 0.6, color: [1, 0.5, 0.2] }, look: { fade: 0.1, saturation: -0.08 },
  },
  {
    id: "instant-mono", name: "Instant Mono", kind: "instant", iso: 640,
    description: "Instant B&W: silvery, soft, slightly warm-grey blacks.",
    sens: [0.27, 0.55, 0.18, 0.27, 0.55, 0.18, 0.27, 0.55, 0.18], gamma: [1, 1, 1], toe: [-9, -9, -9], shoulder: [9, 9, 9],
    toeSoft: 0.2, shoulderSoft: 0.2, coupling: 0, printGamma: 1.5, printRange: 1.7, printToeSoft: 0.28,
    printShoulderSoft: 0.3, tint: [1.0, 0.985, 0.96], grain: { rms: 10, um: 9, rough: 0.35, soft: 0.6 },
    halation: { strength: 0.5, color: [1, 1, 1] },
  },
];

export const NONE_STOCK = "none";

const cache = new Map<string, CompiledStock>();
export function getStock(id: string): CompiledStock {
  const key = STOCKS.some((s) => s.id === id) ? id : "everyday-400";
  let c = cache.get(key);
  if (!c) {
    c = compileStock(STOCKS.find((s) => s.id === key)!);
    cache.set(key, c);
  }
  return c;
}
