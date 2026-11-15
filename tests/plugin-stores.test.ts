import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();
const plugins = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-plugins-"));
process.env.ZEFF_PLUGINS_DIR = plugins;

/**
 * Capability E — plugins' stores (lib/ext/stores.ts, the store actions): a plugin's own data beyond Workspace databases, in tables the
 * kernel keeps for it; written and read by key through a flow with the permission, read by its own lambdas; a column added later is
 * added to the table; a port may keep using only the built-in tables the kernel lets it adopt.
 */

const write = (id: string, manifest: object) => {
  fs.mkdirSync(path.join(plugins, id), { recursive: true });
  fs.writeFileSync(path.join(plugins, id, "zeff-plugin.json"), JSON.stringify({ name: id, apiVersion: 1, id, ...manifest }));
};
const MSGS = { name: "messages", key: "id", columns: [{ name: "id", type: "text" }, { name: "chat", type: "text" }, { name: "at", type: "text" }, { name: "seen", type: "integer" }, { name: "data", type: "json" }], indexes: [["chat", "at"]] };

async function world() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  await import("@/plugins/contributions");
  const reg = await import("@/lib/ext/registry");
  return { reg, flows: await import("@/plugins/workspace/flows/store"), engine: await import("@/plugins/workspace/flows/engine"), stores: await import("@/lib/ext/stores") };
}

test("a manifest declares stores: their key one of their columns, names checked", async () => {
  const { parseManifest } = await import("@/lib/ext/manifest");
  assert.ok(parseManifest(JSON.stringify({ id: "pl", name: "P", apiVersion: 1, contributes: { stores: [MSGS] } })).ok);
  assert.ok(!parseManifest(JSON.stringify({ id: "pl", name: "P", apiVersion: 1, contributes: { stores: [{ ...MSGS, key: "nope" }] } })).ok, "the key must be a column");
  assert.ok(!parseManifest(JSON.stringify({ id: "pl", name: "P", apiVersion: 1, contributes: { stores: [{ ...MSGS, name: "Bad Name" }] } })).ok);
});

test("a flow with the permission writes and reads a store by key; json kept as it was; without the permission: no", async () => {
  const { reg, flows, engine, stores } = await world();
  write("chatty", { contributes: { stores: [MSGS] } });
  reg.scanPlugins(true);
  reg.setEnabled("chatty", true);
  flows.createFlow({
    name: "t.store.rw",
    nodes: [
      { id: "put", kind: "action", action: "store.put", input: { store: "chatty.messages", rows: [{ id: "m1", chat: "eva", at: "2026-11-14T10:00", seen: false, data: { text: "Hi", n: [1, 2] } }, { id: "m2", chat: "eva", at: "2026-11-14T11:00", seen: true }] } },
      { id: "again", kind: "action", action: "store.put", input: { store: "chatty.messages", rows: [{ id: "m1", seen: true }] } },
      { id: "read", kind: "action", action: "store.query", input: { store: "chatty.messages", where: { chat: "eva" }, order: "-at" } },
    ],
    output: "{{ steps.read }}",
    permissions: { store: ["chatty.messages"] },
  });
  const r = await engine.runFlow("t.store.rw");
  assert.equal(r.status, "done", r.error ?? "");
  const out = r.output as { rows: Record<string, unknown>[]; total: number };
  assert.equal(out.total, 2);
  assert.deepEqual(out.rows.map((x) => x.id), ["m2", "m1"], "newest first");
  assert.deepEqual(out.rows[1].data, { text: "Hi", n: [1, 2] }, "json as it was");
  assert.equal(out.rows[1].seen, 1, "changed by its key, the other columns kept");
  assert.equal(out.rows[1].chat, "eva");
  flows.createFlow({ name: "t.store.denied", nodes: [{ id: "q", kind: "action", action: "store.query", input: { store: "chatty.messages" } }] });
  assert.match((await engine.runFlow("t.store.denied")).error ?? "", /may not use the store/);
  assert.throws(() => stores.storeDelete("chatty.messages", {}), /needs a where/);
  assert.equal(stores.storeDelete("chatty.messages", { id: "m2" }).deleted, 1);
  assert.throws(() => stores.storePut("chatty.messages", [{ id: "x", nope: 1 }]), /no column nope/);
});

test("a column added in a newer version is added to the table; a store of a plugin that is off can't be used", async () => {
  const { reg, stores } = await world();
  write("chatty", { contributes: { stores: [{ ...MSGS, columns: [...MSGS.columns, { name: "sender", type: "text" }] }] } });
  reg.scanPlugins(true);
  stores.storePut("chatty.messages", [{ id: "m3", sender: "Tom" }]);
  assert.equal(stores.storeQuery("chatty.messages", { where: { id: "m3" } }).rows[0].sender, "Tom");
  assert.equal(stores.storeQuery("chatty.messages", { where: { id: "m1" } }).rows[0].sender, null, "older rows: empty");
  reg.setEnabled("chatty", false);
  assert.throws(() => stores.storeQuery("chatty.messages"), /isn't on/);
});

test("adopting a built-in's table: only a port the kernel allows, only a table that is there", async () => {
  const { reg, stores } = await world();
  write("thief", { contributes: { stores: [{ name: "people", key: "id", columns: [{ name: "id", type: "integer" }], adopts: "people" }] } });
  write("cases-ext", { contributes: { stores: [{ name: "cases", key: "id", columns: [{ name: "id", type: "integer" }, { name: "label", type: "text" }], adopts: "cases" }] } });
  reg.scanPlugins(true);
  reg.setEnabled("thief", true);
  reg.setEnabled("cases-ext", true);
  assert.throws(() => stores.storeQuery("thief.people"), /may not use the table/);
  const { getSqlite } = await import("@/db");
  getSqlite().exec("create table if not exists cases (id integer primary key autoincrement, key text, label text not null default '')");
  getSqlite().prepare("insert into cases (key, label) values (?, ?)").run("AZ 1", "AZ 1/26");
  const rows = stores.storeQuery("cases-ext.cases").rows;
  assert.deepEqual(rows.map((x) => x.label), ["AZ 1/26"], "the built-in's own rows — nothing copied");
});

test("a store's key may be columns together: a row is the same row when all of them are", async () => {
  const { reg, stores } = await world();
  write("linker", { contributes: { stores: [{ name: "links", key: ["case_id", "ref"], columns: [{ name: "case_id", type: "integer" }, { name: "ref", type: "text" }, { name: "title", type: "text" }] }] } });
  reg.scanPlugins(true);
  reg.setEnabled("linker", true);
  stores.storePut("linker.links", [{ case_id: 1, ref: "mail:a", title: "A" }, { case_id: 1, ref: "mail:b", title: "B" }, { case_id: 2, ref: "mail:a", title: "A2" }]);
  stores.storePut("linker.links", [{ case_id: 1, ref: "mail:a", title: "A again" }]);
  const rows = stores.storeQuery("linker.links", { order: "title" }).rows;
  assert.deepEqual(rows.map((r) => r.title), ["A again", "A2", "B"]);
  assert.throws(() => stores.storePut("linker.links", [{ case_id: 3 }]), /needs its key/);
});
