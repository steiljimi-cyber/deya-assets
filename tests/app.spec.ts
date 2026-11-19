// End-to-end tests: the real frontend (built) + the real Rust core (via the dev server bridge),
// rendered with WebGL2 in Chromium.
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const FIX = path.resolve("tests/fixtures");
const OUT = "/tmp/ffl-test-out";
fs.mkdirSync(OUT, { recursive: true });

async function boot(page: Page, img = "scene.jpg") {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).ffl);
  await page.evaluate((p) => (window as any).ffl.open(p), path.join(FIX, img));
  await page.waitForFunction(() => (window as any).ffl.app.r.source);
}

/** Render a canvas region at k=1 (export path) and return RGBA floats. */
async function renderRegion(page: Page, patch: any, region: { x: number; y: number; w: number; h: number }) {
  return page.evaluate(({ patch, region }) => {
    const f = (window as any).ffl;
    f.replace(patch);
    const s = f.settings();
    const L = f.renderer.layout(s);
    const t = f.renderer.renderRegion(s, L, { region, k: 1, exportMode: true });
    const px = Array.from(f.renderer.g.readRGBA(t, 0, 0, region.w, region.h) as Float32Array);
    f.renderer.g.release(t);
    return px;
  }, { patch, region });
}

const NEUTRAL = { grain: { amount: 0 }, halation: { amount: 0 }, border: { type: "none" } };

test("boots with float WebGL2 and renders the photo", async ({ page }) => {
  await boot(page);
  const caps = await page.evaluate(() => { const g = (window as any).ffl.renderer.g; return { floatLinear: g.floatLinear }; });
  expect(caps.floatLinear).toBe(true);
  const px = await renderRegion(page, {}, { x: 1400, y: 900, w: 32, h: 32 });
  const mean = px.reduce((a, b) => a + b, 0) / px.length;
  expect(mean).toBeGreaterThan(0.05);
  expect(px.every((v) => Number.isFinite(v))).toBe(true);
});

test("GPU film pipeline matches the TypeScript reference model", async ({ page }) => {
  await boot(page, "small.png");
  for (const stock of ["everyday-400", "portrait-400", "velvet-50", "tri-400", "instant-color", "snapshot-97"]) {
    const res = await page.evaluate(async ({ stock, NEUTRAL, FIXP }) => {
      const f = (window as any).ffl;
      f.replace({ ...NEUTRAL, film: { stock, intensity: 100, format: "35mm", iso: 400, isoAuto: true } });
      const s = f.settings();
      const look = f.film.getStock(stock).def.look ?? {};
      // the stock "look" adds post adjustments; compare the pure film response
      if (Object.keys(look).length) return { skipped: true, maxErr: 0 };
      const img = await f.openImage(FIXP);
      const L = f.renderer.layout(s);
      const region = { x: 0, y: 0, w: 600, h: 400 };
      const t = f.renderer.renderRegion(s, L, { region, k: 1, exportMode: true });
      const gpu = f.renderer.g.readRGBA(t, 0, 0, 600, 400);
      f.renderer.g.release(t);
      const half = (h: number) => { const e = (h >> 10) & 31, m = h & 1023, sg = h >> 15 ? -1 : 1; return e === 0 ? sg * m * 2 ** -24 : e === 31 ? NaN : sg * (1 + m / 1024) * 2 ** (e - 15); };
      const st = f.film.getStock(stock);
      let maxErr = 0;
      for (let i = 0; i < 400; i++) {
        const x = (i * 37) % 600, y = (i * 53) % 400;
        const o = (y * 600 + x) * 4;
        const src = [half(img.pixels[o]), half(img.pixels[o + 1]), half(img.pixels[o + 2])];
        const ref = f.film.filmApply(st, src).out;
        for (let c = 0; c < 3; c++) {
          const err = Math.abs(Math.cbrt(gpu[o + c]) - Math.cbrt(ref[c]));
          maxErr = Math.max(maxErr, err);
        }
      }
      return { skipped: false, maxErr };
    }, { stock, NEUTRAL, FIXP: path.join(FIX, "small.png") });
    if (!res.skipped) expect(res.maxErr, stock).toBeLessThan(0.004);
  }
});

test("GPU grain shader matches the CPU Boolean-model reference pixel by pixel", async ({ page }) => {
  await boot(page, "small.png");
  const r = await page.evaluate(() => {
    const f = (window as any).ffl;
    const G = f.grain, g = f.renderer.g, gl = g.gl;
    const prog = g.program(`
      #include "grain.glsl"
      uniform float u_u;
      out vec4 o;
      void main() {
        vec2 cp = gl_FragCoord.xy;
        ivec2 pix = ivec2(floor(cp));
        o = vec4(applyGrain(vec3(u_u), cp, pix, false), 1.0);
      }`);
    const p = { radius: 2.2, sigma: 0.3, soft: 0.8, seed: 12345 };
    const a = G.softAreaFactor(p.soft);
    const n = 12, W = 48, H = 48;
    const t = g.target(W, H);
    let worst = 0, bad = 0, total = 0;
    for (const u of [0.2, 0.5, 0.8]) {
      g.draw(prog, t, { u_u: u, u_gAmount: 1, u_gR: [p.radius, p.radius, p.radius], u_gSigma: p.sigma, u_gSoft: p.soft, u_gArea: a, u_gColor: 1,
        u_gSeed: p.seed, u_gS: 0.5, u_gN: n, u_gDelta: G.rMax(p) });
      const px = g.readRGBA(t);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const cpu = G.pixelCoverage(x, y, u, 0, p, a, 0.5, n, G.rMax(p), 1);
        const gpu = px[(y * W + x) * 4];
        const d = Math.abs(Math.min(cpu, 0.9995) - gpu);
        worst = Math.max(worst, d);
        if (d > 0.02) bad++;
        total++;
      }
    }
    g.release(t);
    return { bad, total, worst };
  });
  expect(r.total).toBe(3 * 48 * 48);
  expect(r.bad / r.total).toBeLessThan(0.02);
});

test("rendered grain is correlated and unbiased", async ({ page }) => {
  await boot(page, "small.png");
  const px = await renderRegion(page, { ...NEUTRAL, film: { stock: "tri-400", intensity: 100 }, grain: { amount: 100, size: 80, roughness: 50, color: 0, seed: 3 } }, { x: 20, y: 20, w: 96, h: 96 });
  const g = px.filter((_, i) => i % 4 === 1);
  const m = g.reduce((a, b) => a + b, 0) / g.length;
  const sd = Math.sqrt(g.reduce((a, b) => a + (b - m) ** 2, 0) / g.length);
  expect(sd).toBeGreaterThan(0.002);
  let ac = 0;
  for (let y = 0; y < 96; y++) for (let x = 0; x < 95; x++) ac += (g[y * 96 + x] - m) * (g[y * 96 + x + 1] - m);
  ac /= 96 * 95 * sd * sd;
  expect(ac).toBeGreaterThan(0.3); // grain clumps, not per-pixel noise
});

test("tiled export is seamless: different tile sizes give identical pixels", async ({ page }) => {
  await boot(page, "small.png");
  const patch = { border: { type: "35mm" }, motionBlur: { amount: 25, angle: 30 }, glitch: { amount: 40 }, dust: { amount: 40, hairs: 30, scratches: 30 }, halation: { amount: 60 }, dateStamp: { enabled: true }, lightLeak: { amount: 40 } };
  const res = await page.evaluate(async ({ patch, OUT }) => {
    const f = (window as any).ffl;
    f.replace(patch);
    const a = await f.exportTo({ path: OUT + "/seam-a.png", format: "png", bitDepth: 16, quality: 95, colorSpace: "srgb", ppi: 300, tiffCompression: "none", longEdge: 1100, tile: 1024 });
    const b = await f.exportTo({ path: OUT + "/seam-b.png", format: "png", bitDepth: 16, quality: 95, colorSpace: "srgb", ppi: 300, tiffCompression: "none", longEdge: 1100, tile: 173 });
    const A = await f.openImage(OUT + "/seam-a.png"), B = await f.openImage(OUT + "/seam-b.png");
    let diff = 0;
    for (let i = 0; i < A.pixels.length; i++) if (A.pixels[i] !== B.pixels[i]) diff = Math.max(diff, Math.abs(A.pixels[i] - B.pixels[i]));
    return { a, diff, len: A.pixels.length };
  }, { patch, OUT });
  expect(res.a.width).toBe(1100);
  // half-float bit patterns: allow one ulp from float rounding, never a visible seam
  expect(res.diff).toBeLessThanOrEqual(2);
});

test("every export format reads back with correct size, bit depth, PPI and ICC profile", async ({ page }) => {
  await boot(page);
  const cases = [
    { f: "jpeg", bits: 8, cs: "srgb", ext: "jpg", icc: "sRGB IEC61966-2.1" },
    { f: "png", bits: 8, cs: "p3", ext: "png", icc: "Display P3" },
    { f: "png", bits: 16, cs: "prophoto", ext: "png", icc: "ProPhoto RGB (ROMM)" },
    { f: "tiff", bits: 8, cs: "adobergb", ext: "tif", icc: "Adobe RGB (1998) compatible", comp: "deflate" },
    { f: "tiff", bits: 16, cs: "srgb", ext: "tif", icc: "sRGB IEC61966-2.1", comp: "lzw" },
  ];
  for (const c of cases) {
    const rep = await page.evaluate(({ c, OUT }) => (window as any).ffl.exportTo({
      path: `${OUT}/fmt-${c.f}${c.bits}.${c.ext}`, format: c.f, bitDepth: c.bits, quality: 92, colorSpace: c.cs, ppi: 240,
      tiffCompression: c.comp ?? "none", longEdge: 1200, tile: 512,
    }), { c, OUT });
    expect(rep.width, c.ext).toBe(1200);
    expect(rep.height, c.ext).toBe(800);
    expect(rep.bitsPerChannel, c.ext).toBe(c.bits);
    expect(rep.ppiX, c.ext).toBeCloseTo(240, 1);
    expect(rep.iccDescription, c.ext).toBe(c.icc);
  }
});

test("A4 print export at 300 ppi has the exact pixel size", async ({ page }) => {
  await boot(page);
  const rep = await page.evaluate((OUT) => (window as any).ffl.exportTo({
    path: `${OUT}/a4.jpg`, format: "jpeg", bitDepth: 8, quality: 90, colorSpace: "srgb", ppi: 300, tiffCompression: "none", longEdge: Math.round((297 / 25.4) * 300), tile: 1024,
  }), OUT);
  expect(rep.width).toBe(3508);
  expect(rep.ppiX).toBe(300);
});

test("edits: save, list, apply, export file, import file; Hiromix leaves motion blur untouched", async ({ page }) => {
  await boot(page, "small.png");
  const r = await page.evaluate(async (OUT) => {
    const f = (window as any).ffl;
    f.set("motionBlur.amount", 33);
    const hiro = f.presets.BUILTIN_EDITS.find((e: any) => e.name.startsWith("Hiromix"));
    const applied = f.presets.applyEdit(f.settings(), hiro);
    f.set("light.exposure", 0.7);
    f.set("film.stock", "portrait-160");
    await f.presets.saveUserEdit({ name: "Test Edit", groups: ["Light", "Film stock"], settings: { light: f.settings().light, film: f.settings().film } });
    const list = await f.presets.listUserEdits();
    const text = f.presets.toFile(list.find((e: any) => e.name === "Test Edit"));
    await f.call("write_text", { path: OUT + "/test.ffedit", text });
    const back = f.presets.fromFile(await f.call("read_text", { path: OUT + "/test.ffedit" }));
    return { motion: applied.motionBlur.amount, stock: applied.film.stock, names: list.map((e: any) => e.name), back: back.settings.light.exposure };
  }, OUT);
  expect(r.motion).toBe(33);
  expect(r.stock).toBe("snapshot-97");
  expect(r.names).toContain("Test Edit");
  expect(r.back).toBe(0.7);
});

test("sidecar, undo/redo and snapshots", async ({ page }) => {
  fs.copyFileSync(path.join(FIX, "small.png"), path.join(OUT, "side.png"));
  try { fs.unlinkSync(path.join(OUT, "side.png.fflab")); } catch { /* none */ }
  await page.goto("/");
  await page.waitForFunction(() => (window as any).ffl);
  await page.evaluate((p) => (window as any).ffl.open(p), path.join(OUT, "side.png"));
  await page.waitForFunction(() => (window as any).ffl.app.r.source);
  await page.evaluate(() => {
    const f = (window as any).ffl;
    f.app.set("light.exposure", 1, false, "Exposure");
    f.app.history.entries[f.app.history.entries.length - 1].time = 0; // don't merge
    f.app.set("light.contrast", 30, false, "Contrast");
  });
  const u = await page.evaluate(() => { const f = (window as any).ffl; f.app.undo(); return f.settings().light; });
  expect(u.contrast).toBe(0);
  expect(u.exposure).toBe(1);
  const rr = await page.evaluate(() => { const f = (window as any).ffl; f.app.redo(); return f.settings().light.contrast; });
  expect(rr).toBe(30);
  await page.evaluate(() => (window as any).ffl.app.saveSidecar());
  const side = JSON.parse(fs.readFileSync(path.join(OUT, "side.png.fflab"), "utf8"));
  expect(side.settings.light.contrast).toBe(30);
  // reopen restores everything
  await page.reload();
  await page.waitForFunction(() => (window as any).ffl);
  await page.evaluate((p) => (window as any).ffl.open(p), path.join(OUT, "side.png"));
  await page.waitForFunction(() => (window as any).ffl.app.r.source);
  const re = await page.evaluate(() => (window as any).ffl.settings().light);
  expect(re.contrast).toBe(30);
  expect(re.exposure).toBe(1);
});

test("texture library indexes and classifies, originals untouched, textures become layers", async ({ page }) => {
  await boot(page, "small.png");
  const root = path.join(FIX, "textures");
  const before = fs.readdirSync(root, { recursive: true }).map(String).sort();
  const hashBefore = fs.readFileSync(path.join(root, "Light Leaks", "leak 01.jpg")).toString("base64");
  const ix = await page.evaluate((root) => (window as any).ffl.call("index_textures", { root }), root);
  expect(ix.entries.length).toBe(4);
  const cat = (n: string) => ix.entries.find((e: any) => e.name === n).category;
  expect(cat("leak 01.jpg")).toBe("light-leak");
  expect(cat("specks.png")).toBe("dust");
  expect(cat("cotton.jpg")).toBe("paper");
  expect(fs.readdirSync(root, { recursive: true }).map(String).sort()).toEqual(before);
  expect(fs.readFileSync(path.join(root, "Light Leaks", "leak 01.jpg")).toString("base64")).toBe(hashBefore);
  const base = await renderRegion(page, NEUTRAL, { x: 200, y: 100, w: 16, h: 16 });
  await page.evaluate((p) => (window as any).ffl.app.addTexture(p, "leak"), path.join(root, "Light Leaks", "leak 01.jpg"));
  await page.waitForFunction(() => (window as any).ffl.app.r.textures.size === 1);
  const withTex = await renderRegion(page, {}, { x: 200, y: 100, w: 16, h: 16 });
  const d = withTex.reduce((a, v, i) => a + Math.abs(v - base[i]), 0);
  expect(d).toBeGreaterThan(1);
});

test("every border type renders at export resolution", async ({ page }) => {
  await boot(page, "small.png");
  for (const type of ["plain", "35mm", "120", "half-frame", "instant", "contact-sheet", "slide-mount", "scan-negative", "torn", "paper"]) {
    const r = await page.evaluate(async ({ type, OUT }) => {
      const f = (window as any).ffl;
      f.replace({ border: { ...f.settings().border, type } });
      return f.exportTo({ path: `${OUT}/border-${type}.jpg`, format: "jpeg", bitDepth: 8, quality: 90, colorSpace: "srgb", ppi: 300, tiffCompression: "none", longEdge: 1600, tile: 1024 });
    }, { type, OUT });
    expect(Math.max(r.width, r.height), type).toBe(1600);
  }
});
