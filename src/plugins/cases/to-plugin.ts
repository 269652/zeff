import fs from "node:fs";
import path from "node:path";
import { getPref } from "@/lib/prefs";
import type { View } from "@/plugins/workspace/model";

const PORT = "cases-ext";

/**
 * From the built-in Cases to the plugin (zeff-plugins/plugins/cases-ext): the plugin on, its package installed under System — the flows
 * that find, summarize, match and settle your cases, allowed to (your click is the yes) —, the cases database's overview and each case's
 * page drawn by the plugin's screens (views/overview.html, views/case.html), the built-in off. Your cases stay where they are: the plugin's
 * stores adopt the built-in's tables (lib/ext/stores.ts ADOPTABLE), and its source stands in for the built-in's "cases" (REPLACEABLE_SOURCES),
 * so the database reads on. Needs the plugin in the plugins folder. Server only.
 */
export async function switchCasesToPlugin(): Promise<{ db: number | null }> {
  const reg = await import("@/lib/ext/registry");
  const plugin = reg.scanPlugins(true).plugins.find((x) => x.id === PORT);
  if (!plugin) throw new Error(`The Cases plugin (${PORT}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  reg.setEnabled(PORT, true);
  const flows = await import("@/plugins/workspace/flows/store");
  if (!flows.flowByName("cases.detect")) {
    const life = await import("@/plugins/workspace/package-life");
    const pkg = await life.offeredPackage(PORT);
    if (!pkg) throw new Error(`The Cases plugin (${PORT}) brings no package.`);
    const system = getPref<number | null>("system.root", null);
    const { getPage } = await import("@/plugins/workspace/store");
    await life.installTracked(pkg, system && getPage(system) && !getPage(system)!.archivedAt ? system : null, { allow: true });
  }
  const { casesDatabase } = await import("./database");
  const db = await casesDatabase();
  if (db) {
    const { getDatabase, updateSchema } = await import("@/plugins/workspace/store");
    const read = (f: string) => fs.readFileSync(path.join(/*turbopackIgnore: true*/ plugin.dir, "views", f), "utf8");
    const overview = read("overview.html");
    const d = getDatabase(db)!;
    // (the built-in's overview becomes the plugin's screen; the case's page its detail page — a row page draws it once the built-in is off)
    const views = d.schema.views.map((v): View => (v.type === "app" && v.app === "cases" ? { ...v, app: "template", template: overview } : v));
    updateSchema(db, { ...d.schema, views, rowTemplate: read("case.html") });
  }
  (await import("@/plugins/state")).setInstalled("cases", false);
  return { db };
}
