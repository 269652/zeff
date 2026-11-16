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
