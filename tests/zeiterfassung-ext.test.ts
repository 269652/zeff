import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";

setupTempData();

/**
 * Time tracking's screens as a plugin (zeff-plugins/plugins/zeiterfassung-ext): what its lambdas hand the view is the built-in's own report — figure for
 * figure, out of the same bookings — and the view draws with it without an error. The core (jobs, projects, bookings) stays the kernel's.
 */

const skip = skipWithoutRepo("zeiterfassung-ext");

let ready: ReturnType<typeof build> | undefined;
const setup = () => (ready ??= build());
async function build() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-zeit-ext-"));
  process.env.ZEFF_PLUGINS_DIR = dir;
  fs.cpSync(repoPlugin("zeiterfassung-ext"), path.join(dir, "zeiterfassung-ext"), { recursive: true });
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "zeiterfassung", "weekly-report", "monthly-report"]) setInstalled(id as never, true);
  await import("@/plugins/contributions");
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  reg.setEnabled("zeiterfassung-ext", true);
  const { createJob } = await import("@/lib/jobs");
  const { createEntry } = await import("@/lib/entries");
  createJob({ number: "100001", name: "Kunde A" });
  createJob({ number: "100002", name: "Kunde B" });
  const book = (date: string, jobNumber: string, hours: number, description: string, ticket?: string) =>
    createEntry({ jobNumber, date, hours, description, ticket, reportedBy: "test" }, "web");
  book("2026-10-05", "100001", 1.5, "Konzept", "ABC-1");
  book("2026-10-05", "100002", 2.25, "Meeting");
  book("2026-10-06", "100001", 4, "Umsetzung", "ABC-1");
  book("2026-10-07", "100002", 0.25, "Abstimmung");
  book("2026-10-27", "100001", 8, "Ende Oktober");
  book("2026-11-02", "100001", 3, "Anfang November");
  const { getLambda } = await import("@/plugins/workspace/lambdas/store");
  const { runLambda } = await import("@/plugins/workspace/lambdas/run");
  const run = async (name: string, event: Record<string, unknown>) => {
    const l = getLambda(name);
    assert.ok(l, `the plugin's lambda ${name} is there`);
    const r = await runLambda(l!, event);
    assert.ok(r.ok, r.ok ? "" : r.error);
    return JSON.parse(JSON.stringify(r.result)) as Record<string, any>;
  };
  return { dir, run };
}

test("the port's month is the built-in's: the same figures, calendar and job lines out of the same bookings", { skip }, async () => {
  const { run } = await setup();
  const { getMonthlyReport } = await import("@/lib/monthly");
  const { resolveMonth } = await import("@/lib/month");
  const { getJobReportSummaries } = await import("@/lib/report");
  const { formatHours } = await import("@/lib/format");
  for (const key of ["2026-10", "2026-11", "2026-09"]) {
    const month = resolveMonth(key)!;
    const builtin = getMonthlyReport(month);
    const port = await run("zeiterfassung.month", { month: key });
    assert.equal(port.key, key);
    assert.equal(port.figures.total, builtin.total, `${key}: the booked hours`);
    assert.deepEqual(port.figures.dayTotals, builtin.dayTotals, `${key}: hours per day`);
    assert.equal(port.entries.value, String(builtin.entries.length), `${key}: the entries`);
    assert.equal(port.jobRows.length, builtin.rows.length, `${key}: a row per job`);
    builtin.rows.forEach((row, i) => {
      assert.equal(port.jobRows[i].total, formatHours(row.total));
      assert.deepEqual(port.jobRows[i].weeks, row.hoursByWeek.map((x) => (x ? formatHours(x) : "·")));
    });
    assert.deepEqual(
      port.summaries.map((s: any) => [s.number, s.hours]),
      getJobReportSummaries(month.startIso, month.endIso).map((j) => [j.jobNumber, `${formatHours(j.hours)} h`]),
      `${key}: what each job's time went to`,
    );
    assert.equal(port.calendar.length, month.weeks.length, `${key}: a row per week`);
    assert.equal(port.calendar.flatMap((w: any) => w.cells).filter((c: any) => c.in).length, month.days.length, `${key}: a cell per day`);
  }
  // A reporter nobody booked as: nothing, in words.
  const none = await run("zeiterfassung.month", { month: "2026-10", by: "nobody" });
  assert.equal(none.jobRows.length, 0);
  assert.equal(none.emptyJobs, "No time booked in this month by nobody.");
  // An unreadable month: the current one, and it says so.
  assert.match((await run("zeiterfassung.month", { month: "Oktober" })).unreadable, /Could not read month "Oktober"/);
});

test("the report's view draws with the lambdas' data without an error — the month's parts and the tab to the week", { skip }, async () => {
  const { run } = await setup();
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "views", "report.html"), "utf8");
  const month = await run("zeiterfassung.month", { month: "2026-10" });
  const draw = (state: Record<string, string>, data: Record<string, unknown>) =>
    renderView(template, { rows: [], props: [], titleName: "Name", state, app: {}, data, db: { id: 1, title: "Report" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] });
  const r = draw({ view: "month", month: "2026-10" }, { m: month });
  assert.deepEqual(r.errors, []);
  const text = JSON.stringify(r.nodes);
  assert.match(text, /Ende Oktober|Kunde A/);
  assert.equal(draw({ view: "month" }, {}).errors.length, 0, "before the data is there");
});

test("the port's week is the built-in's: the same figures, table, report and entries out of the same bookings", { skip }, async () => {
  const { run } = await setup();
  const { getWeeklyReport } = await import("@/lib/entries");
  const { getWeekTargets } = await import("@/lib/schedule");
  const { getRewrittenReport, reportToText } = await import("@/lib/report");
  const { resolveWeek } = await import("@/lib/week");
  const { formatHours } = await import("@/lib/format");
  for (const key of ["2026-W41", "2026-W44", "2026-W30"]) {
    const week = resolveWeek(key)!;
    const builtin = getWeeklyReport(week);
    const port = await run("zeiterfassung.week", { week: key });
    assert.equal(port.key, key);
    assert.equal(port.figures.total, builtin.total, `${key}: the booked hours`);
    assert.deepEqual(port.figures.dayTotals, builtin.dayTotals, `${key}: hours per day`);
    assert.equal(port.figures.target, getWeekTargets(week).weekTarget, `${key}: the target`);
    assert.equal(port.table.rows.length, builtin.rows.length, `${key}: a row per job`);
    builtin.rows.forEach((row, i) => assert.deepEqual(port.table.rows[i].days.map((d: any) => d.text), row.hoursByDay.map((x) => (x ? formatHours(x) : "·"))));
    assert.equal(port.report.text, reportToText(getRewrittenReport(week), formatHours), `${key}: the report's copy text`);
    assert.equal(port.entryList.length, builtin.entries.length, `${key}: the entries`);
  }
  assert.match((await run("zeiterfassung.week", { week: "Woche" })).unreadable, /Could not read week "Woche"/);
});

test("the package installs: the flows book, change and delete an entry through the kernel's writes — what the report's form does", { skip }, async () => {
  const { run } = await setup();
  const life = await import("@/plugins/workspace/package-life");
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "zeiterfassung.package.json"), "utf8"));
  if (!life.getInstalled("zeiterfassung-ext")) await life.installTracked(pkg, null, { allow: true });
  assert.ok(life.getInstalled("zeiterfassung-ext"), "the package is installed");
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const { listEntries } = await import("@/lib/entries");
  const before = listEntries({ from: "2026-12-07", to: "2026-12-07" }).length;
  const added = await runFlow("zeiterfassung.add-entry", { date: "2026-12-07", hours: "1,5", description: "Ein Test, mit Komma", bookOn: "j:100001", ticket: "", type: "", tags: "alpha, #beta", comment: "" });
  assert.equal(added.status, "done", JSON.stringify(added));
  assert.match(String((added.output as any).message), /Booked 1\.5h on 100001 for 2026-12-07/);
  const entries = listEntries({ from: "2026-12-07", to: "2026-12-07" });
  assert.equal(entries.length, before + 1);
  const entry = entries.find((e) => e.description === "Ein Test, mit Komma")!;
  assert.equal(entry.hours, 1.5);
  assert.deepEqual(entry.tags.map((x) => x.name).sort(), ["alpha", "beta"]);
  const week = await run("zeiterfassung.week", { week: "2026-12-07" });
  assert.equal(week.figures.total, 1.5);
  assert.equal((await runFlow("zeiterfassung.entry-hours", { id: entry.id, hours: "2" })).status, "done");
  assert.equal((await run("zeiterfassung.week", { week: "2026-12-07" })).figures.total, 2);
  // a refusal is the flow's failure (the button says why)
  const bad = await runFlow("zeiterfassung.add-entry", { date: "2026-12-07", hours: "1", description: "x", bookOn: "" });
  assert.equal(bad.status, "failed");
  assert.match(String(bad.error), /Pick a job or a project to book on/);
  assert.equal((await runFlow("zeiterfassung.delete-entry", { id: entry.id })).status, "done");
  assert.equal((await run("zeiterfassung.week", { week: "2026-12-07" })).figures.total, 0);
});

test("the report's view draws the week with the lambda's data — the form, the table, the dialogs", { skip }, async () => {
  const { run } = await setup();
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "views", "report.html"), "utf8");
  const week = await run("zeiterfassung.week", { week: "2026-W41" });
  const draw = (state: Record<string, string>, data: Record<string, unknown>) =>
    renderView(template, { rows: [], props: [], titleName: "Name", state, app: {}, data, db: { id: 1, title: "Report" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] });
  for (const state of [{ view: "week", week: "2026-W41" }, { view: "week", hoursedit: String(week.entryList[0].id) }, { view: "week", sugedit: "1" }] as Record<string, string>[]) {
    const r = draw(state, { w: week });
    assert.deepEqual(r.errors, [], JSON.stringify(state));
  }
  const text = JSON.stringify(draw({ view: "week" }, { w: week }).nodes);
  assert.match(text, /zeiterfassung\.add-entry/, "the form runs the flow");
  assert.match(text, /zeiterfassung\.delete-entry/, "an entry can be deleted");
  assert.deepEqual(draw({ view: "week" }, {}).errors, [], "before the data is there");
});

test("jobs and projects: the lists are the built-in's; the flows create, change and switch them off through the kernel's writes", { skip }, async () => {
  const { run } = await setup();
  const life = await import("@/plugins/workspace/package-life");
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "zeiterfassung.package.json"), "utf8"));
  if (!life.getInstalled("zeiterfassung-ext")) await life.installTracked(pkg, null, { allow: true });
  const { listJobs } = await import("@/lib/jobs");
  const { listProjects } = await import("@/lib/projects");
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const lists = async () => run("zeiterfassung.jobs", {});
  let r = await lists();
  assert.deepEqual(r.jobs.map((j: any) => j.number), listJobs({ includeInactive: true }).map((j) => j.number));
  const made = await runFlow("zeiterfassung.job-save", { number: "300001", name: "Neu", customer: "Kunde", description: "", defaultTags: "x, #y" });
  assert.equal(made.status, "done", JSON.stringify(made));
  assert.match(String((made.output as any).message), /Created job 300001 — Neu/);
  r = await lists();
  const job = r.jobs.find((j: any) => j.number === "300001");
  assert.equal(job.tags, "#x #y");
  assert.equal((await runFlow("zeiterfassung.job-save", { id: job.id, name: "Umbenannt" })).status, "done");
  assert.equal((await lists()).jobs.find((j: any) => j.number === "300001").name, "Umbenannt");
  assert.equal((await runFlow("zeiterfassung.job-save", { id: job.id, active: "false" })).status, "done");
  assert.equal((await lists()).jobs.find((j: any) => j.number === "300001").status, "inactive");
  const dup = await runFlow("zeiterfassung.job-save", { number: "300001", name: "Doppelt" });
  assert.equal(dup.status, "failed", "a number twice is refused");
  const p = await runFlow("zeiterfassung.project-save", { title: "Schulung", jobNumber: "100001", customer: "", description: "", startDate: "", endDate: "", defaultTags: "" });
  assert.equal(p.status, "done", JSON.stringify(p));
  r = await lists();
  assert.equal(r.projects.length, listProjects({ includeInactive: true }).length);
  assert.equal(r.projects.find((x: any) => x.title === "Schulung").jobNumber, "100001");
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "views", "report.html"), "utf8");
  for (const state of [{ view: "jobs" }, { view: "jobs", jobedit: String(job.id) }, { view: "jobs", projectedit: String(r.projects[0].id) }]) {
    const d = renderView(template, { rows: [], props: [], titleName: "Name", state, app: {}, data: { j: r }, db: { id: 1, title: "Report" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] });
    assert.deepEqual(d.errors, [], JSON.stringify(state));
  }
});

test("schedule settings: the weekly hours, break, flex time and absences — shown as the built-in's, saved through the kernel's writes", { skip }, async () => {
  const { run } = await setup();
  const life = await import("@/plugins/workspace/package-life");
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "zeiterfassung.package.json"), "utf8"));
  if (!life.getInstalled("zeiterfassung-ext")) await life.installTracked(pkg, null, { allow: true });
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const sch = await import("@/lib/schedule");
  let r = await run("zeiterfassung.schedule", {});
  assert.deepEqual(r.days.map((d: any) => d.hours), sch.scheduleHours(sch.getWorkSchedule()));
  assert.equal(r.h_mon, r.days[0].hours);
  assert.equal((await runFlow("zeiterfassung.schedule-save", { what: "hours", mon: "6", tue: "6", wed: "6", thu: "6", fri: "6", sat: "0", sun: "0" })).status, "done");
  assert.deepEqual(sch.scheduleHours(sch.getWorkSchedule()), [6, 6, 6, 6, 6, 0, 0]);
  assert.equal((await run("zeiterfassung.schedule", {})).hoursHead, "Weekly hours · 30 h/week");
  const bad = await runFlow("zeiterfassung.schedule-save", { what: "pauses", text: "keine zeit" });
  assert.equal(bad.status, "failed", "an unreadable break is refused");
  assert.equal((await runFlow("zeiterfassung.schedule-save", { what: "pauses", text: "12:00-12:30" })).status, "done");
  assert.equal(sch.getDefaultPauses()[0].start, "12:00");
  const flex = await runFlow("zeiterfassung.schedule-save", { what: "flex", jobNumber: "100002", comment: "Gleitzeit" });
  assert.equal(flex.status, "done");
  assert.equal(sch.getFlexTime().jobNumber, "100002");
  assert.equal((await runFlow("zeiterfassung.schedule-save", { what: "flex", jobNumber: "999", comment: "" })).status, "failed", "no such job");
  const added = await runFlow("zeiterfassung.absence", { startDate: "2026-12-14", endDate: "", type: "vacation", hours: "", note: "Urlaub", repeatUntil: "" });
  assert.equal(added.status, "done", JSON.stringify(added));
  assert.match(String((added.output as any).message), /Added vacation 2026-12-14\./);
  r = await run("zeiterfassung.schedule", {});
  assert.equal(r.absences.length, sch.listAbsences().length);
  assert.equal(r.absences[0].hours, "full day");
  assert.equal(sch.getWeekTargets((await import("@/lib/week")).resolveWeek("2026-12-14")!).weekTarget, 24, "the absence takes its day off the target");
  assert.equal((await runFlow("zeiterfassung.absence", { delete: r.absences[0].id })).status, "done");
  assert.equal(sch.listAbsences().length, 0);
  assert.equal((await runFlow("zeiterfassung.absence", { startDate: "2026-12-20", endDate: "2026-12-19", type: "sick" })).status, "failed", "an end before the start");
  // The flex-time row: a short past day booked on the flex job
  const w = await run("zeiterfassung.week", { week: "2026-W41" });
  assert.ok(w.table.flex, "the week offers the flex job");
  const gap = w.table.flex.days[0];
  if (gap) assert.equal((await runFlow("zeiterfassung.flex-book", { dates: gap.iso })).status, "done");
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "views", "report.html"), "utf8");
  const s = await run("zeiterfassung.schedule", {});
  const d = renderView(template, { rows: [], props: [], titleName: "Name", state: { view: "settings" }, app: {}, data: { s }, db: { id: 1, title: "Report" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] });
  assert.deepEqual(d.errors, []);
  const dw = renderView(template, { rows: [], props: [], titleName: "Name", state: { view: "week" }, app: {}, data: { w: await run("zeiterfassung.week", { week: "2026-W41" }) }, db: { id: 1, title: "Report" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] });
  assert.deepEqual(dw.errors, []);
});

test("the port's analysis is the built-in's: the same totals, split by type, weeks and tickets", { skip }, async () => {
  const { run } = await setup();
  const { getAnalysis, getEarliestEntryDate } = await import("@/lib/analysis");
  const { formatHours } = await import("@/lib/format");
  for (const weeks of [4, 8, 0]) {
    const a = getAnalysis({ weeks, earliest: getEarliestEntryDate(), ticketScope: "all" });
    const port = await run("zeiterfassung.analysis", { weeks: String(weeks) });
    assert.equal(port.hasData, a.hasData, `${weeks}: data`);
    assert.equal(port.figures.total, a.totalHours, `${weeks}: total`);
    assert.equal(port.figures.meetingPercent, a.meetingPercent);
    assert.equal(port.cards[0].value, `${formatHours(a.totalHours)} h`);
    assert.deepEqual(port.typeSplit.map((x: any) => [x.key, x.hours]), Object.entries(a.byType).filter(([, v]) => v > 0).map(([k, v]) => [k, v]).sort((x, y) => port.typeSplit.findIndex((s: any) => s.key === x[0]) - port.typeSplit.findIndex((s: any) => s.key === y[0])), `${weeks}: hours by type`);
    assert.equal(port.jobItems.length, a.byJob.length, `${weeks}: hours by job`);
    assert.deepEqual(port.ticketItems.map((x: any) => x.key), a.topTickets.map((x) => x.ticket), `${weeks}: top tickets`);
  }
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "views", "report.html"), "utf8");
  const port = await run("zeiterfassung.analysis", { weeks: "0" });
  for (const state of [{ view: "analysis" }, { view: "analysis", asplit: "type", atickets: "mine" }]) {
    const r = renderView(template, { rows: [], props: [], titleName: "Name", state, app: {}, data: { a: port }, db: { id: 1, title: "Report" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] });
    assert.deepEqual(r.errors, [], JSON.stringify(state));
  }
});

test("end of day: the day drafted as the built-in has it, booked as the lines stand in the view's state, taken back again", { skip }, async () => {
  const { run } = await setup();
  const life = await import("@/plugins/workspace/package-life");
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "zeiterfassung.package.json"), "utf8"));
  if (!life.getInstalled("zeiterfassung-ext")) await life.installTracked(pkg, null, { allow: true });
  const { proposeDay } = await import("@/lib/feierabend");
  const { suggestEntry } = await import("@/lib/work/suggestions");
  const { listEntries } = await import("@/lib/entries");
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const { todayIso } = await import("@/lib/week");
  const today = todayIso();
  suggestEntry({ date: today, hours: 2, description: "Agentenarbeit", jobNumber: "100001", ticket: "ABC-9" });
  suggestEntry({ date: today, hours: 1, description: "Zweite Zeile", jobNumber: "100002" });
  const builtin = await proposeDay();
  const port = await run("zeiterfassung.day", {});
  assert.equal(port.days.length, 1);
  assert.deepEqual(port.days[0].lines.map((l: any) => [l.kind, l.description, l.hours]), builtin.rows.map((r) => [r.kind, r.description, r.hours ?? ""]));
  assert.equal(port.days[0].target, String(builtin.target));
  const lines = port.days[0].lines as any[];
  const first = lines.find((l) => l.description === "Agentenarbeit");
  const second = lines.find((l) => l.description === "Zweite Zeile");
  const before = listEntries({ from: today, to: today }).length;
  // the first line taken over with other hours and words, the second left out
  const state = { [first.kh]: "3", [first.kd]: "Neu gesagt", [second.ki]: "0" };
  const booked = await runFlow("zeiterfassung.day-book", { date: today, state: JSON.stringify(state) });
  assert.equal(booked.status, "done", JSON.stringify(booked));
  assert.match(String((booked.output as any).message), /1 booked \(3 h\)/);
  const entries = listEntries({ from: today, to: today });
  assert.equal(entries.length, before + 1);
  const entry = entries.find((e) => e.description === "Neu gesagt")!;
  assert.equal(entry.hours, 3);
  assert.equal(entries.some((e) => e.description === "Zweite Zeile"), false, "the line left out is not booked");
  const created = (await run("zeiterfassung.day", {})).days[0].lines.length;
  assert.equal(created, lines.length - 1, "the booked suggestion is no line any more");
  // taking it back: from what the booking said it created
  const stamps = JSON.stringify([{ id: entry.id, updatedAt: entry.updatedAt }]);
  const undone = await runFlow("zeiterfassung.day-undo", { created: stamps });
  assert.equal(undone.status, "done");
  assert.match(String((undone.output as any).message), /1 taken back/);
  assert.equal(listEntries({ from: today, to: today }).length, before);
  const none2 = await runFlow("zeiterfassung.day-book", { date: today, state: JSON.stringify({ [second.ki]: "0", [first.ki]: "0" }) });
  assert.equal(none2.status, "failed", "nothing ticked");
  assert.match(String(none2.error), /Nothing ticked to book/);
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "views", "report.html"), "utf8");
  const f = await run("zeiterfassung.day", { week: "current" });
  const d = renderView(template, { rows: [], props: [], titleName: "Name", state: { view: "day", [second.ki]: "1" }, app: {}, data: { f }, db: { id: 1, title: "Report" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] });
  assert.deepEqual(d.errors, []);
  assert.match(JSON.stringify(d.nodes), /zeiterfassung\.day-book/);
});

test("the rules: type rules, report rules, meeting rules and entry types are listed and changed step by step — as the built-in's forms save them", { skip }, async () => {
  const { run } = await setup();
  const life = await import("@/plugins/workspace/package-life");
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "zeiterfassung.package.json"), "utf8"));
  if (!life.getInstalled("zeiterfassung-ext")) await life.installTracked(pkg, null, { allow: true });
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const { getTypeRules } = await import("@/lib/type-rules");
  const { getReportRules, getReportSettings, getMeetingJobRules, getMeetingDefaultJob, getMeetingExcludeRules } = await import("@/lib/report");
  const { listEntryTypes } = await import("@/lib/entry-types");
  const op = (input: Record<string, unknown>) => runFlow("zeiterfassung.rule-op", input);
  // type rules
  assert.equal((await op({ what: "types", op: "add", jobNumber: "100001", description: "Urlaub", type: "absence" })).status, "done");
  assert.equal((await op({ what: "types", op: "add", jobNumber: "", description: "Meeting", type: "meeting" })).status, "done");
  assert.deepEqual(getTypeRules().map((r) => [r.jobNumber, r.description, r.type]), [["100001", "Urlaub", "absence"], ["", "Meeting", "meeting"]]);
  assert.equal((await op({ what: "types", op: "down", index: 0 })).status, "done");
  assert.equal(getTypeRules()[1].description, "Urlaub");
  assert.equal((await op({ what: "types", op: "add", jobNumber: "999", description: "x", type: "other" })).status, "failed", "an unknown job");
  assert.equal((await op({ what: "types", op: "remove", index: 1 })).status, "done");
  assert.equal(getTypeRules().length, 1);
  // report rules
  const before = getReportRules(getReportSettings()).length;
  const added = await op({ what: "report", op: "add", f1: "type", v1: "meeting", f2: "title", v2: "Daily", template: "Dailys", tags: "daily" });
  assert.equal(added.status, "done", JSON.stringify(added));
  const rules = getReportRules(getReportSettings());
  assert.equal(rules.length, before + 1);
  assert.deepEqual(rules[rules.length - 1].conditions, [{ field: "type", value: "meeting" }, { field: "title", value: "Daily" }]);
  assert.deepEqual(rules[rules.length - 1].tags, ["daily"]);
  // meeting rules and entry types
  assert.equal((await op({ what: "meetings", op: "add", match: "Mob", jobNumber: "100002", group: "true" })).status, "done");
  assert.deepEqual(getMeetingJobRules(getReportSettings()).map((r) => [r.match, r.jobNumber, !!r.group]), [["Mob", "100002", true]]);
  assert.equal((await op({ what: "meetings", op: "default", jobNumber: "100001" })).status, "done");
  assert.equal(getMeetingDefaultJob(getReportSettings()), "100001");
  assert.equal((await op({ what: "exclude", op: "add", value: "Zeiten erfassen" })).status, "done");
  assert.deepEqual(getMeetingExcludeRules(getReportSettings()), ["Zeiten erfassen"]);
  assert.equal((await op({ what: "entry-type", op: "add", label: "Schulung", color: "#112233" })).status, "done");
  assert.ok(listEntryTypes().some((x) => x.key === "schulung"));
  assert.equal((await op({ what: "entry-type", op: "update", key: "schulung", label: "Weiterbildung", color: "#445566" })).status, "done");
  assert.equal(listEntryTypes().find((x) => x.key === "schulung")!.label, "Weiterbildung");
  assert.equal((await op({ what: "entry-type", op: "remove", key: "other" })).status, "failed", "a built-in type stays");
  assert.equal((await op({ what: "entry-type", op: "remove", key: "schulung" })).status, "done");
  const r = await run("zeiterfassung.rules", {});
  assert.equal(r.typeRules.length, 1);
  assert.ok(r.reportRules.some((x: any) => x.template === "Dailys"));
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "views", "report.html"), "utf8");
  for (const state of [{ view: "settings" }, { view: "settings", typeedit: "meeting" }]) {
    const d = renderView(template, { rows: [], props: [], titleName: "Name", state, app: {}, data: { s: await run("zeiterfassung.schedule", {}), r: { ...r, meetings: true } }, db: { id: 1, title: "Report" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] });
    assert.deepEqual(d.errors, [], JSON.stringify(state));
  }
});

test("week editing: a day's break, a whole entry, a copy, a start, parallel work and a group — as the built-in's actions do them", { skip }, async () => {
  const { run } = await setup();
  const life = await import("@/plugins/workspace/package-life");
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "zeiterfassung.package.json"), "utf8"));
  if (!life.getInstalled("zeiterfassung-ext")) await life.installTracked(pkg, null, { allow: true });
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const { listEntries, createEntry } = await import("@/lib/entries");
  const { listPausesByDate } = await import("@/lib/pauses");
  const op = (input: Record<string, unknown>) => runFlow("zeiterfassung.entry-op", input);
  // the break of a day (and one a day gets offered from the day before)
  assert.equal((await op({ op: "pauses", dates: "2026-10-05", text: "12:00-12:30" })).status, "done");
  assert.deepEqual(listPausesByDate("2026-10-05", "2026-10-05")["2026-10-05"], [{ start: "12:00", end: "12:30" }]);
  const w = await run("zeiterfassung.week", { week: "2026-W41" });
  assert.equal(w.table.foot.pause[0].current, "12:00-12:30");
  assert.equal(w.table.foot.pause[1].suggest, "12:00-12:30", "the next day is offered the earlier break");
  assert.equal((await op({ op: "pauses", dates: "2026-10-06", text: "none" })).status, "done");
  assert.equal((await op({ op: "pauses", dates: "2026-10-06", text: "kaffee" })).status, "failed", "an unreadable break is refused");
  // a whole entry changed
  const e = listEntries({ from: "2026-10-07", to: "2026-10-07" })[0];
  const upd = await op({ op: "update", id: e.id, date: "2026-10-07", bookOn: "j:100001", hours: "0,5", type: "meeting", ticket: "", start: "09:30", description: "Abstimmung neu", tags: "x, #y", comment: "Notiz", isGroup: "false" });
  assert.equal(upd.status, "done", JSON.stringify(upd));
  const after = listEntries({ from: "2026-10-07", to: "2026-10-07" }).find((x) => x.id === e.id)!;
  assert.equal(after.description, "Abstimmung neu");
  assert.equal(after.hours, 0.5);
  assert.equal(after.job.number, "100001");
  assert.equal(after.start, "09:30");
  assert.equal(after.comment, "Notiz");
  assert.deepEqual(after.tags.map((x) => x.name).sort(), ["x", "y"]);
  // a copy on another day
  assert.equal((await op({ op: "copy", id: e.id, date: "2026-10-08" })).status, "done");
  assert.equal(listEntries({ from: "2026-10-08", to: "2026-10-08" }).some((x) => x.description === "Abstimmung neu"), true);
  assert.equal((await op({ op: "copy", id: e.id, date: "" })).status, "failed");
  // parallel work: two tasks of one job at the same time, found and booked divided
  const a = createEntry({ jobNumber: "100002", date: "2026-10-12", hours: 2, description: "Parallel A", start: "09:00" }, "web");
  const b = createEntry({ jobNumber: "100002", date: "2026-10-12", hours: 2, description: "Parallel B", start: "09:00" }, "web");
  void a;
  let pw = await run("zeiterfassung.week", { week: "2026-W42" });
  const set = pw.parallel.sets.find((x: any) => x.lines.some((l: string) => l.includes("Parallel B")));
  assert.ok(set, "the parallel work is found");
  assert.equal((await op({ op: "parallel", mode: "divide", ids: set.ids })).status, "done");
  pw = await run("zeiterfassung.week", { week: "2026-W42" });
  const mine = pw.entryList.find((x: any) => x.id === b.id);
  assert.ok(mine.member && mine.spanId, "it is a task of a group now");
  assert.match(mine.groupText, /Divided parallel work/);
  assert.match(mine.books, /books 1 h/);
  assert.equal(pw.parallel.sets.find((x: any) => x.lines.some((l: string) => l.includes("Parallel B"))), undefined, "no longer open");
  // its group mode changed, then taken apart
  assert.equal((await op({ op: "span-mode", spanId: mine.spanId, mode: "sequential" })).status, "done");
  assert.equal((await op({ op: "unlink", id: b.id })).status, "done");
  assert.equal((await op({ op: "ungroup", spanId: mine.spanId })).status, "done");
  assert.equal((await run("zeiterfassung.week", { week: "2026-W42" })).entryList.some((x: any) => x.member), false);
  assert.equal((await op({ op: "start", id: b.id, start: "9h" })).status, "failed", "a start like 09:30");
  // the view draws with every dialog
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "views", "report.html"), "utf8");
  const wk = await run("zeiterfassung.week", { week: "2026-W42" });
  for (const state of [{ pauseday: "2026-10-12" }, { entryedit: String(b.id) }, { entrycopy: String(b.id) }, { groupedit: String(b.id) }, { entryedit: String(b.id), ee_group: "true" }]) {
    const d = renderView(template, { rows: [], props: [], titleName: "Name", state: { view: "week", ...state }, app: {}, data: { w: wk }, db: { id: 1, title: "Report" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] });
    assert.deepEqual(d.errors, [], JSON.stringify(state));
  }
});

test("a job's and a project's own page: entries, booking days on a project, deleting — as the built-in's pages do", { skip }, async () => {
  const { run } = await setup();
  const life = await import("@/plugins/workspace/package-life");
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "zeiterfassung.package.json"), "utf8"));
  if (!life.getInstalled("zeiterfassung-ext")) await life.installTracked(pkg, null, { allow: true });
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const { listJobs, getJobByNumber } = await import("@/lib/jobs");
  const { listProjects } = await import("@/lib/projects");
  const { getJobHours, listEntries } = await import("@/lib/entries");
  const j = getJobByNumber("100001")!;
  const jd = await run("zeiterfassung.job-detail", { ref: `job:${j.id}` });
  assert.equal(jd.found, true);
  assert.equal(jd.entries.length, listEntries({ jobId: j.id, limit: 200 }).length);
  assert.match(jd.sub, new RegExp(`^${String(getJobHours(j.id)).replace(".", "[.,]")}h booked in`));
  assert.equal((await run("zeiterfassung.job-detail", { ref: "job:99999" })).found, false);
  // a project: its days booked, then the page lists them
  const made = await runFlow("zeiterfassung.project-save", { title: "Training", jobNumber: "100001" });
  assert.equal(made.status, "done");
  const p = listProjects({ includeInactive: true }).find((x) => x.title === "Training")!;
  const booked = await runFlow("zeiterfassung.book-days", { id: p.id, from: "2027-01-04", to: "2027-01-06", hours: "6", fillUp: "", description: "Training", type: "" });
  assert.equal(booked.status, "done", JSON.stringify(booked));
  assert.match(String((booked.output as any).message), /Booked 18 h on 3 days/);
  const pd = await run("zeiterfassung.job-detail", { ref: `project:${p.id}` });
  assert.equal(pd.entries.length, 3);
  assert.ok(pd.today && pd.typeOptions.length, "the form's defaults");
  const none = await runFlow("zeiterfassung.book-days", { id: p.id, from: "2027-01-09", to: "2027-01-10", hours: "6", description: "x" });
  assert.equal(none.status, "failed", "a weekend: nothing to book");
  // delete: a job with time is refused, a project goes (its entries stay)
  assert.equal((await runFlow("zeiterfassung.job-delete", { kind: "job", id: j.id })).status, "failed");
  assert.equal((await runFlow("zeiterfassung.job-delete", { kind: "project", id: p.id })).status, "done");
  assert.equal(listProjects({ includeInactive: true }).some((x) => x.id === p.id), false);
  assert.ok(listJobs().length >= 2);
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "views", "report.html"), "utf8");
  for (const [state, d] of [[{ jd: `job:${j.id}` }, jd], [{ jd: `project:${p.id}` }, pd]] as const) {
    const r = renderView(template, { rows: [], props: [], titleName: "Name", state: { view: "jobs", ...state }, app: {}, data: { j: await run("zeiterfassung.jobs", {}), d }, db: { id: 1, title: "Report" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] });
    assert.deepEqual(r.errors, [], JSON.stringify(state));
  }
});

test("places for the booking systems: a plugin's cards, buttons, marks, approvals, jobs column and closing steps are drawn — by data", { skip }, async () => {
  const { run } = await setup();
  const { timeSlots } = await import("@/plugins/zeiterfassung/time-slots");
  const { listEntries } = await import("@/lib/entries");
  const entries = listEntries({ from: "2026-10-05", to: "2026-10-06" });
  const first = entries.find((e) => e.date === "2026-10-05")!;
  const second = entries.find((e) => e.date === "2026-10-06")!;
  timeSlots.contribute("zeiterfassung", {
    week: ({ entries: es }) => ({
      cards: [{ label: "Chrono", value: `${es.length} entries`, sub: "pulled", tone: "good" }],
      actions: [{ label: "Pull", flow: "zeiterfassung.entry-op", with: "op=pauses, dates=2026-10-05, text=12:00-12:30" }],
      exports: [{ label: "Export to Chrono →", href: "/export/chrono" }],
      entries: { [first.id]: { text: "✓", tone: "good", approved: true, title: "approved" }, [second.id]: { text: "…", tone: "warn" } },
      days: [{ text: "✓ 8", title: "day approved" }, null],
    }),
    month: ({ entries: es }) => ({
      approvals: { system: "Chrono", days: Array.from({ length: 31 }, (_, d) => (d === 4 ? { approved: 1.5 } : d === 5 ? { approved: 0 } : d === 6 ? { approved: 99 } : null)) },
      actions: [{ label: "Pull month", flow: "x" }],
      oldestPull: "status from 1 Oct",
      entries: { [es[0].id]: { text: "✓" } },
    }),
    jobs: () => ({ toolbar: [{ label: "Pull jobs", flow: "x" }], column: { title: "Chrono", cells: { 1: { text: "linked" } } } }),
    weekClose: () => [{ key: "chrono", label: "Approved in Chrono", state: "open", detail: "2 left", href: "/" }],
  });
  const w = await run("zeiterfassung.week", { week: "2026-W41" });
  assert.equal(w.slots.cards.length, 1);
  assert.equal(w.slots.cards[0].label, "Chrono");
  assert.equal(w.slots.exports[0].href, "/export/chrono");
  assert.equal(w.slots.actions[0].label, "Pull");
  const e1 = w.entryList.find((e: any) => e.id === first.id);
  assert.equal(e1.mark, "✓");
  assert.equal(e1.approved, true);
  assert.equal(w.entryList.find((e: any) => e.id === second.id).mark, "…");
  const cell = w.table.rows.flatMap((r: any) => r.days).filter((c: any) => c.mark === "✓");
  assert.ok(cell.length >= 1 && cell.every((c: any) => c.tone === "good"), "a cell whose entries are all approved reads green");
  assert.equal(w.table.foot.booked[0].mark, "✓ 8");
  assert.ok(w.closing.items.some((i: any) => i.key === "chrono" && i.state === "open"), "the closing step of the plugin");
  const m = await run("zeiterfassung.month", { month: "2026-10" });
  const cells = m.calendar.flatMap((c: any) => c.cells).filter((c: any) => c.in);
  assert.match(cells[4].hours, /^1\.5 \/ 6/, "partly approved: approved / booked");
  assert.equal(cells[4].pending, true);
  assert.equal(cells[5].pending, true, "none approved yet");
  assert.equal(cells[6].tone, "bad", "hours missing win over approved, as in the built-in");
  assert.match(cells[6].title, /all approved in Chrono/);
  assert.ok(m.approvals.legendAll.includes("Chrono") && m.slotActions.length === 1 && m.oldestPull === "status from 1 Oct");
  assert.match(m.calendarHint, /Chrono approval/);
  const j = await run("zeiterfassung.jobs", {});
  assert.equal(j.toolbar[0].label, "Pull jobs");
  assert.equal(j.columnTitle, "Chrono");
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "views", "report.html"), "utf8");
  const draw = (state: Record<string, string>, data: Record<string, unknown>) =>
    renderView(template, { rows: [], props: [], titleName: "Name", state, app: {}, data, db: { id: 1, title: "Report" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] });
  for (const [state, data] of [[{ view: "week" }, { w }], [{ view: "month", month: "2026-10" }, { m }], [{ view: "jobs" }, { j }]] as const) {
    assert.deepEqual(draw({ ...state }, data).errors, [], JSON.stringify(state));
  }
  assert.match(JSON.stringify(draw({ view: "week" }, { w }).nodes), /Export to Chrono/);
  timeSlots.contribute("zeiterfassung", {});
});

test("the week's rest: booking with a start, a group entry, a separate entry and a context; dropping an entry on a collecting entry; the entry's context", { skip }, async () => {
  const { run } = await setup();
  const life = await import("@/plugins/workspace/package-life");
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "zeiterfassung.package.json"), "utf8"));
  if (!life.getInstalled("zeiterfassung-ext")) await life.installTracked(pkg, null, { allow: true });
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const { listEntries } = await import("@/lib/entries");
  const add = (input: Record<string, unknown>) => runFlow("zeiterfassung.add-entry", { date: "2027-02-01", hours: "4", description: "x", bookOn: "j:100001", ...input });
  // a mob day: a collecting entry, and work running parallel to it is grouped under it
  const head = await add({ description: "Mob day", hours: "8", start: "09:00", isGroup: "true" });
  assert.equal(head.status, "done", JSON.stringify(head));
  const task = await add({ description: "Task A", hours: "2", start: "10:00" });
  assert.match(String((task.output as any).message), /grouped under it/);
  const sep = await add({ description: "Task B", hours: "1", start: "11:00", separate: "true" });
  assert.doesNotMatch(String((sep.output as any).message), /grouped|parallel/i);
  const all = listEntries({ from: "2027-02-01", to: "2027-02-01" });
  const headE = all.find((e) => e.description === "Mob day")!;
  const a = all.find((e) => e.description === "Task A")!;
  const b = all.find((e) => e.description === "Task B")!;
  assert.ok(headE.isGroup && a.spanId && !b.spanId);
  // dragged onto the collecting entry: the state holds the dragged entry under the head's name
  assert.equal((await runFlow("zeiterfassung.entry-op", { op: "drop", state: JSON.stringify({ [`dr${headE.id}`]: String(b.id), view: "week" }) })).status, "done");
  assert.ok(listEntries({ from: "2027-02-01", to: "2027-02-01" }).find((e) => e.id === b.id)!.spanId, "it is a task of the group now");
  const w = await run("zeiterfassung.week", { week: "2027-02-01" });
  assert.equal(w.entryList.find((e: any) => e.id === headE.id).dropKey, `dr${headE.id}`);
  assert.equal(w.dropClear, `dr${headE.id}=`);
  assert.equal(w.entryList.find((e: any) => e.id === a.id).draggable, false, "a task of a group is not dragged again");
  // a context written with the entry, and added to another
  const withCtx = await add({ description: "Mit Kontext", hours: "1", date: "2027-02-02", ctxKind: "note", ctxTitle: "Notiz", ctxBody: "Was gesagt wurde", ctxLink: "" });
  assert.equal(withCtx.status, "done", JSON.stringify(withCtx));
  assert.match(String((withCtx.output as any).message), /Booked 1h on 100001 for 2027-02-02/);
  const ctxEntry = listEntries({ from: "2027-02-02", to: "2027-02-02" }).find((e) => e.description === "Mit Kontext")!;
  let d = await run("zeiterfassung.entry-detail", { id: ctxEntry.id });
  assert.equal(d.contexts.length, 1);
  assert.equal(d.contexts[0].headline, "Notiz");
  assert.equal((await runFlow("zeiterfassung.entry-op", { op: "context-add", id: ctxEntry.id, ctxKind: "teams", ctxAuthor: "Anna", ctxBody: "Zweite Nachricht" })).status, "done");
  d = await run("zeiterfassung.entry-detail", { id: ctxEntry.id });
  assert.equal(d.contexts.length, 2);
  assert.equal((await runFlow("zeiterfassung.entry-op", { op: "context-add", id: ctxEntry.id })).status, "failed", "nothing written");
  assert.equal((await runFlow("zeiterfassung.entry-op", { op: "context-delete", contextId: d.contexts[0].id })).status, "done");
  assert.equal((await run("zeiterfassung.entry-detail", { id: ctxEntry.id })).contexts.length, 1);
  assert.equal((await run("zeiterfassung.entry-detail", { id: 999999 })).found, false);
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "views", "report.html"), "utf8");
  for (const state of [{ view: "week", n_ctx: "true", n_group: "true" }, { view: "week", ctxentry: String(ctxEntry.id) }]) {
    const r = renderView(template, { rows: [], props: [], titleName: "Name", state, app: {}, data: { w, ctx: d }, db: { id: 1, title: "Report" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] });
    assert.deepEqual(r.errors, [], JSON.stringify(state));
  }
});

test("the rest of the details: the day's sums and 'spread the rest' follow the state; a job's customer can be emptied; the month opens an entry's week", { skip }, async () => {
  const { run } = await setup();
  const life = await import("@/plugins/workspace/package-life");
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "zeiterfassung.package.json"), "utf8"));
  if (!life.getInstalled("zeiterfassung-ext")) await life.installTracked(pkg, null, { allow: true });
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const { suggestEntry } = await import("@/lib/work/suggestions");
  const { todayIso } = await import("@/lib/week");
  const { getDayTargets } = await import("@/lib/schedule");
  const today = todayIso();
  suggestEntry({ date: today, hours: 3, description: "Summen-Test", jobNumber: "100001" });
  const f0 = await run("zeiterfassung.day", {});
  const day = f0.days[0];
  const line = day.lines.find((l: any) => l.description === "Summen-Test");
  const base = day.sums.selected;
  // another hour count in the state changes the sums at once
  const f1 = await run("zeiterfassung.day", { state: JSON.stringify({ [line.kh]: "5" }) });
  assert.notEqual(f1.days[0].sums.selected, base);
  assert.match(f1.days[0].sums.selected, /^\+ selected /);
  // a line unticked: not in the sum
  const f2 = await run("zeiterfassung.day", { state: JSON.stringify({ [line.ki]: "0" }) });
  assert.notEqual(f2.days[0].sums.selected, base);
  const all = Object.fromEntries(f0.days[0].lines.map((l: any) => [l.ki, "0"]));
  const f3 = await run("zeiterfassung.day", { state: JSON.stringify(all) });
  assert.match(f3.days[0].sums.selected, /selected 0 h/);
  assert.equal(f3.days[0].whyNot, "Nothing ticked to book.");
  // spread: a ticket line without hours gets what is missing (only when there are tickets; otherwise nothing is offered)
  assert.equal(f0.days[0].canSpread, false, "no ticket line: no spreading");
  assert.ok(getDayTargets([new Date(`${today}T12:00:00`)])[0] !== undefined);
  // a customer emptied: the dialog's "~"
  const j = await runFlow("zeiterfassung.job-save", { number: "400001", name: "Mit Kunde", customer: "Kunde X", description: "d" });
  assert.equal(j.status, "done");
  const id = (await run("zeiterfassung.jobs", {})).jobs.find((x: any) => x.number === "400001").id;
  assert.equal((await runFlow("zeiterfassung.job-save", { id, full: "true", number: "400001", name: "Mit Kunde", customer: "~", description: "d" })).status, "done");
  const after = (await run("zeiterfassung.jobs", {})).jobs.find((x: any) => x.number === "400001");
  assert.equal(after.customer, "");
  assert.equal(after.description, "d");
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("zeiterfassung-ext"), "views", "report.html"), "utf8");
  const draw = (state: Record<string, string>, data: Record<string, unknown>) =>
    renderView(template, { rows: [], props: [], titleName: "Name", state, app: {}, data, db: { id: 1, title: "Report" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] });
  assert.deepEqual(draw({ view: "day" }, { f: f1 }).errors, []);
  assert.deepEqual(draw({ view: "jobs", jobedit: String(id) }, { j: await run("zeiterfassung.jobs", {}) }).errors, []);
  const m = await run("zeiterfassung.month", { month: "2026-10" });
  const r = draw({ view: "month", month: "2026-10" }, { m });
  assert.deepEqual(r.errors, []);
  assert.match(JSON.stringify(r.nodes), /openweek/);
  const s = await run("zeiterfassung.schedule", {});
  assert.equal(typeof s.punchOn, "boolean");
});
