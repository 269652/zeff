import fs from "node:fs";
import path from "node:path";
import { newView, type View } from "@/plugins/workspace/model";

const PORT = "people-ext";

/**
 * The People port's screens put in place (zeff-plugins/plugins/people-ext): the people database's overview view and each person's page are the plugin's
 * templates (views/people.html, views/person.html) — made of the view language, their data the plugin's lambdas. Zeff has no screens of its own for them any
 * more: while the plugin is on, the database gets them (when the workspace opens: ensurePeopleDatabase) and a newer version's templates replace the older
 * ones. Your own views of the database stay. The people, claims and links themselves stay Zeff's (the shared graph). Server only.
 */
export async function switchPeopleScreensToPlugin(): Promise<{ db: number | null }> {
  const reg = await import("@/lib/ext/registry");
  const plugin = reg.scanPlugins(true).plugins.find((x) => x.id === PORT);
  if (!plugin) throw new Error(`The People plugin (${PORT}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  return putPeopleScreens(plugin.dir);
}

/** The screens in the database when the plugin is on and they are missing or older (nothing when it is off). */
export async function ensurePeopleScreens(): Promise<void> {
  const { enabledPlugins } = await import("@/lib/ext/registry");
  const plugin = enabledPlugins().find((x) => x.id === PORT);
  if (plugin) await putPeopleScreens(plugin.dir);
}

async function putPeopleScreens(dir: string): Promise<{ db: number | null }> {
  const { peopleDatabase } = await import("@/plugins/workspace/people-database");
  const db = peopleDatabase();
  if (!db) return { db: null };
  const { getDatabase, updateSchema } = await import("@/plugins/workspace/store");
  const read = (f: string) => fs.readFileSync(path.join(/*turbopackIgnore: true*/ dir, "views", f), "utf8");
  const overview = read("people.html");
  const person = read("person.html");
  const d = getDatabase(db)!;
  // (the overview: the one view that is the plugin's — its template names the lambda people.screen — brought up to the plugin's version; none yet: the first of the database's views)
  const mine = (v: View) => v.type === "app" && v.app === "template" && /people\.screen/.test(v.template ?? "");
  const views = d.schema.views.some(mine) ? d.schema.views.map((v): View => (mine(v) ? { ...v, template: overview } : v)) : [{ ...newView("Overview"), type: "app", app: "template", template: overview } as View, ...d.schema.views];
  // (nothing written when it is all there already: the workspace opens often)
  if (d.schema.rowTemplate === person && JSON.stringify(views) === JSON.stringify(d.schema.views)) return { db };
  updateSchema(db, { ...d.schema, views, rowTemplate: person });
  return { db };
}
