import { getPref, setPref } from "@/lib/prefs";
import { normalizeForm } from "./form-spec";
import { getFlow, saveFlow } from "./flows/store";
import { mergeLines, settleDoc, type Conflict, type Step } from "./merge-parts";
import { getInstalled, hashOf, MAX_HISTORY, read, write, type HistoryEntry } from "./package-registry";
import { getPage, setPageProps, updatePage, updateSchema } from "./store";
import type { DbSchema } from "./model";

/**
 * An app's update merged the way git merges (docs/extensions/workspace.md, "Updates merged like git"): the update brings in everything
 * only it changed and keeps everything only you changed at once; the spots both changed differently stay open — yours stands there
 * meanwhile — and the merge waits, with all three sides of each spot (the version before, yours, the update's). You settle each one:
 * keep yours, take the update's, both (a page's text: one after the other), or a value of your own (the AI may propose one), then finish
 * it — or abort: the whole app goes back to how it was before the update (its save point). While one is open, no further update of
 * that app is taken. Server only.
 */

export type Part = "schema" | "form" | "flow" | "doc";
export type Choice = "mine" | "theirs" | "both" | "edited";
export type MergeSpot = {
  /** Its number in the merge (1, 2, …). */
  n: number;
  /** The package's item and the page it is. */
  item: string;
  pageId: number;
  title: string;
  part: Part;
  where: string;
  path: Step[];
  base: unknown;
  mine: unknown;
  theirs: unknown;
  removed?: boolean;
  /** A text of lines both changed: git's markers around the lines both changed (what "edit" starts from). */
  marked?: string;
  choice?: Choice;
  /** What `edited` puts there. */
  value?: unknown;
  /** What the AI said of its proposal. */
  note?: string;
};
export type PendingAppMerge = { id: string; name: string; from: string; to: string; at: string; /** The save point kept before the update: abort goes back to it. */ savePoint: number | null; spots: MergeSpot[] };
export type SpotDraft = { item: string; pageId: number; title: string; part: Part; conflict: Conflict };

const PREF = "workspace.packages.merges";
const all = (): Record<string, PendingAppMerge> => {
  const v = getPref<unknown>(PREF, {});
  return v && typeof v === "object" ? (v as Record<string, PendingAppMerge>) : {};
};
const keep = (m: Record<string, PendingAppMerge>) => setPref(PREF, m);

/** The open merge of an app (null: none). */
export const pendingAppMerge = (id: string): PendingAppMerge | null => all()[id] ?? null;
/** Every open merge (the apps waiting for you). */
export const pendingAppMerges = (): PendingAppMerge[] => Object.values(all());
/** The open merge of the app a page belongs to (its top page or any page of it). */
export function pendingMergeOfPage(pageId: number): PendingAppMerge | null {
  const id = Object.values(read()).find((p) => p.rootId === pageId || Object.values(p.map).includes(pageId))?.id;
  return id ? pendingAppMerge(id) : null;
}

/** The open merge dropped without touching the app (a roll-back or an update that replaces your changes does the rest). */
export function dropAppMerge(id: string): void {
  const rest = all();
  if (!(id in rest)) return;
  delete rest[id];
  keep(rest);
}

/** Kept after an update that left spots open (package-life.ts updateTracked). */
export function openAppMerge(m: Omit<PendingAppMerge, "spots" | "at">, drafts: SpotDraft[]): PendingAppMerge | null {
  if (!drafts.length) return null;
  const spots = drafts.map((d, i): MergeSpot => {
    const c = d.conflict;
    const marked = typeof c.mine === "string" && typeof c.theirs === "string" ? mergeLines(typeof c.base === "string" ? c.base : "", c.mine, c.theirs).marked : undefined;
    return { n: i + 1, item: d.item, pageId: d.pageId, title: d.title, part: d.part, where: c.where, path: c.path ?? [], base: c.base, mine: c.mine, theirs: c.theirs, ...(c.removed ? { removed: true } : {}), ...(marked ? { marked } : {}) };
  });
  const merge: PendingAppMerge = { ...m, at: new Date().toISOString(), spots };
  keep({ ...all(), [m.id]: merge });
  return merge;
}

/** One spot settled (or unsettled: choice null). `edited`: the value of your own — a text, or for anything else JSON. */
export function settleSpot(id: string, n: number, choice: Choice | null, value?: unknown, note?: string): PendingAppMerge {
  const m = pendingAppMerge(id);
  if (!m) throw new Error("There is no open merge for this app.");
  const s = m.spots.find((x) => x.n === Number(n));
  if (!s) throw new Error(`The merge has no spot ${n}.`);
  if (choice === "both" && s.part !== "doc") throw new Error("“Both” is for a page's text — for this spot keep one side or write it yourself.");
  if (choice === "edited") {
    if (s.part === "doc") throw new Error("A page's text is settled by keeping one side or both — then change the page itself.");
    let v = value;
    if (typeof s.mine !== "string" && typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        throw new Error("This spot holds structure, not text: write it as JSON.");
      }
    }
    if (typeof v === "string" && /^(<{7}|={7}|>{7}|\|{7})/m.test(v)) throw new Error("Git's markers are still in it — take them out where you settled each place.");
    s.value = v;
    s.note = note;
  } else {
    delete s.value;
    delete s.note;
  }
  if (choice) s.choice = choice;
  else delete s.choice;
  keep({ ...all(), [id]: m });
  return m;
}

/** The AI's proposal for a spot (not applied): one value that keeps what both sides meant, and a sentence on it. */
export async function proposeSpot(id: string, n: number): Promise<{ value: unknown; text: string; note: string }> {
  const s = pendingAppMerge(id)?.spots.find((x) => x.n === Number(n));
  if (!s) throw new Error(`The merge has no spot ${n}.`);
  if (s.part === "doc") throw new Error("A page's text: keep one side or both, then change the page.");
  const text = (v: unknown) => (v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v, null, 2));
  const { aiMerge } = await import("@/lib/ext/merge-ai");
  const r = await aiMerge(`${s.title} — ${s.where}`, text(s.base), text(s.mine), text(s.removed ? undefined : s.theirs));
  let value: unknown = r.text;
  if (typeof s.mine !== "string") {
    try {
      value = JSON.parse(r.text);
    } catch {
      throw new Error("The AI's answer is no JSON — settle it yourself, or ask again.");
    }
  }
  return { value, text: r.text, note: r.note };
}

// ---------------------------------------------------------------------------
// Applying what was settled
// ---------------------------------------------------------------------------

const REMOVE = Symbol("remove");
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** `root` with the value at `path` replaced (REMOVE: taken out) — a copy; null: the path isn't there any more. */
export function setAt(root: unknown, path: Step[], value: unknown): unknown | null {
  if (!path.length) return value;
  const [step, ...rest] = path;
  if (typeof step === "string") {
    if (!isPlain(root)) return null;
    if (!rest.length) {
      const out = { ...root };
      if (value === REMOVE || value === undefined) delete out[step];
      else out[step] = value;
      return out;
    }
    const inner = setAt(root[step], rest, value);
    return inner === null ? null : { ...root, [step]: inner };
  }
  if (!Array.isArray(root)) return null;
  const at = root.findIndex((x) => isPlain(x) && String(x.id) === step.id);
  if (at < 0) return null;
  if (!rest.length) return value === REMOVE || value === undefined ? root.filter((_, k) => k !== at) : root.map((x, k) => (k === at ? value : x));
  const inner = setAt(root[at], rest, value);
  return inner === null ? null : root.map((x, k) => (k === at ? inner : x));
}

const stripFlow = (x: object) => {
  const { permissions: _p, requested: _r, pageId: _i, ...rest } = x as Record<string, unknown>;
  void [_p, _r, _i];
  return rest;
};

/** A part of a page as it is now, and how to keep it changed. */
function partOf(s: MergeSpot): { get: () => unknown; set: (v: unknown) => void } | null {
  const page = getPage(s.pageId);
  if (!page) return null;
  if (s.part === "schema") return { get: () => getPage(s.pageId)?.schema, set: (v) => updateSchema(s.pageId, v as DbSchema) };
  if (s.part === "form") return { get: () => (getPage(s.pageId)?.props as { form?: unknown } | undefined)?.form, set: (v) => setPageProps(s.pageId, { form: normalizeForm(v as never) }) };
  if (s.part === "flow") {
    const f = getFlow(s.pageId);
    if (!f) return null;
    return { get: () => stripFlow(getFlow(s.pageId)!), set: (v) => saveFlow(s.pageId, { ...(v as typeof f), permissions: getFlow(s.pageId)!.permissions }) };
  }
  return { get: () => getPage(s.pageId)?.content, set: (v) => updatePage(s.pageId, { content: v as never }) };
}

/**
 * The merge finished: each spot as you settled it put in place (yours stood there already), the pages counted as the package left them
 * again where you took the update's, a line in the app's history. Every spot must be settled first (as git asks), unless `rest` says
 * what the open ones get: "mine" or "theirs".
 */
export async function finishAppMerge(id: string, opts: { rest?: "mine" | "theirs" } = {}): Promise<{ applied: string[]; missing: string[] }> {
  const m = pendingAppMerge(id);
  if (!m) throw new Error("There is no open merge for this app.");
  const open = m.spots.filter((s) => !s.choice);
  if (open.length && !opts.rest) throw new Error(`Still open: ${open.map((s) => `${s.n} (${s.title} ${s.where})`).join(", ")}.`);
  const applied: string[] = [];
  const missing: string[] = [];
  for (const s of m.spots) {
    const choice = s.choice ?? opts.rest!;
    if (choice === "mine") {
      applied.push(`${s.title} ${s.where}: yours`);
      continue;
    }
    const part = partOf(s);
    if (!part) {
      missing.push(`${s.title} ${s.where}: the page is gone`);
      continue;
    }
    if (s.part === "doc") {
      const now = (part.get() ?? { type: "doc", content: [] }) as { content?: unknown[] };
      part.set(await settleDoc(s.base as never, now, s.theirs as never, choice === "both" ? "union" : "theirs"));
      applied.push(`${s.title} ${s.where}: ${choice === "both" ? "both" : "the update's"}`);
      continue;
    }
    const value = choice === "edited" ? s.value : s.removed ? REMOVE : s.theirs;
    const next = setAt(part.get(), s.path, value);
    if (next === null) {
      missing.push(`${s.title} ${s.where}: not there any more`);
      continue;
    }
    part.set(next);
    applied.push(`${s.title} ${s.where}: ${choice === "edited" ? "your own" : s.removed ? "removed, as the update has it" : "the update's"}`);
  }
  // What the pages are now counts as the package's: your next change shows again as yours.
  const inst = getInstalled(id);
  if (inst) {
    const regs = read();
    const me = regs[id];
    for (const s of m.spots) {
      const key = Object.entries(me.map).find(([, pid]) => pid === s.pageId)?.[0];
      if (key && m.spots.filter((x) => x.pageId === s.pageId).every((x) => (x.choice ?? opts.rest) !== "mine")) me.hashes[key] = hashOf(s.pageId);
    }
    const entry: HistoryEntry = { at: new Date().toISOString(), action: "update", from: m.from, to: m.to, changes: [`merge finished: ${applied.length} spot${applied.length === 1 ? "" : "s"} settled`, ...applied, ...missing] };
    me.history = [...me.history, entry].slice(-MAX_HISTORY);
    write(regs);
  }
  const rest = all();
  delete rest[id];
  keep(rest);
  return { applied, missing };
}

/** The merge aborted: the whole app back to how it was before the update (its save point), the merge dropped. */
export async function abortAppMerge(id: string): Promise<{ to: string | null }> {
  const m = pendingAppMerge(id);
  if (!m) throw new Error("There is no open merge for this app.");
  const rest = all();
  delete rest[id];
  keep(rest);
  if (m.savePoint === null) return { to: null };
  const { restoreSavePoint } = await import("./package-life");
  await restoreSavePoint(id, m.savePoint);
  // (the version installed is the one before again)
  const regs = read();
  if (regs[id]) {
    regs[id].version = m.from;
    write(regs);
  }
  return { to: m.from };
}
