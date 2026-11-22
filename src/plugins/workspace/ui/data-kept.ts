/**
 * The answers a <data> got, kept per what it was asked with — for this browser session, in memory (no size limit of localStorage:
 * a long list of done todos is kept too). Inputs changed back to something seen before (Done → Open → Done): its kept answer shows
 * at once, the fresh one replaces it behind (stale-while-revalidate). Generic: the key is the page, the source and the resolved with=.
 */

const MAX = 80;
const kept = new Map<string, unknown>();

/** The key of an answer: the page, the source (flow / lambda:… / do:…) and the inputs it was asked with (also localStorage's). */
export function keptKey(source: string, inputs: Record<string, unknown>): string {
  return `zeff.flowdata:${typeof location !== "undefined" ? location.pathname : ""}:${JSON.stringify([source, inputs])}`;
}

/**
 * preload="scope=done|worker; part=recap": per input, the other values it may take (a segmented control's, tabs') — at most 6 in all.
 */
export function preloadsOf(spec: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const part of spec.split(/[;,]/)) {
    const m = /^\s*([\p{L}_][\p{L}\p{N}_.]*)\s*=\s*(.*)$/u.exec(part);
    if (!m) continue;
    for (const v of m[2].split("|").map((s) => s.trim())) if (v && out.length < 6) out.push({ name: m[1], value: v });
  }
  return out;
}

/** The answer kept for this key — undefined: none. */
export function keptAnswer(key: string): unknown {
  if (!kept.has(key)) return undefined;
  const v = kept.get(key);
  // (Used again: the newest, the last to go.)
  kept.delete(key);
  kept.set(key, v);
  return v;
}

export function keepAnswer(key: string, value: unknown): void {
  kept.delete(key);
  kept.set(key, value);
  while (kept.size > MAX) kept.delete(kept.keys().next().value as string);
}

/** Every kept answer forgotten (tests; an account switched). */
export function forgetKept(): void {
  kept.clear();
}

/**
 * hold="filter, q": when only these inputs changed (a search typed), the answer on screen stays while the new one loads — it is the
 * same list, narrowed. A text typed on or taken back by a few letters counts as held by itself (a search box of any view). Any
 * other input changed (another tab: scope=done) and nothing is kept for the new inputs: no answer is shown
 * as if it were the new one (data.<name> empty, data.<name>_loading true).
 */
export function onlyHeldChanged(before: Record<string, unknown> | null, after: Record<string, unknown>, hold: string | undefined): boolean {
  if (!before) return false;
  const held = new Set((hold ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  let changed = false;
  for (const k of names) {
    if (JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null)) continue;
    changed = true;
    if (!held.has(k) && !typed(before[k], after[k])) return false;
  }
  return changed;
}

/** A text typed on or taken back (a search: "ab" → "abc", "abc" → "ab", "" → "a") — not a number (an id), not a value picked. */
function typed(a: unknown, b: unknown): boolean {
  const x = typeof a === "string" ? a : a == null ? "" : null;
  const y = typeof b === "string" ? b : b == null ? "" : null;
  if (x === null || y === null) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long.startsWith(short) && /\p{L}/u.test(long) && !/^\d+$/.test(long) && long.length - short.length <= 3;
}
