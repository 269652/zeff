import { getPref, setPref } from "@/lib/prefs";
import { promptText } from "@/lib/prompts";
import { TASTE_INSTRUCTIONS, TASTE_SCHEMA, fallbackTaste, matchTaste, tastePrompt, type Signal, type Taste, type Update } from "./taste-core";
export { TASTE_INSTRUCTIONS, fallbackTaste, matchTaste, tastePrompt, type Signal, type Taste };
import { getPrefs, tasteSignals } from "./store";

/**
 * Your taste, written down: a short description of what you like to read, kept by Zeff and growing as you go. Every article you
 * like (👍), save (🔖) or reject (👎) is a signal; the signals are fed — a few at a time — to the AI together with the current
 * description, which rewrites it: new likes added, vague ones sharpened, contradictions out. Along with the text it keeps the
 * terms you like, the ones you avoid and searches that would find more. This description is the basis of Discover: it plans
 * the searches for new sources and is matched against the unread news already fetched. Without an AI the description is built
 * from the tags of what you liked. You can edit it yourself; the AI continues from your version.
 */
const KEY = "news:taste";
const EMPTY: Taste = { text: "", likes: [], avoids: [], queries: [], updatedAt: null, pending: [], edited: false };

export const getTaste = (): Taste => ({ ...EMPTY, ...getPref<Partial<Taste>>(KEY, {}) });
export const setTaste = (patch: Partial<Taste>): Taste => {
  const next = { ...getTaste(), ...patch };
  setPref(KEY, next);
  return next;
};

/** A like, a save or a dislike on an item: queued for the next update of the description (the opposite one for the same item replaces it). */
export function recordSignal(item: { id: number; title: string; summary: string; terms?: string[] }, kind: Signal["kind"]): void {
  const t = getTaste();
  const rest = t.pending.filter((p) => p.id !== item.id || p.kind === kind);
  if (rest.some((p) => p.id === item.id && p.kind === kind)) return;
  setTaste({ pending: [...rest, { id: item.id, kind, title: item.title, summary: item.summary.slice(0, 300), tags: (item.terms ?? []).slice(0, 4), at: new Date().toISOString() }].slice(-60) });
}

/** A signal taken back (the 👍 removed, the 🔖 undone): it leaves the queue. */
export function withdrawSignal(itemId: number, kind: Signal["kind"]): void {
  const t = getTaste();
  if (t.pending.some((p) => p.id === itemId && p.kind === kind)) setTaste({ pending: t.pending.filter((p) => !(p.id === itemId && p.kind === kind)) });
}

export type TasteDeps = { ask?: (prompt: string) => Promise<Update>; profile?: () => Promise<string[]> | string[]; batch?: number; now?: () => number };

let updating = false;

/** Feeds the queued signals (up to `batch` at a time) to the AI with the current description, and keeps what comes back. Returns how many signals were taken in. */
export async function updateTaste(deps: TasteDeps = {}): Promise<number> {
  if (updating) return 0;
  const cur = getTaste();
  const batch = cur.pending.slice(0, deps.batch ?? 12);
  if (!batch.length) return 0;
  updating = true;
  try {
    const profile = await (deps.profile ?? (async () => (await import("./similar")).profileLines("")))();
    let out: Update | null = null;
    try {
      const ask =
        deps.ask ??
        (await (async () => {
          const { isInstalled } = await import("@/plugins/state");
          if (!isInstalled("llm")) return null;
          const { runAi } = await import("@/lib/ai");
          return async (prompt: string) => (await runAi<Update>(prompt, TASTE_SCHEMA, { task: "news-taste", timeoutMs: 3 * 60000, maxBudgetUsd: 0.2 })).output;
        })());
      if (ask) out = await ask(tastePrompt(cur, batch, profile, promptText("news-taste", TASTE_INSTRUCTIONS)));
    } catch {
      out = null;
    }
    const clean = (l: unknown, n: number) => [...new Set((Array.isArray(l) ? l : []).filter((x): x is string => typeof x === "string").map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length >= 2 && x.length <= 60))].slice(0, n);
    const next = out?.description && out.description.trim().length >= 20 ? out : fallbackTaste(cur, batch);
    setTaste({
      text: String(next.description ?? cur.text).trim().slice(0, 1200),
      likes: clean(next.likes, 12),
      avoids: clean(next.avoids, 8),
      queries: clean(next.queries, 6),
      updatedAt: new Date((deps.now ?? Date.now)()).toISOString(),
      // The batch is taken in; signals that came meanwhile stay queued.
      pending: getTaste().pending.filter((p) => !batch.some((b) => b.id === p.id && b.kind === p.kind)),
      edited: false,
    });
    return batch.length;
  } finally {
    updating = false;
  }
}

/** A like or save: the update runs half a minute later (a burst of them becomes one call). */
const g = globalThis as { __zeffTasteTimer?: ReturnType<typeof setTimeout> };
export function scheduleTasteUpdate(ms = 30_000): void {
  if (g.__zeffTasteTimer) clearTimeout(g.__zeffTasteTimer);
  g.__zeffTasteTimer = setTimeout(() => {
    g.__zeffTasteTimer = undefined;
    void updateTaste().catch(() => undefined);
  }, ms);
  g.__zeffTasteTimer.unref?.();
}

/** The first time: what was liked and saved before this existed becomes the first signals. */
export function seedFromHistory(limit = 24): number {
  const t = getTaste();
  if (t.text || t.pending.length) return 0;
  const signals = tasteSignals(limit);
  if (signals.length) setTaste({ pending: signals });
  return signals.length;
}

export const tasteReady = () => {
  const t = getTaste();
  return !!(t.text || t.likes.length || getPrefs().interests.length);
};
