import assert from "node:assert/strict";
import test from "node:test";
import { splitRefs } from "../src/lib/refs/shared";

test("splitRefs: ticket keys, T-37 and !168 in a text become references; the rest stays words", () => {
  const parts = splitRefs("Fix PROJ-12 after T-37, see !168 (not a!5 or XT-3x)", { hrefs: { "PROJ-12": "https://jira/browse/PROJ-12" } });
  assert.deepEqual(
    parts.filter((p) => p.kind).map((p) => [p.kind, p.id, p.href]),
    [["ticket", "PROJ-12", "https://jira/browse/PROJ-12"], ["todo", "37", "/t/37"], ["mr", "!168", undefined]],
  );
  assert.equal(parts.map((p) => p.text).join(""), "Fix PROJ-12 after T-37, see !168 (not a!5 or XT-3x)");
  assert.deepEqual(splitRefs("PROJ-1 and T-2", { tickets: false }).filter((p) => p.kind).map((p) => p.kind), ["todo"]);
});
