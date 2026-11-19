// Small DOM toolkit for the editor panels. Every control is bound to a settings path.
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}

export function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj: any, path: string, v: any) {
  const ks = path.split(".");
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = v;
}

export interface Binding {
  get(path: string): any;
  set(path: string, v: any, live: boolean, label: string): void;
}

export interface SliderOpts { min: number; max: number; step?: number; def?: number; fmt?: (v: number) => string; label: string; path: string; center?: boolean }

/** Slider: drag (Alt = fine), double-click label/track to reset, type an exact value, arrow keys. */
export function slider(b: Binding, o: SliderOpts) {
  const step = o.step ?? 1;
  const def = o.def ?? (o.min < 0 ? 0 : o.min);
  const fmt = o.fmt ?? ((v: number) => (step < 1 ? v.toFixed(step < 0.1 ? 2 : 1) : String(Math.round(v))));
  const fill = h("div", { class: "sl-fill" });
  const thumb = h("div", { class: "sl-thumb" });
  const track = h("div", { class: "sl-track", tabindex: "0", role: "slider", "aria-label": o.label, "data-path": o.path }, fill, thumb);
  const val = h("input", { class: "sl-val", type: "text", spellcheck: "false" }) as HTMLInputElement;
  const lab = h("label", { class: "sl-label", title: "Double-click to reset" }, o.label);
  const root = h("div", { class: "slider", "data-path": o.path }, h("div", { class: "sl-head" }, lab, val), track);
  const clamp = (v: number) => Math.min(o.max, Math.max(o.min, Math.round(v / step) * step));
  const paint = () => {
    const v = Number(b.get(o.path) ?? def);
    const t = (v - o.min) / (o.max - o.min);
    const z = o.min < 0 && o.center !== false ? (0 - o.min) / (o.max - o.min) : 0;
    fill.style.left = `${Math.min(t, z) * 100}%`;
    fill.style.width = `${Math.abs(t - z) * 100}%`;
    thumb.style.left = `${t * 100}%`;
    if (document.activeElement !== val) val.value = fmt(v);
    root.classList.toggle("changed", Math.abs(v - def) > 1e-9);
  };
  const setV = (v: number, live: boolean) => { b.set(o.path, clamp(v), live, o.label); paint(); };
  let dragging = false, startX = 0, startV = 0;
  track.addEventListener("pointerdown", (e) => {
    track.setPointerCapture(e.pointerId);
    dragging = true;
    const r = track.getBoundingClientRect();
    startX = e.clientX;
    startV = Number(b.get(o.path));
    if (!e.altKey && (e.target as HTMLElement) !== thumb) setV(o.min + ((e.clientX - r.left) / r.width) * (o.max - o.min), true);
    startV = Number(b.get(o.path));
  });
  track.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const r = track.getBoundingClientRect();
    const fine = e.altKey ? 0.1 : 1;
    setV(startV + ((e.clientX - startX) / r.width) * (o.max - o.min) * fine, true);
  });
  const end = () => { if (dragging) { dragging = false; setV(Number(b.get(o.path)), false); } };
  track.addEventListener("pointerup", end);
  track.addEventListener("pointercancel", end);
  track.addEventListener("dblclick", () => setV(def, false));
  lab.addEventListener("dblclick", () => setV(def, false));
  track.addEventListener("keydown", (e) => {
    const big = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { setV(Number(b.get(o.path)) + step * big, false); e.preventDefault(); e.stopPropagation(); }
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { setV(Number(b.get(o.path)) - step * big, false); e.preventDefault(); e.stopPropagation(); }
  });
  val.addEventListener("change", () => { const n = parseFloat(val.value); if (!isNaN(n)) setV(n, false); else paint(); });
  val.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") val.blur(); });
  paint();
  (root as any).refresh = paint;
  return root;
}

export function select(b: Binding, o: { label: string; path: string; options: [string, string][]; onChange?: (v: string) => void }) {
  const sel = h("select", { "data-path": o.path }) as HTMLSelectElement;
  for (const [v, l] of o.options) sel.append(h("option", { value: v }, l));
  const paint = () => { sel.value = String(b.get(o.path)); };
  sel.addEventListener("change", () => {
    const cur = b.get(o.path);
    const v = typeof cur === "number" ? Number(sel.value) : sel.value;
    b.set(o.path, v, false, o.label);
    o.onChange?.(sel.value);
  });
  sel.addEventListener("keydown", (e) => e.stopPropagation());
  paint();
  const root = h("div", { class: "row" }, h("label", {}, o.label), sel);
  (root as any).refresh = paint;
  return root;
}

export function toggle(b: Binding, o: { label: string; path: string }) {
  const cb = h("input", { type: "checkbox", "data-path": o.path }) as HTMLInputElement;
  const paint = () => { cb.checked = !!b.get(o.path); };
  cb.addEventListener("change", () => b.set(o.path, cb.checked, false, o.label));
  paint();
  const root = h("label", { class: "row toggle" }, cb, h("span", {}, o.label));
  (root as any).refresh = paint;
  return root;
}

export function colorInput(b: Binding, o: { label: string; path: string }) {
  const inp = h("input", { type: "color", "data-path": o.path }) as HTMLInputElement;
  const paint = () => { inp.value = String(b.get(o.path)); };
  inp.addEventListener("input", () => b.set(o.path, inp.value, true, o.label));
  inp.addEventListener("change", () => b.set(o.path, inp.value, false, o.label));
  paint();
  const root = h("div", { class: "row" }, h("label", {}, o.label), inp);
  (root as any).refresh = paint;
  return root;
}

export function textInput(b: Binding, o: { label: string; path: string }) {
  const inp = h("input", { type: "text", "data-path": o.path, spellcheck: "false" }) as HTMLInputElement;
  const paint = () => { if (document.activeElement !== inp) inp.value = String(b.get(o.path) ?? ""); };
  inp.addEventListener("input", () => b.set(o.path, inp.value, true, o.label));
  inp.addEventListener("change", () => b.set(o.path, inp.value, false, o.label));
  inp.addEventListener("keydown", (e) => e.stopPropagation());
  paint();
  const root = h("div", { class: "row" }, h("label", {}, o.label), inp);
  (root as any).refresh = paint;
  return root;
}

export function section(title: string, body: HTMLElement[], opts: { open?: boolean; id?: string; onReset?: () => void } = {}) {
  const content = h("div", { class: "sec-body" }, ...body);
  const reset = opts.onReset ? h("button", { class: "sec-reset", title: "Reset section", onclick: (e: Event) => { e.stopPropagation(); opts.onReset!(); } }, "↺") : null;
  const head = h("div", { class: "sec-head" }, h("span", { class: "caret" }, "▸"), h("span", {}, title), reset);
  const root = h("section", { class: "sec" + (opts.open ? " open" : ""), "data-sec": opts.id ?? title }, head, content);
  head.addEventListener("click", () => root.classList.toggle("open"));
  return root;
}

export function button(label: string, onclick: () => void, attrs: Record<string, any> = {}) {
  return h("button", { ...attrs, onclick }, label);
}

export function refreshAll(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".slider, .row, .curve-wrap").forEach((el) => (el as any).refresh?.());
}
