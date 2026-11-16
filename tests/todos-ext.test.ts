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
  const expected = ["todos-ext.add", "todos-ext.board-run", "todos-ext.defer", "todos-ext.due", "todos-ext.flag", "todos-ext.follow", "todos-ext.note", "todos-ext.note-remove", "todos-ext.op-remove", "todos-ext.recap-start", "todos-ext.run", "todos-ext.seen", "todos-ext.status", "todos-ext.text", "todos-ext.ticket-action", "todos-ext.time", "todos-ext.undo-run"];
  for (const name of expected) assert.ok(allowed.includes(name), name);
  assert.ok([...allowed].every((n) => n.startsWith("todos-ext.")));
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

type Panel = { found: boolean; id: number; ref: string; text: string; kind: string; closed: boolean; notes: { at: string; by: string; text: string; mine: boolean; when: string }[]; ops: { index: number; title: string; heading: string; body: string; runnable: boolean; only: string }[]; nOps: number; opsWhy: string; time: { minutes: number; length: string; note: string }[]; totalTime: string; sources: unknown[]; error?: string };

test("a todo's panel: its notes, actions in words, time — and what the panel does is the engine's: note, time, remove an action, run is held back without api", { skip }, async () => {
  const { call, ids, store } = await world();
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const engine = await import("@/plugins/workspace/flows/engine");
  const id = ids.soon;
  getDb().update(schema.todos).set({ ops: JSON.stringify([{ type: "jira-comment", ticket: "PROJ-7", body: "Rico, kannst du bitte approven?" }, { type: "jira-comment", ticket: "PROJ-8", body: "Zweiter Kommentar" }]), autoOpsWhy: "Rico wartet auf eine Erinnerung" }).where(eq(schema.todos.id, id)).run();
  const p0 = await call<Panel>("todos.panel", { id });
  assert.equal(p0.found, true);
  assert.equal(p0.ref, `T-${id}`);
  assert.equal(p0.text, "Send the form");
  assert.equal(p0.nOps, 2);
  assert.equal(p0.ops[0].runnable, true);
  assert.match(p0.ops[0].body, /approven/);
  assert.equal(p0.opsWhy, "Suggested: Rico wartet auf eine Erinnerung");
  assert.equal((await call<Panel>("todos.panel", { id: 999999 })).found, false);
  assert.equal((await engine.runFlow("todos-ext.text", { id, text: "Send the form to Anna" })).status, "done");
  assert.equal(store.getTodo(id)?.text, "Send the form to Anna");
  // An action taken off (its place), a place that isn't there said so.
  const removed = await engine.runFlow("todos-ext.op-remove", { id, index: "0" });
  assert.equal(removed.status, "done", removed.error ?? "");
  assert.equal(store.getTodo(id)?.ops.length, 1);
  assert.equal((store.getTodo(id)?.ops[0] as { ticket?: string }).ticket, "PROJ-8");
  assert.equal(((await engine.runFlow("todos-ext.op-remove", { id, index: "7" })).output as { ok: boolean }).ok, false);
  // A note (saved as yours: it can be taken away), time by hand.
  const noted = await engine.runFlow("todos-ext.note", { id, text: "Ask Rico first" });
  assert.equal(noted.status, "done", noted.error ?? "");
  assert.equal(((await engine.runFlow("todos-ext.note", { id, text: "  " })).output as { ok: boolean }).ok, false);
  const timed = await engine.runFlow("todos-ext.time", { id, minutes: "75", note: "Read the form" });
  assert.equal(timed.status, "done", timed.error ?? "");
  const p1 = await call<Panel>("todos.panel", { id });
  assert.deepEqual(p1.notes.filter((n) => n.mine).map((n) => [n.text, n.mine]), [["Ask Rico first", true]]);
  assert.deepEqual(p1.time.map((r) => [r.minutes, r.length, r.note]), [[75, "1 h 15 min", "Read the form"]]);
  assert.equal(p1.totalTime, "1 h 15 min");
  const own = () => store.getTodo(id)!.userNotes.filter((n) => !n.by && n.kind !== "instruction");
  assert.equal(own().length, 1);
  // The note taken away again.
  const at = own()[0].at;
  assert.equal((await engine.runFlow("todos-ext.note-remove", { id, at })).status, "done");
  assert.equal(own().length, 0);
  // Running them: dry run touches nothing; a flow without "api" is refused (the package's flow asks for both).
  assert.equal((await engine.runFlow("todos-ext.run", { id, only: "" }, { dry: true })).status, "done");
  const { flowAction } = await import("@/plugins/workspace/flows/actions");
  const todosOnly = { flow: "x", runId: null, dryRun: false, perms: { todos: true }, web: async () => new URL("https://x.y"), canWrite: () => undefined, may: () => undefined, log: () => undefined };
  await assert.rejects(async () => flowAction("todos.run-ops")!.run({ id }, todosOnly as never), /permissions “todos” and “api”/);
  assert.equal(flowAction("todos.run-ops")?.writes, true);
  assert.ok(!flowAction("todos.detail")?.writes);
  assert.deepEqual((await import("@/plugins/workspace/lambdas/store")).getLambda("todos.panel")!.manifest.zeff, ["todos.detail"]);
  // The panel draws.
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("todos-ext"), "views", "todos.html"), "utf8");
  const x = await call<Screen>("todos.screen", { scope: "open" });
  const p2 = await call<Panel>("todos.panel", { id });
  for (const state of [{ scope: "open", panel: String(id) }, { scope: "open", panel: String(id), textedit: String(id), edittext: "x" }]) {
    const r = renderView(template, { rows: [], props: [], titleName: "Todos", state, app: {}, data: { x, p: p2, ran: { message: "done" }, noted: { message: "Note saved" } }, db: { id: 1, title: "Todos" } } as never);
    assert.deepEqual(r.errors, []);
    const drawn = JSON.stringify(r.nodes);
    for (const word of ["Zweiter Kommentar", "Suggested: Rico wartet", "Add time you spent on this todo"]) assert.ok(drawn.includes(word), word);
  }
});

test("Activity, the omnibar's chips, the briefing and its tickets, the recap, Today: the lambdas give what the built-in's pages show, and every part of the template draws", { skip }, async () => {
  const { call, ids, otherId, store } = await world();
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const engine = await import("@/plugins/workspace/flows/engine");
  const runs = await import("@/lib/runs/store");
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("todos-ext"), "views", "todos.html"), "utf8");
  const drawn = (state: Record<string, string>, data: Record<string, unknown>) => {
    const r = renderView(template, { rows: [], props: [], titleName: "Todos", state, app: {}, data, db: { id: 1, title: "Todos" } } as never);
    assert.deepEqual(r.errors, [], JSON.stringify(state));
    return JSON.stringify(r.nodes);
  };

  // Activity: what happened (made, done, dismissed — by you or not), by day; "new" is what is newer than what you have seen and not your own click.
  type Feed = { days: { items: { id: number; label: string; text: string; isNew: boolean; by: string }[] }[]; max: number; unseen: number };
  const feed = await call<Feed>("todos.feed", {});
  const all = feed.days.flatMap((d) => d.items);
  const built = (await import("@/lib/todos/activity")).todoActivity();
  assert.equal(all.length, built.length);
  assert.ok(all.some((e) => e.text === "Water the plants" && e.label === "done"));
  assert.ok(all.some((e) => e.text === "Old idea" && e.label === "dismissed"));
  assert.equal(feed.max, Math.max(...built.map((e) => e.id)));
  const closed = await call<Feed>("todos.feed", { filter: "closed" });
  assert.ok(closed.days.flatMap((d) => d.items).every((e) => e.label === "done" || e.label === "dismissed"));
  // Never looked: nothing counts as new; once seen up to an event, the later ones from others do.
  assert.equal(feed.unseen, 0);
  assert.equal((await engine.runFlow("todos-ext.seen", { id: feed.max - 1 })).status, "done");
  assert.equal((await engine.runFlow("todos-ext.seen", { id: 1 })).status, "done"); // (never lowered)
  const after = await call<Feed>("todos.feed", {});
  assert.equal(after.unseen, built.filter((e) => e.id > feed.max - 1 && !e.mine).length);
  assert.ok(drawn({ part: "todos", scope: "activity" }, { feed: after, lage: await call("todos.lage", {}) }).includes("Water the plants"));

  // The omnibar: hits with the todos they name; a pick is a chip that narrows the list to exactly those todos.
  const hits = await call<{ hits: { key: string; title: string; first: boolean; label: string; pick: string }[] }>("todos.hits", { q: "garage" });
  assert.ok(hits.hits.length >= 2);
  assert.equal(hits.hits[0].label, "Everything with this");
  const pick = hits.hits.find((h) => h.title.includes(`T-${ids.late}`))!;
  assert.ok(pick, "the todo itself is a hit");
  const chipped = await call<Screen & { chips: unknown[] }>("todos.screen", { scope: "open", chips: JSON.stringify([pick.pick]) });
  assert.deepEqual(chipped.groups.flatMap((g) => g.items.map((x) => x.id)), [ids.late]);
  assert.equal(chipped.chips.length, 1);
  const none = await call<Screen>("todos.screen", { scope: "open", chips: JSON.stringify([pick.pick, "x␟999999"]) });
  assert.equal(none.groups.length, 0);
  assert.deepEqual((await call<{ hits: unknown[] }>("todos.hits", { q: "x" })).hits, []);
  assert.ok(drawn({ part: "todos", scope: "open", omniq: "garage", chips: JSON.stringify([pick.pick]) }, { x: chipped, hits: await call("todos.hits", { q: "garage" }), lage: await call("todos.lage", {}) }).includes("Pay the garage"));

  // The briefing and its tickets: a run with two tickets, one analysed (its todo, a suggested change), one only listed.
  const run = runs.startRun("assignee = currentUser()", "test-model");
  const ticket = (key: string, analyzed: boolean) => ({ key, summary: `Summary of ${key}`, url: `https://jira.example/browse/${key}`, status: "In Progress", statusCategory: "inprogress", issueType: "Task", priority: null, assignee: null, parent: null, updatedAt: "2026-11-01T10:00:00Z", comments: 0, analyzed });
  runs.finishRun(run, {
    status: "ok",
    tickets: [ticket("WSX-12", true), ticket("OLD-1", false)] as never,
    result: { lede: "Two things matter today.", tickets: [{ key: "WSX-12", attention: "feedback", lead: "A question is open.", summary: "Anna asked about the filter.", happened: [{ when: "2026-11-01", who: "Anna", what: "Asked" }], todos: [], resolved: [], flags: ["Overdue in Jira"], actions: [{ type: "comment", label: "Comment: answered", why: "She waits", comment: "Done." }] }], left: [] } as never,
  });
  type Lage = { running: boolean; asOf: string; lede: string; chips: { attention: string; n: number }[]; tickets: { key: string; attLabel: string; lead: string; todos: { text: string }[]; actions: { label: string; ok: boolean }[]; flags: { text: string }[] }[]; nListed: number; runId: number };
  const lage = await call<Lage>("todos.lage", {});
  assert.equal(lage.running, false);
  assert.equal(lage.lede, "Two things matter today.");
  assert.deepEqual(lage.chips.map((c) => [c.attention, c.n]), [["feedback", 1]]);
  assert.deepEqual(lage.tickets.map((x) => [x.key, x.attLabel, x.lead]), [["WSX-12", "Open question", "A question is open."]]);
  assert.deepEqual(lage.tickets[0].todos.map((x) => x.text), ["Order the new filter"]);
  assert.equal(lage.tickets[0].actions[0].label, "Comment: answered");
  assert.equal(lage.tickets[0].flags[0].text, "Overdue in Jira");
  assert.equal(lage.nListed, 1);
  assert.equal(lage.runId, run);
  assert.equal((await call<Lage>("todos.lage", { att: "active" })).tickets.length, 0);
  // The briefing now restricts the list to its tickets (and those without one), as the built-in page does.
  const list = await call<Screen>("todos.screen", { scope: "open" });
  assert.equal(list.briefing, true);
  assert.equal(list.counts.open, store.boardTodos(["WSX-12", "OLD-1", ""]).filter((t) => t.status === "open" && t.owner === "me").length);
  // Its buttons are flows that need todos + api; dry runs do nothing.
  for (const [name, input] of [["todos-ext.board-run", { stop: "false" }], ["todos-ext.ticket-action", { run, ticket: "WSX-12", idx: 0 }], ["todos-ext.recap-start", { day: "2026-11-13" }], ["todos-ext.undo-run", { run: 999999 }]] as const) assert.equal((await engine.runFlow(name, input, { dry: true })).status, "done", name);
  assert.equal((await engine.runFlow("todos-ext.follow", { key: "WSX-12", value: "1" })).status, "done");
  const lageHtml = drawn({ part: "tickets", att: "" }, { lage, x: list });
  for (const word of ["Two things matter today.", "Anna asked about the filter.", "Comment: answered", "Order the new filter", "Only listed"]) assert.ok(lageHtml.includes(word), word);
  assert.ok(drawn({ part: "todos", scope: "open" }, { lage, x: list }).includes("Run now"));
  assert.ok(drawn({ part: "todos", scope: "open" }, { lage: { ...lage, running: true, runningText: "0:12 · analyzing" }, x: list }).includes("Cancel"));

  // The recap: a day's summary, per ticket what was done with its evidence, the work on no ticket.
  const day = "2026-11-13";
  getDb().insert(schema.dayRecaps).values({ day, status: "ok", model: "m", facts: JSON.stringify({ tickets: [{ key: "WSX-12", summary: "Filter", status: "Done", url: null, facts: [{ kind: "entry", at: "2026-11-13T09:00:00Z", text: "Booked on WSX-12", hours: 1.5 }, { kind: "commit", at: null, text: "fix filter" }] }], other: [{ kind: "todo", at: null, text: "Planning" }] }), result: JSON.stringify({ summary: "A calm day.", tickets: [{ key: "WSX-12", lead: "The filter is done.", done: ["Ordered it", "Tested it"] }], other: ["Planning"] }) }).run();
  type Recap = { day: string; before: string; summary: string; booked: string; tickets: { key: string; lead: string; done: { text: string }[]; hours: string; facts: { kind: string }[] }[]; hasOther: boolean };
  const recap = await call<Recap>("todos.day", { day });
  assert.equal(recap.day, day);
  assert.equal(recap.before, "2026-11-12");
  assert.equal(recap.summary, "A calm day.");
  assert.deepEqual(recap.tickets[0].done.map((x) => x.text), ["Ordered it", "Tested it"]);
  assert.match(recap.tickets[0].hours, /1[.,]5 h booked/);
  assert.match(recap.booked, /1[.,]5 h booked/);
  assert.deepEqual(recap.tickets[0].facts.map((f) => f.kind), ["Entry", "Commit"]);
  assert.equal(recap.hasOther, true);
  assert.ok((await call<{ empty: string }>("todos.day", { day: "2026-10-01" })).empty.startsWith("No recap"));
  const recapHtml = drawn({ part: "recap", recapday: day }, { day: recap, lage });
  for (const word of ["A calm day.", "The filter is done.", "Ordered it", "Planning"]) assert.ok(recapHtml.includes(word), word);

  // Today: yours due, what you wait on for days, what agents ask, what workers report.
  getDb().update(schema.todos).set({ createdAt: new Date(Date.now() - 5 * 864e5).toISOString() }).where(eq(schema.todos.id, otherId)).run();
  store.setTodoNeedsInput(ids.week, "Which train?");
  store.markWorkerDone(ids.star, "W-9 · Copilot", "All green");
  type Today = { due: { id: number; when: string; overdue: boolean }[]; waiting: { id: number; ago: string }[]; asking: { id: number; question: string }[]; reported: { id: number; by: string; note: string }[] };
  const today = await call<Today>("todos.heute", {});
  assert.deepEqual(today.due.map((x) => x.id), [ids.late, ids.today]);
  assert.deepEqual(today.due.map((x) => [x.when, x.overdue]), [["overdue (3 days)", true], ["due today", false]]);
  assert.deepEqual(today.waiting.map((x) => [x.id, x.ago]), [[otherId, "for 5 days"]]);
  assert.deepEqual(today.asking.map((x) => [x.id, x.question]), [[ids.week, "Which train?"]]);
  assert.deepEqual(today.reported.map((x) => [x.id, x.by, x.note]), [[ids.star, "W-9", "All green"]]);
  const todayHtml = drawn({ part: "today" }, { today, lage });
  for (const word of ["Pay the garage", "Reply from Anna", "Which train?", "All green"]) assert.ok(todayHtml.includes(word), word);
  // Every lambda only reads: the kernel reads they name.
  const lambdas = await import("@/plugins/workspace/lambdas/store");
  assert.deepEqual(lambdas.getLambda("todos.lage")!.manifest.zeff, ["todos.board", "todos.rows"]);
  assert.deepEqual(lambdas.getLambda("todos.hits")!.manifest.zeff, ["todos.omni"]);
});

test("the rest of the row and the panel: repeats, notes changed, instruction, draft, GiroCode, other ways, an action's text, a transfer, time taken off, contexts, new todos", { skip }, async () => {
  const { call, ids, store } = await world();
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const engine = await import("@/plugins/workspace/flows/engine");
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("todos-ext"), "views", "todos.html"), "utf8");
  const out = async (name: string, input: Record<string, unknown>, dry = false) => {
    const r = await engine.runFlow(name, input, dry ? { dry: true } : undefined);
    assert.equal(r.status, "done", `${name}: ${r.error ?? ""}`);
    return r.output as Record<string, unknown>;
  };

  // A repeat: its rule, shown on the row; changed and taken away by the flow.
  const id = ids.week;
  await out("todos-ext.recurrence", { id, freq: "monthly" });
  assert.equal(store.getTodo(id)?.recurrence?.freq, "monthly");
  const list = await call<Screen>("todos.screen", { scope: "open" });
  assert.equal(list.groups.flatMap((g) => g.items).find((x) => x.id === id)?.repeat, "every month");
  await out("todos-ext.recurrence", { id, freq: "" });
  assert.equal(store.getTodo(id)?.recurrence, null);
  await out("todos-ext.regenerate", { id }, true);

  // The row's own extras: the worker on it, time on it, where it came from, a merge request.
  const later = ids.later;
  await out("todos-ext.time", { id: later, minutes: "20", note: "x" });
  const rows = (await call<Screen>("todos.screen", { scope: "done" })).rows.concat((await call<Screen>("todos.screen", { scope: "open" })).groups.flatMap((g) => g.items));
  type Extra = Item & { time: string; origin: string; mrs: unknown[]; workRun: string; isNew: boolean; doneTip: string; copyTip: string };
  const withTime = rows.find((x) => x.id === later) as unknown as Extra;
  assert.equal(withTime.time, "⏱ 20 min");
  assert.equal(withTime.doneTip, `T-${later} open again`);
  assert.equal(withTime.copyTip, `Copy “T-${later}” — for Copilot / Claude Code`);
  // Never opened: nothing is new; once the list was looked at, what is made after it is.
  assert.equal(rows.some((x) => (x as unknown as Extra).isNew), false);
  await out("todos-ext.list-seen", {});
  await new Promise((r) => setTimeout(r, 15));
  const fresh = store.addManualTodo({ ticket: "", text: "Brand new thing" });
  const after = (await call<Screen>("todos.screen", { scope: "open" })).groups.flatMap((g) => g.items) as unknown as Extra[];
  assert.equal(after.find((x) => x.id === fresh.id)?.isNew, true);
  assert.equal(after.find((x) => x.id === ids.today)?.isNew, false);

  // A note changed, and put on Jira (dry: needs both permissions; the flow asks for them).
  await out("todos-ext.note", { id: ids.today, text: "First wording" });
  const at = store.getTodo(ids.today)!.userNotes.find((n) => !n.by)!.at;
  await out("todos-ext.note-edit", { id: ids.today, at, text: "Second wording" });
  assert.equal(store.getTodo(ids.today)!.userNotes.find((n) => n.at === at)?.text, "Second wording");
  await out("todos-ext.note-sync", { id: ids.today, at }, true);

  // An action's text and a transfer: changed through the engine's rules.
  getDb().update(schema.todos).set({ ops: JSON.stringify([{ type: "jira-comment", ticket: "PROJ-7", body: "Old" }]) }).where(eq(schema.todos.id, ids.plain)).run();
  const saved = await out("todos-ext.op-text", { id: ids.plain, index: "0", text: "New words" });
  assert.equal(saved.ok, true);
  assert.equal((store.getTodo(ids.plain)!.ops[0] as { body?: string }).body, "New words");
  assert.equal((await out("todos-ext.op-text", { id: ids.plain, index: "0", text: " " })).ok, false);
  assert.equal((await out("todos-ext.op-text", { id: ids.plain, index: "5", text: "x" })).ok, false);
  assert.equal((await out("todos-ext.transfer", { id: ids.plain, index: "0", iban: "DE00" })).ok, false);

  // The panel: a payment in the words becomes a GiroCode; alternatives, the draft and the rest come from the same reads the built-in's panel has.
  const pay = store.addManualTodo({ ticket: "", text: "Garage 24,80 € überweisen, Empfänger Garage Müller, IBAN DE02120300000000202051" });
  type Panel2 = { payment: { iban: string; line: string } | null; alternatives: unknown[]; nAlternatives: number; recurrence: string; ops: { editBody: boolean; hasText: boolean }[]; notes: { sync: string }[]; time: { mine: boolean }[]; nKnowledge: number };
  const p = await call<Panel2>("todos.panel", { id: pay.id });
  assert.equal(p.payment?.iban, "DE02120300000000202051");
  assert.match(p.payment!.line, /24[.,]80/);
  assert.equal(p.nKnowledge, 0);
  const pl = await call<Panel2>("todos.panel", { id: ids.plain });
  assert.deepEqual(pl.ops.map((o) => [o.hasText, o.editBody]), [[true, true]]);
  assert.equal((await call<Panel2>("todos.panel", { id: later })).time[0].mine, true);
  const t0 = (await call<{ time: { id: number }[] }>("todos.panel", { id: later })).time[0];
  await out("todos-ext.time-delete", { id: t0.id });
  assert.equal((await call<{ time: unknown[] }>("todos.panel", { id: later })).time.length, 0);
  await out("todos-ext.context-dismiss", { id: ids.today, ref: "mail:abc" });
  assert.equal((await out("todos-ext.alternative", { id: ids.plain, label: "nothing like it" })).ok, false);
  assert.equal((await out("todos-ext.worked-on", { id: ids.plain })).ok, true);
  for (const [name, input] of [["todos-ext.instruct", { id: ids.plain, text: "Look" }], ["todos-ext.draft", { id: ids.plain }], ["todos-ext.suggest", { id: ids.plain }], ["todos-ext.open-reply", { url: "https://mail.google.com/x" }]] as const) await out(name, input, true);
  assert.equal((await out("todos-ext.instruct", { id: ids.plain, text: " " })).ok, false);
  // None of the new write actions works without its permission; the reads don't write.
  const { flowAction } = await import("@/plugins/workspace/flows/actions");
  const none = { flow: "x", runId: null, dryRun: false, perms: {}, web: async () => new URL("https://x.y"), canWrite: () => undefined, may: () => undefined, log: () => undefined };
  for (const name of ["todos.update-note", "todos.sync-note", "todos.instruct", "todos.draft-reply", "todos.open-reply", "todos.suggest-actions", "todos.run-alternative", "todos.set-recurrence", "todos.regenerate-series", "todos.delete-time", "todos.worked-on", "todos.dismiss-context", "todos.save-op-text", "todos.save-transfer", "todos.rows-seen"]) {
    assert.equal(flowAction(name)?.writes, true, `${name} writes`);
    await assert.rejects(async () => flowAction(name)!.run({ id: 1, at: "x", text: "x", url: "https://mail.google.com/x", label: "x", index: 0 }, none as never), /may not/, name);
  }
  // The template draws with everything the panel can show.
  const screen = await call<Screen>("todos.screen", { scope: "open" });
  const panel = { ...(await call<Record<string, unknown>>("todos.panel", { id: pay.id })), nAlternatives: 1, alternatives: [{ label: "Do it differently", title: "Another way", also: false }], draft: "" };
  const r = renderView(template, { rows: [], props: [], titleName: "Todos", state: { part: "todos", scope: "open", panel: String(pay.id), noteedit: "x", opedit: "0" }, app: {}, data: { x: screen, p: panel, draft: { ok: true, text: "Hello Anna", to: "anna@example.com", channel: "mail", openUrl: "https://mail.google.com/x" }, sugg: { ok: true, message: "Actions suggested — on the todo." } }, db: { id: 1, title: "Todos" } } as never);
  assert.deepEqual(r.errors, []);
  const html = JSON.stringify(r.nodes);
  for (const word of ["Hello Anna", "Do it differently", "Pay with GiroCode", "Instruction to Copilot", "Brand new thing"]) assert.ok(html.includes(word), word);
});
