import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("answerKey: the same inputs give one key, whatever the order", async () => {
  const { answerKey } = await import("@/lib/data-cache");
  assert.equal(answerKey("flow", "a.b", { x: 1, y: { q: 2, p: 3 } }, 5), answerKey("flow", "a.b", { y: { p: 3, q: 2 }, x: 1 }, 5));
  assert.notEqual(answerKey("flow", "a.b", { x: 1 }), answerKey("lambda", "a.b", { x: 1 }));
  assert.notEqual(answerKey("flow", "a.b", { x: 1 }), answerKey("flow", "a.b", { x: 2 }));
});

test("kept answers: peek gives the last one back, kept in the database too", async () => {
  const { answerKey, peekAnswer, rememberAnswer } = await import("@/lib/data-cache");
  const key = answerKey("flow", "t.kept", { n: 1 });
  assert.equal(peekAnswer(key), null);
  rememberAnswer(key, { ok: true, status: "done", output: { rows: [1, 2] } });
  assert.deepEqual((peekAnswer(key)?.answer as { output: unknown }).output, { rows: [1, 2] });
  // (a second process: memory gone, the database still has it)
  (globalThis as { __zeffAnswerCache?: Map<string, unknown> }).__zeffAnswerCache?.clear();
  assert.deepEqual((peekAnswer(key)?.answer as { output: unknown }).output, { rows: [1, 2] });
  // (too big: not kept)
  const big = answerKey("flow", "t.big", {});
  rememberAnswer(big, { output: "x".repeat(500_000) });
  assert.equal(peekAnswer(big), null);
});

test("inflight: the same thing asked twice at once runs once", async () => {
  const { inflight } = await import("@/lib/data-cache");
  let runs = 0;
  const slow = () => new Promise<number>((r) => setTimeout(() => r(++runs), 20));
  const [a, b] = await Promise.all([inflight("k", slow), inflight("k", slow)]);
  assert.equal(a, b);
  assert.equal(runs, 1);
  assert.equal(await inflight("k", slow), 2);
});

test("swr: the first read waits, the next answers at once and refreshes in the background", async () => {
  const { swr, forgetSwr } = await import("@/lib/data-cache");
  let n = 0;
  const load = async () => ++n;
  assert.equal(await swr("t:s", -1, load), 1);
  // (older than its time-to-live: the old value now, the new one loaded behind it)
  assert.equal(await swr("t:s", -1, load), 1);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(await swr("t:s", 60_000, load), 2);
  assert.equal(await swr("t:s", 60_000, load, { fresh: true }), 3);
  forgetSwr("t:");
  assert.equal(await swr("t:s", 60_000, load), 4);
});
