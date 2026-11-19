// Tone curve editor: master RGB + red/green/blue. Click to add, drag to move, double-click to remove.
import { h } from "./controls";
import { monotoneCurve } from "../engine/curves";
import type { CurvePoint, Settings } from "../state/settings";

export function curveEditor(get: () => Settings, set: (ch: "rgb" | "r" | "g" | "b", pts: CurvePoint[], live: boolean) => void) {
  let ch: "rgb" | "r" | "g" | "b" = "rgb";
  const cv = h("canvas", { class: "curve", width: "560", height: "560" }) as HTMLCanvasElement;
  const tabs = h("div", { class: "tabs small" });
  const colors: Record<string, string> = { rgb: "#d0d0d0", r: "#e05555", g: "#55c06a", b: "#5a8be8" };
  (["rgb", "r", "g", "b"] as const).forEach((c) => {
    const t = h("button", { class: c === ch ? "on" : "", onclick: () => { ch = c; tabs.querySelectorAll("button").forEach((x) => x.classList.remove("on")); t.classList.add("on"); draw(); } }, c.toUpperCase());
    tabs.append(t);
  });
  const ctx = cv.getContext("2d")!;
  const W = 560, P = 14;
  const toPx = (p: CurvePoint): [number, number] => [P + p[0] * (W - 2 * P), W - P - p[1] * (W - 2 * P)];
  const fromPx = (x: number, y: number): CurvePoint => [Math.min(1, Math.max(0, (x - P) / (W - 2 * P))), Math.min(1, Math.max(0, (W - P - y) / (W - 2 * P)))];
  function draw() {
    const s = get();
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = "#181818";
    ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = "#2c2c2c";
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      const x = P + (i / 4) * (W - 2 * P);
      ctx.beginPath(); ctx.moveTo(x, P); ctx.lineTo(x, W - P); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(P, x); ctx.lineTo(W - P, x); ctx.stroke();
    }
    ctx.strokeStyle = "#3a3a3a";
    ctx.beginPath(); ctx.moveTo(P, W - P); ctx.lineTo(W - P, P); ctx.stroke();
    for (const c of ["r", "g", "b", "rgb"] as const) {
      if (c !== ch && c !== "rgb" && ch !== "rgb") continue;
      const f = monotoneCurve(s.curve[c]);
      ctx.strokeStyle = c === ch ? colors[c] : "#555";
      ctx.lineWidth = c === ch ? 3 : 1.5;
      ctx.beginPath();
      for (let i = 0; i <= 200; i++) {
        const x = i / 200;
        const [px, py] = toPx([x, f(x)]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    for (const p of s.curve[ch]) {
      const [x, y] = toPx(p);
      ctx.fillStyle = "#1c1c1c";
      ctx.strokeStyle = colors[ch];
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  let drag = -1;
  const pos = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * W];
  };
  cv.addEventListener("pointerdown", (e) => {
    cv.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    const pts = get().curve[ch].map((p) => [...p] as CurvePoint);
    drag = pts.findIndex((p) => { const [px, py] = toPx(p); return Math.hypot(px - x, py - y) < 22; });
    if (drag < 0) {
      pts.push(fromPx(x, y));
      pts.sort((a, b) => a[0] - b[0]);
      drag = pts.findIndex((p) => { const [px, py] = toPx(p); return Math.hypot(px - x, py - y) < 2; });
      set(ch, pts, true);
    }
    draw();
  });
  cv.addEventListener("pointermove", (e) => {
    if (drag < 0) return;
    const [x, y] = pos(e);
    const pts = get().curve[ch].map((p) => [...p] as CurvePoint);
    const np = fromPx(x, y);
    const lo = drag > 0 ? pts[drag - 1][0] + 0.01 : 0, hi = drag < pts.length - 1 ? pts[drag + 1][0] - 0.01 : 1;
    if (drag === 0) np[0] = Math.min(np[0], hi);
    else if (drag === pts.length - 1) np[0] = Math.max(np[0], lo);
    else np[0] = Math.min(hi, Math.max(lo, np[0]));
    pts[drag] = np;
    set(ch, pts, true);
    draw();
  });
  cv.addEventListener("pointerup", () => { if (drag >= 0) set(ch, get().curve[ch], false); drag = -1; });
  cv.addEventListener("dblclick", (e) => {
    const r = cv.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * W;
    const pts = get().curve[ch];
    const i = pts.findIndex((p) => { const [px, py] = toPx(p); return Math.hypot(px - x, py - y) < 22; });
    if (i > 0 && i < pts.length - 1) { set(ch, pts.filter((_, j) => j !== i), false); draw(); }
    else if (i < 0) { set(ch, [[0, 0], [1, 1]], false); draw(); }
  });
  const root = h("div", { class: "curve-wrap" }, tabs, cv, h("div", { class: "hint" }, "Click to add a point · drag · double-click a point to remove · double-click empty area to reset channel"));
  (root as any).refresh = draw;
  draw();
  return root;
}
