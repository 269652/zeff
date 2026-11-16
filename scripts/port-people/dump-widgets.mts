/**
 * The People widgets' declarations (id, label, icon, description, size, settings, whether a button acts) as they are in the built-in (src/plugins/people/widgets*.ts),
 * written to scripts/port-people/widgets.json — scripts/port-people.mts turns them into the plugin's `contributes.widgets`. Run when a built-in widget changes:
 *   DATABASE_PATH=<a scratch db> npx tsx scripts/port-people/dump-widgets.mts
 */
import fs from "node:fs";
import path from "node:path";

process.env.DATABASE_PATH ??= path.join(process.env.TEMP ?? ".", "zeff-dump-widgets.db");
await import("../../src/plugins/contributions");
const { workspaceWidgets } = await import("../../src/plugins/workspace/widget-point");
const all = workspaceWidgets.all().flatMap((c) => c.impl).filter((w) => w.id.startsWith("people."));
const out = all.map((w) => ({ id: w.id, label: w.label, icon: w.icon, description: w.description, size: w.size ?? "half", ttl: w.ttl ?? 30, header: w.header, settings: w.settings ?? [], acts: !!w.act }));
fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")), "widgets.json"), JSON.stringify(out, null, 2) + "\n");
console.log(out.map((w) => w.id).join(", "));
