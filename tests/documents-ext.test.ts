import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";

/**
 * Documents' port (zeff-plugins/plugins/documents-ext): the document review, the matching of documents to todos, your local folders read in and the reading —
 * as the built-in does them (tests/documents-steps.test.ts, doc-folders.test.ts), with a fake Claude CLI answering (no Claude, no cost).
 */
const dir = setupTempData();
const skip = skipWithoutRepo("documents-ext");
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
const promptFile = path.join(dir, "prompt.txt");
process.env.FAKE_CLAUDE_PROMPT_FILE = promptFile;
const plugins = path.join(dir, "plugins");
process.env.ZEFF_PLUGINS_DIR = plugins;

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "llm", "claude-cli", "documents"]) setInstalled(id as never, true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
  fs.cpSync(repoPlugin("documents-ext"), path.join(plugins, "documents-ext"), { recursive: true });
  await import("@/plugins/contributions");
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  if (!reg.isEnabled("documents-ext")) await (await import("@/plugins/documents/to-plugin")).switchDocumentsToPlugin();
}

async function addDoc(name: string, text: string) {
  const { addDocument, setExtracted } = await import("@/plugins/documents/store");
  const { doc } = addDocument(name, Buffer.from(text), "text/plain");
  setExtracted(doc.id, text);
  return doc;
}

const run = async (name: string, input: Record<string, unknown> = {}) => {
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const r = await runFlow(name, input);
  assert.equal(r.status, "done", `${name}: ${r.error ?? r.status}`);
  return r.output as { ok: boolean; message: string };
};

test("the switch: the port on, its flows there, the built-in standing in through it", { skip }, async () => {
  await setup();
  const { isInstalled, onlyThroughPort } = await import("@/plugins/state");
  assert.ok(isInstalled("documents") && onlyThroughPort("documents"));
  const { flowByName } = await import("@/plugins/workspace/flows/store");
  for (const n of ["documents.review", "documents.relate", "documents.folders", "documents.read"]) assert.ok(flowByName(n), n);
  // (the steps the port's flows took over aren't the built-in's any more)
  const { stepAvailable } = await import("@/plugins/state");
  for (const s of ["localdocs", "doctodos", "docrelations"]) assert.equal(stepAvailable(s), false, s);
});

test("document review through the port: a todo with its deadline, the document as its source — and a document is read once", { skip }, async () => {
  await setup();
  const { listTodos } = await import("@/lib/todos/store");
  const doc = await addDoc("Mahnung Badenova.txt", "Mahnung vor Sperrung. Bitte überweisen Sie 186,83 EUR bis zum 16.10.2026 auf das Vertragskonto 1285554639.");
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ todos: [{ text: "Mahnung der Badenova über 186,83 € bis 16.10. bezahlen", kind: "other", owner: "me", due: "2026-10-16", refs: [doc.ref], repeat: "monthly" }, { text: "Ohne passende Quelle", refs: ["doc:999"] }] });
  const r = await run("documents.review");
  assert.equal(r.ok, true);
  assert.match(r.message, /1 documents reviewed, 1 new todos/);
  const todo = listTodos({ status: "open" }).find((t) => /Badenova/.test(t.text))!;
  assert.ok(todo.refs.includes(doc.ref), "the document is its source");
  assert.equal(todo.due, "2026-10-16");
  assert.equal(todo.source, "Dokument-Durchsicht");
  assert.equal(todo.recurrence?.freq, "monthly");
  // The AI got the document with its name and text — the built-in's prompt.
  assert.match(fs.readFileSync(promptFile, "utf8"), /\[doc:\d+\] „Mahnung Badenova\.txt“[\s\S]*186,83 EUR/);
  // Read once: the same document isn't gone through again (no AI call, no second todo).
  fs.rmSync(promptFile, { force: true });
  const again = await run("documents.review");
  assert.match(again.message, /^0 documents reviewed, 0 new todos/);
  assert.equal(fs.existsSync(promptFile), false);
  assert.equal(listTodos({ status: "open" }).filter((t) => /Badenova/.test(t.text)).length, 1);
});

test("document matching through the port: each todo gets the documents it is about — documents attached by hand stay", { skip }, async () => {
  await setup();
  const { addManualTodo, addTodoContext, getTodo } = await import("@/lib/todos/store");
  const mietvertrag = await addDoc("Mietvertrag Stockmattenweg.txt", "Mietvertrag Stockmattenweg Freiburg. Die Kündigungsfrist beträgt drei Monate, die Kaution 1500 EUR.");
  const handmade = await addDoc("Foto Zählerstand.txt", "Zählerstand Strom 4711");
  const todo = addManualTodo({ ticket: "", text: "Mietvertrag Stockmattenweg prüfen: Kündigungsfrist und Kaution klären" });
  addTodoContext(todo.id, [handmade.ref], "", "Document");
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ todos: [{ id: todo.id, docs: [`[${mietvertrag.ref}]`, "doc:999"] }] });
  const r = await run("documents.relate");
  assert.equal(r.ok, true);
  assert.deepEqual([...getTodo(todo.id)!.refs].sort(), [handmade.ref, mietvertrag.ref].sort(), "the AI's pick (only what it was offered) and the one by hand");
});

test("local folders through the port: new files read in and read, a changed one in its place, a gone one marked, a folder that waits holds the AI back", { skip }, async () => {
  await setup();
  const { getSqlite } = await import("@/db");
  const { setPref, getPref } = await import("@/lib/prefs");
  const folder = path.join(dir, "folder");
  fs.mkdirSync(path.join(folder, "sub"), { recursive: true });
  fs.writeFileSync(path.join(folder, "brief.txt"), "Bitte zahlen Sie die Rechnung 4711.\n");
  fs.writeFileSync(path.join(folder, "sub", "notiz.md"), "# Notiz\nFormular unterschreiben.\n");
  fs.writeFileSync(path.join(folder, "leer.txt"), "");
  fs.writeFileSync(path.join(folder, "bild.png"), Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"));
  fs.writeFileSync(path.join(folder, "nichts.xyz"), "x");
  setPref("documents:folders", [{ id: "t1", path: folder, mode: "confirm", addedAt: new Date().toISOString(), lastScanAt: null, files: 0 }]);
  const r = await run("documents.folders");
  assert.equal(r.ok, true);
  assert.equal(r.message, "3 new", "the empty file and the unknown kind are left out");
  const rows = () => getSqlite().prepare("select id, name, kind, status, error, text from documents where name in ('brief.txt', 'notiz.md', 'bild.png') order by name").all() as { id: number; name: string; kind: string; status: string; error: string; text: string }[];
  const [bild, brief, notiz] = rows();
  assert.deepEqual([brief.status, notiz.status], ["ready", "ready"], "text is read right here");
  assert.match(brief.text, /Rechnung 4711/);
  assert.deepEqual([bild.kind, bild.status], ["image", "queued"], "a picture needs the AI: it waits for your confirmation");
  assert.match(bild.error, /Waits for your confirmation/);
  const gate = getSqlite().prepare("select doc_id from doc_gate where state = 'pending'").all() as { doc_id: number }[];
  assert.equal(gate.length, 3, "every document of a folder that waits is held");
  const known = getPref<{ lastScanAt: string | null; files: number }[]>("documents:folders", [])[0];
  assert.ok(known.lastScanAt && known.files === 3, "the folder's list says when and how many");
  // Nothing changed: nothing new.
  assert.equal((await run("documents.folders")).message, "Nothing new.");
  // A file changed, one gone.
  fs.writeFileSync(path.join(folder, "brief.txt"), "Geändert: bitte bis 20.10. zahlen.\n");
  fs.rmSync(path.join(folder, "sub", "notiz.md"));
  assert.equal((await run("documents.folders")).message, "1 changed, 1 gone from the folder");
  const [, changed] = rows();
  assert.equal(changed.id, brief.id, "the document stays, its content is replaced");
  assert.match(changed.text, /Geändert/);
  const missing = getSqlite().prepare("select rel from doc_local_files where missing_at is not null").all() as { rel: string }[];
  assert.deepEqual(missing.map((m) => m.rel.replace(/\\/g, "/")), ["sub/notiz.md"]);
  // The old file is no longer kept.
  assert.equal(fs.readdirSync(path.join(dir, "documents")).filter((f) => /brief/.test(f)).length, 1);
});

test("the search and a document's text through the port are the built-in's", { skip }, async () => {
  await setup();
  const { documentsMatching, documentText } = await import("@/plugins/documents/fulltext");
  const { getLambda } = await import("@/plugins/workspace/lambdas/store");
  const { runLambda } = await import("@/plugins/workspace/lambdas/run");
  const doc = await addDoc("Rechnung Stadtwerke.txt", "Rechnung 2026-11 über Strom, Kunde 4711, Zählerstand 12345");
  for (const q of ["rechnung", "strom 4711", "zählerstand", "gibtesnicht", ""]) {
    const r = await runLambda(getLambda("documents.search")!, { q });
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.deepEqual([...(r.result as { ids: number[] }).ids].sort(), [...documentsMatching(q)].sort(), `“${q}”`);
  }
  const t = await runLambda(getLambda("documents.text")!, { id: doc.id });
  assert.ok(t.ok);
  assert.deepEqual({ found: (t.result as { found: boolean }).found, text: (t.result as { text: string }).text, summary: (t.result as { summary: string }).summary }, { found: true, ...documentText(doc.id) });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The screens: the Documents screen, its settings page and the attach panel — their data, what their buttons do, and that their templates draw
// ---------------------------------------------------------------------------------------------------------------------------------------------------

async function lambda(name: string, event: Record<string, unknown> = {}) {
  const { getLambda } = await import("@/plugins/workspace/lambdas/store");
  const { runLambda } = await import("@/plugins/workspace/lambdas/run");
  const r = await runLambda(getLambda(name)!, event);
  assert.ok(r.ok, r.ok ? "" : `${name}: ${r.error}`);
  return r.result as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** A file the way a view's upload brings it: staged, with a token for the flow. */
async function staged(name: string, text: string, mime = "text/plain") {
  const { stageUploadAction } = await import("@/plugins/workspace/actions/uploads");
  const form = new FormData();
  form.append("file", new File([text], name, { type: mime }));
  const r = await stageUploadAction(form);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r as { token: string; name: string; size: number; mime: string };
}

const tpl = (file: string) => fs.readFileSync(path.join(repoPlugin("documents-ext"), "views", file), "utf8");
const countOf = (sql: string, ...params: unknown[]) => (async () => ((await import("@/db")).getSqlite().prepare(sql).get(...params) as { n: number }).n)();

test("the screen: a file added by the upload is kept and read, the same content again is the first one, unread until you mark it", { skip }, async () => {
  await setup();
  const { getSqlite } = await import("@/db");
  const up = await staged("Bescheid Finanzamt.txt", "Bescheid über die Einkommensteuer 2025, Frist 30.11.2026.");
  const r = (await run("documents.add", { name: up.name, mime: up.mime, size: up.size, token: up.token })) as unknown as { ok: boolean; id: number; fresh: boolean };
  assert.equal(r.fresh, true);
  const row = getSqlite().prepare("select name, kind, status, text, file from documents where id = ?").get(r.id) as { name: string; kind: string; status: string; text: string; file: string };
  assert.deepEqual([row.name, row.kind, row.status], ["Bescheid Finanzamt.txt", "text", "ready"], "kept and read at once (the flow reads what waits)");
  assert.match(row.text, /Einkommensteuer/);
  assert.ok(fs.existsSync(path.join(dir, "documents", row.file)));
  assert.equal(fs.existsSync(path.join(dir, "uploads", up.token)), false, "the staged file is taken");
  const again = await staged("Bescheid Finanzamt.txt", "Bescheid über die Einkommensteuer 2025, Frist 30.11.2026.");
  const second = (await run("documents.add", { name: again.name, mime: again.mime, size: again.size, token: again.token })) as unknown as { id: number; fresh: boolean };
  assert.deepEqual([second.fresh, second.id], [false, r.id], "nothing doubled");
  // The screen: in the inbox (unread), found by a word of its text, then marked read — gone from the inbox, still in all.
  let s = await lambda("documents.screen", { scope: "inbox" });
  assert.ok(s.items.some((d: { id: number; unread: boolean }) => d.id === r.id && d.unread));
  assert.ok((await lambda("documents.screen", { scope: "all", q: "einkommensteuer" })).items.some((d: { id: number }) => d.id === r.id), "found in the text");
  assert.equal((await lambda("documents.screen", { scope: "all", q: "gibtesnicht" })).count, 0);
  await run("documents.act", { op: "read", ids: String(r.id) });
  s = await lambda("documents.screen", { scope: "inbox" });
  assert.ok(!s.items.some((d: { id: number }) => d.id === r.id), "read: out of the inbox");
  assert.ok((await lambda("documents.screen", { scope: "all" })).items.some((d: { id: number }) => d.id === r.id));
  await run("documents.act", { op: "unread", ids: `[${r.id}]` });
  assert.ok((await lambda("documents.screen", { scope: "inbox" })).items.some((d: { id: number }) => d.id === r.id), "unread again");
  // A name with a path in it stays in the documents folder.
  const sneaky = await staged("..\\..\\evil.txt", "harmless text of a sneaky name");
  const sr = (await run("documents.add", { name: sneaky.name, mime: sneaky.mime, size: sneaky.size, token: sneaky.token })) as unknown as { id: number };
  const sf = getSqlite().prepare("select name, file from documents where id = ?").get(sr.id) as { name: string; file: string };
  assert.equal(sf.name, "evil.txt");
  assert.ok(fs.existsSync(path.join(dir, "documents", sf.file)));
  // Only a staged token is taken: no path.
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const bad = await runFlow("documents.add", { name: "x.txt", token: "../../zeff.db" });
  assert.equal(bad.status, "failed");
});

test("the screen: attached to a todo by hand (and a new file attached at once), deleted for good — file, row and the todos' ref", { skip }, async () => {
  await setup();
  const { getSqlite } = await import("@/db");
  const { addManualTodo, getTodo } = await import("@/lib/todos/store");
  const todo = addManualTodo({ ticket: "", text: "Steuerbescheid prüfen" });
  const doc = await addDoc("Steuerbescheid.txt", "Steuerbescheid 2025");
  const list = await lambda("documents.attach-list", { q: "steuer" });
  assert.ok(list.items.some((d: { id: number; ref: string }) => d.id === doc.id && d.ref === doc.ref));
  assert.equal((await run("documents.attach", { todo: todo.id, doc: doc.id })).ok, true);
  assert.ok(getTodo(todo.id)!.refs.includes(doc.ref));
  const up = await staged("Nachweis.txt", "Nachweis über die Zahlung vom 3.11.");
  const made = (await run("documents.add", { name: up.name, mime: up.mime, size: up.size, token: up.token, todo: String(todo.id) })) as unknown as { id: number };
  assert.ok(getTodo(todo.id)!.refs.includes(`doc:${made.id}`), "a new file is attached at once");
  // Delete: the row, its file and the todos' ref are gone.
  const file = (getSqlite().prepare("select file from documents where id = ?").get(doc.id) as { file: string }).file;
  fs.mkdirSync(path.join(dir, "documents"), { recursive: true });
  fs.writeFileSync(path.join(dir, "documents", file), "x");
  await run("documents.act", { op: "delete", ids: String(doc.id) });
  assert.equal(await countOf("select count(*) as n from documents where id = ?", doc.id), 0);
  assert.equal(fs.existsSync(path.join(dir, "documents", file)), false);
  assert.ok(!getTodo(todo.id)!.refs.includes(doc.ref), "the todo let go of it");
  assert.ok(getTodo(todo.id)!.refs.includes(`doc:${made.id}`), "the other stays");
});

test("the screen: read again, skip, and the documents waiting for your confirmation", { skip }, async () => {
  await setup();
  const { getSqlite } = await import("@/db");
  const doc = await addDoc("Wartet.txt", "Wartet auf Bestätigung");
  const state = (id: number) => getSqlite().prepare("select status, error from documents where id = ?").get(id) as { status: string; error: string };
  getSqlite().prepare("update documents set status = 'queued' where id = ?").run(doc.id);
  await run("documents.act", { op: "skip", ids: String(doc.id) });
  assert.equal(state(doc.id).status, "failed");
  assert.match(state(doc.id).error, /Skipped/);
  await run("documents.act", { op: "reread", ids: String(doc.id) });
  assert.equal(state(doc.id).status, "ready", "read again, at once");
  getSqlite().prepare("insert into doc_gate (doc_id, state, at) values (?, 'pending', ?) on conflict(doc_id) do update set state = 'pending'").run(doc.id, new Date().toISOString());
  const page = await lambda("documents.settings");
  assert.ok(page.pending.some((p: { id: number }) => p.id === doc.id));
  await run("documents.act", { op: "approve", ids: String(doc.id) });
  assert.ok(!(await lambda("documents.settings")).pending.some((p: { id: number }) => p.id === doc.id));
  assert.equal((getSqlite().prepare("select state from doc_gate where doc_id = ?").get(doc.id) as { state: string }).state, "approved");
});

test("the settings page: the local folders added, chosen, set and removed; the audio transcriber saved", { skip }, async () => {
  await setup();
  const { getPref, setPref } = await import("@/lib/prefs");
  setPref("documents:folders", []);
  const folder = path.join(dir, "scans");
  fs.mkdirSync(path.join(folder, "2026"), { recursive: true });
  fs.writeFileSync(path.join(folder, "rechnung.txt"), "Rechnung 99 vom 1.11.2026");
  const root = (await run("documents.browse", { path: dir })) as unknown as { dirs: { name: string; path: string }[]; parent: string };
  assert.ok(root.dirs.some((d) => d.name === "scans"), "the folder browser lists the subfolders");
  assert.ok(root.parent);
  const r = await run("documents.folder", { op: "add", path: folder, mode: "confirm" });
  assert.equal(r.ok, true);
  assert.match(r.message, /read in now/);
  const folders = getPref<{ id: string; path: string; mode: string; files: number }[]>("documents:folders", []);
  assert.equal(folders.length, 1);
  assert.equal(folders[0].mode, "confirm");
  assert.equal(await countOf("select count(*) as n from documents where name = 'rechnung.txt'"), 1, "read in at once");
  // A folder that is not there: nothing is kept.
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const no = await runFlow("documents.folder", { op: "add", path: path.join(dir, "gibtesnicht"), mode: "auto" });
  assert.equal(no.status, "failed");
  assert.equal(getPref<unknown[]>("documents:folders", []).length, 1);
  await run("documents.folder", { op: "mode", id: folders[0].id, mode: "auto" });
  assert.equal(getPref<{ mode: string }[]>("documents:folders", [])[0].mode, "auto");
  const page = await lambda("documents.settings");
  assert.equal(page.folders.length, 1);
  assert.match(page.folders[0].status, /1 documents/);
  await run("documents.folder", { op: "remove", id: folders[0].id });
  assert.equal(getPref<unknown[]>("documents:folders", []).length, 0);
  assert.equal(await countOf("select count(*) as n from documents where name = 'rechnung.txt'"), 1, "its documents stay");
  // The transcriber.
  await run("documents.setting", { transcriber: ' whisper "{file}" ', autoInstall: "false" });
  assert.deepEqual(getPref("plugin:documents", null), { transcriber: 'whisper "{file}"', autoInstall: false });
  const again = await lambda("documents.settings");
  assert.deepEqual([again.transcriber, again.autoInstall], ['whisper "{file}"', false]);
});

test("the abstracts: kept with the documents once the knowledge server compiled them; the pages it reads", { skip }, async () => {
  await setup();
  const { getSqlite } = await import("@/db");
  const doc = await addDoc("Mietvertrag.txt", "Mietvertrag über die Wohnung, Kaution 1500 EUR.");
  assert.ok((await lambda("documents.abstracts-plan")).ids.includes(`zeff:doc:${doc.id}`));
  // (no knowledge server here: the flow asks and gets nothing)
  assert.equal((await run("documents.abstracts")).ok, true);
  const res = await lambda("documents.abstracts-result", { pages: [{ id: `zeff:doc:${doc.id}`, summary: "Ein Mietvertrag mit Kaution.", concepts: "Miete, Kaution", compiled: true }, { id: "zeff:doc:99999", summary: "", compiled: true }, { id: `zeff:doc:${doc.id}`, summary: "x", compiled: false }] });
  assert.equal(res.n, 1);
  for (const st of res.statements as { sql: string; params: unknown[] }[]) getSqlite().prepare(st.sql).run(...st.params);
  const row = getSqlite().prepare("select summary, concepts, compiled from documents where id = ?").get(doc.id) as { summary: string; concepts: string; compiled: number };
  assert.deepEqual([row.summary, row.concepts, row.compiled], ["Ein Mietvertrag mit Kaution.", "Miete, Kaution", 1]);
  assert.ok(!(await lambda("documents.abstracts-plan")).ids.includes(`zeff:doc:${doc.id}`));
  // The pages for the knowledge server: as the built-in's export gives them.
  const { documentDocs } = await import("@/plugins/documents/export");
  const { getLambda } = await import("@/plugins/workspace/lambdas/store");
  const { runLambda } = await import("@/plugins/workspace/lambdas/run");
  const mine = await runLambda(getLambda("documents.knowledge-docs")!, {});
  assert.ok(mine.ok);
  assert.deepEqual(mine.result, documentDocs("").map(({ url, ...d }) => (void url, d)));
});

test("the screens' templates draw: the Documents screen (grid, list, a PDF and a picture picked), the settings page, the attach panel — no errors", { skip }, async () => {
  await setup();
  const { renderView } = await import("@/plugins/workspace/view-template");
  const { getSqlite } = await import("@/db");
  await addDoc("Brief.txt", "Ein Brief an das Finanzamt");
  const pdf = await addDoc("Vertrag.pdf", "%PDF-1.4 vertrag");
  const img = await addDoc("Foto.png", "png");
  getSqlite().prepare("update documents set kind = 'pdf' where id = ?").run(pdf.id);
  getSqlite().prepare("update documents set kind = 'image' where id = ?").run(img.id);
  const draw = (source: string, state: Record<string, string>, data: Record<string, unknown>) => renderView(source, { rows: [], props: [], titleName: "Documents", state, app: {}, data, db: { id: 1, title: "Documents" } });
  const rendered = (r: { nodes: unknown[] }) => JSON.stringify(r.nodes);
  for (const state of [{} as Record<string, string>, { layout: "list" }, { scope: "all", selected: String(pdf.id) }, { scope: "all", selected: String(img.id), layout: "list" }]) {
    const docs = await lambda("documents.screen", { ...state, checked: `[${pdf.id}]` });
    const doc = await lambda("documents.text", { id: Number(state.selected ?? 0), chars: 6000 });
    const r = draw(tpl("documents.html"), state, { docs, doc });
    assert.deepEqual(r.errors, [], JSON.stringify(state));
    assert.match(rendered(r), /Add files/);
    if (state.selected) assert.match(rendered(r), /\/api\/files\/kept\?dir=documents/);
  }
  assert.deepEqual(draw(tpl("documents.html"), {}, {}).errors, [], "an empty screen draws too");
  const settings = await lambda("documents.settings");
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("documents-ext"), "documents.package.json"), "utf8")) as { items: { kind: string; schema?: { views: { template: string }[] } }[] };
  const settingsTpl = pkg.items.find((i) => i.kind === "database")!.schema!.views[0].template;
  const withFolder = { ...settings, folders: [{ id: "a", path: "C:\\Rechnungen", mode: "confirm", files: 3, status: "3 documents" }], pending: [{ id: 1, name: "x.pdf" }] };
  for (const data of [{ s: settings }, { s: withFolder, browse: { path: "C:\\", parent: null, dirs: [{ name: "A", path: "C:\\A" }] } }, {}]) {
    const r = renderView(settingsTpl, { rows: [], props: [], titleName: "Settings", state: { browsing: "1" }, app: {}, data, db: { id: 2, title: "Documents settings" } });
    assert.deepEqual(r.errors, []);
  }
  const attach = draw(tpl("documents-attach.html"), { todo: "7" }, { pick: await lambda("documents.attach-list", {}) });
  assert.deepEqual(attach.errors, []);
  assert.match(rendered(attach), /Attach/);
});
