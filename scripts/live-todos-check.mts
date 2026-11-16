/**
 * Live-near check of todos-ext: against a COPY of a real account's database (DATABASE_PATH) and a copy of the plugins folder (ZEFF_PLUGINS_DIR), the package installed
 * the way an update does, every lambda of the screen run for real in every state the browser can be in, and each answer drawn with renderView: 0 errors.
 *   DATABASE_PATH=<copy>/zeff.db ZEFF_PLUGINS_DIR=<copy>/plugins npx tsx scripts/live-todos-check.mts
 */
import fs from "node:fs";
import path from "node:path";

const plugins = process.env.ZEFF_PLUGINS_DIR!;
const state = await import("../src/plugins/state");
await import("../src/plugins/contributions");
const reg = await import("../src/lib/ext/registry");
reg.scanPlugins(true);
reg.setEnabled("todos-ext", true);
const pkgFile = path.join(plugins, "todos-ext", "todos.package.json");
const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
const life = await import("../src/plugins/workspace/package-life");
const was = life.getInstalled(pkg.id)?.version;
// As an update does: the installed package taken to the new version (a first install when there is none yet).
const r = was ? (life.compareVersions(pkg.version, was) > 0 ? await life.updateTracked(pkg.id, pkg, { allow: true }) : { note: "already there" }) : await life.installTracked(pkg, null, { allow: true });
console.log(was ? `updated ${was} → ${pkg.version}` : `installed ${pkg.version}`, JSON.stringify(r).slice(0, 300));
void state;
const lambdas = await import("../src/plugins/workspace/lambdas/store");
const { runLambda } = await import("../src/plugins/workspace/lambdas/run");
const { renderView, viewDefaults } = await import("../src/plugins/workspace/view-template");
const template = fs.readFileSync(path.join(plugins, "todos-ext", "views", "todos.html"), "utf8");

const call = async (name: string, event: Record<string, unknown>) => {
  const l = lambdas.getLambda(name);
  if (!l) throw new Error(`${name} isn't there`);
  const run = await runLambda(l, event);
  if (!run.ok) throw new Error(`${name}: ${run.error}`);
  return run.result as Record<string, unknown>;
};
let bad = 0;
const draw = (label: string, st: Record<string, string>, data: Record<string, unknown>) => {
  // (the state the browser starts with — every <state> of the template — and what the click set)
  const out = renderView(template, { rows: [], props: [], titleName: "Todos", state: { ...viewDefaults(template), ...st }, app: {}, data, db: { id: 1, title: "Todos" } } as never);
  const text = JSON.stringify(out.nodes);
  // (a template that draws "undefined", "[object Object]" or "NaN" has a name that does not exist in the data)
  const junk = /undefined|\[object|NaN/.exec(text);
  if (junk) out.errors.push({ line: 0, message: `drawn: …${text.slice(Math.max(0, junk.index - 60), junk.index + 40)}…` } as never);
  if (out.errors.length || !label.startsWith("panel")) console.log(out.errors.length ? "FAIL" : "ok  ", label, `${text.length} chars`, out.errors.length ? JSON.stringify(out.errors.slice(0, 5)) : "");
  if (out.errors.length) bad++;
  return text;
};

// The newest runs may be empty (nothing on the boards): then the newest run with tickets is made the latest one — in this copy — so the Tickets tab is drawn from real data too.
{
  const { getSqlite } = await import("../src/db");
  const sq = getSqlite();
  const latest = sq.prepare("select id, status, length(tickets) n from board_runs order by id desc limit 1").get() as { id: number; status: string; n: number } | undefined;
  if (!latest || latest.status !== "ok" || latest.n < 10) {
    const real = sq.prepare("select tickets, result, model, jql from board_runs where status = 'ok' and length(tickets) > 10 order by id desc limit 1").get() as { tickets: string; result: string; model: string; jql: string } | undefined;
    if (real) {
      sq.prepare("insert into board_runs (jql, model, status, tickets, result, finished_at) values (?, ?, 'ok', ?, ?, CURRENT_TIMESTAMP)").run(real.jql, real.model, real.tickets, real.result);
      console.log("a run with tickets made the latest one (in the copy)");
    }
  }
}
const lage2 = await call("todos.lage", {});
type Row = { id: number };
const lage: Record<string, unknown> = { ...lage2 };
const common = { lage };
for (const scope of ["open", "done", "worker"]) {
  const x = await call("todos.screen", { scope });
  draw(`list ${scope}`, { part: "todos", scope }, { ...common, x });
  const chips = JSON.stringify([]);
  draw(`list ${scope} + filter`, { part: "todos", scope, filter: "a", chips }, { ...common, x: await call("todos.screen", { scope, filter: "a" }) });
}
const open = (await call("todos.screen", { scope: "open" })) as { groups: { items: Row[] }[]; waiting: Row[] };
const hits = await call("todos.hits", { q: "a" + "b" });
draw("omnibar", { part: "todos", scope: "open", omniq: "ab" }, { ...common, x: open, hits });
const feed = await call("todos.feed", {});
draw("activity", { part: "todos", scope: "activity" }, { ...common, feed });
for (const f of ["closed", "created"]) draw(`activity ${f}`, { part: "todos", scope: "activity", feedfilter: f }, { ...common, feed: await call("todos.feed", { filter: f }) });
draw("tickets", { part: "tickets" }, { ...common, x: open });
for (const att of ((lage.chips as { attention: string }[]) ?? []).map((c) => c.attention)) draw(`tickets ${att}`, { part: "tickets", att }, { lage: await call("todos.lage", { att }) });
const day = await call("todos.day", {});
draw("recap", { part: "recap" }, { ...common, day });
draw("today", { part: "today" }, { ...common, today: await call("todos.heute", {}) });

// every todo of the open, done and worker lists as the panel shows it
const ids = new Set<number>();
for (const scope of ["open", "done", "worker"]) {
  const s = (await call("todos.screen", { scope })) as { groups: { items: Row[] }[]; waiting: Row[]; rows: Row[] };
  for (const x of [...s.groups.flatMap((g) => g.items), ...s.waiting, ...s.rows]) ids.add(x.id);
}
console.log("panels:", ids.size);
let n = 0;
for (const id of ids) {
  const p = await call("todos.panel", { id });
  const text = draw(`panel T-${id}`, { part: "todos", scope: "open", panel: String(id) }, { ...common, x: open, p, pick: { items: [] } });
  void text;
  if (++n >= 400) break;
}
// the other states a click leaves: a due day being set, a note or an action's text being edited, a transfer, an answer that asks
const first = [...ids][0];
const sample = await call("todos.panel", { id: first });
const pickLive = await (async () => { try { return await call("documents.attach-list", { q: "" }); } catch { return { items: [] }; } })();
for (const st of [{ dueedit: String(first), dueval: "2026-12-01" }, { panel: String(first), textedit: String(first), edittext: "x" }, { panel: String(first), noteedit: "x", opedit: "0", optext: "t", instr: "do it" }, { panel: String(first), aq: "a", mins: "5", timenote: "x" }] as Record<string, string>[])
  draw(`states ${JSON.stringify(st).slice(0, 60)}`, { part: "todos", scope: "open", ...st }, { ...common, x: open, p: sample, pick: pickLive, st: { confirm: "Mark it done already?", id: first }, added: { id: first, ref: "T-1", merged: true }, ran: { message: "done" }, draft: { ok: true, text: "Hi", to: "x", channel: "mail", openUrl: "https://mail.google.com/x" }, alt: { ok: false, error: "no" }, sugg: { ok: true, message: "ok" }, noted: { message: "saved" }, jira: { error: "no" }, opsave: { message: "Saved." } });
// every day with a recap, the briefing's tickets with their todos
const { getSqlite } = await import("../src/db");
const days = (getSqlite().prepare("select distinct day from day_recaps order by day desc limit 20").all() as { day: string }[]).map((d) => d.day);
for (const d of days) draw(`recap ${d}`, { part: "recap", recapday: d }, { ...common, day: await call("todos.day", { day: d }) });
console.log("recap days", days.length, "| tickets", (lage.tickets as unknown[]).length, "| activity events", (feed.days as { items: unknown[] }[]).flatMap((x) => x.items).length);
console.log(bad ? `${bad} FAILED` : "all drawn without an error");
process.exit(bad ? 1 : 0);
