import { ALL_FEEDS, STARTER_NAMES, type CatalogFeed } from "./catalog";
import type { NewsPrefs } from "./shared";

/**
 * Which catalog feeds fit best (pure: what you have and what you like are given) — the News plugin bundles it (scripts/port-news.mts). Client-safe.
 */
export const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/** The `batch` catalog feeds that fit best and aren't added yet (pure: what you have and what you like are given). */
export function pickFromCatalog(have: Set<string>, prefs: Pick<NewsPrefs, "language" | "interests">, liked: string[], batch: number, feeds: CatalogFeed[] = ALL_FEEDS): CatalogFeed[] {
  const terms = [...prefs.interests.map((i) => i.term), ...liked].map((t) => t.toLowerCase()).filter((t) => t.length >= 3);
  const score = (f: CatalogFeed): number => {
    let s = 0;
    const hay = `${f.name} ${f.category}`.toLowerCase();
    const match = terms.some((t) => hay.includes(t));
    if (prefs.language === "any") s += 1.5;
    else if (f.lang === prefs.language) s += 2;
    else if (f.lang === "en") s += 1;
    else s -= 1;
    if (STARTER_NAMES.includes(f.name)) s += 3;
    if (f.category === "Topics") s += match ? 4 : -0.5;
    else s += 1 + (match ? 2 : 0);
    return s + (hash(f.url) % 100) / 400; // a stable shuffle among equals
  };
  return feeds
    .filter((f) => !have.has(f.url))
    .map((f) => ({ f, s: score(f) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, batch)
    .map((x) => x.f);
}

