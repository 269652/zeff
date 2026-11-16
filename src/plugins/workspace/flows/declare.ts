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
