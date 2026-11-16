import fs from "node:fs";
import path from "node:path";
import { dataDir, getSqlite } from "@/db";
import { flowAction, type ActionCtx, type FlowAction } from "./actions";
import { checkExpr, fill } from "./expr";
import { applyPatch, type NodePatch } from "./patch";
import { FLOW_NAME, normalizeField, normalizeNodes, walkNodes, type Expr, type FieldSpec, type FlowNode } from "./types";

/**
 * The capability registry of the server DSL (docs/plugins/server-dsl.md): what a flow's action node can call, DECLARED AS DATA in the
 * database — its name, input and output schema, what it needs, and what it is made of — instead of a name matched to code.
 *
 *   { use: "<primitive or capability>", input: { … }, output: "{{ result.… }}" }   a wrapper: the input mapped, the answer shaped
 *   { nodes: [ … flow nodes … ], output }                                          a small program (its input is `input`)
 *
 * The primitives are the CLOSED set below — the only things in this layer that are TypeScript: pref.get, pref.set, sql.query,
 * clock.now, log. Everything else a plugin needs is composed over them (and over the kernel's older actions, which stay).
 * A capability never has more rights than its caller: the primitives check the calling flow's grants (permissions.pref, permissions.sql).
 * Server only.
 */

// ---------------------------------------------------------------------------
// The primitives (closed)
// ---------------------------------------------------------------------------

export type Primitive = { name: string; summary: string; input: FieldSpec[]; output: string; writes?: boolean; run: (input: Record<string, unknown>, ctx: ActionCtx) => Promise<unknown> | unknown };

const field = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });

export const prefGranted = (granted: string[] | undefined, key: string): boolean => (granted ?? []).some((g) => (g.endsWith("*") ? key.startsWith(g.slice(0, -1)) : g === key));

const TABLE_REF = /\b(?:from|join)\s+["`[]?([A-Za-z_]\w*)/gi;
const NEVER = new Set(["ws_flow_secrets"]);
const MAX_ROWS = 5000;
const FS_MAX = 1_000_000;
const FS_ENTRIES = 1000;

/** A path inside one of the flow's fs roots (symlinks resolved — nothing leaves a root; write: the root must allow it), with that root's limits. Zeff's own data folder is never reachable, whatever is granted. */
function inRootOf(ctx: ActionCtx, raw: string, write: boolean): { path: string; maxEntries: number; maxBytes: number } {
  const roots = ctx.perms.fs ?? [];
  if (!raw.trim()) throw new Error("fs: no path.");
  const p = path.resolve(raw);
  const real = (x: string): string => {
    // (a file or folder that isn't there yet: its nearest existing folder's real place, then the rest)
    try {
      return fs.realpathSync(x);
    } catch {
      const up = path.dirname(x);
      if (up === x) throw new Error("no such path");
      return path.join(real(up), path.basename(x));
    }
  };
  let target: string;
  try {
    target = real(p);
  } catch {
    throw new Error(`fs: “${raw}” isn't there.`);
  }
  const lower = (x: string) => (process.platform === "win32" ? x.toLowerCase() : x);
  const inside = (x: string, root: string) => lower(x) === lower(root) || lower(x).startsWith(lower(root) + path.sep);
  try {
    if (inside(target, fs.realpathSync(dataDir()))) throw new Error(`“${raw}” is in Zeff's own data folder — flows never reach it.`);
  } catch (e) {
    if (e instanceof Error && /own data folder/.test(e.message)) throw e;
  }
  for (const r of roots) {
    let root: string;
    try {
      root = fs.realpathSync(path.resolve(r.root));
    } catch {
      continue;
    }
    if (inside(target, root)) {
      if (write && !r.write) throw new Error(`This flow may read but not write under ${r.root} — grant write there under the flow's permissions (fs).`);
      return { path: target, maxEntries: r.maxEntries ?? FS_ENTRIES, maxBytes: r.maxBytes ?? FS_MAX };
    }
  }
  throw new Error(`This flow may not reach “${raw}” — grant its folder under the flow's permissions (fs).`);
}


export const PRIMITIVES: Record<string, Primitive> = {
  "pref.get": {
    name: "pref.get",
    summary: "A preference of Zeff by its key (null: not set) — only keys the flow was granted under permissions.pref.",
    input: [field("key", "text", { required: true })],
    output: "{ value }",
    run: async (i, ctx) => {
      const key = String(i.key ?? "").trim();
      if (!prefGranted(ctx.perms.pref, key)) throw new Error(`This flow may not read the preference “${key}” — grant it under the flow's permissions (pref).`);
      const { getPref } = await import("@/lib/prefs");
      return { value: getPref<unknown>(key, null) };
    },
  },
  "pref.set": {
    name: "pref.set",
    summary: "Sets a preference (any JSON value) — only keys the flow was granted under permissions.pref.",
    input: [field("key", "text", { required: true }), field("value", "json")],
    output: "{ key }",
    writes: true,
    run: async (i, ctx) => {
      const key = String(i.key ?? "").trim();
      if (!prefGranted(ctx.perms.pref, key)) throw new Error(`This flow may not write the preference “${key}” — grant it under the flow's permissions (pref).`);
      const { setPref } = await import("@/lib/prefs");
      setPref(key, i.value ?? null);
      return { key };
    },
  },
  "sql.query": {
    name: "sql.query",
    summary: "One SELECT on Zeff's database, with ? parameters — only on the tables the flow was granted under permissions.sql. At most 5000 rows.",
    input: [field("sql", "text", { required: true }), field("params", "list"), field("limit", "number", { default: 200 })],
    output: "{ rows, count, truncated }",
    run: (i, ctx) => {
      const sql = String(i.sql ?? "").trim().replace(/;\s*$/, "");
      if (!/^(select|with)\b/i.test(sql)) throw new Error("sql.query runs one SELECT (or WITH … SELECT).");
      const tables = [...sql.matchAll(TABLE_REF)].map((m) => m[1].toLowerCase());
      const granted = new Set((ctx.perms.sql ?? []).map((t) => t.toLowerCase()));
      for (const t of tables) if (NEVER.has(t) || !granted.has(t)) throw new Error(`This flow may not read the table “${t}” — grant it under the flow's permissions (sql).`);
      const params = Array.isArray(i.params) ? i.params : [];
      if (params.some((p) => p !== null && !["string", "number", "boolean"].includes(typeof p))) throw new Error("sql.query: parameters are texts, numbers, true/false or null.");
      const limit = Math.max(1, Math.min(MAX_ROWS, Math.floor(Number(i.limit) || 200)));
      let stmt;
      try {
        stmt = getSqlite().prepare(sql);
      } catch (e) {
        throw new Error(`sql.query: ${e instanceof Error ? e.message : e}`);
      }
      if (!stmt.reader || !stmt.readonly) throw new Error("sql.query only reads.");
      const rows: unknown[] = [];
      let truncated = false;
      for (const r of stmt.iterate(...params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p)))) {
        if (rows.length >= limit) {
          truncated = true;
          break;
        }
        rows.push(r);
      }
      return { rows, count: rows.length, truncated };
    },
  },
  "sql.exec": {
    name: "sql.exec",
    summary: "One INSERT / UPDATE / DELETE on Zeff's database, with ? parameters — only on the tables the flow was granted under permissions.sqlWrite (any other table the statement reads needs permissions.sql). Inside a tx node it commits with the rest or not at all.",
    input: [field("sql", "text", { required: true }), field("params", "list")],
    output: "{ changes, lastInsertRowid }",
    writes: true,
    run: (i, ctx) => {
      const sql = String(i.sql ?? "").trim().replace(/;\s*$/, "");
      const target = /^(?:insert|replace)\s+(?:or\s+\w+\s+)?into\s+["`[]?([A-Za-z_]\w*)/i.exec(sql)?.[1] ?? /^update\s+(?:or\s+\w+\s+)?["`[]?([A-Za-z_]\w*)/i.exec(sql)?.[1] ?? /^delete\s+from\s+["`[]?([A-Za-z_]\w*)/i.exec(sql)?.[1];
      if (!target) throw new Error("sql.exec runs one INSERT, UPDATE or DELETE (no DDL, no PRAGMA).");
      const writable = new Set((ctx.perms.sqlWrite ?? []).map((t) => t.toLowerCase()));
      if (NEVER.has(target.toLowerCase()) || !writable.has(target.toLowerCase())) throw new Error(`This flow may not write the table “${target}” — grant it under the flow's permissions (sqlWrite).`);
      const readable = new Set((ctx.perms.sql ?? []).map((t) => t.toLowerCase()));
      for (const m of sql.matchAll(TABLE_REF)) if (NEVER.has(m[1].toLowerCase()) || !(readable.has(m[1].toLowerCase()) || writable.has(m[1].toLowerCase()))) throw new Error(`This flow may not read the table “${m[1]}” — grant it under the flow's permissions (sql).`);
      const params = Array.isArray(i.params) ? i.params : [];
      if (params.some((p) => p !== null && !["string", "number", "boolean"].includes(typeof p))) throw new Error("sql.exec: parameters are texts, numbers, true/false or null.");
      let stmt;
      try {
        stmt = getSqlite().prepare(sql);
      } catch (e) {
        throw new Error(`sql.exec: ${e instanceof Error ? e.message : e}`);
      }
      if (stmt.reader) throw new Error("sql.exec doesn't return rows — use sql.query to read.");
      const r = stmt.run(...params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p)));
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
    },
  },
  "fs.list": {
    name: "fs.list",
    summary: "The entries of a folder under one of the flow's fs roots: [{ name, type (file|dir), size }] (at most 1000).",
    input: [field("path", "text", { required: true })],
    output: "{ entries }",
    run: (i, ctx) => {
      const { path: p, maxEntries } = inRootOf(ctx, String(i.path ?? ""), false);
      const entries = fs.readdirSync(p, { withFileTypes: true }).slice(0, maxEntries).map((d) => ({ name: d.name, type: d.isDirectory() ? "dir" : "file", size: d.isFile() ? fs.statSync(path.join(p, d.name)).size : 0 }));
      return { entries };
    },
  },
  "fs.read-text": {
    name: "fs.read-text",
    summary: "A text file under one of the flow's fs roots (at most 1 MB; larger is an error).",
    input: [field("path", "text", { required: true })],
    output: "{ text, size }",
    run: (i, ctx) => {
      const { path: p, maxBytes } = inRootOf(ctx, String(i.path ?? ""), false);
      const size = fs.statSync(p).size;
      if (size > maxBytes) throw new Error(`fs.read-text: the file has ${size} bytes — at most ${maxBytes}.`);
      return { text: fs.readFileSync(p, "utf8"), size };
    },
  },
  "fs.write-text": {
    name: "fs.write-text",
    summary: "Writes (or appends to) a text file under one of the flow's fs roots marked write (at most 1 MB; folders are made).",
    input: [field("path", "text", { required: true }), field("text", "text", { required: true }), field("append", "boolean")],
    output: "{ path, size }",
    writes: true,
    run: (i, ctx) => {
      const text = String(i.text ?? "");
      const { path: p, maxBytes } = inRootOf(ctx, String(i.path ?? ""), true);
      if (Buffer.byteLength(text) > maxBytes) throw new Error(`fs.write-text: at most ${maxBytes} bytes.`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      if (i.append === true) fs.appendFileSync(p, text);
      else fs.writeFileSync(p, text);
      return { path: p, size: fs.statSync(p).size };
    },
  },
  http: {
    name: "http",
    summary: "A web request (as http.request: domains from permissions.web, redirects re-checked, private addresses refused) whose headers may carry SECRETS the flow was granted (permissions.secret): secretHeaders: { authorization: { secret: \"API_KEY\", prefix: \"Bearer \" } }. The value goes into the header on the server — the flow never reads it, the log shows •••.",
    input: [field("url", "url", { required: true }), field("method", "text"), field("query", "json"), field("body", "json"), field("headers", "json"), field("secretHeaders", "json"), field("timeoutMs", "number")],
    output: "{ status, ok, url, type, json, text, headers }",
    run: async (i, ctx) => {
      const { secretValues } = await import("./store");
      const headers: Record<string, unknown> = { ...(i.headers && typeof i.headers === "object" ? (i.headers as Record<string, unknown>) : {}) };
      const secrets = secretValues();
      for (const [h, spec] of Object.entries(i.secretHeaders && typeof i.secretHeaders === "object" ? (i.secretHeaders as Record<string, { secret?: string; prefix?: string }>) : {})) {
        const name = String(spec?.secret ?? "");
        if (!(ctx.perms.secret ?? []).includes(name)) throw new Error(`This flow may not use the secret “${name}” — grant it under the flow's permissions (secret).`);
        if (!(name in secrets)) throw new Error(`There is no secret “${name}” (Studio → Secrets).`);
        headers[h] = `${spec.prefix ?? ""}${secrets[name]}`;
      }
      const rest = { ...i };
      delete rest.secretHeaders;
      const base = flowAction("http.request");
      if (!base) throw new Error("http.request isn't there.");
      return base.run({ ...rest, headers }, ctx);
    },
  },
  "clock.now": {
    name: "clock.now",
    summary: "The time now: { now (ISO, UTC), today (YYYY-MM-DD, local), local (YYYY-MM-DDTHH:mm) }. The only way a flow reads the clock inside a function.",
    input: [],
    output: "{ now, today, local }",
    run: () => {
      const d = new Date();
      return { now: d.toISOString(), today: d.toLocaleDateString("sv-SE"), local: `${d.toLocaleDateString("sv-SE")}T${d.toTimeString().slice(0, 5)}` };
    },
  },
  log: {
    name: "log",
    summary: "A line in the run's log (shown with the node in the run console).",
    input: [field("message", "text", { required: true })],
    output: "{ logged }",
    run: (i, ctx) => {
      ctx.log(String(i.message ?? "").slice(0, 2000));
      return { logged: true };
    },
  },
};

// ---------------------------------------------------------------------------
// The registry (the database)
// ---------------------------------------------------------------------------

/** command: a kernel operation whose code is TypeScript (declare.ts) — the row is its declaration: schema, writes, class; the handler is found by name. */
export type CapImpl = { use: string; input?: Record<string, Expr>; output?: Expr } | { nodes: FlowNode[]; output?: Expr } | { command: string };
export type Capability = { name: string; label: string; summary: string; input: FieldSpec[]; output: string; impl: CapImpl; enabled: boolean; /** Declared kernel operations: changes something. */ writes?: boolean; /** primitive | read | command | vendor — what kind of kernel operation (declare.ts). */ class?: string; group?: string };

function db() {
  const d = getSqlite();
  d.exec("create table if not exists ws_capabilities (name text primary key, def text not null, enabled integer not null default 1, updated_at text not null)");
  d.exec("create table if not exists ws_capability_versions (name text not null, v integer not null, def text not null, at text not null, primary key (name, v))");
  return d;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** What the AI or the Studio wrote, made a capability — and every problem it has, each with its place ("impl.input.key"). Empty: it is fine. */
export function normalizeCapability(raw: unknown): { cap: Capability | null; problems: string[] } {
  const o = obj(raw);
  const problems: string[] = [];
  const name = str(o.name).toLowerCase();
  if (!FLOW_NAME.test(name)) problems.push(`name: “${str(o.name)}” — lowercase letters, digits, - and _, parts joined by dots ("news.item").`);
  const input = (Array.isArray(o.input) ? o.input : []).map(normalizeField).filter((f): f is FieldSpec => !!f);
  const impl = obj(o.impl);
  const exprProblems = (v: unknown, where: string) => {
    if (typeof v === "string") for (const m of v.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      const bad = checkExpr(m[1]);
      if (bad) problems.push(`${where}: {{${m[1]}}} — ${bad}`);
    }
    else if (Array.isArray(v)) v.forEach((x, i) => exprProblems(x, `${where}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) exprProblems(x, `${where}.${k}`);
  };
  let built: CapImpl | null = null;
  if (typeof impl.command === "string" && impl.command.trim()) {
    if (!flowAction(impl.command.trim())) problems.push(`impl.command: there is no kernel operation “${impl.command}”.`);
    built = { command: impl.command.trim() };
  } else if (typeof impl.use === "string" && impl.use.trim()) {
    const use = impl.use.trim();
    if (use === name) problems.push("impl.use: a capability can't use itself.");
    else if (!PRIMITIVES[use] && !getCapability(use) && !flowAction(use)) problems.push(`impl.use: “${use}” is neither a primitive (${Object.keys(PRIMITIVES).join(", ")}), a capability nor a kernel operation.`);
    const mapped = impl.input === undefined ? undefined : obj(impl.input);
    if (mapped) exprProblems(mapped, "impl.input");
    if (impl.output !== undefined) exprProblems(impl.output, "impl.output");
    built = { use, ...(mapped ? { input: mapped } : {}), ...(impl.output !== undefined && impl.output !== null && impl.output !== "" ? { output: impl.output } : {}) };
  } else if (Array.isArray(impl.nodes)) {
    const nodes = normalizeNodes(impl.nodes);
    if (!nodes.length) problems.push("impl.nodes: no node I know — see the node kinds in docs/plugins/server-dsl.md.");
    walkNodes(nodes, (n) => {
      const where = `impl.nodes.${n.id}`;
      if (n.kind === "action") exprProblems(n.input, where);
      else if (n.kind === "set") exprProblems(n.vars, where);
      else if (n.kind === "return") exprProblems(n.value, where);
      else if (n.kind === "apply") exprProblems(n.args, where);
      else if (n.kind === "if" || n.kind === "while") exprProblems(`{{${n.when}}}`, where);
    });
    if (impl.output !== undefined) exprProblems(impl.output, "impl.output");
    built = { nodes, ...(impl.output !== undefined && impl.output !== null && impl.output !== "" ? { output: impl.output } : {}) };
  } else problems.push("impl: give `use` (a primitive or capability to wrap) or `nodes` (a small program).");
  if (problems.length || !built) return { cap: null, problems };
  return { cap: { name, label: str(o.label) || name, summary: str(o.summary), input, output: str(o.output) || "the result", impl: built, enabled: o.enabled !== false, ...(o.writes === true ? { writes: true } : {}), ...(str(o.class) ? { class: str(o.class) } : {}), ...(str(o.group) ? { group: str(o.group) } : {}) }, problems };
}

// (A row read a moment ago is read again only after 2 s or a save here — every action node asks for its row.)
const rowCache = ((globalThis as { __zeffCapRows?: Map<string, { at: number; cap: Capability | null }> }).__zeffCapRows ??= new Map());

/** A capability's row, switched off ones too (enabled: false). */
export function declaredRow(name: string): Capability | null {
  const hit = rowCache.get(name);
  if (hit && Date.now() - hit.at < 2000) return hit.cap;
  const r = db().prepare("select def, enabled from ws_capabilities where name = ?").get(name) as { def: string; enabled: number } | undefined;
  let cap: Capability | null = null;
  if (r) {
    try {
      cap = { ...(JSON.parse(r.def) as Capability), enabled: !!r.enabled };
    } catch {
      cap = null;
    }
  }
  rowCache.set(name, { at: Date.now(), cap });
  return cap;
}

export function getCapability(name: string): Capability | null {
  const c = declaredRow(name);
  return c && c.enabled ? c : null;
}

export function listCapabilities(): Capability[] {
  return (db().prepare("select name, def, enabled from ws_capabilities order by name").all() as { name: string; def: string; enabled: number }[]).flatMap((r) => {
    try {
      return [{ ...(JSON.parse(r.def) as Capability), enabled: !!r.enabled }];
    } catch {
      return [];
    }
  });
}

/** Saves a capability (checked: throws with every problem). */
export function saveCapability(raw: unknown): Capability {
  const { cap, problems } = normalizeCapability(raw);
  if (!cap) throw new Error(`The capability has problems:\n- ${problems.join("\n- ")}`);
  const d = db();
  const prev = d.prepare("select def from ws_capabilities where name = ?").get(cap.name) as { def: string } | undefined;
  if (!prev || prev.def !== JSON.stringify(cap)) {
    const v = ((d.prepare("select max(v) m from ws_capability_versions where name = ?").get(cap.name) as { m: number | null }).m ?? 0) + 1;
    d.prepare("insert into ws_capability_versions (name, v, def, at) values (?, ?, ?, ?)").run(cap.name, v, JSON.stringify(cap), new Date().toISOString());
  }
  rowCache.clear();
  db().prepare("insert into ws_capabilities (name, def, enabled, updated_at) values (?, ?, ?, ?) on conflict(name) do update set def = excluded.def, enabled = excluded.enabled, updated_at = excluded.updated_at").run(cap.name, JSON.stringify(cap), cap.enabled ? 1 : 0, new Date().toISOString());
  return cap;
}

/** Every saved state of a capability, newest first (the AI's edits and yours): restore any with restoreCapability. */
export function listCapabilityVersions(name: string): { version: number; at: string; def: Capability }[] {
  return (db().prepare("select v, at, def from ws_capability_versions where name = ? order by v desc").all(name) as { v: number; at: string; def: string }[]).map((r) => ({ version: r.v, at: r.at, def: JSON.parse(r.def) as Capability }));
}

/** An earlier state back (as a new version — nothing is lost). */
export function restoreCapability(name: string, version: number): Capability {
  const old = listCapabilityVersions(name).find((v) => v.version === version);
  if (!old) throw new Error(`The capability “${name}” has no version ${version}.`);
  return saveCapability(old.def);
}

/** Edits to a capability's program by node id (patch.ts), checked as a whole and saved as a new version. */
export function patchCapability(name: string, ops: NodePatch[]): Capability {
  const cur = getCapability(name);
  if (!cur) throw new Error(`There is no capability “${name}”.`);
  if (!("nodes" in cur.impl)) throw new Error(`“${name}” wraps a primitive (use) — it has no nodes to patch; save it whole.`);
  const { nodes, problems } = applyPatch(cur.impl.nodes, ops);
  if (problems.length) throw new Error(`The patch has problems:\n- ${problems.join("\n- ")}`);
  return saveCapability({ ...cur, impl: { ...cur.impl, nodes } });
}

export function deleteCapability(name: string): void {
  rowCache.clear();
  db().prepare("delete from ws_capabilities where name = ?").run(name);
}

// ---------------------------------------------------------------------------
// Running one
// ---------------------------------------------------------------------------

/** Whether what a capability is made of (down to the primitive) changes something. */
function changes(use: string, seen = new Set<string>()): boolean {
  if (PRIMITIVES[use]) return !!PRIMITIVES[use].writes;
  if (seen.has(use)) return false;
  seen.add(use);
  const c = getCapability(use);
  if (!c) return false;
  if ("command" in c.impl) return !!c.writes || !!flowAction(c.impl.command)?.writes;
  if ("use" in c.impl) return changes(c.impl.use, seen);
  let w = false;
  walkNodes(c.impl.nodes, (n) => {
    if (n.kind === "action" && (PRIMITIVES[n.action.replace(/^core./, "")]?.writes || flowAction(n.action)?.writes || (n.action !== use && getCapability(n.action) && changes(n.action, seen)))) w = true;
  });
  return w;
}

const MAX_USE_DEPTH = 6;

async function runUse(use: string, input: Record<string, unknown>, ctx: ActionCtx, run: NodesRunner, depth: number): Promise<unknown> {
  if (depth > MAX_USE_DEPTH) throw new Error("Capabilities use each other too deep (a loop?).");
  const p = PRIMITIVES[use];
  if (p) {
    for (const f of p.input) if (f.required && (input[f.name] === undefined || input[f.name] === null || input[f.name] === "")) throw new Error(`${use} needs “${f.name}”.`);
    return p.run(input, ctx);
  }
  const c = getCapability(use);
  if (!c) {
    // (a kernel operation that no row declares yet: still callable as a wrapper's target)
    const k = flowAction(use);
    if (k && declaredRow(use)?.enabled === false) throw new Error(`The action “${use}” is switched off.`);
    if (k) return k.run(input, ctx);
    throw new Error(`There is no capability “${use}”.`);
  }
  return runCapability(c, input, ctx, run, depth + 1);
}

/** Runs a `nodes` capability's program: the engine's own (it owns the journal, the log and the limits). */
export type NodesRunner = (cap: Capability & { impl: { nodes: FlowNode[]; output?: Expr } }, input: Record<string, unknown>) => Promise<unknown>;

async function runCapability(cap: Capability, input: Record<string, unknown>, ctx: ActionCtx, run: NodesRunner, depth = 0): Promise<unknown> {
  if ("command" in cap.impl) {
    const a = flowAction(cap.impl.command);
    if (!a) throw new Error(`The kernel operation “${cap.impl.command}” is declared but its code is gone.`);
    return a.run(input, ctx);
  }
  if ("nodes" in cap.impl) return run(cap as Capability & { impl: { nodes: FlowNode[]; output?: Expr } }, input);
  const args = cap.impl.input ? (fill(cap.impl.input, { input }) as Record<string, unknown>) : input;
  const result = await runUse(cap.impl.use, args, ctx, run, depth);
  return cap.impl.output !== undefined ? fill(cap.impl.output, { input, result }) : result;
}

/**
 * The action a flow's node calls by this name — the DATABASE's declaration is what the engine goes by: a kernel action with a row
 * (declare.ts) gets that row's label, summary, input and output (its required inputs are checked from the row; the AI or you may have
 * edited it) and can be switched off there (enabled: false); the code is only the handler. A row never makes an action weaker than
 * its code: it writes if either says so. Without a row: the code as it is. Then the closed primitives (core.*), then capabilities.
 */
export function resolveAction(name: string, run: NodesRunner): FlowAction | undefined {
  const code = flowAction(name);
  if (code) {
    const row = declaredRow(name);
    if (!row || !("command" in row.impl)) return code;
    if (!row.enabled) throw new Error(`The action “${name}” is switched off (its row in the capabilities has enabled: false).`);
    return { ...code, label: row.label || code.label, summary: row.summary || code.summary, input: row.input, output: row.output || code.output, writes: code.writes || row.writes ? true : undefined };
  }
  return primitiveAction(name) ?? capabilityAction(name, run) ?? undefined;
}

/** A primitive as an action a flow's node can call directly, under the prefix core. (“core.sql.query”) — it never shadows an older kernel action of the same name. */
export function primitiveAction(name: string): FlowAction | null {
  const p = name.startsWith("core.") ? PRIMITIVES[name.slice(5)] : undefined;
  return p ? { name, group: "core", label: p.name, summary: p.summary, input: p.input, output: p.output, ...(p.writes ? { writes: true } : {}), run: p.run } : null;
}

/** A capability as an action the engine can run (its schema checked, a dry run says what it would do). */
export function capabilityAction(name: string, run: NodesRunner): FlowAction | null {
  const cap = getCapability(name);
  if (!cap) return null;
  return {
    name: cap.name,
    group: "capability",
    label: cap.label,
    summary: cap.summary,
    input: cap.input,
    output: cap.output,
    writes: changes(cap.name),
    run: (input, ctx) => runCapability(cap, input, ctx, run),
  };
}
