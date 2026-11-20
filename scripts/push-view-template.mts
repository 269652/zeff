/**
 * A plugin's app view template checked and put into a (test) server's database — how a change to a port's view reaches a running server without a version
 * bump: every database whose app view has the marker gets the template. Only for a test server's database (ZEFF_TEST_SERVER).
 *   DATABASE_PATH=<test data>/zeff.db ZEFF_TEST_SERVER=1 npx tsx scripts/push-view-template.mts <template.html> <marker, e.g. todos.screen>
 */
import fs from "node:fs";

if (!process.env.DATABASE_PATH || !process.env.ZEFF_TEST_SERVER) throw new Error("Only for a test server's database (DATABASE_PATH + ZEFF_TEST_SERVER).");
const [file, marker] = process.argv.slice(2);
const template = fs.readFileSync(file, "utf8");
const { renderView, viewDefaults } = await import("../src/plugins/workspace/view-template");
const out = renderView(template, { rows: [], props: [], titleName: "x", state: viewDefaults(template), app: {}, data: {}, db: { id: 1, title: "x" } } as never);
if (out.errors.length) {
  console.error(JSON.stringify(out.errors.slice(0, 10), null, 1));
  process.exit(1);
}
const { getSqlite } = await import("../src/db");
const sq = getSqlite();
let n = 0;
for (const r of sq.prepare("select id, schema from ws_pages where kind = 'database' and instr(schema, ?) > 0").all(marker) as { id: number; schema: string }[]) {
  const s = JSON.parse(r.schema);
  for (const v of s.views ?? []) if (v.type === "app" && String(v.template ?? "").includes(marker)) v.template = template;
  sq.prepare("update ws_pages set schema = ? where id = ?").run(JSON.stringify(s), r.id);
  n++;
}
console.log(`template put into ${n} database(s)`);
