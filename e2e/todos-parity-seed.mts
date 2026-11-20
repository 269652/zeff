/**
 * A test server's database filled with todos in every state the Todos screen draws (scripts/test-server.mjs --seed e2e/todos-parity-seed.mts):
 * a briefing run with four tickets, your todos in every group (Important, Overdue, Today, This week, Later, No due date, Set aside), one you wait on,
 * done and dismissed ones, a worker's, every badge of a row (ticket, linked ticket, kind, due, repeat, deferred, a worker's report, a suggestion,
 * an agent's question, the last error, a note, a source, time) and a recap of the day before. Dates are relative to today, so the old screens and the
 * plugin's look the same on the same day. With ZEFF_PLUGINS_DIR holding todos-ext, the Todos screens are switched to the plugin.
 */
import fs from "node:fs";
import path from "node:path";

if (!process.env.DATABASE_PATH || !process.env.ZEFF_TEST_SERVER) throw new Error("Only for a test server's database (DATABASE_PATH + ZEFF_TEST_SERVER).");

const { setInstalled } = await import("@/plugins/state");
for (const id of ["todos", "tickets", "work"] as const) {
  try {
    setInstalled(id as never, true);
  } catch {
    // not in this version
  }
}
const { getSqlite } = await import("@/db");
const sq = getSqlite();
const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return dayOf(d);
};
const now = new Date();
const ago = (min: number) => new Date(now.getTime() - min * 60000).toISOString();

// The briefing's run: four tickets, analysed.
const tickets = [
  ["PROJ-101", "Login fails with SSO", "In Progress", "inprogress"],
  ["PROJ-102", "Export to CSV", "In Review", "inprogress"],
  ["PROJ-103", "Dark mode for the settings", "To Do", "todo"],
  ["PROJ-104", "Payment webhook retries", "Testing", "inprogress"],
].map(([key, summary, status, statusCategory]) => ({ key, summary, url: null, status, statusCategory, issueType: "Story", priority: "Medium", assignee: "Me", parent: null, updatedAt: ago(600), comments: 2, analyzed: true, recent: [] as { id: string; author: string; at: string; text: string }[] }));
// The comments the run read (a todo's context: what it came from).
tickets[0].recent = [
  { id: "10001", author: "Anna Berg", at: ago(300), text: "The SSO login loops after the redirect — can you review the fix in the MR?" },
  { id: "10002", author: "Thomas Kurz", at: ago(240), text: "I added a test for the callback; please check the session cookie too." },
];
tickets[1].recent = [{ id: "10003", author: "Anna Berg", at: ago(500), text: "Should the CSV export include archived rows? The customer asks." }];
const result = {
  lede: "Two tickets wait on you, the export is in review.",
  tickets: tickets.map((t, i) => ({ key: t.key, attention: ["feedback", "active", "check", "spec"][i], lead: `${t.summary}: what is next.`, summary: "", happened: [], todos: [], resolved: [], flags: [] })),
};
sq.prepare("insert into board_runs (status, jql, model, tickets, result, cost_usd, duration_ms, started_at, finished_at) values ('ok', 'assignee = currentUser()', 'claude-sonnet', ?, ?, 0.42, 95000, ?, ?)").run(
  JSON.stringify(tickets),
  JSON.stringify(result),
  "2026-11-20 06:00:00",
  "2026-11-20 06:01:35",
);
const runId = (sq.prepare("select max(id) id from board_runs").get() as { id: number }).id;

type T = { ops?: object[]; planned?: object[]; why?: string; ticket?: string; text: string; kind?: string; owner?: string; status?: string; due?: string | null; flagged?: boolean; deferred?: boolean; needsInput?: string; workerDone?: object; byWorker?: boolean; note?: string; source?: string; refs?: string[]; also?: string[]; recurrence?: object; userNotes?: object[]; created?: number };
const add = (t: T): number => {
  const created = ago(t.created ?? 3000);
  const r = sq
    .prepare(
      "insert into todos (ticket, text, kind, owner, status, source, refs, note, run_id, due, flagged_at, deferred_at, needs_input, worker_done, by_worker, also_tickets, recurrence, user_notes, created_at, updated_at, done_at, ops, planned, auto_ops_why) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      t.ticket ?? "",
      t.text,
      t.kind ?? "other",
      t.owner ?? "me",
      t.status ?? "open",
      t.source ?? null,
      JSON.stringify(t.refs ?? []),
      t.note ?? null,
      runId,
      t.due ?? null,
      t.flagged ? ago(60) : null,
      t.deferred ? ago(30) : null,
      t.needsInput ?? null,
      t.workerDone ? JSON.stringify(t.workerDone) : null,
      t.byWorker ? 1 : 0,
      JSON.stringify(t.also ?? []),
      t.recurrence ? JSON.stringify(t.recurrence) : null,
      JSON.stringify(t.userNotes ?? []),
      created,
      created,
      t.status && t.status !== "open" ? ago(120) : null,
      JSON.stringify(t.ops ?? []),
      JSON.stringify(t.planned ?? []),
      t.why ?? null,
    );
  return Number(r.lastInsertRowid);
};

const ids = {
  important: add({ ticket: "PROJ-101", text: "Review the SSO login fix", kind: "review", flagged: true, refs: ["jira-comment:10001", "jira-comment:10002"], userNotes: [{ at: ago(100), text: "The MR is !168 — check the cookie flags." }], planned: [{ path: null, steps: [{ text: "Merge the SSO fix", kind: "merge", owner: "me" }, { text: "Deploy to staging", kind: "deploy", owner: "me" }] }] }),
  overdue: add({ ticket: "PROJ-102", text: "Answer Anna about the CSV export", kind: "reply", due: inDays(-3), needsInput: "Should the export include archived rows?", refs: ["jira-comment:10003"] }),
  today: add({ ticket: "PROJ-103", text: "Comment on the dark mode spec", kind: "comment", due: inDays(0), ops: [{ type: "jira-comment", ticket: "PROJ-103", body: "The spec looks good. Two questions: does the toggle follow the system setting, and do charts switch too?" }] }),
  week: add({ text: "Pay the hosting invoice", kind: "other", due: inDays(3), recurrence: { freq: "monthly", interval: 1 }, note: "Invoice 2026-11 from the hosting company", source: "Mail from billing" }),
  later: add({ ticket: "PROJ-104", text: "Update the webhook retry docs", kind: "document", due: inDays(20), workerDone: { at: ago(20), by: "Copilot · W-3", note: "Docs updated in the README" }, ops: [{ type: "jira-transition", ticket: "PROJ-104", to: "Done" }, { type: "jira-comment", ticket: "PROJ-104", body: "The retry docs are updated in the README." }], why: "The worker reports the docs done — the ticket can be closed with a note." }),
  none: add({ ticket: "PROJ-101", text: "Check the failing nightly build", kind: "fix", also: ["PROJ-104"], workerDone: { at: ago(25), by: "Review", note: "The last build was green", suggested: true } }),
  none2: add({ text: "Prepare the sprint demo", kind: "other", source: "Weekly meeting", userNotes: [{ at: ago(200), text: "Show the export and the dark mode." }] }),
  deferred: add({ ticket: "PROJ-103", text: "Clean up old feature flags", kind: "implement", deferred: true }),
  waiting: add({ ticket: "PROJ-102", text: "Thomas reviews the export merge request", kind: "review", owner: "other" }),
  done1: add({ ticket: "PROJ-101", text: "Fix the typo in the footer", kind: "fix", status: "done" }),
  done2: add({ ticket: "PROJ-104", text: "Reply to the vendor about retries", kind: "reply", status: "dismissed" }),
  worker: add({ ticket: "PROJ-104", text: "Run the migration script on staging", kind: "deploy", byWorker: true }),
};

// What the knowledge base has on the overdue one (the Knowledge plugin on): a page, an entity, a system's address.
try {
  setInstalled("knowledge" as never, true);
} catch {
  // not in this version
}
sq.prepare("update todos set knowledge = ? where id = ?").run(
  JSON.stringify({
    at: ago(60),
    pages: [{ id: "conf:4711", title: "CSV export — design", space: "DEV", url: "https://wiki.example.com/csv-export", summary: "How the export writes rows, which columns, archived rows are left out by default.", snippet: "archived rows are left out", heading: "Rows", score: 0.8 }],
    entities: [{ id: 1, name: "CSV export", type: "feature", summary: "The export of the list as CSV.", aliases: [], pages: 1, related: [] }],
    links: [{ env: "test", label: "Export (test)", url: "https://test.example.com/export", page: "conf:4711" }],
  }),
  ids.overdue,
);

// Time on the important one (45 min, by hand).
try {
  const { addTodoTime } = await import("@/lib/work/todo-time");
  addTodoTime({ todoId: ids.important, minutes: 45, note: "Read the diff", source: "hand", at: ago(90) });
} catch (e) {
  console.error("time:", e);
}
// The last attempt on today's failed (a failed run of a worker, not seen).
try {
  const cols = (sq.prepare("pragma table_info(work_runs)").all() as { name: string; notnull: number; dflt_value: unknown }[]).filter((c) => c.notnull && c.dflt_value == null && c.name !== "id");
  const v: Record<string, unknown> = { ticket: "PROJ-103", todo_id: ids.today, mode: "agent", provider: "copilot", status: "failed", prompt: "Comment on the spec", error: "The Jira comment could not be posted: 403 Forbidden" };
  for (const c of cols) if (!(c.name in v)) v[c.name] = "";
  v.status = "failed";
  v.error = "The Jira comment could not be posted: 403 Forbidden";
  const keys = Object.keys(v);
  sq.prepare(`insert into work_runs (${keys.join(", ")}) values (${keys.map(() => "?").join(", ")})`).run(...keys.map((k) => v[k] as never));
} catch (e) {
  console.error("work run:", e);
}

// A recap of the day before.
{
  const d = new Date();
  do d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6);
  const day = dayOf(d);
  const facts = {
    tickets: [
      { key: "PROJ-101", summary: "Login fails with SSO", status: "In Progress", url: null, facts: [{ kind: "entry", at: `${day}T09:00:00`, text: "Debugging the SSO redirect", hours: 2 }, { kind: "todo", at: `${day}T11:00:00`, text: "Fix the typo in the footer" }] },
      { key: "PROJ-102", summary: "Export to CSV", status: "In Review", url: null, facts: [{ kind: "commit", at: `${day}T14:00:00`, text: "Add the CSV writer" }] },
    ],
    other: [{ kind: "entry", at: `${day}T16:00:00`, text: "Team meeting", hours: 1 }],
  };
  const res = { summary: "Worked on the SSO login and the CSV export; the footer typo is fixed.", tickets: [{ key: "PROJ-101", lead: "The redirect loop is found.", done: ["Debugged the SSO redirect", "Fixed the footer typo"] }, { key: "PROJ-102", lead: "The writer is in.", done: ["Added the CSV writer"] }], other: ["Team meeting"] };
  sq.prepare("insert into day_recaps (day, status, model, facts, result, cost_usd, duration_ms, started_at, finished_at) values (?, 'ok', 'claude-sonnet', ?, ?, 0.05, 41000, ?, ?)").run(day, JSON.stringify(facts), JSON.stringify(res), "2026-11-20 06:10:00", "2026-11-20 06:10:41");
}

// The plugin's screens, when the plugins folder has them.
const plugins = process.env.ZEFF_PLUGINS_DIR;
if (plugins && fs.existsSync(path.join(plugins, "todos-ext", "zeff-plugin.json"))) {
  const { switchTodosToPlugin } = await import("@/plugins/todos/to-plugin");
  console.log("switched:", JSON.stringify(await switchTodosToPlugin()).slice(0, 200));
}
console.log("todos seeded", JSON.stringify(ids));
