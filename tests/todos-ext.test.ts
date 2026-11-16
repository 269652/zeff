import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";
import { loadRepoLanguages, repoPlugin, skipWithoutRepo } from "./plugins-repo";

setupTempData();

/**
 * The Todos screens' port (zeff-plugins/plugins/todos-ext): its lambda gives the screen the very todos the built-in page shows (the same groups, the same order, the same
 * words); what a click does is a flow over the kernel's engine functions (the same the built-in's server actions call); the screen draws without an error.
 */

const skip = skipWithoutRepo("todos-ext");
type Item = { id: number; ref: string; text: string; ticket: string; due: string; dueLabel: string; dueTone: string; flagged: boolean; deferred: boolean; closed: boolean; waiting: boolean; repeat: string; kind: string; reported: string; asking: string; state: string };
type Screen = { scope: string; counts: { open: number; waiting: number; done: number; worker: number }; groups: { key: string; label: string; count: number; items: Item[] }[]; waiting: Item[]; rows: Item[]; nWaiting: number; empty: string; briefing: boolean };

const iso = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

let made: ReturnType<typeof build> | null = null;
const world = () => (made ??= build());
async function build() {
  const plugins = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-todos-ext-"));
  process.env.ZEFF_PLUGINS_DIR = plugins;
  fs.cpSync(repoPlugin("todos-ext"), path.join(plugins, "todos-ext"), { recursive: true });
  const state = await import("@/plugins/state");
  const { getDb, schema } = await import("@/db");
  for (const id of ["workspace", "todos"]) state.setInstalled(id as never, true);
  await import("@/plugins/contributions");
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  reg.setEnabled("todos-ext", true);
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("todos-ext"), "todos.package.json"), "utf8"));
  const r = await (await import("@/plugins/workspace/package-life")).installTracked(pkg, null, { allow: true });
  const lambdas = await import("@/plugins/workspace/lambdas/store");
  const { runLambda } = await import("@/plugins/workspace/lambdas/run");
  const call = async <T>(name: string, event: Record<string, unknown>): Promise<T> => {
    const l = lambdas.getLambda(name);
    assert.ok(l, `${name} is there`);
    const run = await runLambda(l!, event);
    assert.ok(run.ok, run.ok ? "" : run.error);
    return run.result as T;
  };
  // Some todos of every kind the page tells apart.
  const store = await import("@/lib/todos/store");
  const mk = (text: string, extra: { due?: string; flag?: boolean; defer?: boolean } = {}) => {
    const t = store.addManualTodo({ ticket: "", text });
    if (extra.due) store.setTodoDue(t.id, extra.due);
    if (extra.flag) store.setTodoFlagged(t.id, true);
    if (extra.defer) store.setTodoDeferred(t.id, true);
    return t.id;
  };
  const ids = {
    late: mk("Pay the garage", { due: iso(-3) }),
    today: mk("Call the bank", { due: iso(0) }),
    soon: mk("Send the form", { due: iso(2) }),
    week: mk("Book the train", { due: iso(6) }),
    later: mk("Renew the passport", { due: iso(40) }),
    plain: mk("Tidy the cellar"),
    star: mk("Prepare the talk", { flag: true }),
    down: mk("Sort the photos", { defer: true }),
    gone: mk("Old idea"),
    finished: mk("Water the plants"),
  };
  const now = new Date().toISOString();
  const other = getDb().insert(schema.todos).values({ ticket: "", text: "Reply from Anna", kind: "reply", owner: "other", status: "open", source: "From you", refs: "[]", runId: null, createdAt: now, updatedAt: now }).returning().get();
  const worker = getDb().insert(schema.todos).values({ ticket: "", text: "Worker's own todo", kind: "fix", owner: "me", status: "open", source: "From agent", byWorker: true, refs: "[]", runId: null, createdAt: now, updatedAt: now }).returning().get();
  store.setTodoStatus(ids.finished, "done");
  store.setTodoStatus(ids.gone, "dismissed");
  return { allowed: r.allowed, call, ids, otherId: other.id, workerId: worker.id, store };
}

test("the screen's lambda groups the open todos as the built-in page does: the same groups, the same todos, the same order", { skip }, async () => {
  const { call, ids, otherId } = await world();
  const { groupTodos } = await import("@/lib/todos/groups");
  const { listTodos } = await import("@/lib/todos/store");
  const { deferral } = await import("@/lib/todos/deferral");
  const open = listTodos({ status: "open" }).filter((t) => !t.byWorker && !t.mergedInto);
  const flags = deferral(open);
  const mine = open.filter((t) => t.owner === "me").map((t) => ({ ...t, deferred: flags[t.id]?.deferred ?? false }));
  const built = groupTodos(mine);
  const screen = await call<Screen>("todos.screen", { scope: "open" });
  assert.equal(screen.briefing, false);
  assert.deepEqual(screen.groups.map((g) => g.key), built.map((g) => g.key));
  assert.deepEqual(screen.groups.map((g) => g.key), ["important", "overdue", "today", "week", "later", "none", "deferred"]);
  for (const g of built) assert.deepEqual(screen.groups.find((x) => x.key === g.key)!.items.map((x) => x.id), g.items.map((x) => x.id).sort((a, b) => a - b));
  assert.deepEqual(screen.groups.map((g) => g.label), ["Important", "Overdue", "Today", "This week", "Later", "No due date", "Set aside"]);
  const all = screen.groups.flatMap((g) => g.items);
  assert.equal(all.find((x) => x.id === ids.late)?.dueLabel, "overdue (3 days)");
  assert.equal(all.find((x) => x.id === ids.late)?.dueTone, "bad");
  assert.equal(all.find((x) => x.id === ids.today)?.dueLabel, "due today");
  assert.equal(all.find((x) => x.id === ids.soon)?.dueTone, "warn");
  assert.equal(all.find((x) => x.id === ids.week)?.dueTone, "muted");
  assert.equal(all.find((x) => x.id === ids.plain)?.dueLabel, "due date");
  assert.equal(all.find((x) => x.id === ids.star)?.flagged, true);
  assert.equal(all.find((x) => x.id === ids.down)?.deferred, true);
  // What you wait on stands apart; the workers' own and the closed ones are not in the list.
  assert.deepEqual(screen.waiting.map((x) => x.id), [otherId]);
  assert.equal(screen.nWaiting, 1);
  assert.ok(!all.some((x) => x.closed || [ids.gone, ids.finished].includes(x.id)));
  assert.deepEqual(screen.counts, { open: mine.length, waiting: 1, done: 2, worker: 1 });
  // The filter.
  const f = await call<Screen>("todos.screen", { scope: "open", filter: "TRAIN" });
  assert.deepEqual(f.groups.flatMap((g) => g.items.map((x) => x.id)), [ids.week]);
  assert.equal((await call<Screen>("todos.screen", { scope: "open", filter: "zzz" })).empty, "Nothing matches the filter.");
});

test("done and the workers' own: the page's lists", { skip }, async () => {
  const { call, ids, workerId } = await world();
  const { doneTodos } = await import("@/lib/todos/store");
  const done = await call<Screen>("todos.screen", { scope: "done" });
  assert.deepEqual(done.rows.map((x) => x.id).sort(), doneTodos().map((x) => x.id).sort());
  assert.deepEqual(done.rows.map((x) => x.id).sort(), [ids.finished, ids.gone].sort());
  assert.equal(done.rows.find((x) => x.id === ids.gone)?.state, "Dismissed");
  assert.ok(done.rows.every((x) => x.closed));
  const worker = await call<Screen>("todos.screen", { scope: "worker" });
  assert.deepEqual(worker.rows.map((x) => x.id), [workerId]);
  assert.equal(worker.rows[0].kind, "Fix");
  assert.equal((await call<Screen>("todos.screen", { scope: "done", filter: "nothing like it" })).rows.length, 0);
});

test("German words from the language pack, as the built-in says them", { skip }, async (t) => {
  if (!(await loadRepoLanguages())) return t.skip("needs the German pack");
  const { call, ids } = await world();
  const srv = await import("@/lib/i18n/server");
  srv.setLanguage("de");
  let screen: Screen;
  try {
    screen = await call<Screen>("todos.screen", { scope: "open" });
  } finally {
    srv.setLanguage("en");
  }
  assert.deepEqual(screen.groups.map((g) => g.label), ["Wichtig", "Überfällig", "Heute", "Diese Woche", "Später", "Ohne Frist", "Zurückgestellt"]);
  assert.match(screen.groups.flatMap((g) => g.items).find((x) => x.id === ids.late)!.dueLabel, /überfällig/);
});

test("what a click does is a flow over the engine: tick off, open again, flag, set aside, a due day, add — each as the built-in's actions", { skip }, async () => {
  const { ids, store, allowed } = await world();
  assert.deepEqual([...allowed].sort(), ["todos-ext.add", "todos-ext.defer", "todos-ext.due", "todos-ext.flag", "todos-ext.status"]);
  const engine = await import("@/plugins/workspace/flows/engine");
  const ok = async (name: string, input: Record<string, unknown>, dry = false) => {
    const r = await engine.runFlow(name, input, dry ? { dry: true } : undefined);
    assert.equal(r.status, "done", `${name}: ${r.error ?? ""}`);
    return r;
  };
  // A dry run touches nothing.
  await ok("todos-ext.status", { id: ids.plain, status: "done" }, true);
  assert.equal(store.getTodo(ids.plain)?.status, "open");
  await ok("todos-ext.status", { id: ids.plain, status: "done" });
  assert.equal(store.getTodo(ids.plain)?.status, "done");
  assert.ok(store.getTodo(ids.plain)?.doneAt);
  await ok("todos-ext.status", { id: ids.plain, status: "open" });
  assert.equal(store.getTodo(ids.plain)?.status, "open");
  await ok("todos-ext.status", { id: ids.plain, status: "dismissed" });
  assert.equal(store.getTodo(ids.plain)?.status, "dismissed");
  await ok("todos-ext.status", { id: ids.plain, status: "open" });
  // The history says you did it (the built-in's: attributed("you")).
  const { getSqlite } = await import("@/db");
  const ev = getSqlite().prepare("select actor from todo_events where todo_id = ? order by id desc limit 1").get(ids.plain) as { actor: string } | undefined;
  assert.equal(ev?.actor, "you");
  // Flag, set aside, a due day (a bad one is refused).
  await ok("todos-ext.flag", { id: ids.week, flagged: "true" });
  assert.ok(store.getTodo(ids.week)?.flaggedAt);
  await ok("todos-ext.flag", { id: ids.week, flagged: "false" });
  assert.equal(store.getTodo(ids.week)?.flaggedAt, null);
  await ok("todos-ext.defer", { id: ids.week, deferred: "true" });
  assert.ok(store.getTodo(ids.week)?.deferredAt);
  await ok("todos-ext.defer", { id: ids.week, deferred: "false" });
  assert.equal(store.getTodo(ids.week)?.deferredAt, null);
  await ok("todos-ext.due", { id: ids.plain, due: iso(5) });
  assert.equal(store.getTodo(ids.plain)?.due?.slice(0, 10), iso(5));
  await ok("todos-ext.due", { id: ids.plain, due: "" });
  assert.equal(store.getTodo(ids.plain)?.due, null);
  assert.equal((await engine.runFlow("todos-ext.due", { id: ids.plain, due: "next week" })).status, "failed");
  // A todo that comes back, ticked off more than a week before its day: asked first, then done with early.
  const { setRecurrence } = await import("@/lib/todos/recurring");
  setRecurrence(ids.later, { freq: "monthly", interval: 1 });
  const asked = await ok("todos-ext.status", { id: ids.later, status: "done" });
  assert.match(String((asked.output as { confirm?: string }).confirm), /comes back every time/);
  assert.equal(store.getTodo(ids.later)?.status, "open");
  await ok("todos-ext.status", { id: ids.later, status: "done", early: "true" });
  assert.equal(store.getTodo(ids.later)?.status, "done");
  // Adding: through the gate (the same words again are merged, and said so), with a ticket and a due day.
  const a = await ok("todos-ext.add", { text: "Order the new filter", ticket: "wsx-12", due: iso(3) });
  const added = (a.output as { id: number; ref: string; merged: boolean });
  assert.equal(added.merged, false);
  assert.equal(store.getTodo(added.id)?.ticket, "WSX-12");
  assert.equal(store.getTodo(added.id)?.due?.slice(0, 10), iso(3));
  assert.equal(store.getTodo(added.id)?.source, "From you");
  const again = await ok("todos-ext.add", { text: "Order the new filter", ticket: "WSX-12" });
  assert.equal((again.output as { merged: boolean }).merged, true);
  assert.equal((again.output as { id: number }).id, added.id);
  // Without the flow's permission "todos" nothing changes.
  const { flowAction } = await import("@/plugins/workspace/flows/actions");
  const none = { flow: "x", runId: null, dryRun: false, perms: {}, web: async () => new URL("https://x.y"), canWrite: () => undefined, may: () => undefined, log: () => undefined };
  for (const name of ["todos.set-status", "todos.flag", "todos.defer", "todos.set-due", "todos.set-text", "todos.add-note"]) {
    assert.equal(flowAction(name)?.writes, true, `${name} writes`);
    await assert.rejects(async () => flowAction(name)!.run({ id: ids.plain, status: "done", text: "x", flagged: true, deferred: true }, none), /may not change todos/);
  }
  assert.ok(!flowAction("todos.rows")?.writes);
});

test("the lambda only reads, and only the kernel's read of the todos", { skip }, async () => {
  await world();
  const lambdas = await import("@/plugins/workspace/lambdas/store");
  assert.deepEqual(lambdas.getLambda("todos.screen")!.manifest.zeff, ["todos.rows"]);
});

test("the screen's template draws without an error: each list, a filter, a due day being set, an answer that asks", { skip }, async () => {
  const { call, ids } = await world();
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("todos-ext"), "views", "todos.html"), "utf8");
  const draw = (x: unknown, state: Record<string, string>, extra: Record<string, unknown> = {}) =>
    renderView(template, { rows: [], props: [], titleName: "Todos", state: { ...state }, app: {}, data: { x, ...extra }, db: { id: 1, title: "Todos" } } as never);
  for (const scope of ["open", "done", "worker"]) {
    const x = await call<Screen>("todos.screen", { scope });
    const r = draw(x, { scope });
    assert.deepEqual(r.errors, [], scope);
    assert.ok(r.nodes.length > 0);
    const drawn = JSON.stringify(r.nodes);
    for (const row of x.groups.flatMap((g) => g.items).concat(x.rows)) assert.ok(drawn.includes(row.text), `${scope}: ${row.text} is drawn`);
    if (scope === "open") assert.ok(drawn.includes("Reply from Anna"), "the todo you wait on is drawn");
  }
  const x = await call<Screen>("todos.screen", { scope: "open" });
  assert.deepEqual(draw(x, { scope: "open", dueedit: String(ids.late), dueval: iso(1) }).errors, []);
  assert.deepEqual(draw(x, { scope: "open", filter: "bank" }).errors, []);
  assert.deepEqual(draw(x, { scope: "open" }, { st: { confirm: "T-5 comes back every time", id: 5 }, added: { id: 3, ref: "T-3", merged: true } }).errors, []);
  assert.deepEqual(draw(undefined, {}).errors, []);
  // The same template is the view of the package's database.
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("todos-ext"), "todos.package.json"), "utf8")) as { items: { schema?: { views: { template: string }[] } }[] };
  assert.equal(pkg.items.find((i) => i.schema)?.schema?.views[0].template, template);
});
