import fs from "node:fs";
import path from "node:path";
import { getPref } from "@/lib/prefs";
import type { View } from "@/plugins/workspace/model";

const PORT = "news-ext";

/**
 * From the built-in News to the plugin (zeff-plugins/plugins/news-ext): News' tables are made if they aren't there yet (the plugin's stores adopt them —
 * nothing is copied), the plugin on, its package installed under System — the flows that fetch, filter, tag, discover and act, allowed to (your click is the yes) —,
 * the News page's view in the Workspace drawn by the plugin's screen (views/news.html), the built-in's sync step taken over by the flow `news.fetch-round` (its interval
 * as before) and the built-in off — it stands in through its port (state.ts PROVIDED_BY: its settings page, the Today page's news and the Workspace database of
 * what you kept go on reading the same tables). Needs the plugin in the plugins folder. Server only.
 */
export async function switchNewsToPlugin(): Promise<{ db: number | null }> {
  const reg = await import("@/lib/ext/registry");
  const plugin = reg.scanPlugins(true).plugins.find((x) => x.id === PORT);
  if (!plugin) throw new Error(`The News plugin (${PORT}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  // (the built-in makes its tables on first use)
  (await import("./store")).listSources();
  const minutes = (await import("@/lib/sync/intervals")).stepMinutes("news" as never);
  reg.setEnabled(PORT, true);
  const flows = await import("@/plugins/workspace/flows/store");
  if (!flows.flowByName("news.fetch-round")) {
    const life = await import("@/plugins/workspace/package-life");
    const pkg = await life.offeredPackage(PORT);
    if (!pkg) throw new Error(`The News plugin (${PORT}) brings no package.`);
    const system = getPref<number | null>("system.root", null);
    const { getPage } = await import("@/plugins/workspace/store");
    await life.installTracked(pkg, system && getPage(system) && !getPage(system)!.archivedAt ? system : null, { allow: true });
  }
  flows.setSyncFlowMinutes("news.fetch-round", minutes);
  const known = getPref<number | null>("news.workspaceApp", null);
  let db: number | null = null;
  if (known) {
    const { getDatabase, updateSchema } = await import("@/plugins/workspace/store");
    const d = getDatabase(known);
    if (d && !d.page.archivedAt) {
      const template = fs.readFileSync(path.join(/*turbopackIgnore: true*/ plugin.dir, "views", "news.html"), "utf8");
      // (the built-in's overview becomes the plugin's screen)
      const views = d.schema.views.map((v): View => (v.type === "app" && v.app === "news" ? { ...v, app: "template", template } : v));
      updateSchema(known, { ...d.schema, views });
      db = known;
    }
  }
  (await import("@/plugins/state")).setInstalled("news", false);
  return { db };
}
