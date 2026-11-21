import { z } from "zod";
import { PLUGIN_CATEGORIES } from "./categories";
import type { Manifest } from "./manifest";

/**
 * A repository's catalog.json — the index of its plugins, generated in the repository (zeff-plugins: `node scripts/catalog.mjs`, checked
 * with `--check`). Zeff reads this one file per source instead of every zeff-plugin.json (sources.ts checkSource): the marketplace (Plugins
 * → Browse), the header's search and the update check list what it says. Without one — or for a folder it doesn't name — the manifest itself
 * is read and described the same way (entryFromManifest), so a repository without a catalog still works, only slower.
 *
 * Nothing in it is trusted for what is installed: an install downloads the plugin's folder and checks its manifest (and signature) itself;
 * the catalog's content hash is compared after the download, and a mismatch only says the catalog is out of date. Client-safe (the hash: catalog-hash.ts).
 */

const names = z.array(z.string().max(200)).max(200).default([]);
const adds = z
  .object({
    apps: z.array(z.object({ name: z.string().max(200), icon: z.string().max(40).optional(), version: z.string().max(40).optional(), pages: z.number().int().min(0).optional(), databases: z.number().int().min(0).optional() })).max(50).default([]),
    pages: z.number().int().min(0).default(0),
    databases: names,
    flows: z.array(z.object({ name: z.string().max(120), title: z.string().max(200) })).max(300).default([]),
    syncs: names,
    views: names,
    widgets: names,
    drivers: names,
    lookups: names,
    functions: z.number().int().min(0).default(0),
    tools: names,
    aiTasks: names,
    services: names,
    stores: names,
    commands: names,
    mcpServers: names,
    hooks: names,
    schedules: names,
    chats: names,
    settings: z.number().int().min(0).default(0),
    oauth: names,
    languages: names,
    workerRules: z.boolean().default(false),
  })
  .default({} as never);

export const catalogEntrySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
  name: z.string().min(1).max(60),
  version: z.string().max(30).default("0.0.0"),
  description: z.string().max(600).default(""),
  keywords: z.array(z.string().max(40)).max(20).default([]),
  category: z.enum(PLUGIN_CATEGORIES).optional().catch(undefined),
  icon: z.string().max(40).optional(),
  iconImage: z.string().max(50_000).regex(/^data:image\/(png|svg\+xml|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).optional().catch(undefined),
  author: z.string().max(100).optional(),
  homepage: z.string().max(300).optional(),
  path: z.string().max(200).regex(/^[\w./-]*$/).default(""),
  permissions: z.array(z.string().max(60)).max(30).default([]),
  requires: z.object({ apiVersion: z.number().int().optional(), plugins: z.array(z.string().max(40)).max(20).default([]) }).default({ plugins: [] }),
  adds,
  files: z.number().int().min(0).default(0),
  size: z.number().int().min(0).default(0),
  hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  signed: z.union([z.literal(false), z.object({ key: z.string().max(100), version: z.string().max(30) })]).default(false),
  readme: z.string().max(2000).optional(),
  screenshots: z.array(z.string().max(200)).max(8).default([]),
});
export type CatalogEntry = z.output<typeof catalogEntrySchema>;
export type CatalogAdds = CatalogEntry["adds"];

/** catalog.json read: its entries (one that doesn't hold is left out and said), or why the file as a whole doesn't. */
export function parseCatalog(text: string): { ok: true; plugins: CatalogEntry[]; problems: string[] } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    return { ok: false, error: `catalog.json isn't JSON: ${(e as Error).message}` };
  }
  const o = (raw && typeof raw === "object" ? raw : {}) as { format?: unknown; plugins?: unknown };
  if (o.format !== 1) return { ok: false, error: `catalog.json has format ${JSON.stringify(o.format)} — this Zeff reads format 1.` };
  if (!Array.isArray(o.plugins)) return { ok: false, error: "catalog.json lists no plugins." };
  const plugins: CatalogEntry[] = [];
  const problems: string[] = [];
  for (const [i, p] of o.plugins.slice(0, 2000).entries()) {
    const r = catalogEntrySchema.safeParse(p);
    if (r.success) plugins.push(r.data);
    else problems.push(`catalog.json, plugin ${i + 1}${p && typeof p === "object" && "id" in p ? ` (${String((p as { id: unknown }).id)})` : ""}: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`);
  }
  return { ok: true, plugins, problems };
}

/** A folder the catalog doesn't name (or a repository without one): described from its manifest alone (what its packages add isn't known). */
export function entryFromManifest(m: Manifest, path: string): CatalogEntry {
  const c = m.contributes;
  const list = <T,>(xs: T[] | undefined, f: (x: T) => string | undefined) => [...new Set((xs ?? []).map(f).filter((x): x is string => !!x))];
  return catalogEntrySchema.parse({
    id: m.id,
    name: m.name,
    version: m.version,
    description: m.description,
    keywords: m.keywords,
    category: m.category,
    icon: m.icon && m.icon.length <= 40 && !/[./]/.test(m.icon) ? m.icon : undefined,
    author: m.author,
    homepage: m.homepage,
    path,
    permissions: m.permissions,
    requires: { apiVersion: m.apiVersion, plugins: m.requires?.plugins ?? [] },
    adds: {
      apps: c.workspacePackages.map((p) => ({ name: p.replace(/\.package\.json$|\.json$/, "") })),
      views: [...list(c.appViews as { id?: string; title?: string }[], (x) => x.title ?? x.id), ...list(c.workPanels, (x) => x.title ?? x.id)],
      widgets: list(c.widgets as { id?: string; title?: string }[], (x) => x.title ?? x.id),
      lookups: list(c.lookups as { id?: string; title?: string }[], (x) => x.title ?? x.id),
      functions: c.functions.length,
      tools: list(c.tools, (x) => x.title ?? x.name),
      aiTasks: list(c.aiTasks as { id?: string; title?: string }[], (x) => x.title ?? x.id),
      services: list(c.services, (x) => x.name),
      stores: list(c.stores as { name?: string }[], (x) => x.name),
      commands: list(c.workCommands, (x) => x.label ?? x.id),
      mcpServers: Object.keys(c.workerMcpServers),
      hooks: Object.keys(c.hooks),
      schedules: list(c.schedules, (x) => x.id),
      chats: list(c.chats as { id?: string; title?: string }[], (x) => x.title ?? x.id),
      settings: c.settings.length,
      oauth: list(c.oauth as { id?: string; name?: string }[], (x) => x.name ?? x.id),
      languages: c.language ? [`${c.language.native} (${c.language.code})`] : [],
      workerRules: !!c.workerRules,
    },
    screenshots: m.screenshots,
  });
}

/** What a plugin adds, in short words (the cards' line, the search's text). */
export function addsSummary(a: CatalogAdds): { key: string; n: number; names: string[] }[] {
  const out: { key: string; n: number; names: string[] }[] = [];
  const push = (key: string, xs: string[] | number) => {
    const n = typeof xs === "number" ? xs : xs.length;
    if (n) out.push({ key, n, names: typeof xs === "number" ? [] : xs });
  };
  push("apps", a.apps.map((x) => `${x.icon ? `${x.icon} ` : ""}${x.name}`));
  push("pages", a.pages);
  push("databases", a.databases);
  push("syncs", a.syncs);
  push("flows", a.flows.filter((f) => !a.syncs.includes(f.name)).map((f) => f.title));
  push("views", a.views);
  push("widgets", a.widgets);
  push("drivers", a.drivers);
  push("lookups", a.lookups);
  push("tools", a.tools);
  push("aiTasks", a.aiTasks);
  push("services", a.services);
  push("functions", a.functions);
  push("stores", a.stores);
  push("commands", a.commands);
  push("mcpServers", a.mcpServers);
  push("hooks", a.hooks);
  push("schedules", a.schedules);
  push("chats", a.chats);
  push("oauth", a.oauth);
  push("languages", a.languages);
  push("settings", a.settings);
  return out;
}
