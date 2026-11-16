import { flowActions, type FlowAction } from "./actions";
import { normalizeField } from "./types";
import { getSqlite } from "@/db";
import { getCapability, listCapabilities, PRIMITIVES, primitiveAction, resolveAction, saveCapability, type Capability } from "./capabilities";

/**
 * The kernel's actions DECLARED IN THE DATABASE (docs/plugins/server-dsl.md §3): each TypeScript action becomes a capability row
 * `{ impl: { command: "<name>" } }` with its schema (input fields, output, what it needs), whether it writes, its group and its CLASS —
 * so the catalogue the AI and the Studio read is the database's, not a list of TypeScript objects, and the class says what the
 * action is for in the plan of the language:
 *
 *   primitive  generic (sql, pref, db, rows, store, http, web, extract, fs, files, ai, prompts, oauth, time, meta, lambda …) — stays code
 *   read       reads kernel-owned data (people.*, todos.texts, messages.recent …) — to become a SQL view + a flow, then deleted
 *   command    writes with the kernel's invariants (todos.add, money.pay, mail.archive …) — stays code, declared
 *   vendor     glue for one service (jira.*, gitlab.*, bank.*, teams.*, connectors …) — to become a flow over http + secret + store
 *
 * Declaring is idempotent and never overwrites: a row that exists is the truth (edit it in the DB — the AI may), and a code change
 * that no longer matches the row is reported as drift. Server only.
 */

const PRIMITIVE = /^(sql|pref|db|rows|store|http|web|extract|fs|files|ai|prompts|time|lambda|meta|fn|api|driver|log|clock)\./;
const VENDOR = /^(jira|gitlab|teams|bank|gcal|connector|localai|signal|chrome|login|session|board|knowledge|gmail|outlook|whatsapp)\.|^messages\.save$|^workspace\.after-sync$/;

export type ActionClass = "primitive" | "read" | "command" | "vendor";

export function classify(a: Pick<FlowAction, "name" | "writes">): ActionClass {
  // (token storage and refresh stay kernel code — never raw http/pref access: port-drive's objection)
  if (/^oauth./.test(a.name)) return "command";
  if (PRIMITIVE.test(a.name)) return "primitive";
  if (VENDOR.test(a.name)) return "vendor";
  return a.writes ? "command" : "read";
}

const declaration = (a: FlowAction): Capability => ({
  name: a.name,
  label: a.label,
  summary: a.summary,
  input: a.input,
  output: a.output,
  impl: { command: a.name },
  enabled: true,
  ...(a.writes ? { writes: true } : {}),
  class: classify(a),
  group: a.group,
});

const sameSchema = (c: Capability, a: FlowAction) => JSON.stringify([c.input, c.output, !!c.writes]) === JSON.stringify([a.input.map(normalizeField), a.output, !!a.writes]);

export type DeclareReport = {
  /** Declared now (they had no row). */
  declared: string[];
  /** Rows whose schema is not the code's any more (the row stays; look at it). */
  drift: string[];
  /** Rows of kernel operations whose code is gone. */
  orphans: string[];
  /** All rows by class. */
  byClass: Record<string, number>;
};

/** Declares every kernel action that has no row (dry: only reports). */
export function declareKernelActions(opts: { dry?: boolean } = {}): DeclareReport {
  const actions = flowActions();
  const declared: string[] = [];
  const drift: string[] = [];
  for (const a of actions) {
    const row = getCapability(a.name);
    if (!row) {
      if (!opts.dry) saveCapability(declaration(a));
      declared.push(a.name);
    } else if ("command" in row.impl && !sameSchema(row, a)) drift.push(a.name);
  }
  const names = new Set(actions.map((a) => a.name));
  const orphans = listCapabilities().filter((c) => "command" in c.impl && !names.has(c.impl.command)).map((c) => c.name);
  const byClass: Record<string, number> = {};
  for (const a of actions) byClass[classify(a)] = (byClass[classify(a)] ?? 0) + 1;
  return { declared, drift, orphans, byClass };
}

// ---------------------------------------------------------------------------
// At start (lazily, once per database) and the catalogue
// ---------------------------------------------------------------------------

const declaredIn = ((globalThis as { __zeffDeclaredIn?: Set<string> }).__zeffDeclaredIn ??= new Set<string>());

/**
 * Declares the kernel's actions in this account's database the first time something asks (a flow run, the Studio's catalogue, the AI's
 * list) — no boot step, no shared start file: each account's database gets its rows when it is first used. Rows that exist stay as
 * they are. A failure never stops a run: the engine then goes by the code, as before.
 */
export function ensureDeclared(): void {
  let key: string;
  try {
    key = getSqlite().name;
  } catch {
    return;
  }
  if (declaredIn.has(key)) return;
  declaredIn.add(key);
  try {
    declareKernelActions();
  } catch (e) {
    declaredIn.delete(key);
    console.error(`[flows] declaring the actions failed: ${e instanceof Error ? e.message : e}`);
  }
}

export type CatalogEntry = Omit<FlowAction, "run"> & { class?: string };

/**
 * What a flow's nodes can call, as the DATABASE declares it (the Studio's picker, the AI's list): the kernel's actions with their rows'
 * texts and schemas (switched-off ones left out), the closed primitives (core.*), and the capabilities made of data. Without the code.
 */
export function declaredCatalog(): CatalogEntry[] {
  ensureDeclared();
  const out: CatalogEntry[] = [];
  const noRun = async () => null;
  for (const a of flowActions()) {
    let def: FlowAction | undefined;
    try {
      def = resolveAction(a.name, noRun);
    } catch {
      continue; // switched off
    }
    if (!def) continue;
    const { run: _run, ...meta } = def;
    out.push({ ...meta, class: classify(a) });
  }
  for (const name of Object.keys(PRIMITIVES)) {
    const p = primitiveAction(`core.${name}`);
    if (p) {
      const { run: _run, ...meta } = p;
      out.push({ ...meta, class: "primitive" });
    }
  }
  const known = new Set(out.map((x) => x.name));
  for (const c of listCapabilities()) {
    if (!c.enabled || "command" in c.impl || known.has(c.name)) continue;
    out.push({ name: c.name, group: "capability", label: c.label, summary: c.summary, input: c.input, output: c.output, ...(getCapability(c.name)?.writes ? { writes: true } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The reads that were only code because flows couldn't say a SELECT: the same answer, as data
// ---------------------------------------------------------------------------

/**
 * Capabilities that give exactly what a kernel `read` action gives (docs/plugins/server-dsl.md §4), made of `sql.query` + the stdlib:
 * `read.<name>` answers like `<name>`, and a flow that grants `sql` for the tables named can use it. They are the proof that the action's
 * code isn't needed; when every caller has switched to `read.<name>` the action is deleted (tests/server-dsl.test.ts compares them
 * answer for answer). The caller must grant the tables each one names (todos, emails, people).
 */
/** What mail.unread counts as an unread mail (its chat folders are WhatsApp and Signal, lib/mail/shared CHAT_FOLDERS — keep in step). */
const UNREAD = "unread = 1 and resolved_at is null and folder not like '%Archive%' and folder not like '%Archiv%' and folder not like '%Sent%' and folder not like '%Gesendet%' and folder not in ('WhatsApp', 'Signal')";

export const READ_REPLACEMENTS: Capability[] = [
  {
    name: "read.todos.texts",
    label: "Your todos' texts",
    summary: 'Every todo (not merged into another): its text, its note, when it was made. Same answer as todos.texts. Needs sql: ["todos"].',
    input: [],
    output: "{ todos: [{ id, text, note, at }] }",
    impl: { use: "sql.query", input: { sql: "select id, text, note, created_at as at from todos where merged_into is null", limit: 5000 }, output: { todos: "{{ result.rows }}" } },
    enabled: true,
    class: "read-replacement",
  },
  {
    name: "read.todos.by-ids",
    label: "Todos by their numbers",
    summary: 'These todos (not merged into another): text, status, due — the open first, the newest first. Same answer as todos.by-ids. Needs sql: ["todos"].',
    input: [{ name: "ids", type: "list", required: true }],
    output: "{ todos: [{ id, text, status, due }] }",
    impl: { use: "sql.query", input: { sql: "select id, text, status, due from todos where id in (select cast(value as integer) from json_each(?)) and merged_into is null order by status = 'done', id desc", params: ["{{ input.ids | json }}"], limit: 2000 }, output: { todos: "{{ result.rows }}" } },
    enabled: true,
    class: "read-replacement",
  },
  {
    name: "read.messages.count",
    label: "How many messages a folder has",
    summary: 'How many messages are kept in a folder (WhatsApp, Signal, a mailbox). Same answer as messages.count. Needs sql: ["emails"].',
    input: [{ name: "folder", type: "text", required: true }],
    output: "{ count }",
    impl: { use: "sql.query", input: { sql: "select count(*) as n from emails where folder = ?", params: ["{{ input.folder }}"] }, output: { count: "{{ result.rows[0].n }}" } },
    enabled: true,
    class: "read-replacement",
  },
  {
    name: "read.people.names",
    label: "Your contacts' names",
    summary: 'The names of these contacts by their id — all your contacts without ids. Same answer as people.names. Needs sql: ["people"].',
    input: [{ name: "ids", type: "list" }],
    output: "{ names: { [id]: name } }",
    impl: {
      use: "sql.query",
      input: { sql: "select json_group_object(id, name) as names from (select id, name from people where (? = '[]' or id in (select cast(value as integer) from json_each(?))) order by starred desc, name collate nocase)", params: ["{{ input.ids | default([]) | json }}", "{{ input.ids | default([]) | json }}"] },
      output: { names: "{{ result.rows[0].names | parse }}" },
    },
    enabled: true,
    class: "read-replacement",
  },
  {
    name: "read.people.emails",
    label: "Your contacts' mail addresses",
    summary: 'Each contact\'s mail addresses, by their id. Same answer as people.emails. Needs sql: ["people"].',
    input: [],
    output: "{ people: [{ id, emails }] }",
    impl: { use: "sql.query", input: { sql: "select json_group_array(json_object('id', id, 'emails', json(emails))) as p from (select id, emails from people order by starred desc, name collate nocase)" }, output: { people: "{{ result.rows[0].p | parse }}" } },
    enabled: true,
    class: "read-replacement",
  },
  {
    name: "read.mail.messages",
    label: "Mails and messages Zeff keeps",
    summary: 'The mails and messages Zeff keeps (any folder): those whose subject or preview contains a text, when given — key, subject, preview, when, the sender\'s address. Same answer as mail.messages (when the table is there). Needs sql: ["emails"] — and sqlMaxRows above 5000 for more rows than that (the kernel action gives up to 50000).',
    input: [{ name: "contains", type: "text" }, { name: "limit", type: "number", default: 20000 }],
    output: "{ messages: [{ key, subject, preview, at, email }] }",
    impl: {
      use: "sql.query",
      input: { sql: "select key, subject, preview, received_at as at, lower(from_email) as email from emails where (? = '' or instr(subject || ' ' || preview, ?) > 0) order by received_at desc", params: ["{{ input.contains | default('') }}", "{{ input.contains | default('') }}"], limit: "{{ input.limit | number | default(20000) | clamp(1, 50000) }}" },
      output: { messages: "{{ result.rows }}" },
    },
    enabled: true,
    class: "read-replacement",
  },
  {
    name: "read.mail.unread",
    label: "The newest unread mails",
    summary: 'The newest unread mails (not chats, not archived or sent ones) and how many there are in all. Same answer as mail.unread. Needs sql: ["emails"].',
    input: [{ name: "limit", type: "number", default: 6 }],
    output: "{ total, mails: [{ key, from, email, subject, preview, at, folder }] }",
    impl: {
      use: "sql.query",
      input: {
        sql: `select (select count(*) from emails where ${UNREAD}) as total, (select json_group_array(json_object('key', key, 'from', from_name, 'email', from_email, 'subject', subject, 'preview', preview, 'at', received_at, 'folder', folder)) from (select * from emails where ${UNREAD} order by received_at desc limit case when ? > 0 then min(?, 50) else 6 end)) as mails`,
        params: ["{{ input.limit | number | default(0) }}", "{{ input.limit | number | default(0) }}"],
      },
      output: { total: "{{ result.rows[0].total }}", mails: "{{ result.rows[0].mails | parse }}" },
    },
    enabled: true,
    class: "read-replacement",
  },
  {
    name: "read.documents.texts",
    label: "The documents that are read",
    summary: 'The documents that are read (OCR and summary done): name, summary, the start of their text (up to chars, 6000 by default), when they came. Same answer as documents.texts. Needs sql: ["documents"].',
    input: [{ name: "chars", type: "number", default: 6000 }],
    output: "{ docs: [{ id, name, summary, text, at }] }",
    impl: {
      use: "sql.query",
      input: { sql: "select id, name, summary, substr(text, 1, ?) as text, created_at as at from documents where status = 'ready'", params: ["{{ input.chars | number | default(6000) | clamp(100, 20000) | floor }}"], limit: 5000 },
      output: { docs: "{{ result.rows }}" },
    },
    enabled: true,
    class: "read-replacement",
  },
];

/** Saves the replacements that have no row yet (a row that exists is the truth — edit it there). */
export function declareReadReplacements(): string[] {
  const made: string[] = [];
  for (const c of READ_REPLACEMENTS) {
    if (getCapability(c.name)) continue;
    saveCapability(c);
    made.push(c.name);
  }
  return made;
}
