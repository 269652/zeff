import assert from "node:assert/strict";
import test from "node:test";
import { createReloadGate } from "@/plugins/workspace/ui/database/reload-gate";

test("a read that started before the second click doesn't overwrite it; one read follows the last answer", () => {
  const g = createReloadGate();
  g.startEdit(); // click 1
  const early = g.begin(); // the read the first click's change event starts
  g.startEdit(); // click 2, quickly
  assert.equal(g.accept(early), false, "late answer of the early read is dropped");
  assert.equal(g.endEdit(), false, "answer 1: another save is still open");
  assert.equal(g.endEdit(), true, "answer 2: the last one — read once now");
  const again = g.begin();
  assert.equal(g.accept(again), true);
});

test("only the newest read counts", () => {
  const g = createReloadGate();
  const a = g.begin();
  const b = g.begin();
  assert.equal(g.accept(a), false);
  assert.equal(g.accept(b), true);
});

test("a read while saves are open waits for them", () => {
  const g = createReloadGate();
  g.startEdit();
  assert.equal(g.request(), false);
  assert.equal(g.endEdit(), true);
  assert.equal(g.request(), true);
});

test("without edits nothing changes", () => {
  const g = createReloadGate();
  assert.equal(g.accept(g.begin()), true);
  assert.equal(g.endEdit(), false);
});
