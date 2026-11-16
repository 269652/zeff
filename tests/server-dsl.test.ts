import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The server DSL (docs/plugins/server-dsl.md), first slice: a typed standard library in expressions, user functions (fn / apply),
 * while, try/catch/finally, and a capability registry in the database over a closed set of primitives — all inside the existing
 * flow engine; flows without them run as before. One real lambda (finances.account-mark) ported and compared with its flow.
 */

async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "studio"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  return {
    s: await import("@/plugins/workspace/flows/store"),
    e: await import("@/plugins/workspace/flows/engine"),
    c: await import("@/plugins/workspace/flows/capabilities"),
    check: await import("@/plugins/workspace/flows/check"),
    types: await import("@/plugins/workspace/flows/types"),
  };
}
let n = 0;
const name = (b: string) => `${b}.t${++n}`;

test("the stdlib: text, lists, objects, dates, regex — typed, and a wrong kind says which argument", async () => {
  const { evalExpr } = await import("@/plugins/workspace/flows/expr");
  const sc = { input: { s: "Hello World 2024-05-06", l: [3, 1, 2], rows: [{ k: "a", n: 1 }, { k: "b", n: 5 }, { k: "a", n: 3 }], o: { a: 1, b: 2, c: 3 } } };
  assert.equal(evalExpr("input.s | startsWith('Hello')", sc), true);
  assert.deepEqual(evalExpr("input.s | regexMatch('(\\d+)-(\\d+)-(\\d+)')", sc), ["2024-05-06", "2024", "05", "06"]);
  assert.equal(evalExpr("input.s | regexReplace('\\s+', '_')", sc), "Hello_World_2024-05-06");
  assert.deepEqual(evalExpr("input.l | reverse | take(2)", sc), [2, 1]);
  assert.deepEqual(evalExpr("input.rows | groupBy('k') | keys", sc), ["a", "b"]);
  assert.deepEqual(evalExpr("input.rows | countBy('k')", sc), { a: 2, b: 1 });
  assert.equal(evalExpr("input.rows | max('n')", sc), 5);
  assert.equal(evalExpr("input.rows | avg('n')", sc), 3);
  assert.deepEqual(evalExpr("input.o | pick('a', 'c')", sc), { a: 1, c: 3 });
  assert.deepEqual(evalExpr("input.o | omit('a') | setKey('z', 9)", sc), { b: 2, c: 3, z: 9 });
  assert.equal(evalExpr("input.o | get('b')", sc), 2);
  assert.equal(evalExpr("'2024-02-27' | addDays(3)", sc), "2024-03-01");
  assert.equal(evalExpr("'2024-03-01' | diffDays('2024-02-27')", sc), 3);
  assert.equal(evalExpr("'2024-03-01T10:05:00Z' | formatDate('DD.MM.YYYY HH:mm')", sc), "01.03.2024 10:05");
  assert.deepEqual(evalExpr("4 | range", sc), [0, 1, 2, 3]);
  assert.equal(evalExpr("input.l | typeOf", sc), "list");
  // typed: wrong kinds, wrong counts, bad patterns — each says what
  assert.throws(() => evalExpr("input.l | startsWith('a')", sc), /startsWith: the value must be text, not list/);
  assert.throws(() => evalExpr("input.s | take(2)", sc), /take: the value must be list, not text/);
  assert.throws(() => evalExpr("input.s | padStart('x')", sc), /padStart: argument 1 must be number, not text — use \| number first/);
  assert.throws(() => evalExpr("missing.path | take(1)", sc), /take: the value must be list, not null — use | default/);
  assert.throws(() => evalExpr("input.s | regexTest('(')", sc), /is no regular expression/);
  assert.throws(() => evalExpr("input.s | startsWith", sc), /startsWith: takes 2 arguments/);
  // what was there before stays as it was
  assert.equal(evalExpr("input.s | upper", sc), "HELLO WORLD 2024-05-06");
});

test("user functions: params, return, recursion, and a limit on how deep", async () => {
  const { s, e } = await world();
  const f = s.createFlow({
    name: name("fn"),
    inputs: [{ name: "n", type: "number", default: 6 }],
    nodes: [
      {
        id: "fact",
        kind: "fn",
        name: "fact",
        params: ["n"],
        nodes: [
          {
            id: "base",
            kind: "if",
            when: "vars.n <= 1",
            then: [{ id: "one", kind: "return", value: 1 }],
            else: [
              { id: "rec", kind: "apply", fn: "fact", args: { n: "{{ vars.n - 1 }}" } },
              { id: "mul", kind: "return", value: "{{ vars.n * steps.rec }}" },
            ],
          },
        ],
      },
      { id: "go", kind: "apply", fn: "fact", args: { n: "{{ input.n }}" } },
      { id: "word", kind: "apply", fn: "shout", args: { text: "done" } },
      { id: "shout", kind: "fn", name: "shout", params: ["text"], nodes: [], output: "{{ vars.text | upper }}!" },
    ],
    output: { f: "{{ steps.go }}", w: "{{ steps.word }}" },
  });
  const r = await e.runFlow(f, { n: 6 });
  assert.equal(r.status, "done", r.error ?? "");
  assert.deepEqual(r.output, { f: 720, w: "DONE!" });
  // endless recursion stops with a message
  const loop = s.createFlow({ name: name("fnloop"), permissions: { maxSteps: 5000 }, nodes: [{ id: "f", kind: "fn", name: "f", params: [], nodes: [{ id: "again", kind: "apply", fn: "f", args: {} }] }, { id: "go", kind: "apply", fn: "f", args: {} }] });
  const l = await e.runFlow(loop);
  assert.equal(l.status, "failed");
  assert.match(l.error ?? "", /more than 20 deep/);
  // an unknown parameter and an unknown function are errors that name them
  const bad = s.createFlow({ name: name("fnbad"), nodes: [{ id: "f", kind: "fn", name: "f", params: ["a"], nodes: [] }, { id: "go", kind: "apply", fn: "f", args: { b: 1 } }] });
  assert.match((await e.runFlow(bad)).error ?? "", /f has no parameter “b” \(it has: a\)/);
  assert.deepEqual((await import("@/plugins/workspace/flows/check")).checkFlow(bad), ["go: f has no parameter “b” (it has: a)"]);
});

test("while: runs while the condition holds, stops at max with an error, counts as steps", async () => {
  const { s, e } = await world();
  const f = s.createFlow({ name: name("while"), nodes: [{ id: "i", kind: "set", vars: { i: 0, sum: 0 } }, { id: "w", kind: "while", when: "vars.i < 5", nodes: [{ id: "step", kind: "set", vars: { i: "{{ vars.i + 1 }}", sum: "{{ vars.sum + vars.i + 1 }}" } }] }], output: "{{ vars.sum }}" });
  const r = await e.runFlow(f);
  assert.equal(r.output, 15);
  const forever = s.createFlow({ name: name("forever"), nodes: [{ id: "w", kind: "while", when: "true", max: 7, nodes: [{ id: "x", kind: "set", vars: { a: 1 } }] }] });
  assert.match((await e.runFlow(forever)).error ?? "", /still going after 7 rounds/);
});

test("try / catch / finally: finally runs after the work and after a catch; a return passes through it", async () => {
  const { s, e } = await world();
  const f = s.createFlow({
    name: name("tcf"),
    nodes: [
      { id: "init", kind: "set", vars: { trail: "" } },
      { id: "t", kind: "try", nodes: [{ id: "a", kind: "set", vars: { trail: "{{ vars.trail }}a" } }, { id: "boom", kind: "fail", message: "boom" }], catch: [{ id: "c", kind: "set", vars: { trail: "{{ vars.trail }}c:{{ error.message }}" } }], finally: [{ id: "fin", kind: "set", vars: { trail: "{{ vars.trail }}f" } }] },
      { id: "t2", kind: "try", nodes: [{ id: "ret", kind: "return", value: "{{ vars.trail }}" }], catch: [], finally: [{ id: "fin2", kind: "set", vars: { trail: "{{ vars.trail }}F" } }] },
    ],
  });
  const r = await e.runFlow(f);
  assert.equal(r.status, "done");
  assert.equal(r.output, "ac:boomf");
  // a flow without any of it is read as before (the node kinds list only grew)
  const { normalizeFlow } = await import("@/plugins/workspace/flows/types");
  assert.equal(normalizeFlow({ name: "a.b", nodes: [{ id: "x", kind: "try", nodes: [], catch: [] }] }).nodes[0].kind, "try");
});

test("capabilities: wrap a primitive as data, run a program as data, composed, validated, granted — never more than the caller", async () => {
  const { s, e, c, check } = await world();
  const { setPref } = await import("@/lib/prefs");
  setPref("dsl.test.count", 41);
  // a wrapper over a primitive, with its own schema and a shaped answer
  c.saveCapability({ name: "dsl.counter-get", label: "The counter", summary: "The test counter.", input: [], output: "a number", impl: { use: "pref.get", input: { key: "dsl.test.count" }, output: "{{ result.value }}" } });
  // a program: reads, computes with the stdlib, writes — and so is marked as writing
  c.saveCapability({
    name: "dsl.counter-bump",
    label: "Bump the counter",
    summary: "Adds `by` to the test counter.",
    input: [{ name: "by", type: "number", default: 1 }],
    output: "the new value",
    impl: {
      nodes: [
        { id: "cur", kind: "action", action: "dsl.counter-get", input: {} },
        { id: "next", kind: "set", vars: { next: "{{ steps.cur + input.by }}" } },
        { id: "w", kind: "action", action: "core.pref.set", input: { key: "dsl.test.count", value: "{{ vars.next }}" } },
        { id: "r", kind: "return", value: "{{ vars.next }}" },
      ],
    },
  });
  const grant = { pref: ["dsl.test.*"] };
  const f = s.createFlow({ name: name("cap"), permissions: grant, nodes: [{ id: "a", kind: "action", action: "dsl.counter-bump", input: { by: 2 } }, { id: "b", kind: "action", action: "dsl.counter-get", input: {} }], output: { a: "{{ steps.a }}", b: "{{ steps.b }}" } });
  assert.deepEqual(check.checkFlow(f), []);
  const r = await e.runFlow(f);
  assert.equal(r.status, "done", r.error ?? "");
  assert.deepEqual(r.output, { a: 43, b: 43 });
  // a dry run does not write: the capability is known to write because what it is made of does
  const dry = await e.runFlow(f, {}, { dry: true });
  assert.equal((dry.output as { a: { dryRun?: boolean } }).a.dryRun, true);
  assert.equal((await import("@/lib/prefs")).getPref("dsl.test.count", 0), 43);
  // the caller's grants bind it: a flow without the preference grant gets nothing
  const poor = s.createFlow({ name: name("poor"), nodes: [{ id: "a", kind: "action", action: "dsl.counter-get", input: {} }] });
  const p = await e.runFlow(poor);
  assert.equal(p.status, "failed");
  assert.match(p.error ?? "", /may not read the preference “dsl\.test\.count” — grant it under the flow's permissions \(pref\)/);
  // validation: every problem with its place
  const bad = c.normalizeCapability({ name: "Bad Name", impl: { use: "nothing.here", input: { a: "{{ x | nofilter }}" } } });
  assert.equal(bad.cap, null);
  assert.ok(bad.problems.some((x) => x.startsWith("name:")));
  assert.ok(bad.problems.some((x) => x.startsWith("impl.use: “nothing.here”")));
  assert.ok(bad.problems.some((x) => x.startsWith("impl.input.a:")));
  assert.throws(() => c.saveCapability({ name: "x.y", impl: {} }), /impl: give `use`/);
  assert.throws(() => c.saveCapability({ name: "x.self", impl: { use: "x.self" } }), /can't use itself/);
  // a missing required input is the schema's error, before it runs
  c.saveCapability({ name: "dsl.needs-key", input: [{ name: "key", type: "text", required: true }], impl: { use: "pref.get", input: { key: "{{ input.key }}" } } });
  const need = s.createFlow({ name: name("need"), permissions: grant, nodes: [{ id: "a", kind: "action", action: "dsl.needs-key", input: {} }] });
  assert.match((await e.runFlow(need)).error ?? "", /needs “key”/);
});

test("sql.query: one SELECT, only granted tables, never the secrets table, parameters, a row limit", async () => {
  const { s, e } = await world();
  const { getSqlite } = await import("@/db");
  getSqlite().exec("create table if not exists dsl_t (id integer primary key, k text, n integer); delete from dsl_t; insert into dsl_t (k, n) values ('a', 1), ('b', 2), ('c', 3)");
  const run = async (sql: string, permissions: Record<string, unknown> = { sql: ["dsl_t"] }, params: unknown[] = [], limit?: number) => {
    const f = s.createFlow({ name: name("sql"), permissions, nodes: [{ id: "q", kind: "action", action: "core.sql.query", input: { sql, params, ...(limit ? { limit } : {}) } }], output: "{{ steps.q }}" });
    return e.runFlow(f);
  };
  const ok = await run("select k, n from dsl_t where n >= ? order by n", undefined, [2]);
  assert.deepEqual((ok.output as { rows: unknown[] }).rows, [{ k: "b", n: 2 }, { k: "c", n: 3 }]);
  const cut = await run("select * from dsl_t", undefined, [], 2);
  assert.deepEqual([(cut.output as { count: number }).count, (cut.output as { truncated: boolean }).truncated], [2, true]);
  assert.match((await run("select * from dsl_t", {})).error ?? "", /may not read the table “dsl_t”/);
  assert.match((await run("select * from ws_flow_secrets", { sql: ["ws_flow_secrets"] })).error ?? "", /may not read the table “ws_flow_secrets”/);
  assert.match((await run("delete from dsl_t")).error ?? "", /runs one SELECT/);
  assert.match((await run("select 1; delete from dsl_t")).error ?? "", /more than one statement|sql\.query/);
  assert.match((await run("select * from dsl_t join other on 1")).error ?? "", /“other”/);
  assert.equal((getSqlite().prepare("select count(*) c from dsl_t").get() as { c: number }).c, 3);
});

test("parity: the real lambda finances.account-mark and its flow give the same on the same events (and the flow can keep it)", async () => {
  await world();
  const { accountMarkParity, CASES } = (await import("../scripts/dsl-parity.mts" as string)) as { accountMarkParity: (c: unknown[]) => Promise<{ event: unknown; lambda: unknown; flow: unknown; same: boolean }[]>; CASES: unknown[] };
  const rows = await accountMarkParity(CASES);
  assert.equal(rows.length, CASES.length + 1);
  for (const r of rows) assert.ok(r.same, `${JSON.stringify(r.event)}: lambda ${JSON.stringify(r.lambda)} ≠ flow ${JSON.stringify(r.flow)}`);
});

test("tx + sql.exec: writes commit together or not at all; granted tables only; nothing that waits inside", async () => {
  const { s, e } = await world();
  const { getSqlite } = await import("@/db");
  const q = () => (getSqlite().prepare("select count(*) c from dsl_x").get() as { c: number }).c;
  getSqlite().exec("create table if not exists dsl_x (id integer primary key, k text); delete from dsl_x");
  const perms = { sqlWrite: ["dsl_x"], sql: ["dsl_x"] };
  const ins = (id: string, k: string) => ({ id, kind: "action", action: "core.sql.exec", input: { sql: "insert into dsl_x (k) values (?)", params: [k] } });
  const ok = s.createFlow({ name: name("txok"), permissions: perms, nodes: [{ id: "t", kind: "tx", nodes: [ins("a", "1"), ins("b", "2")] }] });
  assert.equal((await e.runFlow(ok)).status, "done");
  assert.equal(q(), 2);
  const bad = s.createFlow({ name: name("txbad"), permissions: perms, nodes: [{ id: "t", kind: "tx", nodes: [ins("a", "3"), { id: "boom", kind: "fail", message: "nope" }] }] });
  assert.equal((await e.runFlow(bad)).status, "failed");
  assert.equal(q(), 2, "rolled back");
  const loose = s.createFlow({ name: name("loose"), permissions: perms, nodes: [ins("a", "4"), { id: "boom", kind: "fail", message: "nope" }] });
  await e.runFlow(loose);
  assert.equal(q(), 3, "outside a tx the first write stays");
  const noGrant = s.createFlow({ name: name("nog"), permissions: { sql: ["dsl_x"] }, nodes: [ins("a", "5")] });
  assert.match((await e.runFlow(noGrant)).error ?? "", /may not write the table “dsl_x” — grant it under the flow's permissions \(sqlWrite\)/);
  const ddl = s.createFlow({ name: name("ddl"), permissions: perms, nodes: [{ id: "a", kind: "action", action: "core.sql.exec", input: { sql: "drop table dsl_x" } }] });
  assert.match((await e.runFlow(ddl)).error ?? "", /one INSERT, UPDATE or DELETE/);
  const waits = s.createFlow({ name: name("txw"), permissions: perms, nodes: [{ id: "t", kind: "tx", nodes: [{ id: "w", kind: "wait", minutes: 1 }] }] });
  assert.match((await e.runFlow(waits)).error ?? "", /a wait node can't be inside a tx/);
  const web = s.createFlow({ name: name("txh"), permissions: perms, nodes: [{ id: "t", kind: "tx", nodes: [{ id: "h", kind: "action", action: "http.request", input: { url: "https://x.example.com" } }] }] });
  assert.match((await e.runFlow(web)).error ?? "", /only core\.\* actions/);
  assert.ok((await import("@/plugins/workspace/flows/check")).checkFlow(waits).some((x) => /can't be inside a tx/.test(x)));
  const before = q();
  await e.runFlow(ok, {}, { dry: true });
  assert.equal(q(), before, "a dry run writes nothing");
});

test("determinism and limits: env is frozen at the run's start; runTimeoutMs stops a run between nodes", async () => {
  const { s, e } = await world();
  const f = s.createFlow({ name: name("env"), nodes: [{ id: "a", kind: "set", vars: { t: "{{ env.now }}" } }], output: "{{ vars.t }}" });
  const r = await e.runFlow(f);
  const run = s.getFlowRun(r.runId)!;
  assert.equal((run.journal.__env.output as { now: string }).now, r.output);
  const slow = s.createFlow({ name: name("slow"), permissions: { runTimeoutMs: 30, maxSteps: 5000 }, nodes: [{ id: "w", kind: "while", when: "true", max: 4000, nodes: [{ id: "x", kind: "script", code: "let s = 0; for (let i = 0; i < 300000; i++) s += i; return s;" }] }] });
  const t = await e.runFlow(slow);
  assert.equal(t.status, "failed");
  assert.match(t.error ?? "", /took longer than 30 ms/);
});

test("fs: only under a granted root, .. and links don't leave it, writing needs write", async () => {
  const { s, e } = await world();
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsl-fs-"));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "dsl-fs-other-"));
  fs.writeFileSync(path.join(other, "secret.txt"), "no");
  fs.writeFileSync(path.join(root, "a.txt"), "hello");
  const run = async (action: string, input: Record<string, unknown>, fsPerm: unknown) => e.runFlow(s.createFlow({ name: name("fs"), permissions: { fs: fsPerm }, nodes: [{ id: "x", kind: "action", action, input }], output: "{{ steps.x }}" }));
  const ro = [{ root }];
  assert.equal(((await run("core.fs.read-text", { path: path.join(root, "a.txt") }, ro)).output as { text: string }).text, "hello");
  assert.deepEqual(((await run("core.fs.list", { path: root }, ro)).output as { entries: { name: string }[] }).entries.map((x) => x.name), ["a.txt"]);
  assert.match((await run("core.fs.read-text", { path: path.join(other, "secret.txt") }, ro)).error ?? "", /may not reach/);
  assert.match((await run("core.fs.read-text", { path: path.join(root, "..", path.basename(other), "secret.txt") }, ro)).error ?? "", /may not reach/);
  assert.match((await run("core.fs.write-text", { path: path.join(root, "b.txt"), text: "x" }, ro)).error ?? "", /read but not write/);
  assert.equal((await run("core.fs.write-text", { path: path.join(root, "sub", "b.txt"), text: "x" }, [{ root, write: true }])).status, "done");
  assert.equal(fs.readFileSync(path.join(root, "sub", "b.txt"), "utf8"), "x");
  try {
    fs.symlinkSync(other, path.join(root, "link"), "junction");
    assert.match((await run("core.fs.read-text", { path: path.join(root, "link", "secret.txt") }, ro)).error ?? "", /may not reach/);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EPERM") throw err;
  }
});

test("secret headers: only secrets the flow was granted, and the value never reaches the output or the log", async () => {
  const { s, e } = await world();
  s.setSecret("DSL_KEY", "sk-live-123456789");
  const realFetch = globalThis.fetch;
  let seen = "";
  globalThis.fetch = (async (_u: string | URL, init?: RequestInit) => {
    seen = String((init?.headers as Record<string, string>)?.authorization ?? "");
    return Response.json({ ok: true });
  }) as typeof fetch;
  try {
    const node = { id: "h", kind: "action", action: "core.http", input: { url: "https://api.example.com/x", secretHeaders: { authorization: { secret: "DSL_KEY", prefix: "Bearer " } } } };
    const resolve = async () => ["93.184.216.34"];
    const denied = await e.runFlow(s.createFlow({ name: name("sec"), permissions: { web: ["api.example.com"] }, nodes: [node] }), {}, { resolve });
    assert.match(denied.error ?? "", /may not use the secret “DSL_KEY”/);
    const ok = await e.runFlow(s.createFlow({ name: name("sec"), permissions: { web: ["api.example.com"], secret: ["DSL_KEY"] }, nodes: [node], output: "{{ steps.h }}" }), {}, { resolve });
    assert.equal(ok.status, "done", ok.error ?? "");
    assert.equal(seen, "Bearer sk-live-123456789");
    assert.ok(!JSON.stringify(ok.output).includes("sk-live-123456789"));
    assert.ok(!JSON.stringify(s.getFlowRun(ok.runId)!.log).includes("sk-live-123456789"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("versions and patch ops: the AI edits one node by id; every state is kept and can come back", async () => {
  const { c } = await world();
  const { applyPatch } = await import("@/plugins/workspace/flows/patch");
  c.saveCapability({ name: "dsl.shout", input: [{ name: "t", type: "text" }], impl: { nodes: [{ id: "u", kind: "set", vars: { v: "{{ input.t | upper }}" } }, { id: "r", kind: "return", value: "{{ vars.v }}" }] } });
  const v2 = c.patchCapability("dsl.shout", [{ op: "update", id: "u", set: { vars: { v: "{{ input.t | upper | truncate(5) }}" } } }, { op: "insert", node: { id: "lg", kind: "action", action: "core.log", input: { message: "shouted" } }, index: 1 }]);
  assert.deepEqual("nodes" in v2.impl && v2.impl.nodes.map((n) => n.id), ["u", "lg", "r"]);
  assert.equal(c.listCapabilityVersions("dsl.shout").length, 2);
  c.restoreCapability("dsl.shout", 1);
  const now = c.getCapability("dsl.shout")!;
  assert.deepEqual("nodes" in now.impl && now.impl.nodes.map((n) => n.id), ["u", "r"]);
  assert.equal(c.listCapabilityVersions("dsl.shout").length, 3);
  const nodes = "nodes" in now.impl ? now.impl.nodes : [];
  const bad = applyPatch(nodes, [{ op: "remove", id: "zzz" }, { op: "insert", node: { id: "u", kind: "set", vars: {} } }, { op: "insert", node: { kind: "nonsense" } }]);
  assert.equal(bad.problems.length, 3);
  assert.match(bad.problems[0], /^op 1 \(remove\): there is no node “zzz”/);
  assert.match(bad.problems[1], /the id “u” is taken/);
  assert.deepEqual(bad.nodes, nodes);
  assert.throws(() => c.patchCapability("dsl.shout", [{ op: "remove", id: "nope" }]), /The patch has problems/);
});

test("the kernel's actions declared in the database: every one a row with its schema and class; idempotent; the row is the truth; a wrapper may target a kernel action", async () => {
  const { c } = await world();
  const { declareKernelActions, classify } = await import("@/plugins/workspace/flows/declare");
  const { flowActions } = await import("@/plugins/workspace/flows/actions");
  const total = flowActions().length;
  assert.ok(total > 80, `${total} actions`);
  // (a flow run before this already declared them in this database — start clean to see the declaring itself)
  for (const x of c.listCapabilities()) if ("command" in x.impl) c.deleteCapability(x.name);
  const dry = declareKernelActions({ dry: true });
  assert.equal(dry.declared.length, total);
  assert.equal(c.listCapabilities().filter((x) => "command" in x.impl).length, 0, "dry changes nothing");
  const r = declareKernelActions();
  assert.equal(r.declared.length, total);
  assert.equal(Object.values(r.byClass).reduce((a, b) => a + b, 0), total);
  const rows = c.listCapabilities().filter((x) => "command" in x.impl);
  assert.equal(rows.length, total);
  const row = rows.find((x) => x.name === "time.now")!;
  assert.deepEqual([row.class, row.group], ["primitive", "util"]);
  assert.equal(c.getCapability("todos.add")?.writes, true);
  assert.equal(classify({ name: "people.known-in", writes: false }), "read");
  assert.equal(classify({ name: "jira.comment", writes: true }), "vendor");
  assert.equal(classify({ name: "money.pay", writes: true }), "command");
  assert.equal(classify({ name: "sql.query", writes: false }), "primitive");
  // idempotent; an edited row stays and drift is said
  assert.equal(declareKernelActions().declared.length, 0);
  const vBefore = c.listCapabilityVersions("time.now").length;
  c.saveCapability({ ...row, input: [{ name: "extra", type: "text" }] });
  const again = declareKernelActions();
  assert.deepEqual(again.drift, ["time.now"]);
  assert.deepEqual(c.getCapability("time.now")?.input.map((f) => f.name), ["extra"]);
  assert.equal(c.listCapabilityVersions("time.now").length, vBefore + 1);
  // a row for code that is gone is an orphan; a bad command is refused
  assert.throws(() => c.saveCapability({ name: "x.gone", impl: { command: "no.such" } }), /no kernel operation “no\.such”/);
  // a wrapper over a kernel operation, shaped as data
  c.saveCapability({ name: "dsl.today", label: "Today", input: [], output: "YYYY-MM-DD", impl: { use: "time.now", output: "{{ result.today }}" } });
  const { s, e } = await world();
  const f = s.createFlow({ name: name("wrap"), nodes: [{ id: "t", kind: "action", action: "dsl.today", input: {} }], output: "{{ steps.t }}" });
  const out = await e.runFlow(f);
  assert.equal(out.status, "done", out.error ?? "");
  assert.match(String(out.output), /^\d{4}-\d{2}-\d{2}$/);
});

test("the engine goes by the database's row: its required inputs, its switch, never weaker on writes", async () => {
  const { s, e, c, check } = await world();
  const { declareKernelActions } = await import("@/plugins/workspace/flows/declare");
  declareKernelActions();
  const call = (input: Record<string, unknown> = {}) => s.createFlow({ name: name("row"), nodes: [{ id: "t", kind: "action", action: "time.now", input }] });
  assert.equal((await e.runFlow(call())).status, "done");
  // the row says the action needs “zone”: the engine checks that, not the code
  const row = c.getCapability("time.now")!;
  c.saveCapability({ ...row, input: [{ name: "zone", type: "text", required: true }] });
  const f = call();
  assert.match((await e.runFlow(f)).error ?? "", /needs “zone”/);
  assert.ok(check.checkFlow(f).some((x) => /time\.now needs “zone”/.test(x)));
  assert.equal((await e.runFlow(call({ zone: "UTC" }))).status, "done");
  // switched off in the database
  c.saveCapability({ ...row, enabled: false });
  assert.match((await e.runFlow(call())).error ?? "", /“time\.now” is switched off/);
  assert.ok(check.checkFlow(call()).some((x) => /switched off/.test(x)));
  // a row that says writes:false doesn't make a writing action read-only (todos.add writes in code)
  const add = c.getCapability("todos.add");
  if (add) {
    c.saveCapability({ ...add, writes: false });
    const { resolveAction } = await import("@/plugins/workspace/flows/capabilities");
    assert.equal(resolveAction("todos.add", async () => null)?.writes, true);
  }
  c.saveCapability({ ...row, enabled: true });
});

test("declared at first use, once per database; the catalogue the Studio and the AI read is the database's", async () => {
  const { s, e, c } = await world();
  const { declaredCatalog, declareKernelActions } = await import("@/plugins/workspace/flows/declare");
  for (const x of c.listCapabilities()) c.deleteCapability(x.name);
  // (declared once already in this process for this database: a second ensure does nothing — declaring by hand shows the rows are gone)
  assert.equal(c.listCapabilities().length, 0);
  declareKernelActions();
  c.saveCapability({ name: "dsl.cat-wrap", label: "Wrapped", summary: "s", input: [], impl: { use: "time.now" } });
  const row = c.getCapability("time.now")!;
  c.saveCapability({ ...row, summary: "Edited in the database." });
  const cat = declaredCatalog();
  assert.equal(cat.find((x) => x.name === "time.now")?.summary, "Edited in the database.");
  assert.ok(cat.some((x) => x.name === "core.sql.query" && x.class === "primitive"));
  assert.ok(cat.some((x) => x.name === "dsl.cat-wrap" && x.group === "capability"));
  assert.ok(cat.every((x) => !("run" in x)));
  c.saveCapability({ ...row, enabled: false });
  assert.ok(!declaredCatalog().some((x) => x.name === "time.now"), "switched off: not offered");
  c.saveCapability({ ...row, enabled: true });
  const f = s.createFlow({ name: name("cat"), nodes: [{ id: "t", kind: "action", action: "time.now", input: {} }] });
  assert.equal((await e.runFlow(f)).status, "done");
});

test("the Studio's capability actions: list, read, save with problems, versions, delete only what is yours", async () => {
  await world();
  const a = await import("@/plugins/studio/server-actions");
  const list = await a.capabilitiesAction();
  assert.ok(list.ok);
  const rows = list.ok ? list.capabilities : [];
  assert.ok(rows.some((r) => r.name === "time.now" && r.made === "command" && r.class === "primitive"));
  // a new wrapper through the form's path; a bad one says every problem
  const bad = await a.saveCapabilityAction({ name: "dsl.form", label: "F", input: [], impl: { use: "nothing.here" } });
  assert.ok(bad.ok && !bad.saved && bad.problems.some((p) => p.startsWith("impl.use:")));
  const good = await a.saveCapabilityAction({ name: "dsl.form", label: "F", input: [{ name: "n", type: "number", required: true }], output: "x", impl: { use: "log", input: { message: "{{ input.n }}" } } });
  assert.ok(good.ok && good.saved);
  const one = await a.capabilityAction("dsl.form");
  assert.ok(one.ok && one.capability.name === "dsl.form" && one.versions.length === 1);
  await a.saveCapabilityAction({ ...(one.ok ? one.capability : {}), label: "F2" });
  const two = await a.capabilityAction("dsl.form");
  assert.ok(two.ok && two.versions.length === 2);
  const back = await a.restoreCapabilityAction("dsl.form", 1);
  assert.ok(back.ok && back.capability.label === "F");
  // a kernel action can't be deleted from here, yours can
  const k = await a.deleteCapabilityAction("time.now");
  assert.ok(!k.ok && /switch it off/.test(k.error));
  assert.ok((await a.deleteCapabilityAction("dsl.form")).ok);
  assert.ok(!(await a.capabilityAction("dsl.form")).ok);
});

test("fs guard: Zeff's own data folder is never reachable; a root's limits are its own", async () => {
  const { s, e } = await world();
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { dataDir } = await import("@/db");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsl-lim-"));
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(root, `f${i}.txt`), "x".repeat(50));
  const run = (action: string, input: Record<string, unknown>, perm: unknown) => e.runFlow(s.createFlow({ name: name("lim"), permissions: { fs: perm }, nodes: [{ id: "x", kind: "action", action, input }], output: "{{ steps.x }}" }));
  assert.equal(((await run("core.fs.list", { path: root }, [{ root, maxEntries: 3 }])).output as { entries: unknown[] }).entries.length, 3);
  assert.match((await run("core.fs.read-text", { path: path.join(root, "f0.txt") }, [{ root, maxBytes: 10 }])).error ?? "", /at most 10/);
  assert.equal((await run("core.fs.read-text", { path: path.join(root, "f0.txt") }, [{ root, maxBytes: 100 }])).status, "done");
  // even a root that contains the data folder doesn't reach into it
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(path.join(dataDir(), "probe.txt"), "private");
  const r = await run("core.fs.read-text", { path: path.join(dataDir(), "probe.txt") }, [{ root: path.dirname(dataDir()) }]);
  assert.match(r.error ?? "", /Zeff's own data folder/);
});

test("the SQL replacements give the same answers as the kernel reads they replace", async () => {
  const { s, e } = await world();
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["todos", "people"]) setInstalled(id, true);
  const { declareReadReplacements, READ_REPLACEMENTS } = await import("@/plugins/workspace/flows/declare");
  const { flowAction } = await import("@/plugins/workspace/flows/actions");
  const { getSqlite } = await import("@/db");
  const sq = getSqlite();
  sq.exec("delete from todos");
  const todo = sq.prepare("insert into todos (ticket, text, note, status, due, merged_into, created_at) values ('t', ?, ?, ?, ?, ?, ?)");
  todo.run("Pay rent", "n1", "open", "2026-12-01", null, "2026-11-01T10:00:00Z");
  todo.run("Call Anna", "", "done", null, null, "2026-11-02T10:00:00Z");
  todo.run("Merged away", "", "open", null, 1, "2026-11-03T10:00:00Z");
  todo.run("Zeta", "x", "open", "2026-11-20", null, "2026-11-04T10:00:00Z");
  sq.exec("create table if not exists people (id integer primary key autoincrement, name text not null, aliases text not null default '[]', note text not null default '', whatsapp text not null default '', emails text not null default '[]', entity_id integer, starred integer not null default 0, created_at text not null, updated_at text not null)");
  sq.exec("delete from people");
  const ppl = sq.prepare("insert into people (name, emails, starred, created_at, updated_at) values (?, ?, ?, 'x', 'x')");
  ppl.run("anna b", '["a@x.de","anna@y.de"]', 0);
  ppl.run("Zoe", "[]", 1);
  ppl.run("Bert Ä", '["b@x.de"]', 0);
  assert.equal(declareReadReplacements().length, READ_REPLACEMENTS.length);
  assert.equal(declareReadReplacements().length, 0, "idempotent");

  const both = async (kernel: string, input: Record<string, unknown>) => {
    const k = await flowAction(kernel)!.run(input, { flow: "t", runId: null, dryRun: false, perms: {}, web: async () => new URL("https://x.example.com"), canWrite: () => undefined, may: () => undefined, log: () => undefined });
    const f = await e.runFlow(s.createFlow({ name: name("rd"), permissions: { sql: ["todos", "people", "emails"] }, nodes: [{ id: "x", kind: "action", action: `read.${kernel}`, input }], output: "{{ steps.x }}" }));
    assert.equal(f.status, "done", f.error ?? "");
    return { k: JSON.parse(JSON.stringify(k)), f: f.output };
  };
  const cases: [string, Record<string, unknown>][] = [["todos.texts", {}], ["todos.by-ids", { ids: [1, 2, 3, 4, 99] }], ["todos.by-ids", { ids: ["2", "4"] }], ["todos.by-ids", { ids: [] }], ["messages.count", { folder: "nowhere" }], ["people.names", {}], ["people.names", { ids: [1, 3] }], ["people.emails", {}]];
  for (const [kernel, input] of cases) {
    const { k, f } = await both(kernel, input);
    assert.deepEqual(f, k, `${kernel} ${JSON.stringify(input)}`);
  }
  // a caller without the table grant gets nothing — the replacement never has more rights than its caller
  const poor = s.createFlow({ name: name("rdp"), permissions: { sql: ["people"] }, nodes: [{ id: "x", kind: "action", action: "read.todos.texts", input: {} }] });
  assert.match((await e.runFlow(poor)).error ?? "", /may not read the table “todos”/);
});

test("lambdas call capabilities: read.* by name, only the tables the manifest grants, never a writing one or a program", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "lookups", "studio", "todos"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  const store = await import("@/plugins/workspace/lambdas/store");
  const run = await import("@/plugins/workspace/lambdas/run");
  const { declareReadReplacements } = await import("@/plugins/workspace/flows/declare");
  const { getSqlite } = await import("@/db");
  const { saveCapability } = await import("@/plugins/workspace/flows/capabilities");
  getSqlite().exec("delete from todos");
  getSqlite().prepare("insert into todos (ticket, text, note, status, created_at) values ('t', 'Pay rent', 'n', 'open', '2026-11-01T10:00:00Z')").run();
  declareReadReplacements();
  saveCapability({ name: "dsl.prog", label: "p", input: [], impl: { nodes: [{ id: "r", kind: "return", value: 1 }] } });
  const lam = (code: string, manifest: Record<string, unknown>) => store.createLambda({ manifest: { name: `dsl.l${++n}`, label: "t", what: "t", kind: "function", ...manifest }, files: { "index.mjs": code } });
  const call = (names: string[]) => `export async function handler(event, context) { const out = {}; for (const n of ${JSON.stringify(names)}) { try { out[n] = await context.zeff.call(n, n === "read.todos.by-ids" ? { ids: event.ids } : n === "core.pref.set" ? { key: "a.b", value: 1 } : {}); } catch (e) { out[n] = "ERR " + e.message; } } return out; }`;
  const names = ["read.todos.texts", "read.todos.by-ids", "core.pref.set", "dsl.prog"];
  // granted: its table
  const todoId = (getSqlite().prepare("select id from todos").get() as { id: number }).id;
  const ok = await run.runLambda(lam(call(names), { zeff: names, sql: ["todos"] }), { ids: [todoId] });
  assert.ok(ok.ok, ok.ok ? "" : ok.error);
  const r = (ok.ok ? ok.result : {}) as Record<string, unknown>;
  assert.deepEqual((r["read.todos.texts"] as { todos: { text: string }[] }).todos.map((x) => x.text), ["Pay rent"]);
  assert.equal((r["read.todos.by-ids"] as { todos: unknown[] }).todos.length, 1);
  assert.match(String(r["core.pref.set"]), /changes something/);
  assert.match(String(r.dsl_prog ?? r["dsl.prog"]), /program of flow nodes/);
  // not granted: nothing readable
  const no = await run.runLambda(lam(call(["read.todos.texts"]), { zeff: ["read.todos.texts"] }), {});
  assert.match(String(((no.ok ? no.result : {}) as Record<string, unknown>)["read.todos.texts"]), /may not read the table “todos”/);
  // not named in the manifest: refused as before
  const unnamed = await run.runLambda(lam(call(["read.todos.texts"]), { sql: ["todos"] }), {});
  assert.match(String(((unnamed.ok ? unnamed.result : {}) as Record<string, unknown>)["read.todos.texts"]), /name it in lambda\.json/);
});

test("more SQL replacements (mail.messages, mail.unread, documents.texts) answer like the kernel reads", async () => {
  const { s, e } = await world();
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["todos", "people", "documents"]) setInstalled(id, true);
  const { declareReadReplacements } = await import("@/plugins/workspace/flows/declare");
  const { flowAction } = await import("@/plugins/workspace/flows/actions");
  const { getSqlite } = await import("@/db");
  const sq = getSqlite();
  sq.exec("delete from emails");
  const mail = sq.prepare("insert into emails (key, conv_id, folder, from_name, from_email, subject, preview, received_at, unread, synced_at, resolved_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'x', ?)");
  for (let i = 0; i < 9; i++) mail.run(`k${i}`, `c${i}`, i === 3 ? "Archive" : i === 4 ? "WhatsApp" : i === 5 ? "Gesendet" : "Posteingang", i % 2 ? null : `Name ${i}`, `Mixed${i}@X.de`, `Subject ${i}`, i === 2 ? "needle here" : `preview ${i}`, `2026-11-0${i + 1}T10:00:00Z`, i === 7 ? 0 : 1, i === 6 ? "2026-11-09" : null);
  sq.exec("delete from documents");
  const doc = sq.prepare("insert into documents (name, sha256, file, summary, text, created_at, updated_at, status) values (?, ?, 'f', ?, ?, ?, ?, ?)");
  doc.run("Letter", "h1", "sum", "x".repeat(300), "2026-11-01", "2026-11-01", "ready");
  doc.run("Pending", "h2", "sum", "y", "2026-11-02", "2026-11-02", "queued");
  declareReadReplacements();
  const kctx = { flow: "t", runId: null, dryRun: false, perms: {}, web: async () => new URL("https://x.example.com"), canWrite: () => undefined, may: () => undefined, log: () => undefined };
  const both = async (kernel: string, input: Record<string, unknown>, perms: Record<string, unknown> = { sql: ["emails", "documents"] }) => {
    const k = await flowAction(kernel)!.run(input, kctx);
    const f = await e.runFlow(s.createFlow({ name: name("rd2"), permissions: perms, nodes: [{ id: "x", kind: "action", action: `read.${kernel}`, input }], output: "{{ steps.x }}" }));
    assert.equal(f.status, "done", f.error ?? "");
    return { k: JSON.parse(JSON.stringify(k)), f: f.output };
  };
  const cases: [string, Record<string, unknown>][] = [["mail.messages", {}], ["mail.messages", { contains: "needle" }], ["mail.messages", { contains: "nomatch" }], ["mail.messages", { limit: 3 }], ["mail.unread", {}], ["mail.unread", { limit: 2 }], ["mail.unread", { limit: 0 }], ["mail.unread", { limit: 500 }], ["documents.texts", {}], ["documents.texts", { chars: 150 }], ["documents.texts", { chars: 5 }]];
  for (const [kernel, input] of cases) {
    const { k, f } = await both(kernel, input);
    assert.deepEqual(f, k, `${kernel} ${JSON.stringify(input)}`);
  }
  // more rows than the default cap: the caller raises sqlMaxRows, as the kernel action's 50000 needs
  sq.exec("delete from emails");
  sq.exec("with recursive n(i) as (select 1 union all select i + 1 from n where i < 5200) insert into emails (key, conv_id, folder, subject, preview, received_at, unread, synced_at) select 'm' || i, 'c', 'Posteingang', 's', 'p', '2026-11-01', 1, 'x' from n");
  assert.equal(((await both("mail.messages", {}, { sql: ["emails"], sqlMaxRows: 50000 })).f as { messages: unknown[] }).messages.length, 5200);
  const capped = await both("mail.messages", {}, { sql: ["emails"] });
  assert.equal((capped.f as { messages: unknown[] }).messages.length, 5000, "without the grant: the default cap");
});

test("the generators' last step swaps a plugin's plain reads for their SQL replacements, with the grants", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { swapPlugin } = (await import("../scripts/lib/swap-reads.mts" as string)) as { swapPlugin: (dir: string) => string[] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsl-swap-"));
  fs.mkdirSync(path.join(dir, "lambdas", "x.one"), { recursive: true });
  fs.writeFileSync(path.join(dir, "lambdas", "x.one", "lambda.json"), JSON.stringify({ name: "x.one", label: "x", what: "x", kind: "function", zeff: ["store.query", "people.names", "mail.messages"] }));
  fs.writeFileSync(path.join(dir, "lambdas", "x.one", "index.mjs"), 'export async function handler(e, context) { const a = await context.zeff.call("people.names", { ids: [1] }); const b = await context.zeff.call("mail.messages", {}); const c = await context.zeff.call("store.query", {}); return [a, b, c]; }');
  fs.writeFileSync(path.join(dir, "x.package.json"), JSON.stringify({ flows: [{ name: "x.sync", nodes: [{ id: "n", kind: "action", action: "messages.count", input: { folder: "a" } }, { id: "m", kind: "action", action: "store.query", input: {} }], permissions: { store: ["x.y"] } }] }));
  const first = swapPlugin(dir);
  assert.deepEqual(first.sort(), [path.join("lambdas", "x.one", "index.mjs"), path.join("lambdas", "x.one", "lambda.json"), "x.package.json"].sort());
  const man = JSON.parse(fs.readFileSync(path.join(dir, "lambdas", "x.one", "lambda.json"), "utf8"));
  assert.deepEqual(man.zeff, ["store.query", "read.people.names", "read.mail.messages"]);
  assert.deepEqual(man.sql, ["emails", "people"]);
  assert.equal(man.sqlMaxRows, 50000);
  const code = fs.readFileSync(path.join(dir, "lambdas", "x.one", "index.mjs"), "utf8");
  assert.match(code, /call\("read\.people\.names"/);
  assert.match(code, /call\("store\.query"/, "what is no swapped read stays");
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "x.package.json"), "utf8"));
  assert.equal(pkg.flows[0].nodes[0].action, "read.messages.count");
  assert.equal(pkg.flows[0].nodes[1].action, "store.query");
  assert.deepEqual(pkg.flows[0].permissions, { store: ["x.y"], sql: ["emails"] });
  assert.deepEqual(swapPlugin(dir), [], "idempotent");
});
