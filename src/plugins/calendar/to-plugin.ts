import fs from "node:fs";
import path from "node:path";
import { getPref } from "@/lib/prefs";
import type { View } from "@/plugins/workspace/model";

const PORT = "calendar-ext";

/**
 * From the built-in Calendar to the plugin (zeff-plugins/plugins/calendar-ext): the plugin on, its package installed under System — the flows that save, move, delete, propose and
 * decide, and the two AI steps, allowed to (your click is the yes) —, the Calendar database's view drawn by the plugin's page (views/calendar.html) and the built-in off — it stands in
 * through its port (state.ts PROVIDED_BY: the calendar model, the readers of Outlook and Google, the settings page, the plugin API calendar.* and the todo action calendar-entry stay
 * the kernel's; the briefing's steps calendartodos and calendarrelations run the plugin's flows). Needs the plugin in the plugins folder. Server only.
 */
export async function switchCalendarToPlugin(): Promise<{ db: number | null }> {
  const reg = await import("@/lib/ext/registry");
  const plugin = reg.scanPlugins(true).plugins.find((x) => x.id === PORT);
  if (!plugin) throw new Error(`The Calendar plugin (${PORT}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  reg.setEnabled(PORT, true);
  const flows = await import("@/plugins/workspace/flows/store");
  if (!flows.flowByName("calendar.save")) {
    const life = await import("@/plugins/workspace/package-life");
    const pkg = await life.offeredPackage(PORT);
    if (!pkg) throw new Error(`The Calendar plugin (${PORT}) brings no package.`);
    const system = getPref<number | null>("system.root", null);
    const { getPage } = await import("@/plugins/workspace/store");
    await life.installTracked(pkg, system && getPage(system) && !getPage(system)!.archivedAt ? system : null, { allow: true });
  }
  const known = (await import("@/plugins/workspace/calendar-database")).calendarDatabase();
  let db: number | null = null;
  if (known) {
    const { getDatabase, updateSchema } = await import("@/plugins/workspace/store");
    const d = getDatabase(known);
    if (d && !d.page.archivedAt) {
      const template = fs.readFileSync(path.join(/*turbopackIgnore: true*/ plugin.dir, "views", "calendar.html"), "utf8");
      // (the built-in's calendar app becomes the plugin's page)
      const views = d.schema.views.map((v): View => (v.type === "app" && v.app === "calendar" ? { ...v, app: "template", template } : v));
      updateSchema(known, { ...d.schema, views });
      db = known;
    }
  }
  (await import("@/plugins/state")).setInstalled("calendar", false);
  return { db };
}
