import { h, button, getPath, setPath, refreshAll } from "./controls";
import { buildPanels, type PanelHost } from "./panels";
import { Renderer } from "../engine/renderer";
import type { Layout } from "../engine/layout";
import type { Target } from "../engine/gl";
import { exportImage, printLongEdge, PAPER_MM, type ExportOptions, type FileReport } from "../engine/export";
import { History } from "../state/history";
import { clone, defaultSettings, defaultTexture, normalize, GROUPS, pickGroups, applyGroups, type Settings } from "../state/settings";
import { BUILTIN_EDITS, listUserEdits, saveUserEdit, deleteUserEdit, applyEdit, toFile, fromFile, type Edit } from "../state/presets";
import { call, callBytes, openImage, openTexture, pickFile, platform } from "../platform";
import * as filmModel from "../film/model";
import * as grainModel from "../engine/grain";
import { getStock } from "../film/stocks";
import * as presets from "../state/presets";

interface TexEntry { id: string; path: string; name: string; folder: string; category: string; reason: string; width: number; height: number; thumb: string; wasCloudOnly: boolean }

const IMG_FILTERS = [{ name: "Images", extensions: ["jpg", "jpeg", "png", "tif", "tiff", "webp"] }];

export class App implements PanelHost {
  s: Settings = defaultSettings();
  history = new History();
  r: Renderer;
  path: string | null = null;
  info: any = null;
  clipboard: Partial<Settings> | null = null;
  // view
  fit = true;
  zoom = 1;
  cx = 0;
  cy = 0;
  showBefore = false;
  split = false;
  clip = false;
  private raf = 0;
  private interactive = false;
  private idleTimer = 0;
  private sidecarTimer = 0;
  private layoutCache: { key: string; L: Layout } | null = null;
  private beforeCache: { key: string; t: Target } | null = null;
  private texIndex: { root: string; entries: TexEntry[]; errors: string[] } | null = null;
  private texFilter = "all";
  private thumbUrls = new Map<string, string>();
  private leftTab = "edits";
  private userEdits: Edit[] = [];
  // dom
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  right!: HTMLElement;
  left!: HTMLElement;
  status!: HTMLElement;
  empty!: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.canvas = h("canvas", { class: "view" }) as HTMLCanvasElement;
    this.r = new Renderer(this.canvas);
    this.buildDom();
    this.history.reset(this.s);
    this.bindKeys();
    this.bindViewer();
    new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement!);
    this.resize();
    this.loadUserEdits();
  }

  // ---------- PanelHost / Binding ----------
  settings() { return this.s; }
  get(path: string) { return getPath(this.s, path); }
  set(path: string, v: any, live: boolean, label: string) {
    setPath(this.s, path, v);
    this.changed(live, label);
  }
  replace(mut: (s: Settings) => void, label: string) {
    mut(this.s);
    this.s = normalize(this.s);
    this.changed(false, label);
    this.rebuild();
  }
  rebuild() {
    const scroll = this.right.scrollTop;
    const open = new Set([...this.right.querySelectorAll<HTMLElement>("section.sec.open")].map((x) => x.dataset.sec));
    this.right.innerHTML = "";
    for (const el of buildPanels(this)) {
      if (open.has(el.dataset.sec)) el.classList.add("open");
      this.right.append(el);
    }
    this.right.scrollTop = scroll;
  }
  showTextures() { this.setLeftTab("textures"); }
  async addTextureFromFile() {
    const p = await pickFile({ title: "Texture image", filters: IMG_FILTERS });
    if (p) this.addTexture(p, p.split("/").pop() ?? "texture");
  }

  private changed(live: boolean, label: string) {
    if (!live) {
      this.history.push(this.s, label);
      this.scheduleSidecar();
      this.renderHistory();
    }
    this.interactive = live;
    this.ensureTextures();
    this.requestRender();
    if (!live) refreshAll(this.right);
  }

  // ---------- DOM ----------
  private buildDom() {
    const tb = h("header", { class: "topbar" },
      h("div", { class: "brand" }, h("span", { class: "logo" }), "Fixer Film Lab"),
      button("Open…", () => this.openDialog(), { title: "Open photo (⌘O)" }),
      button("Export…", () => this.exportDialog(), { title: "Export (⌘E)", class: "accent" }),
      h("span", { class: "sep" }),
      button("↶", () => this.undo(), { title: "Undo (⌘Z)" }), button("↷", () => this.redo(), { title: "Redo (⇧⌘Z)" }),
      h("span", { class: "sep" }),
      button("Before/After", () => { this.showBefore = !this.showBefore; this.requestRender(); }, { title: "Before / after (\\)" }),
      button("Split", () => { this.split = !this.split; this.requestRender(); }, { title: "Split compare (Y)" }),
      button("Clipping", () => { this.clip = !this.clip; this.requestRender(); }, { title: "Clipping warning (J)" }),
      button("Fit", () => { this.fit = true; this.requestRender(); }, { title: "Fit (⌘0)" }), button("100%", () => this.zoomTo(1), { title: "1:1 (Z)" }),
      h("span", { class: "sep" }),
      button("Copy settings", () => this.copySettings(), { title: "⇧⌘C" }), button("Paste", () => this.pasteSettings(), { title: "⇧⌘V" }),
      button("Reset", () => this.resetAll(), { title: "Reset all (⇧⌘R)" }),
      h("span", { class: "grow" }),
      button("?", () => this.helpDialog(), { title: "Keyboard shortcuts" }),
    );
    this.left = h("aside", { class: "left" });
    this.right = h("aside", { class: "right" });
    this.empty = h("div", { class: "empty" }, h("div", { class: "empty-in" }, h("h2", {}, "Fixer Film Lab"), h("p", {}, "Open a photo to start (⌘O). JPEG, PNG, TIFF and WebP; RAW, HEIC and PSD follow in later phases."), button("Open photo…", () => this.openDialog(), { class: "accent" })));
    const center = h("main", { class: "center" }, this.canvas, this.empty);
    this.status = h("footer", { class: "status" }, "No image");
    this.root.append(tb, h("div", { class: "body" }, this.left, center, this.right), this.status);
    this.rebuild();
    this.renderLeft();
  }

  toast(msg: string, kind: "info" | "error" = "info", ms = 4000) {
    const t = h("div", { class: `toast ${kind}` }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), ms);
  }

  private modal(title: string, body: HTMLElement, actions: HTMLElement[]) {
    const close = () => bg.remove();
    const bg = h("div", { class: "modal-bg", onclick: (e: Event) => { if (e.target === bg) close(); } },
      h("div", { class: "modal" }, h("h3", {}, title), body, h("div", { class: "actions" }, ...actions, button("Close", close))));
    bg.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") close(); });
    document.body.append(bg);
    return close;
  }

  // ---------- left panel ----------
  private setLeftTab(t: string) { this.leftTab = t; this.renderLeft(); }
  private renderLeft() {
    this.left.innerHTML = "";
    const tabs = h("div", { class: "tabs" });
    for (const [id, l] of [["edits", "Edits"], ["textures", "Textures"], ["history", "History"], ["snapshots", "Snapshots"]]) {
      tabs.append(h("button", { class: this.leftTab === id ? "on" : "", onclick: () => this.setLeftTab(id) }, l));
    }
    const body = h("div", { class: "left-body" });
    this.left.append(tabs, body);
    if (this.leftTab === "edits") this.renderEdits(body);
    if (this.leftTab === "textures") this.renderTextures(body);
    if (this.leftTab === "history") this.renderHistory(body);
    if (this.leftTab === "snapshots") this.renderSnapshots(body);
  }

  private async loadUserEdits() {
    this.userEdits = await listUserEdits().catch(() => []);
    if (this.leftTab === "edits") this.renderLeft();
  }

  private renderEdits(body: HTMLElement) {
    const list = h("div", { class: "list" });
    const item = (e: Edit) => h("div", { class: "item", title: e.groups.join(", ") },
      h("span", { class: "grow", onclick: () => { this.s = applyEdit(this.s, e); this.changed(false, `Edit: ${e.name}`); this.rebuild(); } }, e.name),
      e.builtin ? h("span", { class: "tag" }, "starter") : button("✕", async () => { await deleteUserEdit(e); this.loadUserEdits(); }, { class: "mini", title: "Delete" }));
    list.append(h("div", { class: "list-head" }, "Your edits"));
    if (!this.userEdits.length) list.append(h("div", { class: "hint" }, "Nothing saved yet."));
    this.userEdits.forEach((e) => list.append(item(e)));
    list.append(h("div", { class: "list-head" }, "Starter edits"));
    BUILTIN_EDITS.forEach((e) => list.append(item(e)));
    body.append(
      h("div", { class: "row wrap" }, button("Save current…", () => this.saveEditDialog(), { class: "accent" }), button("Import…", () => this.importEdit()), button("Export…", () => this.exportEditDialog())),
      list,
    );
  }

  private groupPicker(defaults: string[]) {
    const box = h("div", { class: "groups" });
    for (const g of Object.keys(GROUPS)) {
      const cb = h("input", { type: "checkbox", value: g }) as HTMLInputElement;
      cb.checked = defaults.includes(g);
      box.append(h("label", { class: "toggle" }, cb, h("span", {}, g)));
    }
    return { box, get: () => [...box.querySelectorAll<HTMLInputElement>("input:checked")].map((c) => c.value) };
  }

  private saveEditDialog() {
    const name = h("input", { type: "text", value: "My edit" }) as HTMLInputElement;
    const gp = this.groupPicker(Object.keys(GROUPS));
    const close = this.modal("Save edit", h("div", {}, h("div", { class: "row" }, h("label", {}, "Name"), name), h("div", { class: "hint" }, "Settings to include:"), gp.box), [
      button("Save", async () => {
        const groups = gp.get();
        await saveUserEdit({ name: name.value || "My edit", groups, settings: pickGroups(this.s, groups) });
        close();
        this.toast(`Saved edit “${name.value}”`);
        this.loadUserEdits();
      }, { class: "accent" }),
    ]);
  }

  private async importEdit() {
    const p = await pickFile({ title: "Import edit", filters: [{ name: "Fixer Film Lab edit", extensions: ["ffedit", "json"] }] });
    if (!p) return;
    try {
      const t = await call<string | null>("read_text", { path: p });
      const e = fromFile(t ?? "");
      await saveUserEdit(e);
      this.toast(`Imported “${e.name}”`);
      this.loadUserEdits();
    } catch (err) { this.toast(String(err), "error"); }
  }

  private exportEditDialog() {
    const name = h("input", { type: "text", value: "My edit" }) as HTMLInputElement;
    const gp = this.groupPicker(Object.keys(GROUPS));
    const close = this.modal("Export current edit", h("div", {}, h("div", { class: "row" }, h("label", {}, "Name"), name), gp.box), [
      button("Export…", async () => {
        const p = await pickFile({ title: "Save edit file", save: true, defaultPath: `${name.value}.ffedit`, filters: [{ name: "Fixer Film Lab edit", extensions: ["ffedit"] }] });
        if (!p) return;
        const groups = gp.get();
        await call("write_text", { path: p, text: toFile({ name: name.value, groups, settings: pickGroups(this.s, groups) }) });
        close();
        this.toast(`Exported ${p}`);
      }, { class: "accent" }),
    ]);
  }

  private async renderTextures(body: HTMLElement) {
    const rootIn = h("input", { type: "text", placeholder: "Texture folder", value: this.texIndex?.root ?? "" }) as HTMLInputElement;
    const status = h("div", { class: "hint" });
    const grid = h("div", { class: "tex-grid" });
    const chips = h("div", { class: "chips" });
    const run = async () => {
      if (!rootIn.value) { status.textContent = "Choose a folder first."; return; }
      status.textContent = "Indexing… cloud-only files are downloaded, thumbnailed and offloaded again.";
      try {
        this.texIndex = await call("index_textures", { root: rootIn.value });
        status.textContent = "";
        this.renderLeft();
      } catch (e) { status.textContent = String(e); }
    };
    body.append(
      h("div", { class: "row" }, rootIn),
      h("div", { class: "row wrap" },
        button("iCloud “textures”", async () => {
          const p = await call<string | null>("default_textures_root");
          if (p) { rootIn.value = p; run(); } else status.textContent = "No “textures” folder found in iCloud Drive on this Mac.";
        }),
        button("Choose folder…", async () => { const p = await pickFile({ title: "Texture folder", directory: true }); if (p) { rootIn.value = p; run(); } }),
        button("Re-index", run)),
      status, chips, grid);
    if (!this.texIndex && !rootIn.value) {
      const p = await call<string | null>("default_textures_root").catch(() => null);
      if (p) rootIn.value = p;
      return;
    }
    if (!this.texIndex) return;
    const ix = this.texIndex;
    const counts = new Map<string, number>();
    for (const e of ix.entries) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    const cats = ["all", ...[...counts.keys()].sort()];
    for (const c of cats) chips.append(h("button", { class: this.texFilter === c ? "on" : "", onclick: () => { this.texFilter = c; this.renderLeft(); } }, `${c} ${c === "all" ? ix.entries.length : counts.get(c)}`));
    if (ix.errors.length) status.textContent = `${ix.errors.length} files could not be read.`;
    for (const e of ix.entries.filter((x) => this.texFilter === "all" || x.category === this.texFilter)) {
      const img = h("img", { alt: e.name, title: `${e.name}\n${e.folder}\n${e.width}×${e.height} · ${e.category} (${e.reason})` }) as HTMLImageElement;
      this.thumb(e.thumb).then((u) => (img.src = u));
      grid.append(h("div", { class: "tex", onclick: () => this.addTexture(e.path, e.name) }, img, h("span", {}, e.name)));
    }
  }

  private async thumb(path: string) {
    let u = this.thumbUrls.get(path);
    if (!u) {
      const b = await callBytes("read_file", { path });
      u = URL.createObjectURL(new Blob([b], { type: "image/jpeg" }));
      this.thumbUrls.set(path, u);
    }
    return u;
  }

  addTexture(path: string, name: string) {
    if (this.s.textures.length >= 4) { this.toast("Four texture slots are in use. Remove one first.", "error"); return; }
    this.replace((s) => { s.textures.push(defaultTexture(path, name)); }, "Add texture");
  }

  private loadingTex = new Set<string>();
  private ensureTextures() {
    for (const t of this.s.textures) {
      if (!t.path || this.r.textures.has(t.path) || this.loadingTex.has(t.path)) continue;
      this.loadingTex.add(t.path);
      openTexture(t.path, 4096).then((img) => {
        this.r.setTexture(t.path, img.info.width, img.info.height, img.pixels);
        this.requestRender();
      }).catch((e) => this.toast(`Texture: ${e}`, "error")).finally(() => this.loadingTex.delete(t.path));
    }
  }

  private renderHistory(body?: HTMLElement) {
    if (!body) { if (this.leftTab === "history") this.renderLeft(); return; }
    const list = h("div", { class: "list" });
    this.history.entries.forEach((e, i) => list.append(h("div", { class: "item" + (i === this.history.index ? " on" : ""), onclick: () => { const s = this.history.goto(i); if (s) this.applyState(s); } }, `${i + 1}. ${e.label}`)));
    body.append(list);
  }

  private renderSnapshots(body: HTMLElement) {
    const list = h("div", { class: "list" });
    this.history.snapshots.forEach((sn, i) => list.append(h("div", { class: "item" },
      h("span", { class: "grow", onclick: () => { this.s = clone(sn.settings); this.changed(false, `Snapshot: ${sn.name}`); this.rebuild(); } }, sn.name),
      button("✕", () => { this.history.snapshots.splice(i, 1); this.scheduleSidecar(); this.renderLeft(); }, { class: "mini" }))));
    body.append(button("+ Snapshot", () => {
      const n = window.prompt("Snapshot name", `Snapshot ${this.history.snapshots.length + 1}`);
      if (n) { this.history.addSnapshot(n, this.s); this.scheduleSidecar(); this.renderLeft(); }
    }, { class: "accent" }), list);
  }

  // ---------- open / sidecar ----------
  async openDialog() {
    const p = await pickFile({ title: "Open photo", filters: IMG_FILTERS });
    if (p) await this.open(p);
  }

  async open(path: string) {
    this.status.textContent = `Opening ${path}…`;
    try {
      const img = await openImage(path);
      this.r.setSource(img.info.width, img.info.height, img.pixels);
      this.path = path;
      this.info = img.info;
      this.layoutCache = null;
      this.dropBefore();
      const side = await call<string | null>("read_text", { path: path + ".fflab" }).catch(() => null);
      if (side) {
        const j = JSON.parse(side);
        this.s = normalize(j.settings);
        this.history = History.fromJSON(j.history, this.s);
      } else {
        this.s = normalize(this.s); // keep current look when opening another photo
        this.history = new History();
        this.history.reset(this.s, "Open");
      }
      this.fit = true;
      this.empty.style.display = "none";
      this.rebuild();
      this.renderLeft();
      this.ensureTextures();
      this.requestRender();
    } catch (e) {
      this.toast(`Could not open: ${e}`, "error", 8000);
      this.status.textContent = String(e);
    }
  }

  private scheduleSidecar() {
    if (!this.path) return;
    clearTimeout(this.sidecarTimer);
    this.sidecarTimer = window.setTimeout(() => this.saveSidecar(), 800);
  }
  async saveSidecar() {
    if (!this.path) return;
    const hist = this.history.toJSON();
    const start = Math.max(0, hist.entries.length - 300);
    const doc = { app: "Fixer Film Lab", version: 1, image: this.path.split("/").pop(), settings: this.s, history: { ...hist, entries: hist.entries.slice(start), index: hist.index - start } };
    await call("write_text", { path: this.path + ".fflab", text: JSON.stringify(doc) }).catch((e) => this.toast(`Sidecar not saved: ${e}`, "error"));
  }

  private applyState(s: Settings) {
    this.s = s;
    this.rebuild();
    this.scheduleSidecar();
    this.ensureTextures();
    this.requestRender();
    this.renderHistory();
  }
  undo() { const s = this.history.undo(); if (s) this.applyState(s); }
  redo() { const s = this.history.redo(); if (s) this.applyState(s); }
  copySettings() {
    this.clipboard = pickGroups(this.s, Object.keys(GROUPS));
    navigator.clipboard?.writeText(toFile({ name: "Copied settings", groups: Object.keys(GROUPS), settings: this.clipboard })).catch(() => {});
    this.toast("Settings copied");
  }
  pasteSettings() {
    if (!this.clipboard) { this.toast("Nothing copied yet", "error"); return; }
    const gp = this.groupPicker(Object.keys(GROUPS));
    const close = this.modal("Paste settings", gp.box, [button("Paste", () => {
      this.s = applyGroups(this.s, normalize({ ...this.s, ...this.clipboard } as Settings), gp.get());
      this.changed(false, "Paste settings");
      this.rebuild();
      close();
    }, { class: "accent" })]);
  }
  resetAll() { this.s = defaultSettings(); this.changed(false, "Reset all"); this.rebuild(); }

  // ---------- viewer ----------
  private resize() {
    const p = this.canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(p.clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(p.clientHeight * dpr));
    if (!this.r.source) {
      const gl = this.r.g.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0.118, 0.118, 0.118, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.requestRender();
  }

  layout(): Layout {
    const key = JSON.stringify([this.r.source?.id, this.s.border]);
    if (this.layoutCache?.key !== key) {
      this.layoutCache = { key, L: this.r.layout(this.s) };
      this.dropBefore();
    }
    return this.layoutCache.L;
  }

  private fitZoom(L: Layout) {
    return Math.min(this.canvas.width / L.canvasW, this.canvas.height / L.canvasH) * 0.95;
  }

  zoomTo(z: number, sx?: number, sy?: number) {
    if (!this.r.source) return;
    const L = this.layout();
    const cur = this.fit ? this.fitZoom(L) : this.zoom;
    if (this.fit) { this.cx = L.canvasW / 2; this.cy = L.canvasH / 2; }
    const dpr = window.devicePixelRatio || 1;
    const zz = z * dpr;
    if (sx !== undefined && sy !== undefined) {
      const px = this.cx + (sx - this.canvas.width / 2) / cur, py = this.cy + (sy - this.canvas.height / 2) / cur;
      this.cx = px - (sx - this.canvas.width / 2) / zz;
      this.cy = py - (sy - this.canvas.height / 2) / zz;
    }
    this.zoom = zz;
    this.fit = false;
    this.requestRender();
  }

  private bindViewer() {
    const c = this.canvas;
    let drag: { x: number; y: number; cx: number; cy: number } | null = null;
    c.addEventListener("pointerdown", (e) => {
      if (this.fit || !this.r.source) return;
      c.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy };
    });
    c.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dpr = window.devicePixelRatio || 1;
      this.cx = drag.cx - ((e.clientX - drag.x) * dpr) / this.zoom;
      this.cy = drag.cy - ((e.clientY - drag.y) * dpr) / this.zoom;
      this.interactive = true;
      this.requestRender();
    });
    c.addEventListener("pointerup", () => { drag = null; this.interactive = false; this.requestRender(); });
    c.addEventListener("dblclick", (e) => {
      if (this.fit) { const dpr = window.devicePixelRatio || 1; this.zoomTo(1, e.offsetX * dpr, e.offsetY * dpr); }
      else { this.fit = true; this.requestRender(); }
    });
    c.addEventListener("wheel", (e) => {
      if (!this.r.source) return;
      e.preventDefault();
      const dpr = window.devicePixelRatio || 1;
      const L = this.layout();
      const cur = this.fit ? this.fitZoom(L) : this.zoom;
      if (e.ctrlKey || e.metaKey) {
        const nz = Math.min(32, Math.max(this.fitZoom(L) / dpr * 0.5, (cur / dpr) * Math.exp(-e.deltaY * 0.01)));
        this.zoomTo(nz, e.offsetX * dpr, e.offsetY * dpr);
      } else if (!this.fit) {
        this.cx += (e.deltaX * dpr) / cur;
        this.cy += (e.deltaY * dpr) / cur;
        this.requestRender();
      }
    }, { passive: false });
  }

  requestRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      try { this.renderNow(); } catch (e) { console.error(e); this.status.textContent = `Render error: ${e}`; }
    });
    clearTimeout(this.idleTimer);
    if (this.interactive) this.idleTimer = window.setTimeout(() => { this.interactive = false; this.requestRender(); }, 250);
  }

  private beforeSettings(): Settings {
    const b = defaultSettings();
    b.film.stock = "none";
    b.grain.amount = 0;
    b.halation.amount = 0;
    b.border = clone(this.s.border);
    return b;
  }
  private dropBefore() {
    if (this.beforeCache) { this.r.g.release(this.beforeCache.t); this.beforeCache = null; }
  }

  renderNow() {
    if (!this.r.source) return;
    const L = this.layout();
    const cw = this.canvas.width, ch = this.canvas.height;
    const z = this.fit ? this.fitZoom(L) : this.zoom;
    if (this.fit) { this.cx = L.canvasW / 2; this.cy = L.canvasH / 2; }
    const vw = cw / z, vh = ch / z;
    // clamp pan
    if (!this.fit) {
      this.cx = Math.min(L.canvasW, Math.max(0, this.cx));
      this.cy = Math.min(L.canvasH, Math.max(0, this.cy));
    }
    const vx = this.cx - vw / 2, vy = this.cy - vh / 2;
    const k = Math.max(1, 1 / z);
    // visible canvas region, snapped to the k grid so pixels stay stable while panning
    let x0 = Math.max(0, vx), y0 = Math.max(0, vy), x1 = Math.min(L.canvasW, vx + vw), y1 = Math.min(L.canvasH, vy + vh);
    x0 = Math.floor(x0 / k) * k; y0 = Math.floor(y0 / k) * k;
    x1 = Math.min(L.canvasW, Math.ceil(x1 / k) * k); y1 = Math.min(L.canvasH, Math.ceil(y1 / k) * k);
    if (x1 <= x0 || y1 <= y0) return;
    const region = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const settings = this.showBefore ? this.beforeSettings() : this.s;
    const t = this.r.renderRegion(settings, L, { region, k, interactive: this.interactive });
    const ms = this.r.lastMs;
    let before: Target | null = null;
    if (this.split && !this.showBefore) before = this.r.renderRegion(this.beforeSettings(), L, { region, k, interactive: this.interactive });
    const rect: [number, number, number, number] = [(x0 - vx) * z, (y0 - vy) * z, (x1 - x0) * z, (y1 - y0) * z];
    this.r.display(t, [0, 0, region.w / k, region.h / k], rect, { nearest: z > 1.0001, clip: this.clip, split: before ? 0.5 : -1, before });
    this.r.g.release(t);
    if (before) this.r.g.release(before);
    const dpr = window.devicePixelRatio || 1;
    const name = this.path?.split("/").pop() ?? "";
    this.status.textContent = `${name} · ${this.info?.width}×${this.info?.height} ${this.info?.format} ${this.info?.bitsPerChannel}-bit · ${this.info?.sourceProfile} · canvas ${L.canvasW}×${L.canvasH} · ${Math.round((z / dpr) * 100)}% · ${ms.toFixed(0)} ms${this.interactive ? " (draft grain while dragging)" : ""}${this.showBefore ? " · BEFORE" : ""}`;
  }

  // ---------- export ----------
  exportDialog() {
    if (!this.r.source) { this.toast("Open a photo first", "error"); return; }
    const L = this.layout();
    const el = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild as HTMLElement; };
    const form = el(`<div class="exp">
      <div class="row"><label>Format</label><select name="format"><option value="jpeg">JPEG</option><option value="tiff">TIFF</option><option value="png">PNG</option></select></div>
      <div class="row"><label>Bit depth</label><select name="bits"><option value="8">8-bit</option><option value="16">16-bit</option></select></div>
      <div class="row"><label>Quality</label><input name="quality" type="number" min="1" max="100" value="95"></div>
      <div class="row"><label>TIFF compression</label><select name="tiffc"><option value="lzw">LZW</option><option value="deflate">ZIP (Deflate)</option><option value="none">None</option><option value="packbits">PackBits</option></select></div>
      <div class="row"><label>Colour space</label><select name="cs"><option value="srgb">sRGB</option><option value="p3">Display P3</option><option value="adobergb">Adobe RGB (1998) compatible</option><option value="prophoto">ProPhoto RGB</option></select></div>
      <div class="row"><label>Size</label><select name="size"><option value="native">Native (${L.canvasW}×${L.canvasH})</option><option value="long">Long edge (px)</option>${Object.keys(PAPER_MM).map((p) => `<option value="paper:${p}">${p}</option>`).join("")}</select></div>
      <div class="row"><label>Long edge px</label><input name="long" type="number" min="16" max="60000" value="${Math.max(L.canvasW, L.canvasH)}"></div>
      <div class="row"><label>PPI</label><input name="ppi" type="number" min="1" max="4800" value="300"></div>
      <div class="row"><label>Artist</label><input name="artist" type="text"></div>
      <div class="row"><label>Copyright</label><input name="copyright" type="text"></div>
      <div class="hint" data-k="info"></div>
      <div class="progress"><div></div></div>
      <pre class="report"></pre></div>`);
    const q = (n: string) => form.querySelector(`[name=${n}]`) as HTMLInputElement;
    const info = form.querySelector("[data-k=info]") as HTMLElement;
    const upd = () => {
      const size = q("size").value;
      const ppi = Number(q("ppi").value) || 300;
      let long = Math.max(L.canvasW, L.canvasH);
      if (size === "long") long = Number(q("long").value);
      if (size.startsWith("paper:")) long = printLongEdge(size.slice(6), ppi);
      const sc = long / Math.max(L.canvasW, L.canvasH);
      const w = Math.round(L.canvasW * sc), hh = Math.round(L.canvasH * sc);
      info.textContent = `Output ${w}×${hh} px · ${(w / ppi * 2.54).toFixed(1)}×${(hh / ppi * 2.54).toFixed(1)} cm at ${ppi} ppi${sc > 1.001 ? " · enlarged (Lanczos)" : ""}`;
      if (q("format").value === "jpeg") q("bits").value = "8";
    };
    form.addEventListener("input", upd);
    upd();
    const bar = form.querySelector(".progress > div") as HTMLElement;
    const report = form.querySelector(".report") as HTMLElement;
    const go = async () => {
      const fmt = q("format").value as ExportOptions["format"];
      const ext = fmt === "jpeg" ? "jpg" : fmt === "tiff" ? "tif" : "png";
      const base = (this.path ?? "photo").replace(/\.[^.\/]+$/, "");
      const p = await pickFile({ title: "Export to", save: true, defaultPath: `${base}-fixer.${ext}`, filters: [{ name: fmt.toUpperCase(), extensions: [ext] }] });
      if (!p) return;
      const size = q("size").value;
      const ppi = Number(q("ppi").value) || 300;
      let longEdge: number | null = null;
      if (size === "long") longEdge = Number(q("long").value);
      if (size.startsWith("paper:")) longEdge = printLongEdge(size.slice(6), ppi);
      try {
        const rep = await this.exportTo({
          path: p, format: fmt, bitDepth: fmt === "jpeg" ? 8 : (Number(q("bits").value) as 8 | 16), quality: Number(q("quality").value),
          colorSpace: q("cs").value as any, ppi, tiffCompression: q("tiffc").value as any, longEdge, tile: 1024,
          metadata: { artist: q("artist").value, copyright: q("copyright").value },
        }, (d, t) => { bar.style.width = `${(d / t) * 100}%`; });
        report.textContent = `Saved and verified by reading the file back:\n${p}\n${rep.format} · ${rep.width}×${rep.height} px · ${rep.bitsPerChannel}-bit\nPPI ${rep.ppiX?.toFixed(2)} × ${rep.ppiY?.toFixed(2)}\nICC: ${rep.iccDescription}\n${(rep.fileBytes / 1e6).toFixed(2)} MB`;
      } catch (e) { report.textContent = `Export failed: ${e}`; }
    };
    this.modal("Export", form, [button("Export…", go, { class: "accent" })]);
  }

  async exportTo(o: ExportOptions, progress?: (d: number, t: number) => void): Promise<FileReport> {
    const t0 = performance.now();
    const rep = await exportImage(this.r, this.s, o, progress);
    this.toast(`Exported ${rep.width}×${rep.height} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    this.requestRender();
    return rep;
  }

  helpDialog() {
    const rows = [
      ["⌘O", "Open photo"], ["⌘E", "Export"], ["⌘Z / ⇧⌘Z", "Undo / redo"], ["\\", "Before / after"], ["Y", "Split compare"],
      ["J", "Clipping warning"], ["Z", "Toggle 100% / fit"], ["⌘0", "Fit"], ["⌘= / ⌘-", "Zoom in / out"], ["⇧⌘C / ⇧⌘V", "Copy / paste settings"],
      ["⇧⌘R", "Reset all"], ["⌘S", "Save sidecar now"], ["⇧⌘N", "New snapshot"], ["Double-click slider", "Reset slider"],
      ["Alt + drag slider", "Fine adjust"], ["← →  (⇧ ×10)", "Nudge focused slider"], ["Drag / scroll", "Pan when zoomed"], ["⌘ + scroll / pinch", "Zoom at cursor"],
    ];
    this.modal("Keyboard shortcuts", h("table", { class: "keys" }, ...rows.map(([k, d]) => h("tr", {}, h("td", {}, k), h("td", {}, d)))), []);
  }

  private bindKeys() {
    window.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const dpr = window.devicePixelRatio || 1;
      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
      else if (mod && k === "y") { e.preventDefault(); this.redo(); }
      else if (mod && k === "o") { e.preventDefault(); this.openDialog(); }
      else if (mod && k === "e") { e.preventDefault(); this.exportDialog(); }
      else if (mod && k === "s") { e.preventDefault(); this.saveSidecar().then(() => this.toast("Saved")); }
      else if (mod && e.shiftKey && k === "c") { e.preventDefault(); this.copySettings(); }
      else if (mod && e.shiftKey && k === "v") { e.preventDefault(); this.pasteSettings(); }
      else if (mod && e.shiftKey && k === "r") { e.preventDefault(); this.resetAll(); }
      else if (mod && e.shiftKey && k === "n") { e.preventDefault(); this.history.addSnapshot(`Snapshot ${this.history.snapshots.length + 1}`, this.s); this.scheduleSidecar(); this.renderLeft(); }
      else if (mod && k === "0") { e.preventDefault(); this.fit = true; this.requestRender(); }
      else if (mod && (k === "=" || k === "+")) { e.preventDefault(); this.zoomTo(((this.fit ? this.fitZoom(this.layout()) : this.zoom) / dpr) * 2); }
      else if (mod && k === "-") { e.preventDefault(); this.zoomTo(((this.fit ? this.fitZoom(this.layout()) : this.zoom) / dpr) / 2); }
      else if (!mod && k === "\\") { this.showBefore = !this.showBefore; this.requestRender(); }
      else if (!mod && k === "y") { this.split = !this.split; this.requestRender(); }
      else if (!mod && k === "j") { this.clip = !this.clip; this.requestRender(); }
      else if (!mod && k === "z") { if (this.fit) this.zoomTo(1); else { this.fit = true; this.requestRender(); } }
    });
  }
}

export function exposeTestHooks(app: App) {
  (window as any).ffl = {
    app,
    open: (p: string) => app.open(p),
    set: (path: string, v: any) => app.set(path, v, false, "test"),
    replace: (s: Partial<Settings>) => { app.s = normalize({ ...app.s, ...s } as Settings); app.rebuild(); app.requestRender(); },
    settings: () => clone(app.s),
    renderNow: () => app.renderNow(),
    exportTo: (o: ExportOptions) => app.exportTo(o),
    renderer: app.r,
    platform,
    film: { ...filmModel, getStock },
    grain: grainModel,
    presets,
    openImage,
    call,
  };
}
