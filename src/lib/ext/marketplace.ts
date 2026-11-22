import { addsSummary, type CatalogEntry } from "./catalog";
import { describePlugin, scanPlugins } from "./registry";
import { checkAll, compareVersions, lastKnown, type SourceState } from "./sources";

/**
 * The marketplace (Plugins → Browse): every plugin of every source — from each repository's catalog.json (sources.ts checkSource) — with
 * how it stands here: not installed, installed (on or off), an update waiting, the port of a built-in (plugins/ports.ts). The header's
 * search finds the ones not installed yet (searchItems). Installing goes through sources.ts installFromSource; nothing here writes.
 * Server only.
 */

export type MarketItem = {
  /** sourceId + plugin id: one plugin may be in two repositories. */
  key: string;
  sourceId: string;
  /** The repository, as shown (owner/repo, or the folder). */
  source: string;
  sourceUrl: string;
  /** The commit the listing is of. */
  sha: string;
  listing: CatalogEntry;
  installed: string | null;
  enabled: boolean;
  /** Installed from this source (its updates come from here). */
  fromHere: boolean;
  updateAvailable: boolean;
  conflicts: number;
  /** Permissions an update added that are held back until it is switched on again. */
  ungranted: string[];
  /** It replaces a built-in plugin (plugins/ports.ts): its id, and whether the built-in runs through it already. */
  port: { builtin: string; switched: boolean } | null;
  /** The same plugin in other sources (one card per plugin: the one it was installed from, else the newest, else one with a catalog). */
  others: { sourceId: string; source: string; version: string }[];
};
export type MarketSource = { id: string; url: string; source: string; error?: string; catalog: boolean; unlisted: string[]; checkedAt: string; hasToken: boolean; problems: string[] };
export type MarketView = { items: MarketItem[]; sources: MarketSource[]; checked: boolean };

/** A source as shown: owner/repo on GitHub, the folder's name for a folder on this computer. */
export const shortSource = (url: string) => (/^https:\/\/github\.com\//.test(url) ? url.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "") : /^[a-z]+:\/\/|^git@/i.test(url) ? url.replace(/\.git$/, "") : (url.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? url));

async function ports(): Promise<Map<string, { builtin: string; switched: boolean }>> {
  const out = new Map<string, { builtin: string; switched: boolean }>();
  try {
    const { PORTS } = await import("@/plugins/ports");
    const { onlyThroughPort, isInstalled } = await import("@/plugins/state");
    // (switched: the built-in runs through its port, or is off while the port is on)
    for (const p of PORTS) out.set(p.plugin, { builtin: p.builtin, switched: onlyThroughPort(p.builtin as never) || (!isInstalled(p.builtin as never) && !!scanPlugins().plugins.find((x) => x.id === p.plugin && describePlugin(x).enabled)) });
  } catch {
    /* (no built-ins: a bare kernel) */
  }
  return out;
}

export async function viewOf(states: SourceState[], checked: boolean): Promise<MarketView> {
  const portOf = await ports();
  const here = new Map(scanPlugins().plugins.map((p) => [p.id, describePlugin(p)]));
  const items: MarketItem[] = [];
  for (const st of states)
    for (const p of st.plugins) {
      // (a state kept from before the catalog — a listing it doesn't have yet: left out until the next check)
      if (!p.listing) continue;
      const inst = here.get(p.id);
      items.push({
        key: `${st.source.id}:${p.id}`,
        sourceId: st.source.id,
        source: shortSource(st.source.url),
        sourceUrl: st.source.url,
        sha: st.sha,
        listing: p.listing,
        installed: p.installed,
        enabled: p.enabled,
        fromHere: p.fromHere,
        updateAvailable: p.updateAvailable,
        conflicts: p.conflicts,
        ungranted: inst?.ungranted ?? [],
        port: portOf.get(p.id) ?? null,
        others: [],
      });
    }
  // One card per plugin: where it was installed from; else the newest version; else a source with a catalog (it says more).
  const catalogued = new Set(states.filter((st) => st.listedBy?.catalog).map((st) => st.source.id));
  const rank = (a: MarketItem, b: MarketItem) => Number(b.fromHere) - Number(a.fromHere) || compareVersions(b.listing.version, a.listing.version) || Number(catalogued.has(b.sourceId)) - Number(catalogued.has(a.sourceId));
  const byId = new Map<string, MarketItem[]>();
  for (const it of items) byId.set(it.listing.id, [...(byId.get(it.listing.id) ?? []), it]);
  const one = [...byId.values()].map((list) => {
    const [first, ...rest] = [...list].sort(rank);
    return { ...first, others: rest.map((x) => ({ sourceId: x.sourceId, source: x.source, version: x.listing.version })) };
  });
  one.sort((a, b) => a.listing.name.localeCompare(b.listing.name));
  items.length = 0;
  items.push(...one);
  const sources: MarketSource[] = states.map((st) => ({ id: st.source.id, url: st.source.url, source: shortSource(st.source.url), ...(st.error ? { error: st.error } : {}), catalog: !!st.listedBy?.catalog, unlisted: st.listedBy?.unlisted ?? [], checkedAt: st.checkedAt, hasToken: st.source.hasToken, problems: st.problems }));
  return { items, sources, checked };
}

/** The marketplace: `cached` what the sources had at their last check (no network — at once), else each source checked (10 minutes cached; `fresh`: now). */
export async function marketplace(mode: "cached" | "check" | "fresh"): Promise<MarketView> {
  if (mode === "cached") return viewOf(lastKnown(), false);
  return viewOf(await checkAll({ fresh: mode === "fresh" }), true);
}

/** The text a plugin is found by: its name, id, description, keywords, category, author, what it adds. */
export function searchText(e: CatalogEntry): string {
  return [e.id, e.name, e.description, ...e.keywords, e.category ?? "", e.author ?? "", ...addsSummary(e.adds).flatMap((a) => [a.key, ...a.names]), ...e.adds.flows.map((f) => f.name)].join(" ").toLowerCase();
}

/** The header's search: plugins of the sources not installed here (from their last check — no network), as "Install …" entries. */
export function notInstalledForSearch(): { id: string; name: string; description: string; icon?: string; source: string; text: string }[] {
  const here = new Set(scanPlugins().plugins.map((p) => p.id));
  const seen = new Set<string>();
  const out: { id: string; name: string; description: string; icon?: string; source: string; text: string }[] = [];
  for (const st of lastKnown())
    for (const p of st.plugins) {
      if (here.has(p.id) || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ id: p.id, name: p.listing.name, description: p.listing.description, icon: p.listing.icon, source: shortSource(st.source.url), text: searchText(p.listing) });
    }
  return out;
}
