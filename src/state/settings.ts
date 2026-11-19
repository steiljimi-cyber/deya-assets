// Every editable setting. Saved in sidecars, history, snapshots and presets ("edits").
export const SETTINGS_VERSION = 1;

export const HSL_BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
export type HslBand = (typeof HSL_BANDS)[number];
/** OKLCh hue centres (degrees) of the 8 bands. */
export const HSL_CENTERS = [25, 58, 100, 142, 195, 255, 300, 345];

export type CurvePoint = [number, number];
export type BlendMode =
  | "normal" | "multiply" | "screen" | "overlay" | "soft-light" | "hard-light" | "color-dodge" | "color-burn"
  | "darken" | "lighten" | "difference" | "exclusion" | "add" | "subtract" | "linear-burn" | "vivid-light"
  | "linear-light" | "pin-light" | "hard-mix" | "divide" | "hue" | "saturation" | "color" | "luminosity";
export const BLEND_MODES: BlendMode[] = [
  "normal", "darken", "multiply", "color-burn", "linear-burn", "lighten", "screen", "color-dodge", "add",
  "overlay", "soft-light", "hard-light", "vivid-light", "linear-light", "pin-light", "hard-mix",
  "difference", "exclusion", "subtract", "divide", "hue", "saturation", "color", "luminosity",
];

export interface TextureSlot {
  path: string;
  name: string;
  intensity: number; // 0..100
  rotation: number; // degrees 0..360
  blend: BlendMode;
  scale: number; // 50..300 %
  offsetX: number; // -100..100
  offsetY: number;
  flipX: boolean;
  flipY: boolean;
  invert: boolean;
  /** apply to the photo only or the whole canvas including the border */
  area: "photo" | "canvas";
  enabled: boolean;
}

export interface TextLayer {
  text: string;
  font: string;
  weight: number;
  size: number; // % of canvas height
  color: string;
  x: number; // 0..1 of canvas
  y: number;
  rotation: number;
  opacity: number; // 0..100
  blend: BlendMode;
  align: "left" | "center" | "right";
  letterSpacing: number; // em/100
  italic: boolean;
  glow: number; // 0..100
  enabled: boolean;
}

export type BorderType =
  | "none" | "plain" | "35mm" | "120" | "half-frame" | "instant" | "contact-sheet" | "slide-mount"
  | "scan-negative" | "torn" | "paper";

export interface Settings {
  version: number;
  film: { stock: string; intensity: number; format: string; iso: number; isoAuto: boolean };
  light: { exposure: number; contrast: number; highlights: number; shadows: number; whites: number; blacks: number; clarity: number; dehaze: number };
  color: { temperature: number; tint: number; vibrance: number; saturation: number };
  hsl: Record<HslBand, { h: number; s: number; l: number }>;
  curve: { rgb: CurvePoint[]; r: CurvePoint[]; g: CurvePoint[]; b: CurvePoint[] };
  levels: { inBlack: number; inWhite: number; gamma: number; outBlack: number; outWhite: number };
  fade: number;
  grain: { amount: number; size: number; roughness: number; color: number; seed: number };
  halation: { amount: number; spread: number; threshold: number };
  bloom: { amount: number; radius: number; threshold: number };
  softFocus: { amount: number; radius: number };
  vignette: { amount: number; midpoint: number; roundness: number; feather: number };
  fringing: { amount: number };
  motionBlur: { amount: number; angle: number };
  jitter: { amount: number; seed: number };
  lightLeak: { amount: number; style: number; position: number; hue: number; size: number; seed: number };
  dust: { amount: number; scratches: number; hairs: number; size: number; seed: number; mode: "auto" | "white" | "black" };
  dateStamp: { enabled: boolean; text: string; style: "led" | "dot"; color: string; size: number; corner: "br" | "bl" | "tr" | "tl"; glow: number };
  glitch: { amount: number; rgbShift: number; slices: number; blocks: number; scanlines: number; seed: number };
  textures: TextureSlot[];
  texts: TextLayer[];
  border: {
    type: BorderType;
    color: string;
    size: number; // margin, % of short side
    ratio: string; // "original" | "1:1" | "4:5" | ...
    variant: string;
    rebateColor: string;
    bgColor: string;
    textColor: string;
    showText: boolean;
    customText: string;
    frameNumber: number;
    seed: number;
    roundness: number;
  };
}

export const defaultTexture = (path = "", name = ""): TextureSlot => ({
  path, name, intensity: 60, rotation: 0, blend: "screen", scale: 100, offsetX: 0, offsetY: 0,
  flipX: false, flipY: false, invert: false, area: "photo", enabled: true,
});

export const defaultText = (): TextLayer => ({
  text: "Fixer Film Lab", font: "Space Mono", weight: 400, size: 4, color: "#ffffff", x: 0.5, y: 0.5,
  rotation: 0, opacity: 100, blend: "normal", align: "center", letterSpacing: 0, italic: false, glow: 0, enabled: true,
});

const ident = (): CurvePoint[] => [[0, 0], [1, 1]];

function today(): string {
  const d = new Date();
  return `'${String(d.getFullYear()).slice(2)} ${d.getMonth() + 1} ${d.getDate()}`;
}

export function defaultSettings(): Settings {
  const hsl = {} as Settings["hsl"];
  for (const b of HSL_BANDS) hsl[b] = { h: 0, s: 0, l: 0 };
  return {
    version: SETTINGS_VERSION,
    film: { stock: "everyday-400", intensity: 100, format: "35mm", iso: 400, isoAuto: true },
    light: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, clarity: 0, dehaze: 0 },
    color: { temperature: 0, tint: 0, vibrance: 0, saturation: 0 },
    hsl,
    curve: { rgb: ident(), r: ident(), g: ident(), b: ident() },
    levels: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
    fade: 0,
    grain: { amount: 50, size: 50, roughness: 50, color: 40, seed: 1 },
    halation: { amount: 25, spread: 40, threshold: 50 },
    bloom: { amount: 0, radius: 50, threshold: 60 },
    softFocus: { amount: 0, radius: 30 },
    vignette: { amount: 0, midpoint: 50, roundness: 0, feather: 50 },
    fringing: { amount: 0 },
    motionBlur: { amount: 0, angle: 0 },
    jitter: { amount: 0, seed: 1 },
    lightLeak: { amount: 0, style: 0, position: 15, hue: 0, size: 50, seed: 1 },
    dust: { amount: 0, scratches: 0, hairs: 0, size: 50, seed: 1, mode: "auto" },
    dateStamp: { enabled: false, text: today(), style: "led", color: "#ff8a1f", size: 50, corner: "br", glow: 60 },
    glitch: { amount: 0, rgbShift: 50, slices: 50, blocks: 30, scanlines: 20, seed: 1 },
    textures: [],
    texts: [],
    border: {
      type: "none", color: "#ffffff", size: 6, ratio: "original", variant: "", rebateColor: "#0b0b0b", bgColor: "#ffffff",
      textColor: "#f08a2a", showText: true, customText: "FIXER 400", frameNumber: 12, seed: 1, roundness: 50,
    },
  };
}

/** Groups used by presets (scope), copy/paste and sync. */
export const GROUPS: Record<string, (keyof Settings)[]> = {
  "Film stock": ["film"],
  "Light": ["light"],
  "Colour": ["color", "hsl"],
  "Curve & levels": ["curve", "levels"],
  "Fade": ["fade"],
  "Grain": ["grain"],
  "Halation & bloom": ["halation", "bloom", "softFocus"],
  "Vignette & lens": ["vignette", "fringing"],
  "Motion blur": ["motionBlur"],
  "Jitter": ["jitter"],
  "Light leaks": ["lightLeak"],
  "Dust & scratches": ["dust"],
  "Date stamp": ["dateStamp"],
  "Glitch": ["glitch"],
  "Textures": ["textures"],
  "Text": ["texts"],
  "Border": ["border"],
};

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** Fill any missing fields from defaults (older sidecars / partial presets). */
export function normalize(input: Partial<Settings> | undefined): Settings {
  const d = defaultSettings();
  if (!input) return d;
  const out: any = clone(d);
  for (const k of Object.keys(d) as (keyof Settings)[]) {
    const v = (input as any)[k];
    if (v === undefined) continue;
    if (Array.isArray(v)) out[k] = clone(v);
    else if (typeof v === "object" && v !== null) out[k] = deepMerge((d as any)[k], v);
    else out[k] = v;
  }
  out.version = SETTINGS_VERSION;
  out.textures = (out.textures as any[]).map((t) => ({ ...defaultTexture(), ...t }));
  out.texts = (out.texts as any[]).map((t) => ({ ...defaultText(), ...t }));
  return out;
}

function deepMerge(a: any, b: any): any {
  if (Array.isArray(a) || Array.isArray(b)) return clone(b);
  const out: any = { ...a };
  for (const k of Object.keys(b)) {
    out[k] = typeof b[k] === "object" && b[k] !== null && !Array.isArray(b[k]) && typeof a?.[k] === "object" ? deepMerge(a[k], b[k]) : clone(b[k]);
  }
  return out;
}

/** Apply only the given groups of `src` onto `dst`. */
export function applyGroups(dst: Settings, src: Partial<Settings>, groups: string[]): Settings {
  const out = clone(dst);
  for (const g of groups) for (const k of GROUPS[g] ?? []) if ((src as any)[k] !== undefined) (out as any)[k] = clone((src as any)[k]);
  return normalize(out);
}

export function pickGroups(s: Settings, groups: string[]): Partial<Settings> {
  const out: any = { version: SETTINGS_VERSION };
  for (const g of groups) for (const k of GROUPS[g] ?? []) out[k] = clone((s as any)[k]);
  return out;
}
