import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

/**
 * A person's page starts with a good layout: a short intro line, then their todos, what is coming up, the facts and your rhythm
 * — only on a page with nothing of its own (never over what is written). An existing page that is (nearly) empty gets it on a
 * click. And one form per thing: "All about a person" leaves out what the detail widgets on the same page show already.
 */
setupTempData();

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const widget = (id: string, config: Record<string, unknown> = {}) => ({ type: "zeffWidget", attrs: { widget: id, config: JSON.stringify(config), title: "", header: "" } });

async function peopleDb() {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["workspace", "people", "todos"]) setInstalled(p, true);
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const db = w.createPage({ kind: "database", title: "People", schema: { titleName: "Name", properties: [], views: [m.newView("Table")], dataType: "people" } });
  return { w, db };
}

const widgetsOf = (doc: { content?: { type: string; attrs?: Record<string, unknown> }[] }) => (doc.content ?? []).filter((n) => n.type === "zeffWidget").map((n) => [n.attrs?.widget, n.attrs?.header]);

test("All about a person leaves out what the detail widgets on the same page show (about the same person)", async () => {
  const { w, db } = await peopleDb();
  const people = await import("@/plugins/people/store");
  const fritz = people.createPerson({ name: "Fritz Vogel", emails: ["fritz@example.com"] });
  const other = people.createPerson({ name: "Gerda Huhn" });
  const { addClaim } = await import("@/plugins/people/graph");
  addClaim({ personId: fritz, kind: "commitment", text: "Leiter zurückbringen", direction: "mine", status: "confirmed" });
  addClaim({ personId: fritz, kind: "fact", text: "segelt gern", status: "confirmed" });
  const { addAgentTodo } = await import("@/lib/todos/store");
  addAgentTodo({ ticket: "", text: "Fritz Vogel wegen Garten fragen" });
  const row = w.addRow(db, { title: "Fritz Vogel" });
  (await import("@/db")).getSqlite().prepare("update ws_pages set props = ? where id = ?").run(JSON.stringify({ srcref: `person:${fritz}` }), row);
  const { widgetData } = await import("@/plugins/workspace/widgets");
  const shown = async () => {
    const d = await widgetData("people.overview", { __page: row });
    if (d.kind !== "list") return assert.fail("a list");
    return d.items.map((i) => `${i.text} | ${i.detail ?? ""}`).join("\n");
  };
  const set = (content: unknown[]) => w.updatePage(row, { content: { type: "doc", content: [widget("people.overview"), ...content] } as never });

  set([]);
  for (const want of [/segelt gern/, /Leiter zurückbringen/, /Garten fragen/, /fritz@example\.com/]) assert.match(await shown(), want, "alone on the page: all of it");

  // The detail widgets on the page (one in a column): their sections go from the overview.
  set([{ type: "flexBox", attrs: { dir: "row", gap: "lg" }, content: [{ type: "flexBox", attrs: { dir: "col", gap: "md", span: null }, content: [widget("people.todos")] }] }, widget("people.facts"), widget("people.promises")]);
  const all = await shown();
  for (const gone of [/segelt gern/, /Leiter zurückbringen/, /Garten fragen/]) assert.doesNotMatch(all, gone);
  assert.match(all, /fritz@example\.com/, "what no widget shows stays");

  // A detail widget about someone else doesn't count.
  set([widget("people.todos", { person: "Gerda Huhn", personId: other })]);
  assert.match(await shown(), /Garten fragen/);
});
