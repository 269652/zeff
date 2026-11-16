import assert from "node:assert/strict";
import test from "node:test";

test("people list: search, starred only, sorts", async () => {
  const { filterPeople } = await import("@/plugins/people/list-filter");
  const row = (id: number, name: string, o: Partial<Parameters<typeof filterPeople>[0][number]> = {}) => ({ id, name, aliases: [], emails: [], note: "", starred: false, createdAt: `2026-01-0${id}`, nextDays: null, lastAt: null, ...o });
  const rows = [row(1, "Zoe", { aliases: ["Zozo"], nextDays: 3, lastAt: "2026-05-01" }), row(2, "Adam", { emails: ["adam@x.de"], note: "plays chess", nextDays: 1 }), row(3, "Mia", { starred: true, lastAt: "2026-06-01" })];
  const ids = (r: typeof rows) => r.map((p) => p.id);
  const base = { query: "", starredOnly: false };
  assert.deepEqual(ids(filterPeople(rows, { ...base, sort: "name" })), [3, 2, 1]); // starred first
  assert.deepEqual(ids(filterPeople(rows, { ...base, sort: "next" })), [3, 2, 1]);
  assert.deepEqual(ids(filterPeople(rows, { ...base, starredOnly: true, sort: "name" })), [3]);
  assert.deepEqual(ids(filterPeople(rows, { query: "zozo", starredOnly: false, sort: "name" })), [1]);
  assert.deepEqual(ids(filterPeople(rows, { query: "ADAM@x chess", starredOnly: false, sort: "name" })), [2]); // case-insensitive, words across fields
  assert.deepEqual(ids(filterPeople(rows, { query: "adam zoe", starredOnly: false, sort: "name" })), []);
  assert.deepEqual(ids(filterPeople(rows, { query: "chess x.de", starredOnly: false, sort: "name" })), [2]);
  assert.deepEqual(ids(filterPeople(rows, { query: "", starredOnly: false, sort: "recent" })), [3, 1, 2]);
  assert.deepEqual(ids(filterPeople(rows.map((r) => ({ ...r, starred: false })), { ...base, sort: "next" })), [2, 1, 3]);
  assert.deepEqual(ids(filterPeople(rows.map((r) => ({ ...r, starred: false })), { ...base, sort: "added" })), [3, 2, 1]);
});
