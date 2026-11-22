import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

// (the plugins' contributions loaded first, as the server does at its start: the places and the flow actions they add to are ready — without
// a booking integration mounted nothing else loads them before)
test.before(async () => void (await import("@/plugins/contributions")));

/** The Todos screen's buttons of other plugins (todos.actions): every field there, a contributor that fails left out. */
test("the Todos screen lists the buttons other plugins put there", async () => {
  const { todoPlaces, todoActions } = await import("@/plugins/todos/places");
  todoPlaces.contribute("core:test-places", { actions: () => [{ label: "Open the export", href: "/export/x" }, { label: "No target" }] });
  todoPlaces.contribute("core:test-broken", { actions: () => { throw new Error("broken"); } });
  const groups = await todoActions();
  const mine = groups.find((g) => g.plugin === "core:test-places");
  assert.deepEqual(mine?.actions, [{ label: "Open the export", href: "/export/x", flow: "", with: "", confirm: "", tip: "" }]);
  assert.equal(groups.some((g) => g.plugin === "core:test-broken"), false);
  const { flowAction } = await import("@/plugins/workspace/flows/actions");
  await import("@/plugins/todos/flow-actions");
  const read = (await flowAction("todos.actions")!.run({}, {} as never)) as { actions: { label: string }[] };
  assert.ok(read.actions.some((a) => a.label === "Open the export"));
});

/** A button of the time report's places that runs its contributor's own handler (TimeSlot.run via time.slot-run). */
test("a slot button runs its contributor's handler, a refusal is an error", async () => {
  const { timeSlots, slotRun, runSlot, SLOT_RUN_FLOW } = await import("@/plugins/zeiterfassung/time-slots");
  const seen: Record<string, string>[] = [];
  timeSlots.contribute("core:test-slot", { run: async (op, input) => (seen.push({ op, ...input }), op === "pull" ? { ok: true, message: "pulled" } : { ok: false, message: "no such button" }) });
  const a = slotRun("core:test-slot", "pull", "Pull", { week: "2026-W40" });
  assert.equal(a.flow, SLOT_RUN_FLOW);
  assert.equal(a.with, "plugin=core:test-slot, op=pull, week=2026-W40");
  assert.equal(await runSlot("core:test-slot", "pull", { week: "2026-W40" }), "pulled");
  await assert.rejects(runSlot("core:test-slot", "other", {}), /no such button/);
  await assert.rejects(runSlot("core:nobody", "pull", {}), /no buttons of its own/);
  await import("@/plugins/zeiterfassung/flow-actions");
  const { flowAction } = await import("@/plugins/workspace/flows/actions");
  const out = await flowAction("time.slot-run")!.run({ plugin: "core:test-slot", op: "pull", week: "2026-W41", month: "" }, { dryRun: false } as never);
  assert.deepEqual(out, { ok: true, message: "pulled" });
  assert.deepEqual(seen.at(-1), { op: "pull", week: "2026-W41" });
});
