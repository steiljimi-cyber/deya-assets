// Bridge to the Rust core: Tauri IPC in the app, HTTP to the dev/test server in a browser.
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const platform = { isTauri };

async function tauriInvoke(): Promise<typeof import("@tauri-apps/api/core").invoke> {
  return (await import("@tauri-apps/api/core")).invoke;
}

export async function callBytes(cmd: string, args: Record<string, unknown> = {}): Promise<ArrayBuffer> {
  if (isTauri) {
    const invoke = await tauriInvoke();
    const r = await invoke<ArrayBuffer | number[]>("call", { cmd, args });
    return r instanceof ArrayBuffer ? r : new Uint8Array(r).buffer;
  }
  const res = await fetch(`/api/${cmd}`, { method: "POST", body: JSON.stringify(args), headers: { "content-type": "application/json" } });
  if (!res.ok) throw new Error(await res.text());
  return res.arrayBuffer();
}

export async function call<T = any>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const b = await callBytes(cmd, args);
  return JSON.parse(new TextDecoder().decode(b)) as T;
}

export async function callRaw<T = any>(cmd: string, args: Record<string, unknown>, body: ArrayBuffer | Uint8Array): Promise<T> {
  let out: ArrayBuffer;
  if (isTauri) {
    const invoke = await tauriInvoke();
    const r = await invoke<ArrayBuffer | number[]>("call_raw", body instanceof Uint8Array ? body : new Uint8Array(body), {
      headers: { "x-cmd": cmd, "x-args": JSON.stringify(args) },
    });
    out = r instanceof ArrayBuffer ? r : new Uint8Array(r).buffer;
  } else {
    const res = await fetch(`/api/${cmd}?args=${encodeURIComponent(JSON.stringify(args))}`, { method: "POST", body: body as BodyInit });
    if (!res.ok) throw new Error(await res.text());
    out = await res.arrayBuffer();
  }
  return JSON.parse(new TextDecoder().decode(out)) as T;
}

export interface DecodedImage {
  info: { width: number; height: number; sourceWidth: number; sourceHeight: number; format: string; bitsPerChannel: number; sourceProfile: string };
  pixels: Uint16Array; // RGBA half floats
}

export function unpackImage(buf: ArrayBuffer): DecodedImage {
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true);
  const info = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
  const off = 4 + n;
  return { info, pixels: new Uint16Array(buf, off, info.width * info.height * 4) };
}

export async function openImage(path: string) {
  return unpackImage(await callBytes("open_image", { path }));
}
export async function openTexture(path: string, max = 4096) {
  return unpackImage(await callBytes("open_texture", { path, max }));
}

export async function pickFile(opts: { title?: string; filters?: { name: string; extensions: string[] }[]; directory?: boolean; save?: boolean; defaultPath?: string }): Promise<string | null> {
  if (isTauri) {
    const d = await import("@tauri-apps/plugin-dialog");
    if (opts.save) return (await d.save({ title: opts.title, filters: opts.filters, defaultPath: opts.defaultPath })) ?? null;
    const r = await d.open({ title: opts.title, filters: opts.filters, directory: opts.directory, multiple: false });
    return (Array.isArray(r) ? r[0] : r) ?? null;
  }
  // browser / test mode: type a path on the machine running the dev server
  return window.prompt(opts.title ?? "Path", opts.defaultPath ?? "") || null;
}

export async function appDataDir(): Promise<string> {
  if (isTauri) {
    const p = await import("@tauri-apps/api/path");
    return await p.appDataDir();
  }
  const home = await call<string | null>("home_dir");
  return `${home ?? "/tmp"}/.fixer-film-lab`;
}
