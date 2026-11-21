/**
 * Time tracking's screens as a plugin (zeff-plugins/plugins/zeiterfassung-ext): the report — the month (and the week) — drawn in the view language over
 * the kernel's reads `time.month` / `time.week` (src/plugins/zeiterfassung/flow-actions.ts: the figures and words of the built-in's own report functions).
 * The core — jobs, projects, bookings, the schedule — stays the kernel's; here are the screens. What each lambda hands the view is in
 * scripts/port-zeiterfassung/zeiterfassung.<name>.mjs, the view in month.html / week.html (the word "view" in the language of src/plugins/workspace/view-template.ts).
 *
 *   npx tsx scripts/port-zeiterfassung.mts [<zeff-plugins folder>]     (default ../zeff-plugins)
 */
import fs from "node:fs";
import { keepCatalogFields } from "./lib/catalog-fields.mts";
import path from "node:path";
import { swapPlugin } from "./lib/swap-reads.mjs";

const ROOT = process.cwd();
const repo = path.resolve(process.argv[2] ?? "../zeff-plugins");
const dir = path.join(repo, "plugins", "zeiterfassung-ext");
const SRC = path.join(ROOT, "scripts", "port-zeiterfassung");
// Raised with every change of what the plugin ships (a Zeff that has the plugin installed is offered the update by its version).
const PLUGIN_VERSION = "0.7.6";
const PACKAGE_VERSION = "1.6.6";
const write = (rel: string, text: string) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
// The report's tabs stand where a part puts <report-tabs/>: at the top of its side column, as the old pages had the Week | Month switch there.
const TABS_TAG = [
  '<nav inline=true>',
  ...[["week", "Week", "📅"], ["month", "Month", "🗓️"], ["analysis", "Analysis", "📊"], ["day", "End of day", "🌙"], ["jobs", "Jobs", "💼"], ["projects", "Projects", "📁"], ["settings", "Settings", "⚙️"]].map(
    ([v, label, icon]) => `<entry id="${v}" label="${label}" icon="${icon}" state="view" value="${v}"/>`,
  ),
  "</nav>",
  "<hr/>",
].join("");
const part = (name: string) => (fs.existsSync(path.join(SRC, name)) ? fs.readFileSync(path.join(SRC, name), "utf8").replaceAll("<report-tabs/>", TABS_TAG) : "");
fs.rmSync(path.join(dir, "lambdas"), { recursive: true, force: true });

const LAMBDAS: Record<string, { label: string; what: string; zeff: string[]; timeoutMs: number }> = {
  "zeiterfassung.jobs": { label: "Time tracking: jobs and projects", what: "The jobs and the projects as the Jobs and Projects pages list them, with the job options of a form.", zeff: ["time.jobs"], timeoutMs: 30000 },
  "zeiterfassung.schedule": { label: "Time tracking: the schedule settings", what: "The weekly hours, the default break, the flex-time job and the absences with their words.", zeff: ["time.schedule"], timeoutMs: 30000 },
  "zeiterfassung.day": { label: "Time tracking: end of day", what: "The day or the week drafted for booking: the meetings, the agents' suggestions and the tickets worked on, each line to take over.", zeff: ["time.day"], timeoutMs: 120000 },
  "zeiterfassung.rules": { label: "Time tracking: the rules", what: "The entry type rules, the report rewriting rules, the meeting rules, the exclude rules and the entry types with the options of their forms.", zeff: ["time.rules"], timeoutMs: 30000 },
  "zeiterfassung.job-detail": { label: "Time tracking: a job's or project's page", what: "What a job's or a project's own page shows: what it has booked, its entries, for a project the days to book.", zeff: ["time.job-detail"], timeoutMs: 30000 },
  "zeiterfassung.entry-detail": { label: "Time tracking: what stands behind an entry", what: "An entry's context items and what its todos bring along.", zeff: ["time.entry-detail"], timeoutMs: 30000 },
  "zeiterfassung.source-search": { label: "Time tracking: sources to add to an entry", what: "Teams messages, GitLab items, todos and mails found by words or a pasted link, each with the link that adds it.", zeff: ["time.source-search"], timeoutMs: 30000 },
  "zeiterfassung.analysis": { label: "Time tracking: the analysis", what: "The analysis of the booked time — the cards, the split by type, hours by job, the weeks, the Jira metrics where tickets are synced, tags and top tickets.", zeff: ["time.analysis"], timeoutMs: 60000 },
  "zeiterfassung.week": { label: "Time tracking: the week's report", what: "The weekly report's figures and words for a week — the booked card, hours per job and day, the closing steps, the suggestions, what was done today, the report, the entries.", zeff: ["time.week"], timeoutMs: 60000 },
  "zeiterfassung.month": { label: "Time tracking: the month's report", what: "The monthly report's figures and words for a month — the booked card, the calendar, hours per job and week, by type and tag, what each job's time went to.", zeff: ["time.month"], timeoutMs: 60000 },
};
for (const [name, l] of Object.entries(LAMBDAS)) {
  write(`lambdas/${name}/index.mjs`, fs.readFileSync(path.join(SRC, `${name}.mjs`), "utf8"));
  write(`lambdas/${name}/lambda.json`, JSON.stringify({ name, label: l.label, what: l.what, kind: "function", zeff: l.zeff, timeoutMs: l.timeoutMs, memoryMb: 256 }, null, 2) + "\n");
}

const TABS = ["month", "analysis", "day", "jobs", "settings"];
// The report: the week and the month, one screen, a tab apart (as the built-in's report has them).
const report = [
  '<state name="view" value="week" keep=url/><state name="by" value=""/><state name="aweeks" value="8"/><state name="atickets" value=""/><state name="asplit" value=""/>',
  '<on event="openweek" action="state" state="view" value="week"/>',
  // one branch per tab, the week the one left over
  // (Jobs and Projects: one part, the page picked by the menu)
  ...TABS.flatMap((tab) => [tab === "jobs" ? "{{#if state.view == 'jobs' or state.view == 'projects'}}" : `{{#if state.view == '${tab}'}}`, part(`${tab}.html`) + (tab === "settings" ? part("rules.html") : ""), "{{#else}}"]),
  part("week.html"),
  ...TABS.map(() => "{{/if}}"),
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
  flow("f15", "zeiterfassung.job-delete", "Delete a job or a project", "Deletes a job or a project (input kind job|project, id). Run by the Jobs tab.", "time.job-delete", i("kind", "id")),
  flow("f16", "zeiterfassung.book-days", "Book the working days on a project", "One entry per working day of a range on a project (input id, from, to, hours, fillUp, description, type). Run by the Jobs tab.", "time.book-days", i("id", "from", "to", "hours", "fillUp", "description", "type")),
  flow("f14", "zeiterfassung.entry-op", "Edit an entry, its group or a day's break", "One edit of the weekly report (input op update|copy|link|unlink|collect|start|span-mode|ungroup|parallel|pauses and its fields). Run by the report.", "time.entry-op", i("op", "id", "date", "bookOn", "hours", "description", "ticket", "type", "tags", "comment", "start", "isGroup", "spanId", "mode", "ids", "dates", "text", "state", "contextId", "ctxKind", "ctxTitle", "ctxAuthor", "ctxBody", "ctxLink", "ctxDate", "ctxTicket", "ctxLinks", "token", "name", "mime", "fileId", "dir", "url")),
  flow("f13", "zeiterfassung.rule-op", "Change a list of rules", "One change of a list of rules or of the entry types (input what types|report|meetings|exclude|entry-type, op add|remove|up|down|default|update|none, index, apply, and the rule's fields). Run by the Settings tab.", "time.rule-op", i("what", "op", "index", "apply", "jobNumber", "description", "type", "f1", "v1", "f2", "v2", "f3", "v3", "template", "tags", "match", "group", "value", "label", "color", "key", "name", "id", "mode")),
  flow("f11", "zeiterfassung.day-book", "Book the day", "The day's lines booked as you took them over (input date, state: the view's state as JSON). Run by the End of day tab.", "time.day-book", i("date", "state")),
  flow("f12", "zeiterfassung.day-undo", "Take the day's booking back", "Takes back what a booking of the day created, as far as it is still as booked (input created). Run by the End of day tab.", "time.day-undo", i("created")),
  flow("f8", "zeiterfassung.schedule-save", "Save the schedule", "The weekly hours, the default break or the flex-time job (input what hours|pauses|flex, mon … sun, text, jobNumber, comment). Run by the Settings tab.", "time.schedule-save", i("what", "mon", "tue", "wed", "thu", "fri", "sat", "sun", "text", "jobNumber", "comment", "punch", "vacation", "sick", "holiday", "other")),
  flow("f17", "zeiterfassung.absence-book", "Book absences on their jobs", "The absence hours of the given days (input dates) booked on the job of their kind of absence. Run by the report's absence rows.", "time.absence-book", i("dates")),
  flow("f9", "zeiterfassung.flex-book", "Book the missing hours on the flex-time job", "The missing hours of the given days (input dates) booked on the flex-time job. Run by the report.", "time.flex-book", i("dates")),
  flow("f10", "zeiterfassung.absence", "Add or delete an absence", "An absence added (startDate, endDate, type, hours, note, repeatUntil) or deleted (input delete: its id). Run by the Settings tab.", "time.absence", i("delete", "startDate", "endDate", "type", "hours", "note", "repeatUntil")),
  flow("f6", "zeiterfassung.job-save", "Create or change a job", "A job: without id created, with id changed (number, name, customer, description, defaultTags, active). Run by the Jobs tab.", "time.job-save", i("id", "number", "name", "customer", "description", "defaultTags", "active", "full")),
  flow("f7", "zeiterfassung.project-save", "Create or change a project", "A project: without id created, with id changed (title, description, customer, jobNumber, startDate, endDate, defaultTags, active). Run by the Jobs tab.", "time.project-save", i("id", "title", "description", "customer", "jobNumber", "startDate", "endDate", "defaultTags", "active", "full")),
  flow("f1", "zeiterfassung.add-entry", "Book time", "Books an entry (input date, hours, description, bookOn j:<job number> or p:<project id>, ticket, type, tags, comment). Run by the report's form.", "time.entry-add", i("date", "hours", "description", "bookOn", "ticket", "type", "tags", "comment", "start", "isGroup", "separate", "reportedBy", "ctxKind", "ctxTitle", "ctxAuthor", "ctxBody", "ctxLink", "ctxDate", "ctxTicket")),
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
      version: PACKAGE_VERSION,
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
      ...keepCatalogFields(old),
      $schema: "http://127.0.0.1:9333/ext/sdk/zeff-plugin.schema.json",
      id: "zeiterfassung-ext",
      name: "Time tracking — the report",
      version: PLUGIN_VERSION,
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
