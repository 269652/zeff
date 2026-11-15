import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Flow runs as a queue that survives Zeff stopping: each step done is kept at once (its output in the run's journal, a sign of life); a run
 * cut off mid-way is taken up again where it was — what was done read from the journal, not done twice. And the queue never stalls: a run
 * cut off again and again (it may be what stops Zeff) and one cut off long ago end with why; at most a few are taken up at once and the clock
 * never waits for them; a run still going on here is never taken up twice.
 */

async function world() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  await import("@/plugins/contributions");
  return { s: await import("@/plugins/workspace/flows/store"), e: await import("@/plugins/workspace/flows/engine"), sqlite: (await import("@/db")).getSqlite() };
}
let n = 0;
const name = (base: string) => `${base}.q${++n}`;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

test("each step done is kept at once: a run cut off after its first step goes on after it — the first not done again", async () => {
  const { s, e, sqlite } = await world();
  const f = s.createFlow({
    name: name("cut"),
    nodes: [
      { id: "one", kind: "action", action: "time.now", input: {} },
      { id: "two", kind: "set", vars: { said: "{{ steps.one }}" } },
    ],
    output: "{{ vars.said }}",
  });
  // A run as Zeff left it when it stopped: "running", its first step done (kept), no sign of life for 20 minutes.
  const runId = s.startFlowRun({ pageId: f.pageId, name: f.name, def: f }, { kind: "manual" }, {}, false);
  s.keepRunProgress(runId, { one: { output: "FROM THE JOURNAL", at: ago(20 * 60_000) } }, []);
  sqlite.prepare("update ws_flow_runs set touched_at = ?, started_at = ? where id = ?").run(ago(20 * 60_000), ago(21 * 60_000), runId);
  assert.equal(await e.resumeCutOffRuns(new Date(), { wait: true }), 1);
  const run = s.getFlowRun(runId)!;
  assert.equal(run.status, "done", run.error ?? "");
  assert.equal(run.output, "FROM THE JOURNAL", "the first step's output from the journal: not run again");
  assert.equal(await e.resumeCutOffRuns(new Date(), { wait: true }), 0, "done: nothing to take up");
});

test("a run that moved lately isn't cut off; one going on in this process is never taken up twice", async () => {
  const { s, e, sqlite } = await world();
  const f = s.createFlow({ name: name("fresh"), nodes: [{ id: "x", kind: "set", vars: { a: 1 } }] });
  const fresh = s.startFlowRun({ pageId: f.pageId, name: f.name, def: f }, { kind: "manual" }, {}, false);
  sqlite.prepare("update ws_flow_runs set touched_at = ? where id = ?").run(ago(60_000), fresh);
  assert.equal(await e.resumeCutOffRuns(new Date(), { wait: true }), 0, "a sign of life a minute ago: still going");
  // (a run going on here, quiet for long — a slow step: left alone)
  const live = (globalThis as { __zeffLiveFlowRuns?: Set<number> }).__zeffLiveFlowRuns!;
  sqlite.prepare("update ws_flow_runs set touched_at = ? where id = ?").run(ago(60 * 60_000), fresh);
  live.add(fresh);
  try {
    assert.equal(await e.resumeCutOffRuns(new Date(), { wait: true }), 0);
  } finally {
    live.delete(fresh);
  }
  assert.equal(await e.resumeCutOffRuns(new Date(), { wait: true }), 1, "no longer going on here: taken up");
});

test("the queue doesn't stall: a run cut off again and again, and one cut off days ago, end with why", async () => {
  const { s, e, sqlite } = await world();
  const f = s.createFlow({ name: name("poison"), nodes: [{ id: "x", kind: "set", vars: { a: 1 } }] });
  const poison = s.startFlowRun({ pageId: f.pageId, name: f.name, def: f }, { kind: "manual" }, {}, false);
  s.keepRunProgress(poison, { __resumed: { output: { times: e.MAX_RESUMES }, at: ago(30 * 60_000) } }, []);
  sqlite.prepare("update ws_flow_runs set touched_at = ? where id = ?").run(ago(30 * 60_000), poison);
  const old = s.startFlowRun({ pageId: f.pageId, name: f.name, def: f }, { kind: "manual" }, {}, false);
  sqlite.prepare("update ws_flow_runs set touched_at = ?, started_at = ? where id = ?").run(ago(3 * 864e5), ago(3 * 864e5), old);
  await e.resumeCutOffRuns(new Date(), { wait: true });
  assert.equal(s.getFlowRun(poison)!.status, "failed");
  assert.match(s.getFlowRun(poison)!.error ?? "", /not taken up again/);
  assert.equal(s.getFlowRun(old)!.status, "failed");
  assert.match(s.getFlowRun(old)!.error ?? "", /two days ago/);
});

test("the clock never waits for a run it takes up: one that hangs holds up nothing; at most three at once", async () => {
  const { s, e, sqlite } = await world();
  const { extensionPoint } = await import("@/lib/plugin-kit/extension-point");
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  extensionPoint("workspace.flowActions").contribute("core:test-hang", [{ name: "test.hang", group: "test", label: "hang", summary: "", input: [], output: "", run: async () => (await gate, "done") }] as never);
  const f = s.createFlow({ name: name("hang"), nodes: [{ id: "h", kind: "action", action: "test.hang", input: {} }] });
  const ids = [1, 2, 3, 4].map(() => {
    const id = s.startFlowRun({ pageId: f.pageId, name: f.name, def: f }, { kind: "manual" }, {}, false);
    sqlite.prepare("update ws_flow_runs set touched_at = ? where id = ?").run(ago(20 * 60_000), id);
    return id;
  });
  const t0 = Date.now();
  assert.equal(await e.resumeCutOffRuns(new Date()), 3, "three taken up, the fourth next time");
  assert.ok(Date.now() - t0 < 2000, "not waited for");
  assert.equal(await e.resumeCutOffRuns(new Date()), 0, "while three go on: none more (and the three not twice)");
  release();
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(ids.slice(0, 3).map((id) => s.getFlowRun(id)!.status), ["done", "done", "done"]);
  assert.equal(await e.resumeCutOffRuns(new Date(), { wait: true }), 1, "then the fourth");
  assert.equal(s.getFlowRun(ids[3])!.status, "done");
});

test("a run that hangs (no step done for an hour) is ended and its place freed: the queue goes on", async () => {
  const { s, e, sqlite } = await world();
  const f = s.createFlow({ name: name("stuck"), nodes: [{ id: "x", kind: "set", vars: { a: 1 } }] });
  const stuck = s.startFlowRun({ pageId: f.pageId, name: f.name, def: f }, { kind: "manual" }, {}, false);
  const live = (globalThis as { __zeffLiveFlowRuns?: Set<number> }).__zeffLiveFlowRuns!;
  live.add(stuck);
  sqlite.prepare("update ws_flow_runs set touched_at = ? where id = ?").run(ago(30 * 60_000), stuck);
  await e.resumeCutOffRuns(new Date(), { wait: true });
  assert.equal(s.getFlowRun(stuck)!.status, "running", "half an hour quiet, going on here: left alone");
  sqlite.prepare("update ws_flow_runs set touched_at = ? where id = ?").run(ago(61 * 60_000), stuck);
  await e.resumeCutOffRuns(new Date(), { wait: true });
  assert.equal(s.getFlowRun(stuck)!.status, "failed");
  assert.match(s.getFlowRun(stuck)!.error ?? "", /hung/);
  assert.ok(!live.has(stuck), "its place freed");
});
