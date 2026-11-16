import { getPref } from "@/lib/prefs";

const PORT = "documents-ext";

/**
 * From the built-in Documents to the plugin (zeff-plugins/plugins/documents-ext): the tables its stores adopt are made if they aren't there yet (nothing is copied),
 * the plugin on, its package installed under System — the flows that go through your documents for todos, match them to your todos, read in your local folders and
 * read what waits, allowed to (your click is the yes) —, the local folders' sync step taken over by the flow `documents.folders` (its interval as before) and the
 * built-in off: it stands in through its port (state.ts PROVIDED_BY — its screen, uploads, settings page and the knowledge server's abstracts go on reading the same
 * tables). Needs the plugin in the plugins folder. Server only.
 */
export async function switchDocumentsToPlugin(): Promise<{ flows: string[]; views: number }> {
  const reg = await import("@/lib/ext/registry");
  if (!reg.scanPlugins(true).plugins.some((x) => x.id === PORT)) throw new Error(`The Documents plugin (${PORT}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  // (the built-in makes these on first use)
  (await import("./gate")).ensureGate();
  (await import("./folders")).ensureLocalFiles();
  (await import("./seen")).ensureSeen();
  const minutes = (await import("@/lib/sync/intervals")).stepMinutes("localdocs");
  reg.setEnabled(PORT, true);
  const flows = await import("@/plugins/workspace/flows/store");
  if (!flows.flowByName("documents.folders")) {
    const life = await import("@/plugins/workspace/package-life");
    const pkg = await life.offeredPackage(PORT);
    if (!pkg) throw new Error(`The Documents plugin (${PORT}) brings no package.`);
    const system = getPref<number | null>("system.root", null);
    const { getPage } = await import("@/plugins/workspace/store");
    await life.installTracked(pkg, system && getPage(system) && !getPage(system)!.archivedAt ? system : null, { allow: true });
  }
  flows.setSyncFlowMinutes("documents.folders", minutes);
  const views = await portDocumentViews();
  (await import("@/plugins/state")).setInstalled("documents", false);
  return { flows: ["documents.review", "documents.relate", "documents.folders", "documents.read"], views };
}

/**
 * The documents databases' screen: the built-in's app view of them ("documents") becomes the port's (a template view of its contributes.appViews entry) —
 * so they go on drawing when the built-in is gone. Once switched, a view is the port's own (what you changed in it stays). How many views.
 */
export async function portDocumentViews(): Promise<number> {
  const { extAppViews, appViewFields } = await import("@/plugins/workspace/app-views");
  const mine = extAppViews.all().flatMap((c) => c.impl).find((a) => a.plugin === "documents-ext" && a.dataType === "documents" && a.template);
  if (!mine) return 0;
  const { getSqlite } = await import("@/db");
  const { getDatabase, updateSchema } = await import("@/plugins/workspace/store");
  const ids = (getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null and template = 0").all() as { id: number }[]).map((r) => r.id);
  let n = 0;
  for (const id of ids) {
    const d = getDatabase(id);
    if (!d || !d.schema.views.some((v) => v.type === "app" && v.app === "documents")) continue;
    updateSchema(id, { ...d.schema, views: d.schema.views.map((v) => (v.type === "app" && v.app === "documents" ? { ...v, ...appViewFields(mine) } : v)) });
    n++;
  }
  return n;
}

