// "Edits": saved looks. Built-in starters plus the user's own, stored as JSON files.
import { call, appDataDir } from "../platform";
import { GROUPS, normalize, pickGroups, applyGroups, type Settings, defaultSettings } from "./settings";

export interface Edit {
  name: string;
  groups: string[];
  settings: Partial<Settings>;
  builtin?: boolean;
  file?: string;
}

export const EDIT_FILE_TYPE = "fixer-film-lab-edit";
const ALL = Object.keys(GROUPS);
const NO_MOTION = ALL.filter((g) => g !== "Motion blur");

function mk(name: string, f: (s: Settings) => void, groups = NO_MOTION): Edit {
  const s = defaultSettings();
  f(s);
  return { name, groups, settings: pickGroups(s, groups), builtin: true };
}

export const BUILTIN_EDITS: Edit[] = [
  mk("Hiromix Flash '97", (s) => {
    s.film.stock = "snapshot-97"; s.grain.amount = 45; s.grain.size = 55; s.halation.amount = 20;
    s.dateStamp.enabled = true; s.color.temperature = -6; s.vignette.amount = -10;
  }),
  mk("Everyday 400 Classic", (s) => { s.film.stock = "everyday-400"; s.grain.amount = 40; s.halation.amount = 25; }),
  mk("Portrait Soft", (s) => { s.film.stock = "portrait-400"; s.grain.amount = 25; s.halation.amount = 15; s.light.highlights = -10; }),
  mk("Night Halo", (s) => { s.film.stock = "cine-800t-halo"; s.grain.amount = 45; s.halation.amount = 70; s.halation.spread = 45; s.halation.threshold = 40; s.bloom.amount = 15; }),
  mk("Street B&W", (s) => { s.film.stock = "tri-400"; s.grain.amount = 55; s.grain.size = 55; s.light.contrast = 15; s.vignette.amount = -15; }),
  mk("Expired Summer", (s) => { s.film.stock = "expired-200"; s.grain.amount = 55; s.fade = 15; s.lightLeak.amount = 35; s.lightLeak.style = 0; s.dust.amount = 25; s.color.temperature = 8; }),
  mk("Velvet Landscape", (s) => { s.film.stock = "velvet-50"; s.grain.amount = 20; s.vignette.amount = -12; }),
  mk("Instant Memory", (s) => { s.film.stock = "instant-color"; s.grain.amount = 20; s.softFocus.amount = 15; s.border.type = "instant"; s.border.variant = "square"; s.vignette.amount = -18; }),
  mk("Contact Sheet", (s) => { s.film.stock = "hp-400"; s.grain.amount = 45; s.border.type = "contact-sheet"; s.border.frameNumber = 14; }),
  mk("Scanned 35mm", (s) => { s.film.stock = "everyday-400"; s.grain.amount = 40; s.border.type = "scan-negative"; s.dust.amount = 20; s.dust.hairs = 15; }),
];

async function editsDir() {
  return `${await appDataDir()}/edits`;
}

export function toFile(e: Edit): string {
  return JSON.stringify({ type: EDIT_FILE_TYPE, version: 1, name: e.name, groups: e.groups, settings: e.settings }, null, 2);
}

export function fromFile(text: string): Edit {
  const j = JSON.parse(text);
  if (j.type !== EDIT_FILE_TYPE) throw new Error("Not a Fixer Film Lab edit file");
  const groups = (j.groups as string[]).filter((g) => g in GROUPS);
  return { name: String(j.name || "Imported edit"), groups, settings: j.settings ?? {} };
}

export async function listUserEdits(): Promise<Edit[]> {
  const dir = await editsDir();
  const files = await call<string[]>("list_dir", { dir, ext: "ffedit" }).catch(() => [] as string[]);
  const out: Edit[] = [];
  for (const f of files) {
    try {
      const t = await call<string | null>("read_text", { path: f });
      if (t) out.push({ ...fromFile(t), file: f });
    } catch { /* skip broken files */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function safeName(n: string) {
  return n.replace(/[^\w\- '().]+/g, "_").slice(0, 80) || "edit";
}

export async function saveUserEdit(e: Edit): Promise<string> {
  const path = `${await editsDir()}/${safeName(e.name)}.ffedit`;
  await call("write_text", { path, text: toFile(e) });
  return path;
}

export async function deleteUserEdit(e: Edit) {
  if (e.file) await call("delete_file", { path: e.file });
}

export function applyEdit(cur: Settings, e: Edit): Settings {
  return applyGroups(cur, normalize({ ...cur, ...e.settings } as Settings), e.groups);
}
