import { mergeText } from "@/lib/ext/git";

/**
 * Three-way merges of an app's parts (docs/zeff-kernel.md: "merged per field and line"): an update brings the package's new version
 * (theirs) onto a part you changed (mine), with the version installed before as the base. What only one side changed is taken from
 * that side. A text of several lines both changed (a view's template, a function's code) is merged line by line, the way git does: only
 * the same lines changed on both sides conflict. Where both changed the same thing differently, yours is kept for now and the spot is a
 * conflict that carries all three sides and where it is (its path), so it can be settled later (package-merge.ts). Things are matched by
 * their stable ids, never by position or name: a database's fields and views, a flow's steps, a form's questions. A page's text is
 * merged block by block (a paragraph, a heading, a widget is one line). Server only.
 */

/** A step to a value inside a part: a key of an object, or the item of a list with this id. */
export type Step = string | { id: string };
export type Conflict = {
  where: string;
  /** Where it is inside the part (empty: the part itself). */
  path?: Step[];
  base?: unknown;
  mine?: unknown;
  /** undefined with `removed`: the update dropped it. */
  theirs?: unknown;
  /** The update dropped it, you changed it. */
  removed?: boolean;
  /** A page's text: the three documents (mine is the page as it is). */
  doc?: boolean;
};
export type Merged<T> = { value: T; conflicts: Conflict[]; /** What came from the new version. */ took: string[] };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hasIds = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v) && v.length > 0 && v.every((x) => isPlain(x) && typeof x.id === "string" && x.id !== "");
const multiline = (v: unknown): v is string => typeof v === "string" && v.includes("\n");

/**
 * One value: whichever side changed it; both, differently: mine, and a conflict. `older`: what older versions of the package had there —
 * a value you left as one of them had it counts as unchanged too (a part that missed an update is still reached by the next one).
 */
export function merge3<T>(base: T | undefined, mine: T, theirs: T, where: string, older: unknown[] = [], path: Step[] = []): Merged<T> {
  if (same(mine, theirs)) return { value: mine, conflicts: [], took: [] };
  if (same(mine, base) || older.some((o) => same(mine, o))) return { value: theirs, conflicts: [], took: [where] };
  if (same(theirs, base)) return { value: mine, conflicts: [], took: [] };
  // Both changed it: an object, or a list of things with ids, is merged inside — only what both changed in the same place conflicts.
  if (isPlain(mine) && isPlain(theirs)) return mergeRecord(isPlain(base) ? base : {}, mine, theirs, where, older.filter(isPlain), path) as Merged<T>;
  if (hasIds(mine) && hasIds(theirs)) return mergeById(hasIds(base) ? base : [], mine, theirs, where, older.filter(hasIds), path) as unknown as Merged<T>;
  // A text of lines: line by line — only the same lines changed on both sides conflict.
  if (multiline(mine) && multiline(theirs) && (base === undefined || typeof base === "string")) {
    const m = mergeLines(typeof base === "string" ? base : "", mine, theirs);
    if (!m.conflicts) return { value: m.text as T, conflicts: [], took: [where] };
  }
  return { value: mine, conflicts: [{ where, path, base, mine, theirs }], took: [] };
}

/** An object, key by key. */
export function mergeRecord(base: Record<string, unknown>, mine: Record<string, unknown>, theirs: Record<string, unknown>, where: string, older: Record<string, unknown>[] = [], path: Step[] = []): Merged<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const conflicts: Conflict[] = [];
  const took: string[] = [];
  for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base)])) {
    const r = merge3(base[k], mine[k], theirs[k], `${where}.${k}`, older.map((o) => o[k]), [...path, k]);
    if (r.value !== undefined) out[k] = r.value;
    conflicts.push(...r.conflicts);
    took.push(...r.took);
  }
  return { value: out, conflicts, took };
}

const label = (x: Record<string, unknown>) => String(x.name ?? x.title ?? x.label ?? x.id);

/**
 * A list of things with ids (fields, views, steps), by id: each merged on its own; one the new version adds is added; one it dropped
 * goes only if you left it as it was (else it stays, a conflict); one you added stays. Your order stays, new ones go where the new version
 * has them (after the one before them).
 */
export function mergeById(base: Record<string, unknown>[], mine: Record<string, unknown>[], theirs: Record<string, unknown>[], where: string, older: Record<string, unknown>[][] = [], path: Step[] = []): Merged<Record<string, unknown>[]> {
  const byId = (l: Record<string, unknown>[]) => new Map(l.map((x) => [String(x.id), x]));
  const b = byId(base);
  const t = byId(theirs);
  const olds = older.map(byId);
  const conflicts: Conflict[] = [];
  const took: string[] = [];
  const out: Record<string, unknown>[] = [];
  for (const m of mine) {
    const id = String(m.id);
    const at = `${where}[${label(m)}]`;
    if (t.has(id)) {
      const r = merge3(b.get(id), m, t.get(id)!, at, olds.map((o) => o.get(id)).filter((x) => x !== undefined), [...path, { id }]);
      out.push(r.value as Record<string, unknown>);
      conflicts.push(...r.conflicts);
      took.push(...r.took);
    } else if (b.has(id)) {
      // The new version dropped it: gone if you left it alone, kept (and said) if you changed it.
      if (same(m, b.get(id))) took.push(`${at} removed`);
      else {
        out.push(m);
        conflicts.push({ where: `${at} (removed by the update, changed by you)`, path: [...path, { id }], base: b.get(id), mine: m, theirs: undefined, removed: true });
      }
    } else out.push(m); // yours
  }
  const have = new Set(out.map((x) => String(x.id)));
  theirs.forEach((x, i) => {
    const id = String(x.id);
    if (have.has(id) || b.has(id)) return; // (there, or dropped by you)
    const prev = i > 0 ? out.findIndex((y) => String(y.id) === String(theirs[i - 1].id)) : -1;
    out.splice(prev + 1, 0, x);
    have.add(id);
    took.push(`${where}[${label(x)}] added`);
  });
  return { value: out, conflicts, took };
}

const docLines = (d: { content?: unknown[] } | null | undefined) => (d?.content ?? []).map((n) => JSON.stringify(n)).join("\n") + "\n";
const docOf = (text: string): { type: string; content: unknown[] } => ({
  type: "doc",
  content: text
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as unknown];
      } catch {
        return [];
      }
    }),
});

/** A page's text (its document), block by block — each top-level block one line for git's merge. */
export async function mergeDoc(base: { content?: unknown[] } | null | undefined, mine: { content?: unknown[] }, theirs: { content?: unknown[] }, where: string): Promise<Merged<{ type: string; content: unknown[] }>> {
  const r = await mergeText(docLines(base), docLines(mine), docLines(theirs), { favorMine: true });
  const changed = docLines(theirs) !== docLines(base);
  return {
    value: docOf(r.text),
    conflicts: r.conflicts ? [{ where: `${where} (${r.conflicts} place${r.conflicts === 1 ? "" : "s"} both changed)`, path: [], base: base ?? { type: "doc", content: [] }, mine, theirs, doc: true }] : [],
    took: changed && docLines(mine) !== r.text ? [`${where} text`] : [],
  };
}

/** A page's text merged again, the places both changed settled one way: the update's blocks (theirs) or both, one after the other (union). */
export async function settleDoc(base: { content?: unknown[] } | null | undefined, mine: { content?: unknown[] }, theirs: { content?: unknown[] }, way: "theirs" | "union"): Promise<{ type: string; content: unknown[] }> {
  return docOf((await mergeText(docLines(base), docLines(mine), docLines(theirs), { favor: way })).text);
}

// ---------------------------------------------------------------------------
// Lines (diff3, as git merge-file does it — in-process, so a field's text merges without git)
// ---------------------------------------------------------------------------

/** For each line of `a`, the line of `b` it stays as (the longest common subsequence), or -1. */
function matchLines(a: string[], b: string[]): number[] {
  const n = a.length;
  const m = b.length;
  const out = new Array<number>(n).fill(-1);
  // (beyond this a text is too long to compare line by line here: no line counts as kept — the whole text conflicts)
  if (n * m > 4_000_000) return out;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) {
      out[i] = j;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

export type LineHunk = { base: string[]; mine: string[]; theirs: string[] };

/**
 * Three texts merged line by line: between the lines all three keep, a stretch only one side changed is taken from it, one both changed
 * the same way once; one both changed differently is a conflict (its lines kept as mine in `text`, the three sides in `hunks`,
 * `marked`: the text with git's markers for editing it).
 */
export function mergeLines(base: string, mine: string, theirs: string): { text: string; conflicts: number; hunks: LineHunk[]; marked: string } {
  const B = base.split("\n");
  const M = mine.split("\n");
  const T = theirs.split("\n");
  const toM = matchLines(B, M);
  const toT = matchLines(B, T);
  const text: string[] = [];
  const marked: string[] = [];
  const hunks: LineHunk[] = [];
  let i = 0;
  let a = 0;
  let b = 0;
  const chunk = (bi: number, ai: number, ti: number) => {
    const cb = B.slice(i, bi);
    const cm = M.slice(a, ai);
    const ct = T.slice(b, ti);
    const eq = (x: string[], y: string[]) => x.length === y.length && x.every((l, k) => l === y[k]);
    let take: string[] | null;
    if (eq(cm, cb)) take = ct;
    else if (eq(ct, cb) || eq(cm, ct)) take = cm;
    else take = null;
    if (take) {
      text.push(...take);
      marked.push(...take);
    } else {
      hunks.push({ base: cb, mine: cm, theirs: ct });
      text.push(...cm);
      marked.push("<<<<<<< mine", ...cm, "||||||| base", ...cb, "=======", ...ct, ">>>>>>> theirs");
    }
  };
  for (let j = 0; j < B.length; j++) {
    if (toM[j] < 0 || toT[j] < 0 || toM[j] < a || toT[j] < b) continue;
    chunk(j, toM[j], toT[j]);
    text.push(B[j]);
    marked.push(B[j]);
    i = j + 1;
    a = toM[j] + 1;
    b = toT[j] + 1;
  }
  chunk(B.length, M.length, T.length);
  return { text: text.join("\n"), conflicts: hunks.length, hunks, marked: marked.join("\n") };
}
