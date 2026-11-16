import fs from "node:fs";
import path from "node:path";
import type { View } from "@/plugins/workspace/model";

const PORT = "people-ext";

/**
 * The People port's screens put in place (zeff-plugins/plugins/people-ext): the people database's overview view and each person's page are
 * the plugin's templates (views/people.html, views/person.html) — made of the view language, their data the plugin's lambdas. Your own
 * views of the database stay; the built-in's overview becomes the plugin's. The people, claims and links themselves stay Zeff's (the shared
 * graph). Run by the port's switch (ports.ts), after the plugin is on and its package installed. Server only.
 */
export async function switchPeopleScreensToPlugin(): Promise<{ db: number | null }> {
  const reg = await import("@/lib/ext/registry");
  const plugin = reg.scanPlugins(true).plugins.find((x) => x.id === PORT);
  if (!plugin) throw new Error(`The People plugin (${PORT}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  const { peopleDatabase } = await import("@/plugins/workspace/people-database");
  const db = peopleDatabase();
  if (!db) return { db: null };
  const { getDatabase, updateSchema } = await import("@/plugins/workspace/store");
  const read = (f: string) => fs.readFileSync(path.join(/*turbopackIgnore: true*/ plugin.dir, "views", f), "utf8");
  const overview = read("people.html");
  const d = getDatabase(db)!;
  const views = d.schema.views.map((v): View => (v.type === "app" && v.app === "people" ? { ...v, app: "template", template: overview } : v));
  updateSchema(db, { ...d.schema, views, rowTemplate: read("person.html") });
  return { db };
}
