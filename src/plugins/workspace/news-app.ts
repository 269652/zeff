import fs from "node:fs";
import path from "node:path";
import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { DbSchema, View } from "./model";

const PREF = "news.workspaceApp";
const PLUGIN = "news-ext";

/** The News plugin's page template (its app view `views/news.html`), null: the plugin isn't in the plugins folder or isn't on. */
async function pluginTemplate(): Promise<string | null> {
  const reg = await import("@/lib/ext/registry");
  const plugin = reg.scanPlugins().plugins.find((x) => x.id === PLUGIN);
  if (!plugin || !reg.isEnabled(PLUGIN)) return null;
  try {
    return fs.readFileSync(path.join(/*turbopackIgnore: true*/ plugin.dir, "views", "news.html"), "utf8");
  } catch {
    return null;
  }
}

/**
 * News in the Workspace: its page "News" (a database of the type "news") shown by the News plugin's template — made once, when /news is first opened. Its id; null: the Workspace or
 * the plugin isn't there. A deleted one is made again; one made while News was the built-in (its app view `news`) is given the plugin's template.
 */
export async function newsApp(): Promise<number | null> {
  if (!isInstalled("workspace")) return null;
  const template = await pluginTemplate();
  if (!template) return null;
  const { createPage, getDatabase, updatePage, updateSchema } = await import("./store");
  const known = getPref<number | null>(PREF, null);
  const db = known ? getDatabase(known) : null;
  if (known && db && !db.page.archivedAt) {
    if (db.schema.views.some((v) => v.type === "app" && v.app === "news")) {
      const views = db.schema.views.map((v): View => (v.type === "app" && v.app === "news" ? { ...v, app: "template", template } : v));
      updateSchema(known, { ...db.schema, views });
    }
    return known;
  }
  const { newView } = await import("./model");
  const schema: DbSchema = { titleName: t("Title"), properties: [], views: [{ ...newView(t("News"), "table"), type: "app", app: "template", template }], dataType: "news" };
  const id = createPage({ kind: "database", title: t("News"), icon: "📰", schema });
  updatePage(id, { fullWidth: true, favorite: true });
  setPref(PREF, id);
  return id;
}
