import { getPref } from "@/lib/prefs";

const PORT = "documents-ext";

/**
 * From the built-in Documents to the plugin (zeff-plugins/plugins/documents-ext): the tables its stores adopt are made if they aren't there yet (nothing is copied),
 * the plugin on, its package installed under System — the flows that go through your documents for todos, match them to your todos, read in your local folders and
 * read what waits, allowed to (your click is the yes) —, the local folders' sync step taken over by the flow `documents.folders` (its interval as before) and the
 * built-in off: it stands in through its port (state.ts PROVIDED_BY — its screen, uploads, settings page and the knowledge server's abstracts go on reading the same
 * tables). Needs the plugin in the plugins folder. Server only.
 */
export async function switchDocumentsToPlugin(): Promise<{ flows: string[] }> {
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
  (await import("@/plugins/state")).setInstalled("documents", false);
  return { flows: ["documents.review", "documents.relate", "documents.folders", "documents.read"] };
}
