// Tiled full-resolution export: renders the canvas in GPU tiles, streams float tiles to the Rust core,
// which converts to the target colour space with LittleCMS, encodes, writes PPI/ICC, and reads the
// file back for verification.
import type { Renderer } from "./renderer";
import type { Settings } from "../state/settings";
import { call, callRaw } from "../platform";

export type ExportFormat = "jpeg" | "png" | "tiff";
export type ColorSpaceId = "srgb" | "p3" | "adobergb" | "prophoto";

export interface ExportOptions {
  path: string;
  format: ExportFormat;
  bitDepth: 8 | 16;
  quality: number;
  colorSpace: ColorSpaceId;
  ppi: number;
  tiffCompression: "none" | "lzw" | "deflate" | "packbits";
  /** Size: null = native, or a long-edge pixel count for the whole canvas */
  longEdge: number | null;
  tile: number;
  metadata?: { artist?: string; copyright?: string; description?: string };
}

export interface FileReport {
  format: string; width: number; height: number; bitsPerChannel: number;
  ppiX: number | null; ppiY: number | null; iccDescription: string | null; fileBytes: number;
}

export const PAPER_MM: Record<string, [number, number]> = {
  A5: [148, 210], A4: [210, 297], A3: [297, 420], A2: [420, 594],
  "4x6 in": [101.6, 152.4], "5x7 in": [127, 177.8], "8x10 in": [203.2, 254], "11x14 in": [279.4, 355.6], "13x19 in": [330.2, 482.6],
};

/** Long edge in px for a paper size at a PPI (long edge of the paper). */
export function printLongEdge(paper: string, ppi: number): number {
  const mm = PAPER_MM[paper];
  return Math.round((Math.max(...mm) / 25.4) * ppi);
}

export async function exportImage(r: Renderer, s: Settings, o: ExportOptions, progress?: (done: number, total: number) => void): Promise<FileReport> {
  const L = r.layout(s, o.longEdge ?? undefined);
  const W = L.canvasW, H = L.canvasH;
  const spec = {
    path: o.path, format: o.format, width: W, height: H, bitDepth: o.bitDepth, quality: o.quality, colorSpace: o.colorSpace,
    ppi: o.ppi, tiffCompression: o.tiffCompression, metadata: { artist: "", copyright: "", description: "", ...(o.metadata ?? {}) },
  };
  const { id } = await call<{ id: number }>("export_begin", { spec });
  const T = o.tile;
  const tiles: [number, number, number, number][] = [];
  for (let y = 0; y < H; y += T) for (let x = 0; x < W; x += T) tiles.push([x, y, Math.min(T, W - x), Math.min(T, H - y)]);
  try {
    let done = 0;
    for (const [x, y, w, h] of tiles) {
      const t = r.renderRegion(s, L, { region: { x, y, w, h }, k: 1, exportMode: true });
      const px = r.g.readRGBA(t, 0, 0, w, h);
      r.g.release(t);
      await callRaw("export_tile", { id, x, y, w, h }, new Uint8Array(px.buffer));
      progress?.(++done, tiles.length);
      // yield so the UI stays responsive
      await new Promise((res) => setTimeout(res, 0));
    }
    return await call<FileReport>("export_finish", { id });
  } catch (e) {
    await call("export_cancel", { id }).catch(() => {});
    throw e;
  } finally {
    r.dropExportSource();
    r.g.trimPool();
  }
}
