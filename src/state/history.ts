import { clone, normalize, type Settings } from "./settings";

export interface HistoryEntry {
  label: string;
  settings: Settings;
  time: number;
}
export interface Snapshot {
  name: string;
  settings: Settings;
  time: number;
}

/** Full undo history (linear, branch is dropped on new edit like Lightroom) plus named snapshots. */
export class History {
  entries: HistoryEntry[] = [];
  index = -1;
  snapshots: Snapshot[] = [];
  limit = 1000;

  reset(s: Settings, label = "Open") {
    this.entries = [{ label, settings: clone(s), time: Date.now() }];
    this.index = 0;
  }

  /** Record a committed change. Consecutive edits of the same control merge. */
  push(s: Settings, label: string) {
    const cur = this.entries[this.index];
    if (cur && JSON.stringify(cur.settings) === JSON.stringify(s)) return;
    this.entries = this.entries.slice(0, this.index + 1);
    const prev = this.entries[this.entries.length - 1];
    if (prev && prev.label === label && Date.now() - prev.time < 1500 && this.entries.length > 1) {
      prev.settings = clone(s);
      prev.time = Date.now();
    } else {
      this.entries.push({ label, settings: clone(s), time: Date.now() });
      if (this.entries.length > this.limit) this.entries.shift();
    }
    this.index = this.entries.length - 1;
  }

  canUndo() { return this.index > 0; }
  canRedo() { return this.index < this.entries.length - 1; }
  undo(): Settings | null {
    if (!this.canUndo()) return null;
    this.index--;
    return clone(this.entries[this.index].settings);
  }
  redo(): Settings | null {
    if (!this.canRedo()) return null;
    this.index++;
    return clone(this.entries[this.index].settings);
  }
  goto(i: number): Settings | null {
    if (i < 0 || i >= this.entries.length) return null;
    this.index = i;
    return clone(this.entries[i].settings);
  }

  addSnapshot(name: string, s: Settings) {
    this.snapshots.push({ name, settings: clone(s), time: Date.now() });
  }

  toJSON() {
    return { entries: this.entries, index: this.index, snapshots: this.snapshots };
  }
  static fromJSON(j: any, fallback: Settings): History {
    const h = new History();
    if (j?.entries?.length) {
      h.entries = j.entries.map((e: any) => ({ ...e, settings: normalize(e.settings) }));
      h.index = Math.min(j.index ?? h.entries.length - 1, h.entries.length - 1);
    } else h.reset(fallback);
    h.snapshots = (j?.snapshots ?? []).map((s: any) => ({ ...s, settings: normalize(s.settings) }));
    return h;
  }
}
