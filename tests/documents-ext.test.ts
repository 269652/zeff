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
  assert.deepEqual(t.result, { found: true, ...documentText(doc.id) });
});
