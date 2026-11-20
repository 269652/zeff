// Dev helper (not shipped): the generated report template put into a test server's page (DATABASE_PATH, PAGE, TEMPLATE).
import fs from "node:fs";
if (!process.env.ZEFF_TEST_SERVER) throw new Error("test servers only");
const { getDatabase, updateSchema } = await import("@/plugins/workspace/store");
const id = Number(process.env.PAGE);
const db = getDatabase(id)!;
const tpl = fs.readFileSync(process.env.TEMPLATE!, "utf8");
updateSchema(id, { ...db.schema, views: db.schema.views.map((v) => (v.type === "app" ? { ...v, template: tpl } : v)) });
console.log("injected", tpl.length);
