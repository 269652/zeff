import { checkedUrl, type ActionCtx } from "./actions";
import { isPackageRef, packagePage } from "../package-refs";
import { fill, holds, evalExpr, text, type Scope } from "./expr";
import { runScript } from "./sandbox";
import { askUser, answerAsk, cancelAsk, expireAsks, type Ask } from "../asks";
import { dueRuns, flowByName, getFlowRun, grantWrite, listFlows, saveFlowRun, secretValues, startFlowRun, type Flow, type FlowRun, type Journal, type LogEntry, type Waiting, cutOffRuns, keepRunProgress } from "./store";
import { walkNodes, type FieldSpec, type FlowDef, type FlowNode, type FlowPermissions, type FlowTrigger } from "./types";
import { resolveAction, type Capability } from "./capabilities";
import { ensureDeclared } from "./declare";
import { asFlow, currentFlow } from "../events";

/**
 * The flow engine. A run goes through the nodes in order; what a node gives is `steps.<id>` for the ones after it. What reaches
 * outside or costs (an action, a script, a sub-flow's nodes, an approval, a wait) is written into the run's journal: a run that
 * waits (for your approval, for a time) is taken up again from its start, and every node already done gives its journaled output
 * instead of running again — so nothing is fetched, written or asked twice. Every node is logged (its input, its output, how long
 * it took) — the Studio's run console. Server only.
 */

class Suspend extends Error {
  constructor(readonly waiting: Waiting) {
    super("waiting");
  }
}
class Return extends Error {
  constructor(readonly value: unknown) {
    super("return");
  }
}
class Failed extends Error {}

export type RunOptions = {
  trigger?: unknown;
  /** A dry run: what writes or sends is not done (its log says what would be); reading, searching, the AI run. */
  dry?: boolean;
  /** The row the run is about (a button in a row, a row event): `row` in its expressions. */
  row?: number;
  /** For tests: what a node of the web resolves to. */
  resolve?: (host: string) => Promise<string[]>;
};

export type RunResult = { runId: number; status: FlowRun["status"]; output: unknown; error: string | null; waiting: Waiting | null };

type Ctx = {
  runId: number;
  flow: string;
  perms: FlowPermissions;
  dry: boolean;
  journal: Journal;
  log: LogEntry[];
  steps: Record<string, unknown>;
  vars: Record<string, unknown>;
  base: Scope;
  count: { n: number; max: number };
  secrets: Record<string, string>;
  depth: number;
  resolve?: RunOptions["resolve"];
  /** The user functions of the flow (fn nodes, by name) and how deep they call each other. */
  fns: Record<string, Extract<FlowNode, { kind: "fn" }>>;
  fnDepth: number;
  /** When the run's time is up (permissions.runTimeoutMs, from this start or resume), checked between nodes. */
  deadline?: number;
  /** Inside a tx node: its nodes' journal is a scratch one (the tx is one journal entry). */
  inTx?: boolean;
};

/** Transactions on the one connection never overlap: a tx waits for the one before it. */
const txQueue = ((globalThis as { __zeffTxQueue?: { p: Promise<unknown> } }).__zeffTxQueue ??= { p: Promise.resolve() });
const TX_KINDS = new Set(["set", "if", "switch", "foreach", "while", "try", "fn", "apply", "return", "fail", "action"]);
/** What may not be inside a tx (it would wait, or reach outside, with the transaction open): null when fine. */
export function txForbidden(nodes: FlowNode[]): string | null {
  let bad: string | null = null;
  walkNodes(nodes, (n) => {
    if (bad) return;
    if (!TX_KINDS.has(n.kind)) bad = `${n.id}: a ${n.kind} node can't be inside a tx (it waits or reaches outside while the transaction is open)`;
    else if (n.kind === "action" && !n.action.startsWith("core.")) bad = `${n.id}: only core.* actions (sql, pref, clock, log) can be inside a tx — not “${n.action}”`;
  });
  return bad;
}

const MAX_FN_DEPTH = 20;
const fnsOf = (nodes: FlowNode[]): Ctx["fns"] => {
  const out: Ctx["fns"] = {};
  walkNodes(nodes, (n) => {
    if (n.kind === "fn") out[n.name] = n;
  });
  return out;
};

const MAX_LOG_VALUE = 4000;

/** A value as the log keeps it: secrets hidden, long texts and big objects cut. */
function forLog(v: unknown, secrets: Record<string, string>): unknown {
  if (v === undefined) return undefined;
  let s: string;
  try {
    s = JSON.stringify(v) ?? "null";
  } catch {
    s = String(v);
  }
  for (const value of Object.values(secrets)) if (value.length >= 4) s = s.split(value).join("•••");
  if (s.length > MAX_LOG_VALUE) return `${s.slice(0, MAX_LOG_VALUE)}… (${s.length} characters)`;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** A run's output never carries a secret: its value is •••. */
function hideSecrets(v: unknown, secrets: Record<string, string>): unknown {
  const values = Object.values(secrets).filter((s) => s.length >= 4);
  if (!values.length || v === undefined || v === null) return v ?? null;
  const s = JSON.stringify(v);
  if (!values.some((x) => s.includes(x))) return v;
  return JSON.parse(values.reduce((acc, x) => acc.split(JSON.stringify(x).slice(1, -1)).join("•••"), s));
}

const scopeOf = (ctx: Ctx, extra: Scope = {}): Scope => ({ ...ctx.base, steps: ctx.steps, vars: ctx.vars, secrets: ctx.secrets, ...extra });

function logNode(ctx: Ctx, n: FlowNode, key: string, depth: number, e: Partial<LogEntry> & { status: LogEntry["status"]; ms: number }) {
  ctx.log.push({ key, node: n.id, kind: n.kind, ...(n.label ? { label: n.label } : {}), ...(n.kind === "action" ? { action: n.action } : {}), depth, at: new Date().toISOString(), ...e, input: forLog(e.input, ctx.secrets), output: forLog(e.output, ctx.secrets), ...(e.error ? { error: String(forLog(e.error, ctx.secrets)) } : {}) });
  if (ctx.log.length > 2000) ctx.log.splice(0, ctx.log.length - 2000);
}

function actionCtx(ctx: Ctx, logs: string[]): ActionCtx {
  return {
    flow: ctx.flow,
    runId: ctx.runId,
    dryRun: ctx.dry,
    perms: ctx.perms,
    web: (url) => checkedUrl(url, ctx.perms, ctx.resolve),
    canWrite: (dbId) => {
      const w = ctx.perms.write;
      // (a package's flow names its own databases by their place in it — "@agenda-ext.i3" — whatever ids they got when it was installed)
      const mine = (x: number | string) => x === dbId || (isPackageRef(x) && packagePage(x) === dbId);
      if (!(w === "all" || (Array.isArray(w) && w.some(mine)))) throw new Error(`This flow may not write the database ${dbId} — grant it under the flow's permissions (write).`);
    },
    may: (need) => {
      if (!ctx.perms[need]) throw new Error(`This flow may not ${need === "ai" ? "use the AI" : need === "send" ? "send anything out" : need === "create" ? "make databases" : "call that plugin method"} — grant it under the flow's permissions (${need}).`);
    },
    grantWrite: (dbId) => {
      const w = ctx.perms.write;
      if (w !== "all") ctx.perms = { ...ctx.perms, write: [...(Array.isArray(w) ? w : []), dbId] };
      grantWrite(ctx.flow, dbId);
    },
    log: (line) => logs.length < 200 && logs.push(line),
  };
}

/** A node's output, journaled: taken from the journal when the run is taken up again. */
async function journaled(ctx: Ctx, key: string, fn: () => Promise<unknown>): Promise<{ output: unknown; replayed: boolean }> {
  if (key in ctx.journal) return { output: ctx.journal[key].output, replayed: true };
  const output = await fn();
  ctx.journal[key] = { output: output === undefined ? null : output, at: new Date().toISOString() };
  // (kept at once: a run cut off after this step goes on after it — resumeCutOffRuns)
  if (!ctx.dry && !ctx.inTx) keepRunProgress(ctx.runId, ctx.journal, ctx.log);
  return { output, replayed: false };
}

async function runNodes(nodes: FlowNode[], ctx: Ctx, prefix: string, depth: number, extra: Scope = {}): Promise<unknown> {
  let last: unknown = null;
  for (const n of nodes) {
    last = await runNode(n, ctx, prefix, depth, extra);
    ctx.steps[n.id] = last;
  }
  return last;
}

async function runNode(n: FlowNode, ctx: Ctx, prefix: string, depth: number, extra: Scope): Promise<unknown> {
  if (++ctx.count.n > ctx.count.max) throw new Failed(`The flow took more than ${ctx.count.max} steps (a loop?) — raise maxSteps in its permissions if it is meant.`);
  if (ctx.deadline && Date.now() > ctx.deadline) throw new Failed(`The run took longer than ${ctx.perms.runTimeoutMs} ms (its permissions' runTimeoutMs) — stopped before “${n.label || n.id}”.`);
  const key = `${prefix}${n.id}`;
  const scope = () => scopeOf(ctx, extra);
  const t0 = Date.now();
  switch (n.kind) {
    case "set": {
      const vals = fill(n.vars, scope()) as Record<string, unknown>;
      Object.assign(ctx.vars, vals);
      logNode(ctx, n, key, depth, { status: "ok", ms: Date.now() - t0, output: vals });
      return vals;
    }
    case "if": {
      const yes = holds(n.when, scope());
      logNode(ctx, n, key, depth, { status: "ok", ms: 0, output: { branch: yes ? "then" : "else" } });
      return runNodes(yes ? n.then : n.else, ctx, prefix, depth + 1, extra);
    }
    case "switch": {
      const v = text(evalExpr(n.on, scope()));
      const hit = n.cases.find((c) => c.value === v);
      logNode(ctx, n, key, depth, { status: "ok", ms: 0, output: { value: v, case: hit ? hit.value : "default" } });
      return runNodes(hit ? hit.nodes : n.default, ctx, prefix, depth + 1, extra);
    }
    case "foreach": {
      const raw = evalExpr(n.items.replace(/^\{\{([\s\S]*)\}\}$/, "$1"), scope());
      const items = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.entries(raw).map(([k, v]) => ({ key: k, value: v })) : raw === null || raw === undefined ? [] : [raw];
      const max = n.max ?? 500;
      logNode(ctx, n, key, depth, { status: "ok", ms: 0, output: { items: items.length, ...(items.length > max ? { only: max } : {}) } });
      const out: unknown[] = [];
      for (const [index, item] of items.slice(0, max).entries()) out.push(await runNodes(n.nodes, ctx, `${key}#${index}/`, depth + 1, { ...extra, item, index, ...(n.as ? { [n.as]: item } : {}) }));
      return out;
    }
    case "parallel": {
      logNode(ctx, n, key, depth, { status: "ok", ms: 0, output: { branches: n.branches.length } });
      return Promise.all(n.branches.map((b, i) => runNodes(b, ctx, `${key}|${i}/`, depth + 1, extra)));
    }
    case "try": {
      let waiting = false;
      try {
        try {
          return await runNodes(n.nodes, ctx, `${key}/`, depth + 1, extra);
        } catch (e) {
          if (e instanceof Suspend || e instanceof Return) throw e;
          const message = e instanceof Error ? e.message : String(e);
          logNode(ctx, n, key, depth, { status: "ok", ms: 0, output: { caught: message } });
          return await runNodes(n.catch, ctx, `${key}!/`, depth + 1, { ...extra, error: { message } });
        }
      } catch (e) {
        if (e instanceof Suspend) waiting = true;
        throw e;
      } finally {
        // (a run that waits is taken up again from its start: its finally nodes run when it ends, not while it waits)
        if (n.finally?.length && !waiting) await runNodes(n.finally, ctx, `${key}~/`, depth + 1, extra);
      }
    }
    case "fn":
      // (defined before the run starts — see fnsOf)
      return null;
    case "tx": {
      if (ctx.inTx) throw new Failed(`${n.label || n.id}: a tx can't be inside another tx.`);
      const no = txForbidden(n.nodes);
      if (no) throw new Failed(`${n.label || n.id}: ${no}`);
      if (ctx.dry) {
        logNode(ctx, n, key, depth, { status: "dry", ms: 0, output: { dryRun: true } });
        return { dryRun: true };
      }
      const r = await journaled(ctx, key, async () => {
        const { getSqlite } = await import("@/db");
        await import("@/lib/prefs");
        const turn = txQueue.p;
        let release!: () => void;
        txQueue.p = new Promise<void>((res) => (release = res));
        await turn;
        const sq = getSqlite();
        sq.exec("begin immediate");
        try {
          const inner: Ctx = { ...ctx, journal: {}, inTx: true };
          let out: unknown;
          try {
            out = await runNodes(n.nodes, inner, `${key}/`, depth + 1, extra);
          } catch (e) {
            if (!(e instanceof Return)) throw e;
            // (a return inside commits what was done, then leaves)
            sq.exec("commit");
            throw e;
          }
          sq.exec("commit");
          return out;
        } catch (e) {
          if (sq.inTransaction) sq.exec("rollback");
          throw e;
        } finally {
          release();
        }
      });
      logNode(ctx, n, key, depth, { status: "ok", ms: Date.now() - t0, output: { committed: true } });
      return r.output;
    }
    case "apply": {
      const fn = ctx.fns[n.fn];
      if (!fn) throw new Failed(`${n.label || n.id}: there is no function “${n.fn}” in this flow (known: ${Object.keys(ctx.fns).join(", ") || "none"}).`);
      if (ctx.fnDepth >= MAX_FN_DEPTH) throw new Failed(`${n.label || n.id}: functions call each other more than ${MAX_FN_DEPTH} deep (endless recursion?).`);
      const args = fill(n.args, scope()) as Record<string, unknown>;
      for (const k of Object.keys(args)) if (!fn.params.includes(k)) throw new Failed(`${n.label || n.id}: ${fn.name} has no parameter “${k}” (it has: ${fn.params.join(", ") || "none"}).`);
      const vars = Object.fromEntries(fn.params.map((p) => [p, args[p] ?? null]));
      logNode(ctx, n, key, depth, { status: "ok", ms: 0, input: args, output: { fn: fn.name } });
      const child: Ctx = { ...ctx, steps: {}, vars, fnDepth: ctx.fnDepth + 1 };
      try {
        const last = await runNodes(fn.nodes, child, `${key}()/`, depth + 1);
        return fn.output !== undefined ? fill(fn.output, scopeOf(child)) : last;
      } catch (e) {
        if (e instanceof Return) return e.value;
        throw e;
      }
    }
    case "while": {
      const max = n.max ?? 200;
      const out: unknown[] = [];
      let round = 0;
      for (; round < max && holds(n.when, scope()); round++) out.push(await runNodes(n.nodes, ctx, `${key}#${round}/`, depth + 1, { ...extra, index: round }));
      if (round >= max && holds(n.when, scope())) throw new Failed(`${n.label || n.id}: still going after ${max} rounds (an endless loop?) — raise max if it is meant.`);
      logNode(ctx, n, key, depth, { status: "ok", ms: 0, output: { rounds: round } });
      return out;
    }
    case "return":
      throw new Return(fill(n.value, scope()));
    case "fail":
      throw new Failed(text(fill(n.message, scope())));
    case "action": {
      // (the kernel's actions first; then the closed primitives as core.*; then the capabilities declared in the database)
      let def;
      try {
        ensureDeclared();
        def = resolveAction(n.action, (cap, capInput) => runCapabilityNodes(cap, capInput, ctx, key, depth));
      } catch (e) {
        throw new Failed(`${n.label || n.id}: ${e instanceof Error ? e.message : e}`);
      }
      if (!def) throw new Failed(`There is no action “${n.action}”.`);
      const input = fill(n.input, scope()) as Record<string, unknown>;
      for (const fld of def.input) if (fld.required && (input[fld.name] === undefined || input[fld.name] === null || input[fld.name] === "")) throw new Failed(`${n.label || n.id}: ${def.label} needs “${fld.name}”.`);
      if (ctx.dry && def.writes) {
        logNode(ctx, n, key, depth, { status: "dry", ms: 0, input, output: { dryRun: true } });
        return { dryRun: true, would: def.label, input };
      }
      const logs: string[] = [];
      let attempt = 0;
      for (;;) {
        try {
          const r = await journaled(ctx, key, async () => def.run(input, actionCtx(ctx, logs)));
          if (!r.replayed) logNode(ctx, n, key, depth, { status: "ok", ms: Date.now() - t0, input, output: r.output, ...(logs.length ? { logs } : {}) });
          return r.output;
        } catch (e) {
          if (attempt++ < (n.retry ?? 0)) {
            await new Promise((res) => setTimeout(res, Math.min(8000, 500 * 2 ** attempt)));
            continue;
          }
          const message = e instanceof Error ? e.message : String(e);
          logNode(ctx, n, key, depth, { status: "failed", ms: Date.now() - t0, input, error: message, ...(logs.length ? { logs } : {}) });
          if (n.onError === "continue") return { error: message };
          throw new Failed(`${n.label || n.id} (${def.label}): ${message}`);
        }
      }
    }
    case "script": {
      const input = fill(n.input ?? {}, scope());
      const r = await journaled(ctx, key, async () => {
        const res = await runScript(n.code, { input, steps: ctx.steps, vars: ctx.vars, item: extra.item ?? null, index: extra.index ?? null, flowInput: ctx.base.input ?? {}, row: ctx.base.row ?? null, env: ctx.base.env ?? {} });
        if (!res.ok) {
          logNode(ctx, n, key, depth, { status: "failed", ms: res.ms, input, error: res.error, logs: res.logs });
          throw new Failed(`${n.label || n.id} (script): ${res.error}`);
        }
        logNode(ctx, n, key, depth, { status: "ok", ms: res.ms, input, output: res.value, ...(res.logs.length ? { logs: res.logs } : {}) });
        return res.value;
      });
      return r.output;
    }
    case "call": {
      if (ctx.depth >= 5) throw new Failed("Flows call each other too deep (a loop?).");
      const sub = flowByName(n.flow);
      if (!sub) throw new Failed(`There is no flow “${n.flow}”.`);
      const input = withDefaults(sub.inputs, fill(n.input, scope()) as Record<string, unknown>);
      logNode(ctx, n, key, depth, { status: "ok", ms: 0, input, output: { flow: sub.name } });
      const child: Ctx = { ...ctx, flow: sub.name, perms: sub.permissions, steps: {}, vars: {}, base: { ...ctx.base, input }, depth: ctx.depth + 1, count: ctx.count, fns: fnsOf(sub.nodes), fnDepth: 0 };
      try {
        const last = await runNodes(sub.nodes, child, `${key}>`, depth + 1);
        return sub.output !== undefined ? fill(sub.output, scopeOf(child)) : last;
      } catch (e) {
        if (e instanceof Return) return e.value;
        throw e;
      }
    }
    case "approve": {
      if (key in ctx.journal) return ctx.journal[key].output;
      const title = text(fill(n.title, scope()));
      const body = n.text ? text(fill(n.text, scope())) : undefined;
      if (ctx.dry) {
        logNode(ctx, n, key, depth, { status: "dry", ms: 0, output: { choice: n.options?.[0] ?? "yes" } });
        return { choice: n.options?.[0] ?? "yes", dryRun: true };
      }
      logNode(ctx, n, key, depth, { status: "waiting", ms: 0, output: { title } });
      const options = n.options?.length ? n.options : ["yes", "no"];
      // (An approval is a question with a choice — and a note, if you like.)
      throw new Suspend({ key, kind: "approve", title, ...(body ? { text: body } : {}), options, fields: [{ name: "choice", kind: "choice", options, required: true }, { name: "note", kind: "text" }] });
    }
    case "ask": {
      if (key in ctx.journal) return ctx.journal[key].output;
      const title = text(fill(n.title, scope()));
      const body = n.text ? text(fill(n.text, scope())) : undefined;
      if (ctx.dry) {
        const sample = Object.fromEntries(n.fields.map((f) => [f.name, f.kind === "scale" || f.kind === "number" ? (f.min ?? 1) : f.kind === "choice" ? (f.options?.[0] ?? "") : f.kind === "yesno" ? true : ""]));
        logNode(ctx, n, key, depth, { status: "dry", ms: 0, output: sample });
        return { ...sample, dryRun: true };
      }
      logNode(ctx, n, key, depth, { status: "waiting", ms: 0, output: { title } });
      throw new Suspend({ key, kind: "ask", title, ...(body ? { text: body } : {}), fields: n.fields, ...(n.expiresMinutes ? { expiresMinutes: n.expiresMinutes } : {}) });
    }
    case "wait": {
      const entry = ctx.journal[key];
      if (entry && entry.until && Date.now() >= Date.parse(entry.until)) {
        if (entry.output === null) {
          ctx.journal[key] = { ...entry, output: { waited: true, until: entry.until } };
          logNode(ctx, n, key, depth, { status: "ok", ms: 0, output: { waited: true } });
        }
        return ctx.journal[key].output;
      }
      const until = entry?.until ?? (n.until ? new Date(text(evalExpr(n.until.replace(/^\{\{([\s\S]*)\}\}$/, "$1"), scope()))).toISOString() : new Date(Date.now() + (n.minutes ?? 1) * 60000).toISOString());
      if (Number.isNaN(Date.parse(until))) throw new Failed(`${n.label || n.id}: “${n.until}” gives no time to wait for.`);
      if (Date.now() >= Date.parse(until) || ctx.dry) return { waited: false, until };
      if (!entry) {
        ctx.journal[key] = { output: null, at: new Date().toISOString(), until };
        logNode(ctx, n, key, depth, { status: "waiting", ms: 0, output: { until } });
      }
      throw new Suspend({ key, kind: "wait", until });
    }
  }
}

/** A capability made of nodes: its program runs as a sub-run with the caller's grants, its input as `input` (as a call node does with a flow). */
async function runCapabilityNodes(cap: Capability & { impl: { nodes: FlowNode[]; output?: unknown } }, input: Record<string, unknown>, ctx: Ctx, key: string, depth: number): Promise<unknown> {
  if (ctx.depth >= 5) throw new Failed("Capabilities call each other too deep (a loop?).");
  const child: Ctx = { ...ctx, steps: {}, vars: {}, base: { ...ctx.base, input }, depth: ctx.depth + 1, fns: fnsOf(cap.impl.nodes), fnDepth: 0 };
  try {
    const last = await runNodes(cap.impl.nodes, child, `${key}@`, depth + 1);
    return cap.impl.output !== undefined ? fill(cap.impl.output, scopeOf(child)) : last;
  } catch (e) {
    if (e instanceof Return) return e.value;
    throw e;
  }
}

/** An input with its fields' defaults, the required ones checked, numbers and true/false made so. */
export function withDefaults(fields: FieldSpec[], given: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...given };
  for (const f of fields) {
    let v = out[f.name];
    if ((v === undefined || v === null || v === "") && f.default !== undefined) v = f.default;
    if ((v === undefined || v === null || v === "") && f.required) throw new Error(`The input “${f.label || f.name}” is required.`);
    if (f.type === "number" && typeof v === "string" && v.trim()) v = Number(v.replace(",", "."));
    if (f.type === "boolean" && typeof v === "string") v = v === "true" || v === "yes" || v === "1";
    if ((f.type === "json" || f.type === "list") && typeof v === "string" && /^\s*[[{]/.test(v)) {
      try {
        v = JSON.parse(v);
      } catch {
        // stays text
      }
    }
    if (f.type === "list" && typeof v === "string") v = v.split(",").map((x) => x.trim()).filter(Boolean);
    if (v !== undefined) out[f.name] = v;
  }
  return out;
}

async function rowScope(rowId: number | undefined): Promise<Scope> {
  if (!rowId) return {};
  const { getPage, rowsOf } = await import("../store");
  const page = getPage(rowId);
  if (!page?.dbId) return {};
  const d = rowsOf(page.dbId);
  const row = d?.rows.find((r) => r.id === rowId);
  if (!d || !row) return {};
  const { rowObject } = await import("./actions");
  return { row: { ...rowObject(d.schema, row), database: page.dbId } };
}

/**
 * Goes through a run's nodes (from the start, its journal skipping what is done) and keeps where it ended. What it writes sets no
 * routine or flow off (quietly, as a routine's own changes): a flow that wants to start others sends a signal.
 */
/** The runs going on in this process (across its module copies): never taken up again as cut off while they still run here. */
const liveRuns = ((globalThis as { __zeffLiveFlowRuns?: Set<number> }).__zeffLiveFlowRuns ??= new Set<number>());

async function execute(...args: Parameters<typeof executeLoud>): Promise<RunResult> {
  const { quietly } = await import("../events");
  liveRuns.add(args[0]);
  try {
    return await quietly(() => executeLoud(...args));
  } finally {
    liveRuns.delete(args[0]);
  }
}

async function executeLoud(runId: number, def: FlowDef, input: Record<string, unknown>, journal: Journal, log: LogEntry[], opts: { dry: boolean; row?: number; trigger?: unknown; resolve?: RunOptions["resolve"] }): Promise<RunResult> {
  const now = new Date();
  const local = `${now.toLocaleDateString("sv-SE")}T${now.toTimeString().slice(0, 5)}`;
  // (The clock as the run began, kept in its journal: a run taken up again sees the same env.now / today / hour — replays are deterministic.)
  const frozen = journal.__env?.output as Record<string, unknown> | undefined;
  const env = frozen ?? { now: now.toISOString(), local, hour: now.getHours(), weekday: now.getDay(), today: now.toLocaleDateString("sv-SE"), flow: def.name, run: runId, trigger: opts.trigger ?? { kind: "manual" } };
  if (!frozen) journal.__env = { output: env, at: now.toISOString() };
  const base: Scope = { input, env, ...(await rowScope(opts.row)) };
  const ctx: Ctx = { runId, flow: def.name, perms: def.permissions, dry: opts.dry, journal, log, steps: {}, vars: {}, base, count: { n: 0, max: def.permissions.maxSteps ?? 500 }, secrets: secretValues(), depth: 0, resolve: opts.resolve, fns: fnsOf(def.nodes), fnDepth: 0, ...(def.permissions.runTimeoutMs ? { deadline: Date.now() + def.permissions.runTimeoutMs } : {}) };
  try {
    let output: unknown;
    try {
      const last = await runNodes(def.nodes, ctx, "", 0);
      output = def.output !== undefined ? fill(def.output, scopeOf(ctx)) : last;
    } catch (e) {
      if (!(e instanceof Return)) throw e;
      output = e.value;
    }
    output = hideSecrets(output, ctx.secrets);
    saveFlowRun(runId, { status: "done", journal, log, output, waiting: null, wakeAt: null });
    return { runId, status: "done", output, error: null, waiting: null };
  } catch (e) {
    if (e instanceof Suspend) {
      let waiting = e.waiting;
      if (waiting.kind === "ask" || waiting.kind === "approve") {
        // The question goes where all questions to you are (asks.ts): the card shows it; asked again, it replaces the one still open.
        saveFlowRun(runId, { status: "waiting", journal, log, waiting, wakeAt: null });
        const pageId = getFlowRun(runId)?.pageId ?? 0;
        const ask = await askUser({ title: waiting.title ?? "?", text: waiting.text, fields: waiting.fields ?? [], source: { kind: "flow", runId }, from: def.title || def.name, replaceKey: `flow:${pageId}:${waiting.key}`, expiresMinutes: waiting.expiresMinutes });
        waiting = { ...waiting, askId: ask.id };
      }
      saveFlowRun(runId, { status: "waiting", journal, log, waiting, wakeAt: waiting.kind === "wait" ? (waiting.until ?? null) : null });
      return { runId, status: "waiting", output: null, error: null, waiting };
    }
    const error = String(forLog(e instanceof Error ? e.message : String(e), ctx.secrets));
    saveFlowRun(runId, { status: "failed", journal, log, error, waiting: null, wakeAt: null });
    return { runId, status: "failed", output: null, error, waiting: null };
  }
}

/** A flow run with this input (its defaults filled in, the required ones checked). */
export async function runFlow(flow: Flow | string, input: Record<string, unknown> = {}, opts: RunOptions = {}): Promise<RunResult> {
  const f = typeof flow === "string" ? flowByName(flow) : flow;
  if (!f) throw new Error(`There is no flow “${String(flow)}”.`);
  // Safe mode (lib/kernel/safe-mode.ts): nothing starts by itself — a flow by clock or event waits; one you start runs.
  const kind = (opts.trigger as { kind?: string } | undefined)?.kind;
  if ((kind === "schedule" || kind === "event") && (await import("@/lib/kernel/safe-mode")).safeMode()) throw new Error(`Safe mode: the flow “${f.name}” doesn't start by itself.`);
  const def: FlowDef = { name: f.name, title: f.title, inputs: f.inputs, nodes: f.nodes, output: f.output, permissions: f.permissions, triggers: f.triggers, lookup: f.lookup, ...(f.sync ? { sync: f.sync } : {}) };
  const full = withDefaults(f.inputs, input);
  const runId = startFlowRun({ pageId: f.pageId, name: f.name, def }, opts.trigger ?? { kind: "manual" }, { ...full, ...(opts.row ? { __row: opts.row } : {}) }, !!opts.dry);
  // (As this flow: what it changes never starts it again — events.ts.)
  return asFlow(f.name, () => execute(runId, def, full, {}, [], { dry: !!opts.dry, row: opts.row, trigger: opts.trigger, resolve: opts.resolve }));
}

/** A run that waits at a question goes on with its answers (they are kept as that step's output). */
async function continueRun(runId: number, output: Record<string, unknown>, opts: Pick<RunOptions, "resolve"> = {}): Promise<RunResult> {
  const run = getFlowRun(runId);
  if (!run || run.status !== "waiting" || !run.waiting) throw new Error("This run doesn't wait.");
  run.journal[run.waiting.key] = { output, at: new Date().toISOString() };
  run.log.push({ key: run.waiting.key, node: run.waiting.key.split("/").pop()!, kind: run.waiting.kind, status: "ok", ms: 0, output, at: new Date().toISOString(), depth: 0 });
  saveFlowRun(runId, { status: "running", journal: run.journal, log: run.log, waiting: null, wakeAt: null });
  const { __row, ...input } = run.input as Record<string, unknown> & { __row?: number };
  return execute(runId, run.def, input, run.journal, run.log, { dry: run.dry, row: typeof __row === "number" ? __row : undefined, trigger: run.trigger, resolve: opts.resolve });
}

/** A flow's question ended (asks.ts calls it): answered, its run goes on; lapsed or replaced, the run ends. */
export async function flowAskEnded(ask: Ask): Promise<void> {
  if (ask.source.kind !== "flow") return;
  const run = getFlowRun(ask.source.runId);
  if (!run || run.status !== "waiting" || run.waiting?.askId !== ask.id) return;
  if (ask.status === "answered" && ask.answers) await continueRun(run.id, ask.answers);
  else saveFlowRun(run.id, { status: "cancelled", journal: run.journal, log: run.log, error: ask.status === "expired" ? "no answer in time" : "replaced by a newer question, or stopped", waiting: null, wakeAt: null });
}

/** A run that waits for you goes on: its question answered (an approval: its choice and a note). */
export async function resumeFlowRun(runId: number, decision: { choice?: string; note?: string; answers?: Record<string, unknown> }, opts: Pick<RunOptions, "resolve"> = {}): Promise<RunResult> {
  const run = getFlowRun(runId);
  if (!run) throw new Error("There is no such run.");
  if (run.status !== "waiting" || !run.waiting) throw new Error("This run doesn't wait.");
  if (!run.waiting.askId) return continueRun(runId, { ...(decision.answers ?? {}), at: new Date().toISOString() }, opts);
  const answers = decision.answers ?? { choice: decision.choice ?? "", ...(decision.note ? { note: decision.note } : {}) };
  if (run.waiting.kind === "approve" && run.waiting.options?.length && !run.waiting.options.includes(String(answers.choice ?? ""))) throw new Error(`Choose one of ${run.waiting.options.join(", ")}.`);
  await answerAsk(run.waiting.askId, answers);
  const after = getFlowRun(runId)!;
  return { runId, status: after.status, output: after.output, error: after.error, waiting: after.waiting };
}

/** A waiting run stopped. */
export function cancelFlowRun(runId: number): void {
  const run = getFlowRun(runId);
  if (!run || (run.status !== "waiting" && run.status !== "running")) throw new Error("This run is over already.");
  saveFlowRun(runId, { status: "cancelled", journal: run.journal, log: run.log, error: "cancelled", waiting: null, wakeAt: null });
  if (run.waiting?.askId) void cancelAsk(run.waiting.askId);
}

/** How long a run "running" may stay without a sign of life before it counts as cut off (longer than any one step may take). */
export const CUT_OFF_MS = 15 * 60_000;
/** A run cut off this often isn't taken up again (it may be what stops Zeff): it fails, with why. */
export const MAX_RESUMES = 2;
/** A run cut off longer ago than this isn't taken up again (what it read is stale by now): it fails, with why. */
export const MAX_CUT_OFF_AGE_MS = 48 * 3600_000;
/** A run going on without a sign of life this long hangs: it is ended (its place freed — the queue goes on), whatever it waits for. */
export const HANG_MS = 60 * 60_000;
/** At most this many runs taken up again at once — the clock never waits for them, so one that hangs holds up nothing else. */
const MAX_RESUMING = 3;
const resuming = ((globalThis as { __zeffResumingFlowRuns?: Set<number> }).__zeffResumingFlowRuns ??= new Set<number>());

/**
 * The runs cut off (Zeff stopped or crashed mid-run): taken up again where they were — the steps done read from their journal, the rest run.
 * A step cut off in the middle runs again: the actions that write are made so that once more does no harm (by key — store.put, money.pay;
 * a todo done stays done). How many.
 */
export async function resumeCutOffRuns(now = new Date(), opts: { /** Tests: wait for the runs taken up (the clock doesn't). */ wait?: boolean } = {}): Promise<number> {
  let n = 0;
  const started: Promise<unknown>[] = [];
  const hung = new Set(cutOffRuns(HANG_MS, now).map((r) => r.id));
  for (const run of cutOffRuns(CUT_OFF_MS, now)) {
    if (liveRuns.has(run.id) || resuming.has(run.id)) {
      // (going on here, but quiet for an hour: it hangs — ended, its place freed; should it come back after all, what it did stays)
      if (hung.has(run.id)) {
        saveFlowRun(run.id, { status: "failed", journal: run.journal, log: run.log, error: "It hung — no step done for an hour. Ended so the others go on; run it again by hand when it should.", waiting: null, wakeAt: null });
        liveRuns.delete(run.id);
        resuming.delete(run.id);
      }
      continue;
    }
    const times = Number((run.journal.__resumed?.output as { times?: number } | undefined)?.times ?? 0);
    const fail = (why: string) => saveFlowRun(run.id, { status: "failed", journal: run.journal, log: run.log, error: why, waiting: null, wakeAt: null });
    // (a poison run — cut off again and again — and one cut off long ago end, so the rest goes on)
    if (times >= MAX_RESUMES) {
      fail(`Cut off ${times + 1} times — not taken up again (it may be what stops Zeff). Run it again by hand when it should.`);
      continue;
    }
    if (now.getTime() - Date.parse(run.startedAt) > MAX_CUT_OFF_AGE_MS) {
      fail("Cut off more than two days ago — not taken up again (what it read is old by now).");
      continue;
    }
    if (resuming.size >= MAX_RESUMING) break;
    run.journal.__resumed = { output: { times: times + 1 }, at: now.toISOString() };
    run.log.push({ key: "resumed", node: "resumed", kind: "action", status: "ok", ms: 0, output: { resumed: times + 1, after: run.startedAt }, at: now.toISOString(), depth: 0 } as never);
    keepRunProgress(run.id, run.journal, run.log);
    const { __row, ...input } = run.input as Record<string, unknown> & { __row?: number };
    resuming.add(run.id);
    const p = execute(run.id, run.def, input, run.journal, run.log, { dry: run.dry, row: typeof __row === "number" ? __row : undefined, trigger: run.trigger })
      .catch((e) => console.error(`[flows] run ${run.id} (taken up again): ${e instanceof Error ? e.message : e}`))
      .finally(() => resuming.delete(run.id));
    started.push(p);
    n++;
  }
  if (opts.wait) await Promise.all(started);
  return n;
}

/** The waits that are over go on, the runs cut off are taken up again (the scheduler calls this every minute). */
export async function resumeDueFlows(now = new Date(), opts: { /** Tests: wait for the runs taken up (the clock doesn't). */ wait?: boolean } = {}): Promise<number> {
  // (The questions nobody answered in time lapse: their runs end.)
  let n = await expireAsks(now);
  n += await resumeCutOffRuns(now, opts);
  const started: Promise<unknown>[] = [];
  for (const run of dueRuns(now)) {
    if (liveRuns.has(run.id) || resuming.has(run.id)) continue;
    if (resuming.size >= MAX_RESUMING) break;
    saveFlowRun(run.id, { status: "running", journal: run.journal, log: run.log, waiting: null, wakeAt: null });
    const { __row, ...input } = run.input as Record<string, unknown> & { __row?: number };
    // (not waited for: one that hangs holds up neither the clock nor the others — at most MAX_RESUMING at once)
    resuming.add(run.id);
    started.push(
      execute(run.id, run.def, input, run.journal, run.log, { dry: run.dry, row: typeof __row === "number" ? __row : undefined, trigger: run.trigger })
        .catch((e) => console.error(`[flows] run ${run.id}: ${e instanceof Error ? e.message : e}`))
        .finally(() => resuming.delete(run.id)),
    );
    n++;
  }
  if (opts.wait) await Promise.all(started);
  return n;
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

export type FlowEvent = { event: (typeof import("./types").EVENTS)[number]; db?: number; row?: number; /** A page's events: the page. */ page?: number; field?: string; value?: string; name?: string; payload?: Record<string, unknown> };
type EventTrigger = Extract<FlowTrigger, { kind: "event" }>;

let firing = 0;

/** Whether a page (a row's: by its database) is at or below `top` — up the tree, at most 40 steps. */
async function isUnder(pageId: number, top: number): Promise<boolean> {
  const { getPage } = await import("../store");
  for (let cur: number | null = pageId, hops = 0; cur && hops < 40; hops++) {
    if (cur === top) return true;
    const p = getPage(cur);
    cur = p ? (p.parentId ?? p.dbId) : null;
  }
  return false;
}

/** Whether a trigger listens to this event. */
async function listens(t: FlowTrigger, e: FlowEvent): Promise<boolean> {
  if (t.kind !== "event" || t.event !== e.event) return false;
  if (t.db && t.db !== e.db) return false;
  if (t.field && t.field.toLowerCase() !== (e.field ?? "").toLowerCase()) return false;
  if (t.equals && t.equals.trim().toLowerCase() !== (e.value ?? "").trim().toLowerCase()) return false;
  if (t.name && t.name !== e.name) return false;
  if (t.under !== undefined) {
    const top = typeof t.under === "number" ? t.under : isPackageRef(t.under) ? packagePage(t.under) : null;
    const at = e.page ?? e.row ?? e.db;
    if (!top || !at || !(await isUnder(at, top))) return false;
  }
  return true;
}

/** The waits of triggers with `settle`: one per flow and page (or row), the last event kept — it runs once things rest. */
const settling = (globalThis as { __zeffFlowSettle?: Map<string, ReturnType<typeof setTimeout>> }).__zeffFlowSettle ??= new Map();

async function runOnEvent(f: Flow, t: EventTrigger, e: FlowEvent): Promise<void> {
  // (`page`: the page it is about — a row is a page too.)
  const at = e.page ?? e.row;
  const input = { ...(e.payload ?? {}), event: e.event, ...(at !== undefined ? { page: at } : {}), ...(e.field ? { field: e.field } : {}), ...(e.name ? { name: e.name } : {}), ...(e.value !== undefined ? { value: e.value } : {}) };
  await runFlow(f, input, { trigger: t, row: e.row });
}

/** Something happened: the enabled flows that listen run (not while a flow's own event fires another, deeper than 3; never the flow that caused it). */
export async function fireFlowEvent(e: FlowEvent): Promise<number> {
  if (firing > 3) return 0;
  const by = currentFlow();
  let ran = 0;
  firing++;
  try {
    for (const f of listFlows()) {
      if (f.enabled === false || f.name === by) continue;
      let t: EventTrigger | undefined;
      for (const x of f.triggers) if (await listens(x, e)) t = x as EventTrigger;
      if (!t) continue;
      if (t.settle) {
        // Runs once, `settle` seconds after the last such event for this page or row (in the account it happened in).
        const key = `${f.pageId}|${e.page ?? e.row ?? e.event}`;
        clearTimeout(settling.get(key));
        const { currentAccountId, withAccount } = await import("@/db/accounts");
        const account = currentAccountId();
        const flow = f;
        const trig = t;
        settling.set(
          key,
          setTimeout(() => {
            settling.delete(key);
            void withAccount(account, () => runOnEvent(flow, trig, e)).catch((err) => console.error(`[flows] ${flow.name}: ${err instanceof Error ? err.message : err}`));
          }, t.settle * 1000),
        );
        ran++;
        continue;
      }
      try {
        await runOnEvent(f, t, e);
      } catch (err) {
        console.error(`[flows] ${f.name}: ${err instanceof Error ? err.message : err}`);
      }
      ran++;
    }
  } finally {
    firing--;
  }
  return ran;
}

/**
 * The watch triggers (`{ kind: "watch", lambda, everySeconds }`) that are due: each lambda asked whether something changed since its last
 * token; a flow runs only when it says so. Kept per account and flow while the server runs (a restart asks again from the last token kept
 * with the flow run — or from nothing: the lambda then answers what it finds).
 */
type WatchState = { at: number; token: unknown; busy: boolean };
const watching = (globalThis as { __zeffFlowWatch?: Map<string, WatchState> }).__zeffFlowWatch ??= new Map();

export async function runDueWatches(now = Date.now()): Promise<number> {
  const { currentAccountId } = await import("@/db/accounts");
  const account = currentAccountId();
  let ran = 0;
  for (const f of listFlows()) {
    if (f.enabled === false) continue;
    for (const t of f.triggers) {
      if (t.kind !== "watch") continue;
      const key = `${account}|${f.pageId}|${t.lambda}`;
      const st = watching.get(key) ?? { at: 0, token: null, busy: false };
      watching.set(key, st);
      if (st.busy || now - st.at < t.everySeconds * 1000) continue;
      st.busy = true;
      st.at = now;
      try {
        const { invokeLambda } = await import("../lambdas/run");
        const r = await invokeLambda(t.lambda, { since: st.token });
        if (!r.ok) {
          console.warn(`[flows] ${f.name}: watching with ${t.lambda} failed — ${r.error}`);
          continue;
        }
        const out = (r.result && typeof r.result === "object" ? r.result : {}) as { changed?: unknown; token?: unknown; input?: unknown };
        if (out.changed !== true) {
          if (out.token !== undefined) st.token = out.token;
          continue;
        }
        const res = await runFlow(f, out.input && typeof out.input === "object" && !Array.isArray(out.input) ? (out.input as Record<string, unknown>) : {}, { trigger: t });
        // (The token moves on only when the run went through — a failed one is asked again.)
        if (out.token !== undefined && res.status !== "failed") st.token = out.token;
        ran++;
      } catch (e) {
        console.error(`[flows] ${f.name}: ${e instanceof Error ? e.message : e}`);
      } finally {
        st.busy = false;
      }
    }
  }
  return ran;
}

/** When a schedule trigger is due next after `from`: every n minutes (within its hours and days), or at a time on its days. */
export function nextFlowRunAfter(t: { everyMinutes?: number; at?: string; days?: number[]; from?: string; to?: string }, from: Date): Date | null {
  const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const okDay = (d: Date) => !t.days?.length || t.days.includes(d.getDay());
  if (t.everyMinutes) {
    const lo = t.from ? minutes(t.from) : 0;
    const hi = t.to ? minutes(t.to) : 24 * 60;
    let next = new Date(from.getTime() + t.everyMinutes * 60000);
    for (let i = 0; i < 9; i++) {
      const m = next.getHours() * 60 + next.getMinutes();
      if (okDay(next) && m >= lo && m <= hi) return next;
      // (Outside its hours or days: the start of its hours on the next day that is one of its days.)
      const d = new Date(next);
      if (m > hi || !okDay(next)) d.setDate(d.getDate() + 1);
      d.setHours(Math.floor(lo / 60), lo % 60, 0, 0);
      next = d;
    }
    return null;
  }
  if (!t.at) return null;
  const [h, m] = t.at.split(":").map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (d > from && okDay(d)) return d;
  }
  return null;
}

/** The scheduled flows that are due run; the waits that are over go on. */
export async function runDueFlows(now = new Date()): Promise<number> {
  const { setFlowNextRun } = await import("./store");
  let ran = await resumeDueFlows(now);
  for (const f of listFlows()) {
    if (f.enabled === false) continue;
    for (const t of f.triggers) {
      if (t.kind !== "schedule") continue;
      const next = f.nextRunAt ? new Date(f.nextRunAt) : null;
      if (!next) {
        const n = nextFlowRunAfter(t, now);
        setFlowNextRun(f.pageId, n ? n.toISOString() : null);
        continue;
      }
      if (next > now) continue;
      const n = nextFlowRunAfter(t, now);
      setFlowNextRun(f.pageId, n ? n.toISOString() : null);
      await runFlow(f, {}, { trigger: t }).catch((e) => console.error(`[flows] ${f.name}: ${e instanceof Error ? e.message : e}`));
      ran++;
    }
  }
  return ran;
}
