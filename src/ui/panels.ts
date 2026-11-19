// Right-hand editing panels, declared as data and bound to settings paths.
import { h, slider, select, toggle, colorInput, textInput, section, button, type Binding } from "./controls";
import { curveEditor } from "./curve";
import { STOCKS } from "../film/stocks";
import { BLEND_MODES, HSL_BANDS, defaultSettings, defaultText, type CurvePoint, type Settings } from "../state/settings";

export interface PanelHost extends Binding {
  settings(): Settings;
  replace(mut: (s: Settings) => void, label: string): void;
  rebuild(): void;
  addTextureFromFile(): void;
  showTextures(): void;
}

const pct = (v: number) => `${Math.round(v)}`;
const sgn = (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`);
const blendOpts = BLEND_MODES.map((m) => [m, m.replace(/-/g, " ")] as [string, string]);

export function buildPanels(H: PanelHost): HTMLElement[] {
  const S = (path: string, label: string, min: number, max: number, extra: Partial<Parameters<typeof slider>[1]> = {}) =>
    slider(H, { path, label, min, max, fmt: min < 0 ? sgn : pct, ...extra });
  const resetGroup = (keys: (keyof Settings)[]) => () => H.replace((s) => { const d = defaultSettings(); for (const k of keys) (s as any)[k] = (d as any)[k]; }, "Reset");
  const s = H.settings();

  const stockOpts: [string, string][] = [["none", "No film (digital)"]];
  for (const kind of ["color", "slide", "bw", "instant"] as const) for (const st of STOCKS.filter((x) => x.kind === kind)) stockOpts.push([st.id, st.name]);
  const desc = h("div", { class: "hint stock-desc" });
  const updDesc = () => { desc.textContent = STOCKS.find((x) => x.id === H.settings().film.stock)?.description ?? "Clean digital rendering: grain and effects still apply."; };
  updDesc();

  const out: HTMLElement[] = [];
  out.push(section("Film stock", [
    select(H, { label: "Stock", path: "film.stock", options: stockOpts, onChange: updDesc }), desc,
    S("film.intensity", "Intensity", 0, 100, { def: 100 }),
    select(H, { label: "Format", path: "film.format", options: [["35mm", "35mm"], ["half", "Half-frame"], ["120", "120 medium format"], ["4x5", "4x5 large format"], ["instant", "Instant"], ["110", "110 pocket"]] }),
    toggle(H, { label: "ISO from stock (box speed)", path: "film.isoAuto" }),
    S("film.iso", "ISO / push", 25, 6400, { step: 25, def: 400 }),
  ], { open: true, id: "film", onReset: resetGroup(["film"]) }));

  out.push(section("Light", [
    S("light.exposure", "Exposure", -5, 5, { step: 0.01, fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(2) }),
    S("light.contrast", "Contrast", -100, 100), S("light.highlights", "Highlights", -100, 100), S("light.shadows", "Shadows", -100, 100),
    S("light.whites", "Whites", -100, 100), S("light.blacks", "Blacks", -100, 100), S("light.clarity", "Clarity", -100, 100), S("light.dehaze", "Dehaze", -100, 100),
  ], { open: true, id: "light", onReset: resetGroup(["light"]) }));

  out.push(section("Colour", [
    S("color.temperature", "White balance", -100, 100), S("color.tint", "Tint", -100, 100),
    S("color.vibrance", "Vibrance", -100, 100), S("color.saturation", "Saturation", -100, 100),
  ], { open: true, id: "color", onReset: resetGroup(["color"]) }));

  // HSL: 8 bands, hue / saturation / luminance tabs
  const hslBody = h("div", { class: "hsl" });
  const hslTabs = h("div", { class: "tabs small" });
  const swatch: Record<string, string> = { red: "#d64545", orange: "#e08a35", yellow: "#d8c23a", green: "#4fae4f", aqua: "#3fb7b0", blue: "#4a74d8", purple: "#8a55d0", magenta: "#cf4fa6" };
  const mkHsl = (k: "h" | "s" | "l") => {
    hslBody.innerHTML = "";
    for (const b of HSL_BANDS) {
      const el = S(`hsl.${b}.${k}`, b[0].toUpperCase() + b.slice(1), -100, 100);
      el.style.setProperty("--sw", swatch[b]);
      el.classList.add("hsl-band");
      hslBody.append(el);
    }
  };
  (["h", "s", "l"] as const).forEach((k, i) => {
    const t = h("button", { class: i === 0 ? "on" : "", onclick: () => { hslTabs.querySelectorAll("button").forEach((x) => x.classList.remove("on")); t.classList.add("on"); mkHsl(k); } }, ["Hue", "Saturation", "Luminance"][i]);
    hslTabs.append(t);
  });
  mkHsl("h");
  out.push(section("HSL (8 bands)", [hslTabs, hslBody], { id: "hsl", onReset: resetGroup(["hsl"]) }));

  out.push(section("Tone curve", [curveEditor(() => H.settings(), (ch, pts: CurvePoint[], live) => H.set(`curve.${ch}`, pts, live, "Tone curve"))], { id: "curve", onReset: resetGroup(["curve"]) }));
  out.push(section("Levels", [
    S("levels.inBlack", "Input black", 0, 254, { def: 0 }), S("levels.inWhite", "Input white", 1, 255, { def: 255 }),
    S("levels.gamma", "Gamma", 0.1, 4, { step: 0.01, def: 1, fmt: (v) => v.toFixed(2) }),
    S("levels.outBlack", "Output black", 0, 255, { def: 0 }), S("levels.outWhite", "Output white", 0, 255, { def: 255 }),
  ], { id: "levels", onReset: resetGroup(["levels"]) }));
  out.push(section("Fade", [S("fade", "Fade", 0, 100)], { id: "fade", open: true, onReset: resetGroup(["fade"]) }));

  out.push(section("Grain", [
    S("grain.amount", "Amount", 0, 100, { def: 50 }), S("grain.size", "Size", 0, 100, { def: 50 }),
    S("grain.roughness", "Roughness", 0, 100, { def: 50 }), S("grain.color", "Colour", 0, 100, { def: 40 }),
    h("div", { class: "row" }, h("label", {}, "Pattern"), button("New seed", () => H.set("grain.seed", (H.get("grain.seed") as number) + 1, false, "Grain seed"))),
    h("div", { class: "hint" }, "Silver/dye grain simulated at output resolution per colour layer. 50 = the stock\u2019s real granularity, 100 = 4x. Check it at 100% (Z)."),
  ], { open: true, id: "grain", onReset: resetGroup(["grain"]) }));

  out.push(section("Halation · bloom · soft focus", [
    S("halation.amount", "Halation", 0, 100, { def: 25 }), S("halation.spread", "Halation spread", 0, 100, { def: 40 }), S("halation.threshold", "Halation threshold", 0, 100, { def: 50 }),
    S("bloom.amount", "Bloom", 0, 100), S("bloom.radius", "Bloom radius", 0, 100, { def: 50 }), S("bloom.threshold", "Bloom threshold", 0, 100, { def: 60 }),
    S("softFocus.amount", "Soft focus", 0, 100), S("softFocus.radius", "Soft focus radius", 0, 100, { def: 30 }),
  ], { open: true, id: "halation", onReset: resetGroup(["halation", "bloom", "softFocus"]) }));

  out.push(section("Vignette · lens", [
    S("vignette.amount", "Vignette", -100, 100), S("vignette.midpoint", "Midpoint", 0, 100, { def: 50 }),
    S("vignette.roundness", "Roundness", -100, 100), S("vignette.feather", "Feather", 0, 100, { def: 50 }),
    S("fringing.amount", "Chromatic fringing", 0, 100),
  ], { id: "vignette", open: true, onReset: resetGroup(["vignette", "fringing"]) }));

  out.push(section("Motion blur · jitter", [
    S("motionBlur.amount", "Motion blur", 0, 100), S("motionBlur.angle", "Angle", 0, 180, { fmt: (v) => `${Math.round(v)}°` }),
    S("jitter.amount", "Frame jitter", 0, 100),
    h("div", { class: "row" }, h("label", {}, "Jitter"), button("Shuffle", () => H.set("jitter.seed", (H.get("jitter.seed") as number) + 1, false, "Jitter seed"))),
  ], { id: "motion", open: true, onReset: resetGroup(["motionBlur", "jitter"]) }));

  out.push(section("Light leaks", [
    S("lightLeak.amount", "Amount", 0, 100),
    select(H, { label: "Style", path: "lightLeak.style", options: [["0", "Edge burn"], ["1", "Corner flare"], ["2", "Back-door stripe"], ["3", "Fog"]] }),
    S("lightLeak.position", "Position", 0, 100, { def: 15 }), S("lightLeak.size", "Size", 0, 100, { def: 50 }), S("lightLeak.hue", "Hue", -100, 100),
    h("div", { class: "row" }, h("label", {}, "Shape"), button("Shuffle", () => H.set("lightLeak.seed", (H.get("lightLeak.seed") as number) + 1, false, "Leak seed"))),
  ], { id: "leaks", onReset: resetGroup(["lightLeak"]) }));

  out.push(section("Dust · scratches", [
    S("dust.amount", "Dust", 0, 100), S("dust.hairs", "Hairs", 0, 100), S("dust.scratches", "Scratches", 0, 100), S("dust.size", "Size", 0, 100, { def: 50 }),
    select(H, { label: "Shows as", path: "dust.mode", options: [["auto", "Auto (from stock)"], ["white", "White (negative)"], ["black", "Black (slide)"]] }),
    h("div", { class: "row" }, h("label", {}, "Pattern"), button("Shuffle", () => H.set("dust.seed", (H.get("dust.seed") as number) + 1, false, "Dust seed"))),
  ], { id: "dust", onReset: resetGroup(["dust"]) }));

  out.push(section("Date stamp", [
    toggle(H, { label: "Show date stamp", path: "dateStamp.enabled" }), textInput(H, { label: "Text", path: "dateStamp.text" }),
    select(H, { label: "Style", path: "dateStamp.style", options: [["led", "7-segment LED"], ["dot", "Dot matrix"]] }),
    colorInput(H, { label: "Colour", path: "dateStamp.color" }), S("dateStamp.size", "Size", 0, 100, { def: 50 }), S("dateStamp.glow", "Glow", 0, 100, { def: 60 }),
    select(H, { label: "Corner", path: "dateStamp.corner", options: [["br", "Bottom right"], ["bl", "Bottom left"], ["tr", "Top right"], ["tl", "Top left"]] }),
  ], { id: "date", onReset: resetGroup(["dateStamp"]) }));

  out.push(section("Glitch", [
    S("glitch.amount", "Amount", 0, 100), S("glitch.rgbShift", "RGB split", 0, 100, { def: 50 }), S("glitch.slices", "Slices", 0, 100, { def: 50 }),
    S("glitch.blocks", "Blocks", 0, 100, { def: 30 }), S("glitch.scanlines", "Scanlines", 0, 100, { def: 20 }),
    h("div", { class: "row" }, h("label", {}, "Pattern"), button("Shuffle", () => H.set("glitch.seed", (H.get("glitch.seed") as number) + 1, false, "Glitch seed"))),
  ], { id: "glitch", onReset: resetGroup(["glitch"]) }));

  // texture slots
  const tex: HTMLElement[] = [];
  s.textures.forEach((t, i) => {
    const p = `textures.${i}`;
    tex.push(h("div", { class: "slot" },
      h("div", { class: "slot-head" }, h("span", { class: "slot-name", title: t.path }, `${i + 1}. ${t.name || "texture"}`),
        button("✕", () => H.replace((x) => { x.textures.splice(i, 1); }, "Remove texture"), { class: "mini", title: "Remove" })),
      toggle(H, { label: "Visible", path: `${p}.enabled` }),
      S(`${p}.intensity`, "Intensity", 0, 100, { def: 60 }), S(`${p}.rotation`, "Rotation", 0, 360, { fmt: (v) => `${Math.round(v)}°` }),
      select(H, { label: "Blend", path: `${p}.blend`, options: blendOpts }),
      S(`${p}.scale`, "Scale", 50, 300, { def: 100 }), S(`${p}.offsetX`, "Offset X", -100, 100), S(`${p}.offsetY`, "Offset Y", -100, 100),
      toggle(H, { label: "Flip horizontal", path: `${p}.flipX` }), toggle(H, { label: "Flip vertical", path: `${p}.flipY` }), toggle(H, { label: "Invert", path: `${p}.invert` }),
      select(H, { label: "Covers", path: `${p}.area`, options: [["photo", "Photo"], ["canvas", "Whole canvas (incl. border)"]] }),
    ));
  });
  out.push(section(`Textures (${s.textures.length})`, [
    ...tex,
    h("div", { class: "row" }, button("+ From library", () => H.showTextures()), button("+ From file…", () => H.addTextureFromFile())),
  ], { id: "textures", open: s.textures.length > 0 }));

  // text layers
  const fonts: [string, string][] = ["Space Mono", "Inter", "DM Serif Display", "VT323", "Courier Prime", "Helvetica Neue", "Georgia", "Futura", "Avenir Next", "Didot", "Menlo"].map((f) => [f, f]);
  const txt: HTMLElement[] = [];
  s.texts.forEach((t, i) => {
    const p = `texts.${i}`;
    txt.push(h("div", { class: "slot" },
      h("div", { class: "slot-head" }, h("span", { class: "slot-name" }, `${i + 1}. ${t.text.slice(0, 24)}`),
        button("✕", () => H.replace((x) => { x.texts.splice(i, 1); }, "Remove text"), { class: "mini" })),
      toggle(H, { label: "Visible", path: `${p}.enabled` }), textInput(H, { label: "Text", path: `${p}.text` }),
      select(H, { label: "Font", path: `${p}.font`, options: fonts }),
      select(H, { label: "Weight", path: `${p}.weight`, options: [["300", "Light"], ["400", "Regular"], ["600", "Semibold"], ["700", "Bold"]] }),
      toggle(H, { label: "Italic", path: `${p}.italic` }), colorInput(H, { label: "Colour", path: `${p}.color` }),
      S(`${p}.size`, "Size", 0.5, 30, { step: 0.1, def: 4, fmt: (v) => v.toFixed(1) }),
      S(`${p}.x`, "X", 0, 1, { step: 0.001, def: 0.5, fmt: (v) => (v * 100).toFixed(1) }), S(`${p}.y`, "Y", 0, 1, { step: 0.001, def: 0.5, fmt: (v) => (v * 100).toFixed(1) }),
      S(`${p}.rotation`, "Rotation", -180, 180, { fmt: (v) => `${Math.round(v)}°` }), S(`${p}.opacity`, "Opacity", 0, 100, { def: 100 }),
      S(`${p}.letterSpacing`, "Letter spacing", -20, 100), S(`${p}.glow`, "Glow", 0, 100),
      select(H, { label: "Align", path: `${p}.align`, options: [["left", "Left"], ["center", "Centre"], ["right", "Right"]] }),
    ));
  });
  out.push(section(`Text (${s.texts.length})`, [...txt, button("+ Add text", () => H.replace((x) => { x.texts.push(defaultText()); }, "Add text"))], { id: "text", open: s.texts.length > 0 }));

  // borders
  const bt = s.border.type;
  const variants: Record<string, [string, string][]> = {
    instant: [["square", "Square (integral)"], ["wide", "Wide"], ["mini", "Mini"], ["go", "Go"]],
    "120": [["", "Auto from photo"], ["6x6", "6×6"], ["6x4.5", "6×4.5"], ["6x7", "6×7"], ["6x9", "6×9"]],
    "scan-negative": [["", "Inverted scan (black rebate)"], ["raw", "Raw negative (orange base)"]],
  };
  const bctl: HTMLElement[] = [
    select(H, { label: "Type", path: "border.type", options: [["none", "None"], ["plain", "Plain"], ["35mm", "35mm sprockets"], ["120", "120 medium format"], ["half-frame", "Half-frame"], ["instant", "Instant film"], ["contact-sheet", "Contact sheet"], ["slide-mount", "Slide mount"], ["scan-negative", "Scanned negative edge"], ["torn", "Torn edge"], ["paper", "Paper print"]], onChange: () => H.rebuild() }),
  ];
  if (variants[bt]) bctl.push(select(H, { label: "Variant", path: "border.variant", options: variants[bt] }));
  bctl.push(select(H, { label: "Canvas ratio", path: "border.ratio", options: [["original", "Original"], ["1:1", "1:1"], ["4:5", "4:5"], ["5:4", "5:4"], ["3:2", "3:2"], ["2:3", "2:3"], ["16:9", "16:9"], ["9:16", "9:16"], ["1:1.414", "A-paper portrait"], ["1.414:1", "A-paper landscape"]] }));
  bctl.push(textInput(H, { label: "Custom ratio (w:h)", path: "border.ratio" }));
  if (["plain", "instant", "slide-mount", "paper"].includes(bt)) bctl.push(colorInput(H, { label: bt === "plain" ? "Border colour" : "Frame colour", path: "border.color" }));
  if (["plain", "torn", "paper"].includes(bt)) bctl.push(S("border.size", "Border size", 0, 40, { def: 6 }));
  if (["35mm", "120", "half-frame", "contact-sheet", "scan-negative"].includes(bt)) bctl.push(colorInput(H, { label: "Rebate colour", path: "border.rebateColor" }));
  if (["35mm", "120", "half-frame"].includes(bt)) bctl.push(colorInput(H, { label: "Edge text colour", path: "border.textColor" }));
  if (bt !== "none") bctl.push(colorInput(H, { label: "Background", path: "border.bgColor" }));
  if (bt === "none") bctl.push(colorInput(H, { label: "Ratio fill colour", path: "border.color" }));
  if (["torn", "paper"].includes(bt)) bctl.push(S("border.roundness", "Edge roughness", 0, 100, { def: 50 }));
  if (["35mm", "120", "half-frame", "contact-sheet", "scan-negative", "slide-mount", "instant"].includes(bt)) {
    bctl.push(toggle(H, { label: "Edge text", path: "border.showText" }), textInput(H, { label: "Edge text", path: "border.customText" }), S("border.frameNumber", "Frame number", 0, 40, { def: 12 }));
  }
  if (bt !== "none") bctl.push(h("div", { class: "row" }, h("label", {}, "Randomness"), button("Shuffle", () => H.set("border.seed", (H.get("border.seed") as number) + 1, false, "Border seed"))));
  out.push(section("Border", bctl, { id: "border", open: bt !== "none", onReset: resetGroup(["border"]) }));
  return out;
}
