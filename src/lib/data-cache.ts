import type Database from "better-sqlite3";
import { getSqlite } from "@/db";
import { currentAccountId, withAccount } from "@/db/accounts";

/**
 * Zeff's "last known answer" store, per account — what makes a screen appear at once and then update itself (stale-while-revalidate).
 *
 *  - `answerCache`: the answers of a view's <data> sources (flows, lambdas). Kept in memory and in the account's database (table
 *    data_cache), so they survive a restart. It never decides anything: a page shows the kept answer first and always asks again
 *    for the fresh one, which replaces it (see /api/workspace/data and ui/view-flows.tsx). A kept answer is therefore never "wrong
 *    data after your own change" — it is only what was shown last, for a moment.
 *  - `swr`: the same idea for any slow server-side read (a status, a manifest scan): the last value at once, a newer one fetched in
 *    the background when the old one is older than its time-to-live.
 *
 * Nothing here knows any plugin. Server only.
 */

const MAX_TEXT = 400_000;
const MAX_AGE_MS = 14 * 24 * 3600_000;
const MAX_MEMORY = 500;

type Entry = { at: number; text: string };
const g = globalThis as { __zeffAnswerCache?: Map<string, Entry>; __zeffDataCacheReady?: WeakSet<Database.Database>; __zeffSwr?: Map<string, { at: number; value: unknown; loading: Promise<unknown> | null }>; __zeffInflight?: Map<string, Promise<unknown>> };
const mem = (g.__zeffAnswerCache ??= new Map<string, Entry>());
const ready = (g.__zeffDataCacheReady ??= new WeakSet<Database.Database>());

function table(): Database.Database | null {
  try {
    const db = getSqlite();
    if (!ready.has(db)) {
      db.exec("CREATE TABLE IF NOT EXISTS data_cache (key TEXT PRIMARY KEY, at INTEGER NOT NULL, body TEXT NOT NULL)");
      ready.add(db);
    }
    return db;
  } catch {
    return null;
  }
}

/** What identifies an answer: kind (flow | lambda), name, what it was asked with, the row it stands in. Keys are per account. */
export function answerKey(kind: string, name: string, input: unknown, row?: number): string {
  const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sorted(x)])) : v);
  return `${kind}:${name}:${row ?? 0}:${JSON.stringify(sorted(input ?? {}))}`;
}

/** The last answer kept for this key (any age up to two weeks), with when it was made. */
export function peekAnswer(key: string): { at: number; answer: unknown } | null {
  const k = `${currentAccountId()}|${key}`;
  let e = mem.get(k);
  if (!e) {
    try {
      const row = table()?.prepare("SELECT at, body FROM data_cache WHERE key = ?").get(key) as { at: number; body: string } | undefined;
      if (row) mem.set(k, (e = { at: row.at, text: row.body }));
    } catch {
      // no table: nothing kept
    }
  }
  if (!e || Date.now() - e.at > MAX_AGE_MS) return null;
  try {
    return { at: e.at, answer: JSON.parse(e.text) };
  } catch {
    return null;
  }
}

/** Keeps an answer (only a finished one, not too big). Written to the database only when it differs from what is kept. */
export function rememberAnswer(key: string, answer: unknown): void {
  let text: string;
  try {
    text = JSON.stringify(answer);
  } catch {
    return;
  }
  if (!text || text.length > MAX_TEXT) return;
  const k = `${currentAccountId()}|${key}`;
  const old = mem.get(k);
  const at = Date.now();
  if (mem.size >= MAX_MEMORY) mem.delete(mem.keys().next().value as string);
  mem.set(k, { at, text });
  if (old?.text === text) return;
  try {
    table()?.prepare("INSERT INTO data_cache (key, at, body) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, body = excluded.body").run(key, at, text);
  } catch {
    // kept in memory only
  }
}

/** One computation of the same thing at a time: the same key asked while it runs gets that run's answer. */
export function inflight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const map = (g.__zeffInflight ??= new Map());
  const k = `${currentAccountId()}|${key}`;
  const hit = map.get(k);
  if (hit) return hit as Promise<T>;
  const p = run().finally(() => map.delete(k));
  map.set(k, p);
  return p;
}

/**
 * A slow read, stale-while-revalidate: the first call waits for `load`; later calls answer at once with the last value, and when it is
 * older than `ttlMs` a newer one is loaded in the background (in the account it was asked in). `fresh`: wait for a new one.
 */
export async function swr<T>(key: string, ttlMs: number, load: () => Promise<T> | T, opts: { fresh?: boolean } = {}): Promise<T> {
  const map = (g.__zeffSwr ??= new Map());
  const account = currentAccountId();
  const k = `${account}|${key}`;
  const hit = map.get(k);
  const refresh = (): Promise<T> => {
    if (hit?.loading) return hit.loading as Promise<T>;
    const loading = Promise.resolve(withAccount(account, () => load())).then(
      (value) => (map.set(k, { at: Date.now(), value, loading: null }), value),
      (e) => {
        const cur = map.get(k);
        if (cur) cur.loading = null;
        throw e;
      },
    );
    if (hit) hit.loading = loading;
    else map.set(k, { at: 0, value: undefined, loading });
    return loading;
  };
  if (hit && hit.at && !opts.fresh) {
    if (Date.now() - hit.at > ttlMs) refresh().catch(() => undefined);
    return hit.value as T;
  }
  return refresh();
}

/** Forget kept reads of this account whose key starts with `prefix` (after something changed them for sure). */
export function forgetSwr(prefix: string): void {
  const map = g.__zeffSwr;
  if (!map) return;
  const p = `${currentAccountId()}|${prefix}`;
  for (const k of map.keys()) if (k.startsWith(p)) map.delete(k);
}
