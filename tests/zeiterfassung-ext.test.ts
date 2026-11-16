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
