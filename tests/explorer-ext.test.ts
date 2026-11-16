import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";

setupTempData();

/**
 * Explorer's port (zeff-plugins/plugins/explorer-ext): its two lambdas read the disk through the kernel's bounded fs.* actions and give what the screen draws — the
 * same folders, entries and files as the built-in Explorer's (files.ts); the guard keeps Zeff's own data out; what changes something is a flow that needs "api";
 * the screen (views/explorer.html) draws without an error.
 */

const skip = skipWithoutRepo("explorer-ext");
type Entry = { name: string; path: string; dir: boolean; size: number; mtime: number; docId: number | null };
type Screen = { path: string; parent: string; atPc: boolean; entries: (Entry & { icon: string; type: string; size: string; sizeBytes: number })[]; crumbs: { name: string; path: string }[]; error: string | null; count: number; nPicked: number; pickedFiles: string; folder: string; drives: { path: string }[] };

let made: ReturnType<typeof build> | null = null;
const world = () => (made ??= build());
async function build() {
  const plugins = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-explorer-ext-"));
  process.env.ZEFF_PLUGINS_DIR = plugins;
  fs.cpSync(repoPlugin("explorer-ext"), path.join(plugins, "explorer-ext"), { recursive: true });
  const state = await import("@/plugins/state");
  const { getDb, schema } = await import("@/db");
  for (const id of ["workspace", "documents"]) state.setInstalled(id as never, true);
  await import("@/plugins/contributions");
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  reg.setEnabled("explorer-ext", true);
  // (the built-in off, there through its port)
  state.setInstalled("explorer", false);
  getDb().insert(schema.plugins).values({ id: "x:explorer-ext", installed: true, changedAt: new Date().toISOString() }).onConflictDoUpdate({ target: schema.plugins.id, set: { installed: true } }).run();
  state.setInstalled("workspace", true); // (drops the memo)
  assert.equal(state.isInstalled("explorer"), true, "the Explorer is there through its port");
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("explorer-ext"), "explorer.package.json"), "utf8"));
  const r = await (await import("@/plugins/workspace/package-life")).installTracked(pkg, null, { allow: true });
  const lambdas = await import("@/plugins/workspace/lambdas/store");
  const { runLambda } = await import("@/plugins/workspace/lambdas/run");
  const call = async <T>(name: string, event: Record<string, unknown>): Promise<T> => {
    const l = lambdas.getLambda(name);
    assert.ok(l, `${name} is there`);
    const run = await runLambda(l!, event);
    assert.ok(run.ok, run.ok ? "" : run.error);
    return run.result as T;
  };
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-explorer-files-"));
  fs.mkdirSync(path.join(folder, "Beta"));
  fs.mkdirSync(path.join(folder, "alpha"));
  fs.writeFileSync(path.join(folder, "notes.md"), "# Notes\n\nSome text.\n");
  fs.writeFileSync(path.join(folder, "table.csv"), 'name;amount\n"A; B";3\nC;4\n');
  fs.writeFileSync(path.join(folder, "plain.txt"), "hello");
  fs.writeFileSync(path.join(folder, "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(folder, "latin.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
  fs.writeFileSync(path.join(folder, ".hidden"), "x");
  fs.writeFileSync(path.join(folder, "thing.xyz"), "x");
  return { allowed: r.allowed, call, folder };
}

test("the screen's lambda lists a folder as the built-in does: folders first, hidden ones left out, the crumbs, the picks", { skip }, async () => {
  const { call, folder, allowed } = await world();
  assert.deepEqual([...allowed].sort(), ["explorer.import", "explorer.import-folder", "explorer.make", "explorer.open-here", "explorer.save", "explorer.unwatch", "explorer.watch", "explorer.watch-mode"]);
  const { listDir } = await import("@/plugins/explorer/files");
  const built = listDir(folder);
  const screen = await call<Screen>("explorer.screen", { path: folder });
  assert.equal(screen.error, null);
  assert.deepEqual(screen.entries.map((e) => [e.name, e.dir, e.path]), built.entries.map((e) => [e.name, e.dir, e.path]));
  assert.deepEqual(screen.entries.map((e) => e.name), ["alpha", "Beta", "latin.txt", "notes.md", "pic.png", "plain.txt", "table.csv", "thing.xyz"]);
  assert.equal(screen.count, built.entries.length);
  assert.equal(screen.parent, built.parent);
  assert.equal(screen.crumbs.at(-1)?.path, path.resolve(folder));
  assert.equal(screen.entries.find((e) => e.name === "alpha")?.icon, "📁");
  assert.equal(screen.entries.find((e) => e.name === "notes.md")?.icon, "📝");
  assert.equal(screen.entries.find((e) => e.name === "thing.xyz")?.type, "XYZ");
  // A filter and a picked file.
  const filtered = await call<Screen>("explorer.screen", { path: folder, filter: "NOTES" });
  assert.deepEqual(filtered.entries.map((e) => e.name), ["notes.md"]);
  const md = path.join(folder, "notes.md");
  const picked = await call<Screen>("explorer.screen", { path: folder, picked: JSON.stringify([md]) });
  assert.equal(picked.nPicked, 1);
  assert.deepEqual(JSON.parse(picked.pickedFiles), [md]);
  assert.equal(picked.folder, built.path ?? ""); // (no folder picked: the one we're in)
  const sub = await call<Screen>("explorer.screen", { path: folder, picked: JSON.stringify([path.join(folder, "alpha")]) });
  assert.equal(sub.folder, path.join(folder, "alpha")); // (a folder picked: the folder actions are about it)
  // This PC.
  const pc = await call<Screen>("explorer.screen", {});
  assert.equal(pc.atPc, true);
  assert.deepEqual(pc.entries.map((e) => e.path), pc.drives.map((d) => d.path));
  // A folder that isn't there: This PC, and why.
  const gone = await call<Screen>("explorer.screen", { path: path.join(folder, "nope") });
  assert.equal(gone.atPc, true);
  assert.match(gone.error ?? "", /isn't there/);
});

test("the guard: never Zeff's own data, never a relative path; the lambda that doesn't name an action may not call it", { skip }, async () => {
  const { call, folder } = await world();
  const { flowAction } = await import("@/plugins/workspace/flows/actions");
  const ctx = { flow: "lambda:test", runId: null, dryRun: false, perms: {}, web: async () => new URL("https://x.y"), canWrite: () => undefined, may: () => undefined, log: () => undefined };
  const dataDir = path.dirname(process.env.DATABASE_PATH!);
  for (const name of ["fs.list", "fs.stat", "fs.read-text"]) await assert.rejects(async () => flowAction(name)!.run({ path: dataDir }, ctx), /Zeff's own data/);
  await assert.rejects(async () => flowAction("fs.read-text")!.run({ path: path.join(dataDir, "accounts.json") }, ctx), /Zeff's own data/);
  await assert.rejects(async () => flowAction("fs.list")!.run({ path: "relative/dir" }, ctx), /isn't there|can't be opened|No path/);
  // The screen's lambda falls back to This PC for it.
  const s = await call<Screen>("explorer.screen", { path: dataDir });
  assert.equal(s.atPc, true);
  assert.match(s.error ?? "", /Zeff's own data/);
  // The folder around the data folder doesn't list it.
  const around = (await flowAction("fs.list")!.run({ path: path.dirname(dataDir) }, ctx)) as { entries: { path: string }[] };
  assert.ok(!around.entries.some((e) => path.resolve(e.path) === path.resolve(dataDir)));
  // A lambda that doesn't name fs.read-text in its "zeff" can't call it (the screen's lambda reads only fs.list and fs.places).
  const lambdas = await import("@/plugins/workspace/lambdas/store");
  assert.deepEqual(lambdas.getLambda("explorer.screen")!.manifest.zeff, ["fs.list", "fs.places"]);
  assert.deepEqual(lambdas.getLambda("explorer.file")!.manifest.zeff, ["fs.read-text"]);
  void folder;
});

test("the file's lambda: the viewer's file as the built-in's openFile gives it", { skip }, async () => {
  const { call, folder } = await world();
  const { openFile } = await import("@/plugins/explorer/files");
  type File = { found: boolean; view: string; text: string; editable: boolean; readOnlyWhy: string; key: string; mtime: number; url: string; downloadUrl: string; csvCols: number; csvRows: { cells: { v: string; head: boolean }[] }[]; hasText: boolean; textual: boolean };
  const md = await call<File>("explorer.file", { path: path.join(folder, "notes.md") });
  const built = await openFile(path.join(folder, "notes.md"));
  assert.equal(md.view, "markdown");
  assert.equal(md.text, built.text);
  assert.equal(md.editable, true);
  assert.ok(md.textual && md.hasText);
  assert.ok(md.url.startsWith("/api/explorer/file?path=") && md.downloadUrl.endsWith("&download=1"));
  const csv = await call<File>("explorer.file", { path: path.join(folder, "table.csv") });
  assert.equal(csv.csvCols, 2);
  assert.deepEqual(csv.csvRows.map((r) => r.cells.map((c) => c.v)), [["name", "amount"], ["A; B", "3"], ["C", "4"]]);
  assert.equal(csv.csvRows[0].cells[0].head, true);
  assert.equal(csv.csvRows[1].cells[0].head, false);
  const latin = await call<File>("explorer.file", { path: path.join(folder, "latin.txt") });
  assert.equal(latin.editable, false);
  assert.match(latin.readOnlyWhy, /UTF-8/);
  const pic = await call<File>("explorer.file", { path: path.join(folder, "pic.png") });
  assert.equal(pic.view, "image");
  assert.equal(pic.hasText, false);
  const none = await call<{ found: boolean; error: string }>("explorer.file", { path: path.join(folder, "missing.txt") });
  assert.equal(none.found, false);
  assert.ok(none.error);
  assert.equal((await call<{ found: boolean }>("explorer.file", { path: "" })).found, false);
});

test("what changes something is a flow with the permission api: saving (refused when the file changed), a new folder and file, the dry run touches nothing", { skip }, async () => {
  const { folder } = await world();
  const engine = await import("@/plugins/workspace/flows/engine");
  const file = path.join(folder, "plain.txt");
  const opened = (await import("@/plugins/explorer/files")).openFile(file);
  const { mtime } = await opened;
  const dry = await engine.runFlow("explorer.save", { path: file, text: "dry", mtime }, { dry: true });
  assert.equal(dry.status, "done");
  assert.equal(fs.readFileSync(file, "utf8"), "hello");
  const saved = await engine.runFlow("explorer.save", { path: file, text: "changed text", mtime });
  assert.equal(saved.status, "done", saved.error ?? undefined);
  assert.equal(fs.readFileSync(file, "utf8"), "changed text");
  // Saved again with the old time: the file changed since — refused.
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  const stale = await engine.runFlow("explorer.save", { path: file, text: "lost update", mtime });
  assert.equal(stale.status, "failed");
  assert.match(stale.error ?? "", /changed on the disk/);
  assert.equal(fs.readFileSync(file, "utf8"), "changed text");
  // A new folder, a new text file (a name that isn't one is refused).
  assert.equal((await engine.runFlow("explorer.make", { parent: folder, name: "Made", kind: "folder" })).status, "done");
  assert.ok(fs.statSync(path.join(folder, "Made")).isDirectory());
  assert.equal((await engine.runFlow("explorer.make", { parent: folder, name: "idea", kind: "file" })).status, "done");
  assert.ok(fs.existsSync(path.join(folder, "idea.txt")));
  assert.equal((await engine.runFlow("explorer.make", { parent: folder, name: "a/b", kind: "folder" })).status, "failed");
  assert.equal((await engine.runFlow("explorer.make", { parent: folder, name: "x.exe", kind: "file" })).status, "failed");
  // Zeff's own data: refused for writes as well.
  const dataDir = path.dirname(process.env.DATABASE_PATH!);
  assert.equal((await engine.runFlow("explorer.make", { parent: dataDir, name: "evil", kind: "folder" })).status, "failed");
  assert.ok(!fs.existsSync(path.join(dataDir, "evil")));
  // The import and the watching: tried dry (the Documents plugin does the reading in; not started here).
  for (const [name, input] of [["explorer.import", { paths: JSON.stringify([path.join(folder, "notes.md")]) }], ["explorer.import-folder", { path: folder }], ["explorer.watch", { path: folder, mode: "confirm" }], ["explorer.unwatch", { id: "x" }], ["explorer.watch-mode", { id: "x", mode: "auto" }], ["explorer.open-here", { path: file, reveal: "false" }]] as const)
    assert.equal((await engine.runFlow(name, input, { dry: true })).status, "done", name);
  // A flow without "api" can't change anything (a button's flow of a plugin that didn't ask for it).
  const { flowAction } = await import("@/plugins/workspace/flows/actions");
  const noApi = { flow: "x", runId: null, dryRun: false, perms: {}, web: async () => new URL("https://x.y"), canWrite: () => undefined, may: () => { throw new Error("This flow may not use the plugins' methods."); }, log: () => undefined };
  await assert.rejects(async () => flowAction("fs.save-text")!.run({ path: file, text: "x", mtime: 0 }, noApi), /may not/);
  await assert.rejects(async () => flowAction("explorer.import-files")!.run({ paths: [file] }, noApi), /may not/);
});

test("a lambda only reads: the write actions are refused for it", { skip }, async () => {
  const { folder } = await world();
  const { flowAction } = await import("@/plugins/workspace/flows/actions");
  for (const name of ["fs.save-text", "fs.make", "fs.open-here", "explorer.import-files", "explorer.import-folder", "explorer.watch", "explorer.unwatch", "explorer.watch-mode"]) assert.equal(flowAction(name)?.writes, true, `${name} writes`);
  for (const name of ["fs.list", "fs.places", "fs.stat", "fs.read-text"]) assert.ok(!flowAction(name)?.writes, `${name} only reads`);
  const stat = (await flowAction("fs.stat")!.run({ path: path.join(folder, "notes.md") }, { flow: "x", runId: null, dryRun: false, perms: {}, web: async () => new URL("https://x.y"), canWrite: () => undefined, may: () => undefined, log: () => undefined })) as { view: string; language: string; dir: boolean; size: number };
  assert.deepEqual([stat.view, stat.language, stat.dir], ["markdown", "markdown", false]);
});

test("the screen's template draws without an error: This PC, a folder with picks, each kind of file, editing", { skip }, async () => {
  const { call, folder } = await world();
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("explorer-ext"), "views", "explorer.html"), "utf8");
  const draw = (x: unknown, file: unknown, state: Record<string, string>) =>
    renderView(template, { rows: [], props: [], titleName: "Explorer", state: { ...state }, app: {}, data: { x, file, result: { message: "ok" } }, db: { id: 1, title: "Explorer" } } as never);
  const pc = await call("explorer.screen", {});
  assert.deepEqual(draw(pc, { found: false }, {}).errors, []);
  const x = await call<Screen>("explorer.screen", { path: folder, picked: JSON.stringify([path.join(folder, "notes.md")]) });
  assert.deepEqual(draw(x, { found: false }, { picked: JSON.stringify([path.join(folder, "notes.md")]) }).errors, []);
  for (const name of ["notes.md", "table.csv", "plain.txt", "pic.png", "latin.txt", "thing.xyz"]) {
    const file = await call<{ key: string; text: string }>("explorer.file", { path: path.join(folder, name) });
    for (const state of [{ file: path.join(folder, name) } as Record<string, string>, { file: path.join(folder, name), editkey: file.key, edit: file.text }]) assert.deepEqual(draw(x, file, state).errors, [], name);
  }
  // The same template is the view of the package's database.
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("explorer-ext"), "explorer.package.json"), "utf8")) as { items: { schema?: { views: { template: string }[] } }[] };
  assert.equal(pkg.items.find((i) => i.schema)?.schema?.views[0].template, template);
});
