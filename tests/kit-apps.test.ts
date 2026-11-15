import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";
import { vnodeToString, type VNode } from "../src/plugins/workspace/card-template";
import type { Property, Row } from "../src/plugins/workspace/model";
import { dateBucket, pickedIds, renderView, type ViewData } from "../src/plugins/workspace/view-template";

setupTempData();

/**
 * The kit grown for apps of every kind — each piece tried the way an app uses it: a CRM reading and writing a second database from its
 * view (db.query / db.add / db.update as you), a task list doing something with many rows at once (<check>, rows.update, rows.archive),
 * a household book by month and category (a chart's by= and series=), a stopwatch (<tick>, now.datetime, since, clock, duration).
 */

const find = (nodes: VNode[], t: string): Extract<VNode, object>[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [...(n.t === t ? [n] : []), ...find(n.c, t)]));
const props: Property[] = [
  { id: "cat", name: "Category", type: "select", options: [{ id: "f", name: "Food", color: "green" }, { id: "r", name: "Rent", color: "blue" }] },
  { id: "amt", name: "Amount", type: "number" },
  { id: "day", name: "Day", type: "date" },
  { id: "start", name: "Started", type: "text" },
] as Property[];
const row = (id: number, title: string, cat: string, amt: number, day: string): Row => ({ id, title, icon: "", cells: { cat, amt, day }, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }) as Row;
const rows = [row(1, "Bread", "f", 3, "2026-10-02"), row(2, "Flat", "r", 900, "2026-10-01"), row(3, "Cheese", "f", 7, "2026-11-03"), row(4, "Flat", "r", 900, "2026-11-01"), row(5, "Apples", "f", 2, "2026-11-20")];
const data = (over: Partial<ViewData> = {}): ViewData => ({ rows, props, titleName: "Name", state: {}, app: {}, db: { id: 7, title: "Book" }, now: new Date("2026-11-14T10:00:00"), ...over });

test("a household book: spending by month, in time's order, a part per category (stacked)", () => {
  const r = renderView('<chart kind=column source="rows" group="Day" by=month value="Amount" series="Category"/>', data());
  assert.deepEqual(r.errors, []);
  const c = find(r.nodes, "chart")[0];
  const points = JSON.parse(c.a.data) as { label: string; value: number; parts: number[] }[];
  assert.deepEqual(points.map((p) => [p.value, p.parts]), [[903, [3, 900]], [909, [9, 900]]]);
  assert.deepEqual(JSON.parse(c.a.series), [{ name: "Food", color: "green" }, { name: "Rent", color: "blue" }]);
  // Without series: one value per month; by week: ISO weeks.
  const plain = JSON.parse(find(renderView('<chart kind=line source="rows" group="Day" by=week calc=count/>', data()).nodes, "chart")[0].a.data) as { label: string; value: number }[];
  assert.equal(plain.length, 4);
  assert.deepEqual(dateBucket("2026-01-01", "week"), { key: "2026-W01", label: "W01 2026" });
  assert.deepEqual(dateBucket("2027-01-01", "week")?.key, "2026-W53");
  assert.deepEqual(dateBucket({ start: "2026-11-14", end: null }, "year"), { key: "2026", label: "2026" });
  assert.equal(dateBucket("not a date", "month"), null);
});

test("a task list: rows ticked one by one or all at once, kept as a list in the state", () => {
  const tpl = '<check bind="picked" all="rows | where(\'Category\', \'Food\')" label="All"/><list source="rows"><row><check bind="picked"/>{{ title }}</row></list>';
  let r = renderView(tpl, data());
  assert.deepEqual(r.errors, []);
  const boxes = find(r.nodes, "check");
  assert.equal(boxes.length, 6);
  assert.deepEqual(JSON.parse(boxes[0].a.ids), ["1", "3", "5"]);
  assert.deepEqual(boxes.slice(1).map((b) => b.a.value), ["1", "2", "3", "4", "5"]);
  r = renderView(tpl, data({ state: { picked: '["1","3"]' } }));
  const again = find(r.nodes, "check");
  assert.equal(again[0].a.some, "true", "some of all ticked: the head's box half");
  assert.deepEqual(again.slice(1).map((b) => b.a.checked), ["true", "", "true", "", ""]);
  r = renderView(tpl, data({ state: { picked: '["1","3","5"]' } }));
  assert.equal(find(r.nodes, "check")[0].a.checked, "true");
  assert.deepEqual(pickedIds("3, 4,4"), ["3", "4"]);
  assert.deepEqual(pickedIds("[3,4]"), ["3", "4"]);
  assert.deepEqual(pickedIds("[nope"), []);
  assert.match(renderView("<check/>", data()).errors[0].message, /bind/);
  // How many are ticked, for the bulk bar.
  assert.match(vnodeToString(renderView("{{ state.picked | fromjson | len }} picked", data({ state: { picked: '["1","3"]' } })).nodes), /2 picked/);
});

test("a stopwatch: the view ticks, the time since a start shown as a clock and a duration", () => {
  const r = renderView('<tick every=1/>{{ now.datetime }} · {{ now.time }} · {{ "2026-11-14T09:58:30" | since | clock }} · {{ "2026-11-14T08:00" | since | duration }} · {{ "2026-11-14T10:00:05" | until }} · {{ 90 | duration("min") }} · {{ "2026-11-14" | month }} {{ "2026-11-14" | week }}', data());
  assert.deepEqual(r.errors, []);
  assert.equal(find(r.nodes, "tick")[0].a.every, "1");
  assert.match(vnodeToString(r.nodes), /2026-11-14T10:00:00 · 10:00:00 · 1:30 · 2 h · 5 · 1 h 30 min · 2026-11 2026-W46/);
  assert.equal(find(renderView("<tick every=99999/>", data()).nodes, "tick")[0].a.every, "3600");
});

test("a CRM: a view reads another database's rows and adds, changes, ticks and trashes them as you", async () => {
  await import("@/plugins/workspace/server");
  const store = await import("@/plugins/workspace/store");
  const { runUserAction } = await import("@/plugins/workspace/actions/flows");
  const { shapeInput } = await import("@/plugins/workspace/flows/user-actions");
  const contacts = store.createPage({ kind: "database", title: "Contacts", schema: { titleName: "Name", properties: [{ id: "co", name: "Company", type: "text" }, { id: "st", name: "Stage", type: "select", options: [{ id: "l", name: "Lead", color: "gray" }] }], views: [] } as never });
  // (as a view's with= gives them: dotted names an object, JSON where JSON is taken)
  assert.deepEqual(shapeInput({ "where.Stage": "Lead", "values.Company": "ACME", rows: "[1,2]" }, [{ name: "rows", type: "list" }]), { where: { Stage: "Lead" }, values: { Company: "ACME" }, rows: [1, 2] });

  const add = await runUserAction("db.insert", { database: "Contacts", title: "Ada", "values.Company": "ACME", "values.Stage": "Customer" });
  assert.ok(add.ok, add.ok ? "" : add.error);
  await runUserAction("db.insert", { database: String(contacts), title: "Bob", "values.Stage": "Lead" });
  await runUserAction("db.insert", { database: "Contacts", title: "Cy", "values.Stage": "Lead" });
  // <data do="db.query"> reads by itself (auto) — where by a field.
  const q = await runUserAction("db.query", { database: "Contacts", "where.Stage": "Lead", sort: "title" }, { auto: true });
  assert.ok(q.ok);
  const leads = (q.output as { rows: { id: number; title: string; Stage: string }[] }).rows;
  assert.deepEqual(leads.map((x) => x.title), ["Bob", "Cy"]);
  // Writing takes a click: not by itself.
  const auto = await runUserAction("db.insert", { database: "Contacts", title: "Eve" }, { auto: true });
  assert.equal(auto.ok, false);

  // The leads ticked, then made customers at once; one of them trashed.
  const picked = JSON.stringify(leads.map((x) => String(x.id)));
  const up = await runUserAction("rows.update", { rows: picked, "values.Stage": "Customer", "values.Company": "Initech" });
  assert.ok(up.ok, up.ok ? "" : up.error);
  assert.equal((up.output as { changed: number }).changed, 2);
  const all = (await runUserAction("db.query", { database: "Contacts", sort: "title" }, { auto: true })) as { ok: true; output: { rows: Record<string, unknown>[] } };
  assert.deepEqual(all.output.rows.map((x) => [x.title, x.Stage, x.Company]), [["Ada", "Customer", "ACME"], ["Bob", "Customer", "Initech"], ["Cy", "Customer", "Initech"]]);
  const gone = await runUserAction("rows.archive", { rows: `${leads[0].id}` });
  assert.equal((gone as { ok: true; output: { archived: number } }).output.archived, 1);
  const left = (await runUserAction("db.query", { database: "Contacts" }, { auto: true })) as { ok: true; output: { count: number } };
  assert.equal(left.output.count, 2);
  // A row of another database changed by its id.
  const ch = await runUserAction("db.update", { row: String(leads[1].id), "values.Stage": "Lead" });
  assert.ok(ch.ok, ch.ok ? "" : ch.error);
});

test("a table sorted by a click on a column's head: by what the column says it sorts by, the other way on the next click", () => {
  const tpl = '<datatable source="rows"><column label="Name">{{ title }}</column><column label="Amount" sort="{{ Amount }}">{{ Amount | euro }}</column></datatable>';
  let r = renderView(tpl, data());
  assert.deepEqual(r.errors, []);
  let t = find(r.nodes, "datatable")[0];
  assert.deepEqual(JSON.parse(t.a.cols).map((c: { sort?: string }) => c.sort ?? ""), ["", "true"], "only the column that says what it sorts by");
  assert.equal(t.a.sorted, "");
  r = renderView(tpl, data({ state: { [t.a.sortstate]: "2:desc" } }));
  t = find(r.nodes, "datatable")[0];
  assert.deepEqual(t.c.map((tr) => (typeof tr === "string" ? "" : tr.a.row)), ["2", "4", "3", "1", "5"], "as numbers, biggest first");
  assert.equal(t.a.sorted, "2:desc");
  // sort=true: every column, by what its cell says; sorted= how it starts.
  const all = find(renderView('<datatable source="rows" sort=true sorted="1:asc"><column label="Name">{{ title }}</column></datatable>', data()).nodes, "datatable")[0];
  assert.deepEqual(all.c.map((tr) => (typeof tr === "string" ? "" : tr.a.row)), ["5", "1", "3", "2", "4"]);
});

test("a countdown: <on when> carries whether its condition holds; a QR code; a state kept for the view", () => {
  const tpl = '<tick/><let name="left" value="\'2026-11-14T10:00:30\' | until"/>{{ left }}<on when="{{ left <= 0 }}" action="state" state="ring" value="true"/>';
  let r = renderView(tpl, data());
  assert.deepEqual(r.errors, []);
  assert.equal(find(r.nodes, "on")[0].a.when, "");
  r = renderView(tpl, data({ now: new Date("2026-11-14T10:00:31") }));
  assert.equal(find(r.nodes, "on")[0].a.when, "true");
  assert.equal(find(r.nodes, "on")[0].a.action, "state");
  assert.match(renderView("<on/>", data()).errors[0].message, /when=/);

  const q = find(renderView('<qr value="https://zeff.app/t/42" size=300 label="Ticket"/><qr value=""/>', data()).nodes, "qr");
  assert.deepEqual(q.map((x) => [x.a.value, x.a.size, x.a.label]), [["https://zeff.app/t/42", "300", "Ticket"]]);

  const k = renderView('<state name="tab" value="open" keep=true/><state name="q" value=""/>{{ state.tab }}', data());
  assert.deepEqual(find(k.nodes, "keep").map((x) => x.a.name), ["tab"]);
  assert.match(vnodeToString(k.nodes), /open/);
});
