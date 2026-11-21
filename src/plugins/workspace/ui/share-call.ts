/**
 * The same read asked by many parts of one page at once — a page of a dozen blocks, each a view asking for its page's settings, its
 * package's update, its merge — is asked once: they all get that one answer. Server actions of one browser run one after the other,
 * so a dozen identical ones held up everything behind them (the blocks' own definitions, a button's action). An answer counts as
 * shared while it is on its way and for a moment after (views drawn a little later), not longer: asked again later, it is asked again.
 */
const SHARE_MS = 2000;
const calls = new Map<string, { done: number; answer: Promise<unknown> }>();

export function shareCall<T>(key: string, ask: () => Promise<T>): Promise<T> {
  const now = Date.now();
  for (const [k, v] of calls) if (now - v.done > SHARE_MS) calls.delete(k);
  const hit = calls.get(key);
  if (hit) return hit.answer as Promise<T>;
  const entry = { done: Infinity, answer: ask() as Promise<unknown> };
  entry.answer.then(
    () => (entry.done = Date.now()),
    () => calls.delete(key),
  );
  calls.set(key, entry);
  return entry.answer as Promise<T>;
}

/** Asked anew from now on (after a change the shared answer would hide: a setting saved, an update brought in). */
export function forgetShared(prefix: string): void {
  for (const k of [...calls.keys()]) if (k.startsWith(prefix)) calls.delete(k);
}
