import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";

setupTempData();

/**
 * Google Keep's port (zeff-plugins/plugins/keep-ext) — all of Keep's own in the plugin: its scraper a driver lambda (kept like any lambda:
 * fixable, the fix in the database), keeping the notes its store, the Google Keep database the kernel's db.mirror. Two syncs (a first read,
 * then one with a note changed, one gone and a label new) give the same notes and the same database as the built-in, row for row.
 */

const skip = skipWithoutRepo("keep-ext");
const at = (d: number) => new Date(Date.UTC(2026, 9, d, 9)).toISOString();
const note = (id: string, v: Record<string, unknown> = {}) => ({ id, kind: "note", title: "", text: "", labels: [], color: null, pinned: false, archived: false, createdAt: at(1), updatedAt: at(2), url: `https://keep.google.com/u/0/#NOTE/${id}`, ...v });
const FIRST = [
  note("a", { title: "Einkauf", kind: "list", text: "- [ ] Milch\n- [x] Brot", labels: ["Haushalt"], color: "yellow", pinned: true }),
  note("b", { text: "Idee: Zeff als Plugin\nzweite Zeile", labels: ["Ideen", "Zeff"], color: "teal" }),
  note("c", { title: "Alt", text: "archiviert", archived: true }),
  note("d", { title: "Weg", text: "kommt nicht wieder" }),
];
const SECOND = [
  note("a", { title: "Einkauf", kind: "list", text: "- [x] Milch\n- [x] Brot", labels: ["Haushalt", "Woche"], color: "yellow", pinned: true, updatedAt: at(5) }),
  note("b", { text: "Idee: Zeff als Plugin\nzweite Zeile", labels: ["Ideen", "Zeff"], color: "teal" }),
  note("c", { title: "Alt", text: "archiviert", archived: true }),
  note("e", { title: "Neu", text: "frisch", color: "cerulean", createdAt: at(6), updatedAt: at(6) }),
];

async function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-keep-ext-"));
  process.env.ZEFF_PLUGINS_DIR = dir;
  fs.cpSync(repoPlugin("keep-ext"), path.join(dir, "keep-ext"), { recursive: true });
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "keep"]) setInstalled(id as never, true);
  await import("@/plugins/contributions");
  (await import("@/lib/ext/registry")).scanPlugins(true);
}

/** The notes kept and the Google Keep database as it reads: each row's title, its fields by name (options by name), its page, its times. */
async function snapshot() {
  const { getSqlite } = await import("@/db");
  const ws = await import("@/plugins/workspace/store");
  const { getPref } = await import("@/lib/prefs");
  const notes = getSqlite().prepare("select id, kind, title, text, labels, color, pinned, archived, created_at, updated_at, url from keep_notes order by id").all();
  const db = getPref<number | null>("ext.mirror.keep-ext.google", null) ?? getPref<number | null>("keep.googleDb", null);
  const d = ws.getDatabase(db!)!;
  const opt = (prop: string, id: unknown) => d.schema.properties.find((p) => p.id === prop)?.options?.find((o) => o.id === id)?.name ?? null;
  const rows = ws
    .rawRows(db!)
    .map((r) => {
      const page = getSqlite().prepare("select body_text, created_at, updated_at from ws_pages where id = ?").get(r.id) as Record<string, string>;
      return { title: r.title, color: opt("color", r.cells.color), pinned: r.cells.pinned ?? null, labels: ((r.cells.labels as string[]) ?? []).map((x) => opt("labels", x)), note: r.cells.noteref, edited: r.cells.keepedited ?? null, text: page.body_text, created: page.created_at, updated: page.updated_at };
    })
    .sort((a, b) => String(a.note).localeCompare(String(b.note)));
  const page = ws.getPage(db!)!;
  return { notes, rows, labels: d.schema.properties.find((p) => p.id === "labels")!.options!.map((o) => [o.name, o.color]), views: d.schema.views.map((v) => [v.name, v.type, v.hidden]), page: { title: page.title, fullWidth: page.fullWidth, locked: page.locked } };
}

async function reset() {
  const { getSqlite } = await import("@/db");
  const { getPref, setPref } = await import("@/lib/prefs");
  const ws = await import("@/plugins/workspace/store");
  getSqlite().exec("delete from keep_notes");
  for (const k of ["keep.googleDb", "ext.mirror.keep-ext.google"]) {
    const id = getPref<number | null>(k, null);
    if (id && ws.getPage(id)) ws.archivePage(id);
    setPref(k, null);
  }
}

test("Keep's port: two syncs give the same notes and the same Google Keep database as the built-in — its scraper a driver, run only as one", { skip }, async () => {
  await world();
  // The built-in: its sync's keeping and its database, twice.
  const store = await import("@/plugins/keep/store");
  const gws = await import("@/plugins/keep/google-workspace");
  store.keepCount();
  store.saveKeepNotes(FIRST as never, true);
  gws.syncGoogleKeepDatabase();
  const builtinFirst = await snapshot();
  store.saveKeepNotes(SECOND as never, true);
  gws.syncGoogleKeepDatabase();
  const builtin = await snapshot();
  assert.equal(builtin.rows.length, 3, "a, b, e — not the archived c, not the gone d");
  await reset();

  // The port: switched, its flow run twice with what the scraper would read.
  const { switchKeepToPlugin } = await import("@/plugins/keep/to-plugin");
  await switchKeepToPlugin();
  const state = await import("@/plugins/state");
  assert.equal(state.stepAvailable("keep"), false, "the built-in's step doesn't run");
  const reads: unknown[] = [];
  let next: unknown[] = FIRST;
  (globalThis as { __zeffDriverStandIn?: unknown }).__zeffDriverStandIn = (name: string, event: unknown) => {
    reads.push([name, event]);
    return { notes: next, full: true, pages: 1 };
  };
  try {
    const { runFlow } = await import("@/plugins/workspace/flows/engine");
    const r1 = await runFlow("keep.sync", {});
    assert.equal(r1.status, "done", r1.error ?? "");
    assert.deepEqual(r1.output, { ok: true, message: "4 new · 0 changed · 4 in all" });
    assert.deepEqual(JSON.parse(JSON.stringify(await snapshot())).rows, JSON.parse(JSON.stringify(builtinFirst)).rows);
    next = SECOND;
    const r2 = await runFlow("keep.sync", {});
    assert.equal(r2.status, "done", r2.error ?? "");
    assert.deepEqual(r2.output, { ok: true, message: "1 new · 1 changed · 1 removed · 4 in all" });
  } finally {
    delete (globalThis as { __zeffDriverStandIn?: unknown }).__zeffDriverStandIn;
  }
  assert.deepEqual(reads[0], ["keep.driver", { tool: "notes", account: "0", launch: true }], "the scraper asked for the account's notes");
  const port = await snapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(port)), JSON.parse(JSON.stringify(builtin)));

  // The scraper is a lambda of kind driver: kept like any (fixable in the Studio), run only as a driver.
  const { getLambda } = await import("@/plugins/workspace/lambdas/store");
  assert.equal(getLambda("keep.driver")?.manifest.kind, "driver");
  const { invokeLambda } = await import("@/plugins/workspace/lambdas/run");
  const plain = await invokeLambda("keep.driver", { tool: "status" });
  assert.equal(plain.ok, false);
  assert.match(plain.ok ? "" : plain.error, /only a flow calls it/);
  const flows = await import("@/plugins/workspace/flows/store");
  flows.createFlow({ name: "t.keep.nope", nodes: [{ id: "r", kind: "action", action: "driver.call", input: { name: "keep.driver", event: { tool: "status" } } }] });
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  assert.match((await runFlow("t.keep.nope", {})).error ?? "", /may not run the driver/);
});
