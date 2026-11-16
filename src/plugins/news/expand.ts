import { getPref, setPref } from "@/lib/prefs";
import { ALL_FEEDS, type CatalogFeed } from "./catalog";
import { pickFromCatalog } from "./catalog-pick";
export { pickFromCatalog };
import type { NewsPrefs } from "./shared";
import { addSources, getPrefs, learnedTop, listSources } from "./store";

/**
 * More sources from the catalog, when the ones there are don't give enough fresh news: the catalog's feeds that aren't
 * yours yet, best fit first — your language, the starter pack, outlets before searches, and whatever matches what you are
 * interested in or liked. This is the fast way to volume (checked feeds, no search needed); the finder (the internet
 * search) takes over when the catalog is used up.
 */
/** Adds the next batch; returns how many were added and how many catalog feeds are left. */
export function expandFromCatalog(batch = 40, feeds: CatalogFeed[] = ALL_FEEDS): { added: number; left: number } {
  const have = new Set(listSources().map((s) => s.url));
  const picks = pickFromCatalog(have, getPrefs(), learnedTop(8).map((l) => l.term), batch, feeds);
  const added = addSources(picks);
  return { added, left: feeds.filter((f) => !have.has(f.url)).length - added };
}

/** The same, but not more often than every half hour (the background sync asks every round). */
export function expandWhenLow(nowMs: number = Date.now(), batch = 30): number {
  if (nowMs - Number(getPref<number>("news:expand-at", 0)) < 30 * 60_000) return 0;
  const r = expandFromCatalog(batch);
  if (r.added) setPref("news:expand-at", nowMs);
  return r.added;
}
