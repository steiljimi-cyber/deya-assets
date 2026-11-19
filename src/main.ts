import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "@fontsource/inter/300.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/dm-serif-display/400.css";
import "@fontsource/vt323/400.css";
import "@fontsource/courier-prime/400.css";
import "./styles.css";
import { App, exposeTestHooks } from "./ui/app";
import { call, platform } from "./platform";

async function boot() {
  // make sure the bundled fonts are ready before any canvas text (rebate text, date stamp) is drawn
  await Promise.all(["Space Mono", "Inter", "DM Serif Display", "VT323", "Courier Prime"].map((f) => document.fonts.load(`16px "${f}"`).catch(() => null)));
  const root = document.getElementById("app")!;
  try {
    const app = new App(root);
    exposeTestHooks(app);
    const q = new URLSearchParams(location.search).get("open");
    if (q) app.open(q);
    else if (platform.isTauri) {
      const p = await call<string | null>("startup_path").catch(() => null);
      if (p) app.open(p);
    }
  } catch (e) {
    root.innerHTML = `<div class="fatal"><h2>Fixer Film Lab could not start</h2><pre>${String(e)}</pre></div>`;
    throw e;
  }
}
boot();
