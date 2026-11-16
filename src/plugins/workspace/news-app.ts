import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { DbSchema, View } from "./model";

const PREF = "news.workspaceApp";
const PLUGIN = "news-ext";
const HASH = "news.workspaceApp.templateHash";
const hash = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

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
 * The page's views carry a copy of the plugin's template (the Workspace keeps a view's template in the database): when the plugin brings a newer one, the copy is replaced —
 * unless it was changed here (what was written last is remembered by its hash; a copy made before that is replaced once). Server only.
 */
export async function refreshNewsApp(): Promise<void> {
  const known = getPref<number | null>(PREF, null);
  if (!known) return;
  const template = await pluginTemplate();
  if (!template) return;
  const { getDatabase, updateSchema } = await import("./store");
  const db = getDatabase(known);
  if (!db || db.page.archivedAt) return;
  const last = getPref<string>(HASH, "");
  const isNews = (v: View) => v.type === "app" && v.app === "template" && !!v.template && v.template.includes('lambda="news.screen"');
  const stale = db.schema.views.filter((v) => isNews(v) && v.template !== template && (!last || hash(v.template!) === last));
  if (!stale.length) {
    if (!last && db.schema.views.some((v) => isNews(v) && v.template === template)) setPref(HASH, hash(template));
    return;
  }
  updateSchema(known, { ...db.schema, views: db.schema.views.map((v) => (stale.includes(v) ? { ...v, template } : v)) });
  setPref(HASH, hash(template));
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
      setPref(HASH, hash(template));
    }
    await refreshNewsApp();
    return known;
  }
  const { newView } = await import("./model");
  const schema: DbSchema = { titleName: t("Title"), properties: [], views: [{ ...newView(t("News"), "table"), type: "app", app: "template", template }], dataType: "news" };
  const id = createPage({ kind: "database", title: t("News"), icon: "📰", schema });
  updatePage(id, { fullWidth: true, favorite: true });
  setPref(PREF, id);
  setPref(HASH, hash(template));
  return id;
}
