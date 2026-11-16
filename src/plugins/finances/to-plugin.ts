import fs from "node:fs";
import path from "node:path";
import { getPref } from "@/lib/prefs";
import type { View } from "@/plugins/workspace/model";

const PORT = "finances-ext";

/**
 * From the built-in Finances to the plugin (zeff-plugins/plugins/finances-ext): the plugin on, its package installed under System — the flows
 * that add a debt, add a subscription, mark an account and the page of your own accounts, allowed to (your click is the yes) —, the debts
 * database's overview drawn by the plugin's screen (views/debts.html), the built-in off. Your debts stay where they are (the database is the
 * Workspace's); its Kennzahlen, widgets, formulas and sources are the plugin's now, and what reads your debts (People, the first look, the brief)
 * asks lib/finances/there.ts. Needs the plugin in the plugins folder. Server only.
 */
export async function switchFinancesToPlugin(): Promise<{ db: number | null }> {
  const reg = await import("@/lib/ext/registry");
  const plugin = reg.scanPlugins(true).plugins.find((x) => x.id === PORT);
  if (!plugin) throw new Error(`The Finances plugin (${PORT}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  reg.setEnabled(PORT, true);
  const flows = await import("@/plugins/workspace/flows/store");
  if (!flows.flowByName("finances.add-debt")) {
    const life = await import("@/plugins/workspace/package-life");
    const pkg = await life.offeredPackage(PORT);
    if (!pkg) throw new Error(`The Finances plugin (${PORT}) brings no package.`);
    const system = getPref<number | null>("system.root", null);
    const { getPage } = await import("@/plugins/workspace/store");
    await life.installTracked(pkg, system && getPage(system) && !getPage(system)!.archivedAt ? system : null, { allow: true });
  }
  const { debtsDatabase } = await import("./database");
  const db = await debtsDatabase();
  if (db) {
    const { getDatabase, updateSchema } = await import("@/plugins/workspace/store");
    const template = fs.readFileSync(path.join(/*turbopackIgnore: true*/ plugin.dir, "views", "debts.html"), "utf8");
    const d = getDatabase(db)!;
    // (the built-in's overview becomes the plugin's screen)
    const views = d.schema.views.map((v): View => (v.type === "app" && v.app === "debts" ? { ...v, app: "template", template } : v));
    updateSchema(db, { ...d.schema, views });
  }
  (await import("@/plugins/state")).setInstalled("finances", false);
  return { db };
}
