/**
 * Time tracking's screens as a plugin (zeff-plugins/plugins/zeiterfassung-ext): the report — the month (and the week) — drawn in the view language over
 * the kernel's reads `time.month` / `time.week` (src/plugins/zeiterfassung/flow-actions.ts: the figures and words of the built-in's own report functions).
 * The core — jobs, projects, bookings, the schedule — stays the kernel's; here are the screens. What each lambda hands the view is in
 * scripts/port-zeiterfassung/zeiterfassung.<name>.mjs, the view in month.html / week.html (the word "view" in the language of src/plugins/workspace/view-template.ts).
 *
 *   npx tsx scripts/port-zeiterfassung.mts [<zeff-plugins folder>]     (default ../zeff-plugins)
 */
import fs from "node:fs";
import path from "node:path";
import { swapPlugin } from "./lib/swap-reads.mjs";

const ROOT = process.cwd();
const repo = path.resolve(process.argv[2] ?? "../zeff-plugins");
const dir = path.join(repo, "plugins", "zeiterfassung-ext");
const SRC = path.join(ROOT, "scripts", "port-zeiterfassung");
const write = (rel: string, text: string) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const part = (name: string) => (fs.existsSync(path.join(SRC, name)) ? fs.readFileSync(path.join(SRC, name), "utf8") : "");
fs.rmSync(path.join(dir, "lambdas"), { recursive: true, force: true });

const LAMBDAS: Record<string, { label: string; what: string; zeff: string[]; timeoutMs: number }> = {
  "zeiterfassung.jobs": { label: "Time tracking: jobs and projects", what: "The jobs and the projects as the Jobs and Projects pages list them, with the job options of a form.", zeff: ["time.jobs"], timeoutMs: 30000 },
  "zeiterfassung.schedule": { label: "Time tracking: the schedule settings", what: "The weekly hours, the default break, the flex-time job and the absences with their words.", zeff: ["time.schedule"], timeoutMs: 30000 },
  "zeiterfassung.analysis": { label: "Time tracking: the analysis", what: "The analysis of the booked time — the cards, the split by type, hours by job, the weeks, the Jira metrics where tickets are synced, tags and top tickets.", zeff: ["time.analysis"], timeoutMs: 60000 },
  "zeiterfassung.week": { label: "Time tracking: the week's report", what: "The weekly report's figures and words for a week — the booked card, hours per job and day, the closing steps, the suggestions, what was done today, the report, the entries.", zeff: ["time.week"], timeoutMs: 60000 },
  "zeiterfassung.month": { label: "Time tracking: the month's report", what: "The monthly report's figures and words for a month — the booked card, the calendar, hours per job and week, by type and tag, what each job's time went to.", zeff: ["time.month"], timeoutMs: 60000 },
};
for (const [name, l] of Object.entries(LAMBDAS)) {
  write(`lambdas/${name}/index.mjs`, fs.readFileSync(path.join(SRC, `${name}.mjs`), "utf8"));
  write(`lambdas/${name}/lambda.json`, JSON.stringify({ name, label: l.label, what: l.what, kind: "function", zeff: l.zeff, timeoutMs: l.timeoutMs, memoryMb: 256 }, null, 2) + "\n");
}

// The report: the week and the month, one screen, a tab apart (as the built-in's report has them).
const report = [
  '<state name="view" value="week" keep=true/><state name="week" value=""/><state name="month" value=""/><state name="by" value=""/><state name="aweeks" value="8"/><state name="atickets" value=""/><state name="asplit" value=""/>',
  '<on event="openweek" action="state" state="view" value="week"/>',
  '<tabs bind="view" options="week:Week, month:Month, analysis:Analysis, jobs:Jobs, settings:Settings"/>',
  "{{#if state.view == 'month'}}",
  part("month.html"),
  "{{#else}}{{#if state.view == 'analysis'}}",
  part("analysis.html"),
  "{{#else}}{{#if state.view == 'jobs'}}",
  part("jobs.html"),
  "{{#else}}{{#if state.view == 'settings'}}",
  part("settings.html"),
  "{{#else}}",
  part("week.html"),
  "{{/if}}{{/if}}{{/if}}{{/if}}",
].join("\n");
write("views/report.html", report);

const EMPTY = { type: "doc", content: [{ type: "paragraph" }] };
const flow = (id: string, name: string, title: string, description: string, action: string, input: Record<string, string>) => ({
  id,
  parent: "i1",
  kind: "page",
  title,
  icon: "⏱️",
  content: EMPTY,
  flow: {
    name,
    title,
    description,
    inputs: [],
    nodes: [
      { id: "do", kind: "action", action, input },
      { id: "done", kind: "return", value: { ok: true, message: "{{ steps.do.message }}" } },
    ],
    requested: { write: "all" },
    triggers: [{ kind: "manual" }],
  },
});
const i = (...names: string[]) => Object.fromEntries(names.map((n) => [n, `{{ input.${n} }}`]));
const FLOWS = [
  flow("f8", "zeiterfassung.schedule-save", "Save the schedule", "The weekly hours, the default break or the flex-time job (input what hours|pauses|flex, mon … sun, text, jobNumber, comment). Run by the Settings tab.", "time.schedule-save", i("what", "mon", "tue", "wed", "thu", "fri", "sat", "sun", "text", "jobNumber", "comment")),
  flow("f9", "zeiterfassung.flex-book", "Book the missing hours on the flex-time job", "The missing hours of the given days (input dates) booked on the flex-time job. Run by the report.", "time.flex-book", i("dates")),
  flow("f10", "zeiterfassung.absence", "Add or delete an absence", "An absence added (startDate, endDate, type, hours, note, repeatUntil) or deleted (input delete: its id). Run by the Settings tab.", "time.absence", i("delete", "startDate", "endDate", "type", "hours", "note", "repeatUntil")),
  flow("f6", "zeiterfassung.job-save", "Create or change a job", "A job: without id created, with id changed (number, name, customer, description, defaultTags, active). Run by the Jobs tab.", "time.job-save", i("id", "number", "name", "customer", "description", "defaultTags", "active")),
  flow("f7", "zeiterfassung.project-save", "Create or change a project", "A project: without id created, with id changed (title, description, customer, jobNumber, startDate, endDate, defaultTags, active). Run by the Jobs tab.", "time.project-save", i("id", "title", "description", "customer", "jobNumber", "startDate", "endDate", "defaultTags", "active")),
  flow("f1", "zeiterfassung.add-entry", "Book time", "Books an entry (input date, hours, description, bookOn j:<job number> or p:<project id>, ticket, type, tags, comment). Run by the report's form.", "time.entry-add", i("date", "hours", "description", "bookOn", "ticket", "type", "tags", "comment")),
  flow("f2", "zeiterfassung.entry-hours", "Change the hours of an entry", "Sets the hours of one entry (input id, hours). Run by the report.", "time.entry-hours", i("id", "hours")),
  flow("f3", "zeiterfassung.delete-entry", "Delete an entry", "Deletes one booked entry (input id). Run by the report.", "time.entry-delete", i("id")),
  flow("f4", "zeiterfassung.suggestion", "Take over or dismiss a suggested entry", "An agent's suggested booking (input id, accept true|false, hours, description). Run by the report.", "time.suggestion", i("id", "accept", "hours", "description")),
  flow("f5", "zeiterfassung.done-today", "Book the todos done today", "A ticket's todos done today booked as one entry, or skipped (input ticket, todoIds, hours, description, skip). Run by the report.", "time.done-today", i("ticket", "todoIds", "hours", "description", "skip")),
];
write(
  "zeiterfassung.package.json",
  JSON.stringify(
    {
      format: 1,
      id: "zeiterfassung-ext",
      version: "1.0.0",
      name: "Time tracking",
      description: "The report of your booked time: the week and the month, with booking, suggestions and closing the week.",
      icon: "⏱️",
      items: [
        { id: "i1", kind: "page", title: "Time tracking", icon: "⏱️", content: EMPTY },
        ...FLOWS,
        {
          id: "i2",
          parent: "i1",
          kind: "database",
          title: "Report",
          icon: "⏱️",
          schema: { titleName: "Report", properties: [], views: [{ id: "vtime1", name: "Report", type: "app", filter: { op: "and", rules: [] }, sorts: [], hidden: [], app: "template", template: report }] },
          rows: [{ id: "r1", title: "Report", cells: {}, content: EMPTY }],
        },
      ],
    },
    null,
    2,
  ) + "\n",
);

const old = fs.existsSync(path.join(dir, "zeff-plugin.json")) ? (JSON.parse(fs.readFileSync(path.join(dir, "zeff-plugin.json"), "utf8")) as { version?: string }) : {};
write(
  "zeff-plugin.json",
  JSON.stringify(
    {
      $schema: "http://127.0.0.1:9333/ext/sdk/zeff-plugin.schema.json",
      id: "zeiterfassung-ext",
      name: "Time tracking — the report",
      version: old.version ?? "0.1.0",
      description: "The report of your booked time in the view language: the week (booking, suggestions, closing it) and the month, over Zeff's own figures. The core (jobs, projects, bookings, the schedule) stays Zeff's.",
      author: "Zeff",
      apiVersion: 1,
      permissions: [],
      contributes: {
        lambdas: "lambdas",
        workspacePackages: ["zeiterfassung.package.json"],
        appViews: [{ id: "time-report", dataType: "time-report", label: "Time report", icon: "⏱️", template: "views/report.html" }],
      },
    },
    null,
    2,
  ) + "\n",
);
write("README.md", `# Time tracking — the report (zeiterfassung-ext)\n\nGenerated by Zeff's \`scripts/port-zeiterfassung.mts\`. The screens of time tracking over the kernel's reads \`time.month\` and \`time.week\`; the core stays Zeff's.\n`);
swapPlugin(dir);
console.log(`${dir}: written`);
