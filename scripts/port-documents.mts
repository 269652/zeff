/**
 * Documents' port (zeff-plugins/plugins/documents-ext): the files kept in your documents folder, the text read out of them, the AI's two steps after the briefing
 * (todos from the documents; which documents each todo is about), your local folders read in by themselves, and the search.
 *
 * The plugin's stores ADOPT the built-in's tables (`documents`, `doc_gate`, `doc_local_files` — lib/ext/stores.ts ADOPTABLE): nothing is copied, the built-in and its port see
 * the same rows while you switch. Its lambdas only read (and decide, with the built-in's own pure cores bundled: review-core.ts, relations-core.ts, folders-core.ts, search-core.ts,
 * shared.ts): `documents.review-plan` / `documents.review-batch` (the Dokument-Durchsicht), `documents.relate` (the Dokument-Zuordnung), `documents.folders-plan` /
 * `documents.keep-plan` (a scan of your local folders), `documents.read-plan` / `documents.read-result` (the reading queue), `documents.search` / `documents.text`, `documents.report`
 * (what a step says). Its flows write: `documents.review` (todos through the kernel's gate: `todos.propose`; what was gone through kept in the AI memo), `documents.relate`
 * (`todos.set-doc-related`), `documents.folders` (files.scan / files.hash / files.keep, rows through sql.exec) and `documents.read` (files.text: the fast lane, then the slow one — pictures,
 * scans, recordings). The first three are sync steps standing in for the built-in's "doctodos", "docrelations" and "localdocs". AI tasks: `doc-todos`, `doc-relations`.
 *
 * Kernel pieces it brought (generic, in src/plugins/documents/flow-actions.ts): files.scan, files.hash, files.keep, files.drop, files.text, ai.memo-all, board.tickets, jira.summaries,
 * todos.refs, todos.propose, todos.set-doc-related, workspace.refresh-databases.
 *
 * The screens (scripts/port-documents-view.mts): the Documents screen (contributes.appViews → views/documents.html), its settings page (a database of the package) and the attach panel
 * for a todo (views/documents-attach.html), made of the kit's elements — adding files is `<upload run=…>` (bytes: staged by actions/uploads.ts, kept by the kernel's files.take). Their data:
 * `documents.screen`, `documents.text`, `documents.settings`, `documents.attach-list`; what their buttons do: the flows `documents.add`, `documents.act` (read / unread / delete / read again /
 * skip / restart / confirm), `documents.folder`, `documents.browse`, `documents.setting`, `documents.attach`; the abstracts: `documents.abstracts` (knowledge.sync / knowledge.pages) and the
 * pages the knowledge server reads (`documents.knowledge-docs`, given once the built-in is off).
 *
 * Not in this port (still the built-in's): the file route (/api/documents/:id/file), the document badge on todos, the Workspace source of the documents (the document inbox databases).
 *
 *   npx tsx scripts/port-documents.mts [<zeff-plugins folder>]     (default ../zeff-plugins)
 */
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { documentsAttachTemplate, documentsScreenTemplate, documentsSettingsTemplate } from "./port-documents-view.mjs";

const ROOT = process.cwd();
const repo = path.resolve(process.argv[2] ?? "../zeff-plugins");
const dir = path.join(repo, "plugins", "documents-ext");
const SRC = path.join(ROOT, "scripts", "port-documents");
const write = (rel: string, text: string) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
fs.rmSync(path.join(dir, "lambdas"), { recursive: true, force: true });

// The texts the lambdas and the cores say: every t("…") in them, translated by the language packs.
const SOURCES = [...fs.readdirSync(SRC).map((f) => path.join(SRC, f)), ...["folders-core.ts"].map((f) => path.join(ROOT, "src", "plugins", "documents", f))];
const keys = new Set<string>();
for (const f of SOURCES) for (const m of fs.readFileSync(f, "utf8").matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`));
const strings: Record<string, Record<string, string>> = {};
for (const lang of ["de", "es"]) {
  const file = path.join(repo, "plugins", `lang-${lang}`, "bundle.json");
  const pack = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>) : {};
  strings[lang] = Object.fromEntries([...keys].filter((k) => pack[k]).map((k) => [k, pack[k]]));
}

const entry = `
export { REVIEW_INSTRUCTIONS, REVIEW_SCHEMA, REVIEW_RESERVE, reviewLine, reviewPrompt, proposedTodos, excerpt } from "@/plugins/documents/review-core";
export { RELATE_INSTRUCTIONS, RELATE_SCHEMA, RELATE_RESERVE, candidates, docWords, pickedRefs, relateBlock } from "@/plugins/documents/relations-core";
export { diffFolder, scanSummary } from "@/plugins/documents/folders-core";
export { wordsOf, matchWhere } from "@/plugins/documents/search-core";
export { kindOf, safeName, READABLE_EXTS, MAX_DOCUMENT_BYTES } from "@/plugins/documents/shared";
export { DOC_KINDS_NAV, docNav, inScope } from "@/plugins/documents/nav";
/** A short stamp of a few values (what a source record says it was when a row was read). */
export const stamp = (parts) => { const s = JSON.stringify(parts); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); };
export { batchByChars } from "@/lib/ai/batch";
export { plain } from "@/lib/plain-text";
import { setPluginStrings, translator, isLang } from "@/lib/i18n/shared";
const STRINGS = ${JSON.stringify(strings)};
setPluginStrings((lang) => STRINGS[lang] ?? {});
/** A translator for the user's language (context.language): the texts the built-in says, in the same words. */
export const tFor = (lang) => translator(isLang(lang) ? lang : "en");
`;
const lib = await build({
  stdin: { contents: entry, resolveDir: ROOT, loader: "ts", sourcefile: "documents-port.ts" },
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  write: false,
  alias: { "@": path.join(ROOT, "src") },
  legalComments: "none",
});
const banner = `// Generated by Zeff's scripts/port-documents.mts from the built-in Documents' pure cores (review-core, relations-core, folders-core, search-core, shared) — change them there, generate again.\n`;

type L = { name: string; label: string; what: string; zeff?: string[]; timeoutMs: number; memoryMb: number; lib?: boolean };
const LAMBDAS: L[] = [
  { name: "documents.review-plan", label: "Documents: what to go through for todos", what: "Which read documents the AI goes through for todos now — new and changed since it last did — and in which batches; those a todo already cites are only marked.", zeff: ["sql.query", "ai.memo-all", "todos.refs", "prompts.fill"], timeoutMs: 120000, memoryMb: 256, lib: true },
  { name: "documents.review-batch", label: "Documents: todos from a batch", what: "The AI reads a batch of documents (beginning and end of each) against your tickets and open todos and says what you have to do — handed back as todos for the flow to make.", zeff: ["sql.query", "board.tickets", "todos.open", "prompts.fill", "ai.json"], timeoutMs: 1800000, memoryMb: 256, lib: true },
  { name: "documents.relate", label: "Documents: which belong to which todo", what: "For each open todo the few documents likeliest to be about it (shared words), then the AI picks by content — handed back as picks for the flow to add to the todos.", zeff: ["sql.query", "todos.open", "jira.summaries", "prompts.fill", "ai.json"], timeoutMs: 1800000, memoryMb: 256, lib: true },
  { name: "documents.folders-plan", label: "Documents: your local folders", what: "Your local folders looked at: which files are new or changed (to read in), which came back, which are gone.", zeff: ["pref.get", "files.scan", "sql.query"], timeoutMs: 300000, memoryMb: 256, lib: true },
  { name: "documents.keep-plan", label: "Documents: a file read in", what: "What reading one file of a local folder in means: a new document, or a changed one put in its place — as statements for the flow.", zeff: ["sql.query"], timeoutMs: 60000, memoryMb: 128, lib: true },
  { name: "documents.read-plan", label: "Documents: what waits to be read", what: "The documents waiting to be read (and those left half-read by a run that is gone) — not those held for your confirmation.", zeff: ["sql.query"], timeoutMs: 60000, memoryMb: 128 },
  { name: "documents.read-result", label: "Documents: what came of reading", what: "What happened to a document that was read: ready with its text, waiting for the slow reading or for your confirmation, unreadable, failed.", zeff: ["sql.query"], timeoutMs: 60000, memoryMb: 128, lib: true },
  { name: "documents.search", label: "Documents: search", what: "The documents holding every word you typed — in their whole text, not only the name.", zeff: ["sql.query"], timeoutMs: 60000, memoryMb: 128, lib: true },
  { name: "documents.text", label: "Documents: a document's text", what: "A document's whole text and its summary.", zeff: ["sql.query"], timeoutMs: 20000, memoryMb: 128 },
  { name: "documents.screen", label: "Documents: the screen", what: "The documents of the scope asked for, searched and sorted, the scopes with their counts, and the one picked.", zeff: ["sql.query", "pref.get", "documents.origins"], timeoutMs: 60000, memoryMb: 256, lib: true },
  { name: "documents.act-plan", label: "Documents: what a button does", what: "What marking read or unread, deleting, reading again, skipping, restarting the reading or confirming documents means — as statements for the flow.", zeff: ["sql.query"], timeoutMs: 60000, memoryMb: 128, lib: true },
  { name: "documents.add-plan", label: "Documents: a file added", what: "What adding a file means: a new document waiting to be read, or the one kept already — as statements for the flow.", zeff: ["sql.query"], timeoutMs: 60000, memoryMb: 128, lib: true },
  { name: "documents.folder-plan", label: "Documents: a change to the local folders", what: "A folder added, its mode set or the folder removed — the folders to keep, as a value for the flow.", zeff: ["pref.get"], timeoutMs: 30000, memoryMb: 128, lib: true },
  { name: "documents.settings", label: "Documents: the settings page", what: "Your local folders, what waits for your confirmation, what is being read and the audio transcriber.", zeff: ["pref.get", "sql.query"], timeoutMs: 30000, memoryMb: 128, lib: true },
  { name: "documents.attach-list", label: "Documents: to attach to a todo", what: "The documents to pick from for a todo, newest first, searched, each with its abstract.", zeff: ["sql.query"], timeoutMs: 30000, memoryMb: 128, lib: true },
  { name: "documents.abstracts-plan", label: "Documents: what the knowledge server compiles", what: "The read documents the knowledge server has not compiled yet — their page ids.", zeff: ["sql.query"], timeoutMs: 30000, memoryMb: 128 },
  { name: "documents.abstracts-result", label: "Documents: the abstracts", what: "The abstracts the knowledge server made, kept with the documents — as statements for the flow.", zeff: [], timeoutMs: 30000, memoryMb: 128 },
  { name: "documents.knowledge-docs", label: "Documents: pages for the knowledge server", what: "The documents as pages for the knowledge server (space Zeff · Documents).", zeff: ["sql.query"], timeoutMs: 120000, memoryMb: 256 },
  { name: "documents.source", label: "Documents: the document inbox", what: "The documents as records of the Workspace (the document inbox databases): kind, state, added, size, unread, compiled, from, concepts, abstract and text.", zeff: ["sql.query", "documents.origins"], timeoutMs: 120000, memoryMb: 256, lib: true },
  { name: "documents.pull-plan", label: "Documents: the Unread box of a row", what: "Which documents the document inbox says you have seen or not — as statements for the flow.", zeff: ["sql.query"], timeoutMs: 60000, memoryMb: 128, lib: true },
  { name: "documents.report", label: "Documents: what a step says", what: "How a step went, in a sentence, in your language.", zeff: [], timeoutMs: 20000, memoryMb: 128, lib: true },
];
for (const l of LAMBDAS) {
  const base = `lambdas/${l.name}`;
  if (l.lib) write(`${base}/lib.mjs`, banner + lib.outputFiles[0].text);
  write(`${base}/index.mjs`, fs.readFileSync(path.join(SRC, `${l.name}.mjs`), "utf8"));
  write(`${base}/lambda.json`, JSON.stringify({ name: l.name, label: l.label, what: l.what, kind: "function", zeff: l.zeff ?? [], timeoutMs: l.timeoutMs, memoryMb: l.memoryMb }, null, 2) + "\n");
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The package: the flows
// ---------------------------------------------------------------------------------------------------------------------------------------------------
const STORES = ["documents-ext.documents", "documents-ext.gate", "documents-ext.local_files", "documents-ext.seen"];
const page = (id: string, parent: string | null, title: string, icon: string, flow?: unknown) => ({ id, ...(parent ? { parent } : {}), kind: "page", title, icon, content: { type: "doc", content: [{ type: "paragraph" }] }, ...(flow ? { flow } : {}) });
const invoke = (id: string, name: string, event: unknown) => ({ id, kind: "action", action: "lambda.invoke", input: { name, event } });
const exec = (id: string, statements: string) => ({ id, kind: "action", action: "sql.exec", input: { statements } });
const memoSet = (id: string, m: string) => ({ id, kind: "action", action: "ai.memo-set", input: { scope: "doc-reviewed", ref: `{{ ${m}.ref }}`, hash: `{{ ${m}.hash }}`, value: true } });
const ret = { ok: "{{ steps.rep.ok }}", message: "{{ steps.rep.message }}" };

const reviewFlow = {
  name: "documents.review",
  title: "Go through the documents for todos",
  description: "The AI goes through the documents that are new or changed since it last did and makes todos of what they ask of you — a deadline, a bill, a form, an open question — the document as the source. Run with the briefing; input runId: the briefing's run.",
  inputs: [{ name: "runId", type: "number" }],
  nodes: [
    invoke("plan", "documents.review-plan", {}),
    { id: "seen", kind: "foreach", items: "{{ steps.plan.marks }}", as: "m", max: 1000, nodes: [memoSet("mark", "m")] },
    {
      id: "each",
      kind: "foreach",
      items: "{{ steps.plan.batches }}",
      as: "b",
      max: 200,
      nodes: [
        invoke("batch", "documents.review-batch", { docs: "{{ b }}" }),
        { id: "made", kind: "action", action: "todos.propose", input: { items: "{{ steps.batch.items }}", source: "Dokument-Durchsicht", prefix: "doc:", runId: "{{ input.runId }}" } },
        { id: "keep", kind: "if", when: "{{ steps.batch.failed }}", then: [], else: [{ id: "marks", kind: "foreach", items: "{{ steps.batch.marks }}", as: "m", max: 200, nodes: [memoSet("mark2", "m")] }] },
        { id: "round", kind: "script", code: "return { failed: !!steps.batch.failed, docs: (item || []).length, added: steps.made.added | 0, merged: steps.made.merged | 0 };" },
      ],
    },
    invoke("rep", "documents.report", { kind: "review", plan: "{{ steps.plan }}", rounds: "{{ steps.each }}" }),
    { id: "done", kind: "return", value: ret },
  ],
  requested: { ai: true, todos: true, store: STORES },
  sync: { label: "Document review", what: "Todos from your documents — what they ask of you: deadlines, bills, forms, open questions — new and changed ones, by the AI (after each briefing)", replaces: "doctodos" },
  triggers: [{ kind: "manual" }],
};

const relateFlow = {
  name: "documents.relate",
  title: "Match the documents to the todos",
  description: "The AI attaches to each open todo the documents it is about — by content. They then show on the todo, in its context and in the agents'. Run with the briefing.",
  inputs: [],
  nodes: [
    invoke("r", "documents.relate", {}),
    { id: "set", kind: "action", action: "todos.set-doc-related", input: { prefix: "doc:", picks: "{{ steps.r.picks }}" } },
    invoke("rep", "documents.report", { kind: "relate", todos: "{{ steps.r.todos }}", batches: "{{ steps.r.batches }}", failed: "{{ steps.r.failed }}", changed: "{{ steps.set.changed }}" }),
    { id: "done", kind: "return", value: ret },
  ],
  requested: { ai: true, todos: true, store: STORES },
  sync: { label: "Document matching", what: "Which documents each open todo is about — the AI reads them by content (after each briefing)", replaces: "docrelations" },
  triggers: [{ kind: "manual" }],
};

const foldersFlow = {
  name: "documents.folders",
  title: "Read in your local folders",
  description: "The folders you chose on this computer (Settings → Documents) looked at: new and changed files read in as documents, files gone marked. What was read in is then read (documents.read); a folder set to confirm waits for you before the AI touches it.",
  inputs: [],
  nodes: [
    invoke("plan", "documents.folders-plan", {}),
    { id: "marks", kind: "foreach", items: "{{ steps.plan.marks }}", as: "b", max: 200, nodes: [exec("mark", "{{ b }}")] },
    {
      id: "work",
      kind: "foreach",
      items: "{{ steps.plan.work }}",
      as: "w",
      max: 200,
      nodes: [
        { id: "hash", kind: "action", action: "files.hash", input: { path: "{{ w.path }}" }, onError: "continue" },
        invoke("p", "documents.keep-plan", { item: "{{ w }}", sha256: "{{ steps.hash.sha256 }}", size: "{{ steps.hash.size }}", error: "{{ steps.hash.error }}", now: "{{ steps.plan.now }}" }),
        { id: "kept", kind: "if", when: "{{ steps.p.keep }}", then: [{ id: "keep", kind: "action", action: "files.keep", input: { path: "{{ w.path }}", dir: "documents", name: "{{ w.clean }}" }, onError: "continue" }], else: [] },
        { id: "wrote", kind: "if", when: "{{ steps.p.statements and not steps.keep.error }}", then: [exec("write", "{{ steps.p.statements }}")], else: [] },
        { id: "dropped", kind: "if", when: "{{ steps.p.drop and not steps.keep.error }}", then: [{ id: "old", kind: "action", action: "files.drop", input: { dir: "documents", file: "{{ steps.p.drop }}" } }], else: [] },
        { id: "one", kind: "script", code: "return { rel: item.rel, error: steps.p.error || steps.keep.error || '', added: steps.keep.error ? 0 : steps.p.added | 0, updated: steps.keep.error ? 0 : steps.p.updated | 0 };" },
      ],
    },
    { id: "prefs", kind: "if", when: "{{ steps.plan.prefValue }}", then: [{ id: "pref", kind: "action", action: "pref.set", input: { plugin: "documents-ext", key: "documents:folders", value: "{{ steps.plan.prefValue }}" } }], else: [] },
    { id: "refresh", kind: "if", when: "{{ steps.work }}", then: [{ id: "inbox", kind: "action", action: "workspace.refresh-databases", input: { dataType: "documents" } }, { id: "reading", kind: "call", flow: "documents.read", input: {} }], else: [] },
    invoke("rep", "documents.report", { kind: "folders", done: "{{ steps.work }}", gone: "{{ steps.plan.gone }}", errors: "{{ steps.plan.errors }}" }),
    { id: "done", kind: "return", value: ret },
  ],
  requested: { api: true, ai: true, store: STORES, maxSteps: 6000 },
  sync: { label: "Local folders", what: "The documents in the folders you chose on this computer — new and changed ones read in", replaces: "localdocs" },
  triggers: [{ kind: "manual" }],
};

const claim = (id: string, d: string) => ({ id, kind: "action", action: "sql.exec", input: { statements: [{ sql: "update documents set status = 'extracting', error = '', updated_at = ? where id = ? and status = 'queued'", params: ["{{ steps.plan.now }}", `{{ ${d}.id }}`] }] } });
const readOne = (sfx: string, d: string, lane: "fast" | "slow") => [
  claim(`claim${sfx}`, d),
  {
    id: `go${sfx}`,
    kind: "if",
    when: `{{ steps.claim${sfx}.changes[0] }}`,
    then: [
      { id: `text${sfx}`, kind: "action", action: "files.text", input: { dir: "documents", file: `{{ ${d}.file }}`, name: `{{ ${d}.name }}`, kind: `{{ ${d}.kind }}`, lane }, onError: "continue" },
      invoke(`res${sfx}`, "documents.read-result", { id: `{{ ${d}.id }}`, lane, read: `{{ steps.text${sfx} }}`, now: "{{ steps.plan.now }}" }),
      exec(`wr${sfx}`, `{{ steps.res${sfx}.statements }}`),
      { id: `out${sfx}`, kind: "script", code: `return { id: ${lane === "fast" ? "item" : "item"}.id, slow: !!steps.res${sfx}.slow };` },
    ],
    else: [],
  },
];
const readFlow = {
  name: "documents.read",
  title: "Read the documents waiting",
  description: "The text is read out of the documents that wait: text, Office files and PDFs with text right here; pictures, scans and recordings by the AI (the Claude CLI) or the transcriber you set — one after the other, a hang ends that one only. Those from a folder that waits for you wait for your confirmation.",
  inputs: [],
  nodes: [
    invoke("plan", "documents.read-plan", { max: 150 }),
    { id: "back", kind: "if", when: "{{ steps.plan.recover }}", then: [exec("recover", "{{ steps.plan.recover }}")], else: [] },
    { id: "fast", kind: "foreach", items: "{{ steps.plan.docs }}", as: "d", max: 150, nodes: readOne("F", "d", "fast") },
    {
      id: "slowly",
      kind: "foreach",
      items: "{{ steps.fast }}",
      as: "r",
      max: 150,
      nodes: [
        {
          id: "isslow",
          kind: "if",
          when: "{{ r and r.slow }}",
          then: [
            { id: "get", kind: "action", action: "sql.query", input: { sql: "select id, name, kind, file from documents where id = ?", params: ["{{ r.id }}"] } },
            ...readOne("S", "steps.get.rows[0]", "slow"),
          ],
          else: [],
        },
      ],
    },
    invoke("rep", "documents.report", { kind: "read", done: "{{ steps.fast }}" }),
    { id: "done", kind: "return", value: ret },
  ],
  requested: { ai: true, store: STORES, maxSteps: 6000 },
  triggers: [{ kind: "schedule", everyMinutes: 10 }],
};


// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The screens' flows: what their buttons do
// ---------------------------------------------------------------------------------------------------------------------------------------------------
const addFlow = {
  name: "documents.add",
  title: "Add a file as a document",
  description: "A file brought by the Documents screen (or the attach panel of a todo — input todo) kept as a document and read; the same content again gives the first one back. input: name, mime, size, token (the staged upload), todo (optional).",
  inputs: [{ name: "name", type: "text" }, { name: "mime", type: "text" }, { name: "size", type: "number" }, { name: "token", type: "text" }, { name: "todo", type: "text" }],
  nodes: [
    { id: "kept", kind: "action", action: "files.take", input: { token: "{{ input.token }}", dir: "documents", name: "{{ input.name }}" } },
    invoke("plan", "documents.add-plan", { name: "{{ steps.kept.name }}", mime: "{{ input.mime }}", sha256: "{{ steps.kept.sha256 }}", size: "{{ steps.kept.size }}", file: "{{ steps.kept.file }}" }),
    { id: "wrote", kind: "if", when: "{{ steps.plan.statements }}", then: [exec("write", "{{ steps.plan.statements }}")], else: [] },
    { id: "row", kind: "action", action: "sql.query", input: { sql: "select id from documents where sha256 = ?", params: ["{{ steps.kept.sha256 }}"] } },
    { id: "attach", kind: "if", when: "{{ input.todo and steps.row.rows[0] }}", then: [{ id: "ctx", kind: "action", action: "todos.add-context", input: { todo: "{{ input.todo }}", refs: ["doc:{{ steps.row.rows[0].id }}"] } }], else: [] },
    { id: "reading", kind: "if", when: "{{ steps.plan.fresh }}", then: [{ id: "inbox", kind: "action", action: "workspace.refresh-databases", input: { dataType: "documents" } }, { id: "go", kind: "call", flow: "documents.read", input: {} }], else: [] },
    { id: "done", kind: "return", value: { ok: true, id: "{{ steps.row.rows[0].id }}", fresh: "{{ steps.plan.fresh }}", message: "{{ steps.plan.message }}" } },
  ],
  requested: { ai: true, todos: true, store: STORES },
  triggers: [{ kind: "manual" }],
};

const actFlow = {
  name: "documents.act",
  title: "Do something with documents",
  description: "What the Documents screen's buttons do to documents: op = read | unread (seen), delete (the document, its file, the todos let go of it), reread (read again), skip, restart (the reading begins afresh), approve (confirm those waiting for you); ids: the documents (3,7 or a list).",
  inputs: [{ name: "op", type: "text" }, { name: "ids", type: "text" }],
  nodes: [
    invoke("plan", "documents.act-plan", { op: "{{ input.op }}", ids: "{{ input.ids }}" }),
    { id: "wrote", kind: "if", when: "{{ steps.plan.statements }}", then: [exec("write", "{{ steps.plan.statements }}")], else: [] },
    { id: "files", kind: "foreach", items: "{{ steps.plan.drops }}", as: "f", max: 500, nodes: [{ id: "drop", kind: "action", action: "files.drop", input: { dir: "documents", file: "{{ f }}" } }] },
    { id: "refs", kind: "foreach", items: "{{ steps.plan.refs }}", as: "r", max: 500, nodes: [{ id: "unref", kind: "action", action: "todos.drop-ref", input: { ref: "{{ r }}" } }] },
    { id: "inbox", kind: "action", action: "workspace.refresh-databases", input: { dataType: "documents" } },
    { id: "reading", kind: "if", when: "{{ steps.plan.reading }}", then: [{ id: "go", kind: "call", flow: "documents.read", input: {} }], else: [] },
    { id: "done", kind: "return", value: { ok: true, changed: "{{ steps.plan.changed }}", message: "{{ steps.plan.message }}" } },
  ],
  requested: { ai: true, todos: true, store: STORES },
  triggers: [{ kind: "manual" }],
};

const folderFlow = {
  name: "documents.folder",
  title: "Change the local folders",
  description: "A folder to read in added (op add, path, mode auto | confirm), its mode set (op mode, id, mode) or the folder no longer read (op remove, id). A folder added is read in at once.",
  inputs: [{ name: "op", type: "text" }, { name: "path", type: "text" }, { name: "mode", type: "text" }, { name: "id", type: "text" }],
  nodes: [
    { id: "look", kind: "if", when: "{{ input.op == 'add' }}", then: [{ id: "chk", kind: "action", action: "files.browse", input: { path: "{{ input.path }}" } }], else: [] },
    invoke("plan", "documents.folder-plan", { op: "{{ input.op }}", path: "{{ steps.chk.path ? steps.chk.path : input.path }}", mode: "{{ input.mode }}", id: "{{ input.id }}" }),
    { id: "pref", kind: "action", action: "pref.set", input: { plugin: "documents-ext", key: "documents:folders", value: "{{ steps.plan.prefValue }}" } },
    { id: "wrote", kind: "if", when: "{{ steps.plan.statements }}", then: [exec("write", "{{ steps.plan.statements }}")], else: [] },
    { id: "scan", kind: "if", when: "{{ steps.plan.scan }}", then: [{ id: "go", kind: "call", flow: "documents.folders", input: {} }], else: [] },
    { id: "done", kind: "return", value: { ok: true, message: "{{ steps.plan.message }}" } },
  ],
  requested: { api: true, ai: true, store: STORES, maxSteps: 6000 },
  triggers: [{ kind: "manual" }],
};

const browseFlow = {
  name: "documents.browse",
  title: "Browse the folders of this computer",
  description: "A folder's subfolders for choosing a folder to read in (none given: the drives). Gives path, parent and dirs.",
  inputs: [{ name: "path", type: "text" }],
  nodes: [
    { id: "ls", kind: "action", action: "files.browse", input: { path: "{{ input.path }}" } },
    { id: "done", kind: "return", value: { path: "{{ steps.ls.path }}", parent: "{{ steps.ls.parent }}", dirs: "{{ steps.ls.dirs }}" } },
  ],
  requested: { api: true },
  triggers: [{ kind: "manual" }],
};

const settingFlow = {
  name: "documents.setting",
  title: "Save the audio transcriber",
  description: "The command that turns audio into text, and whether Poppler is installed by itself (input transcriber, autoInstall).",
  inputs: [{ name: "transcriber", type: "text" }, { name: "autoInstall", type: "text" }],
  nodes: [
    invoke("plan", "documents.settings", { save: { transcriber: "{{ input.transcriber }}", autoInstall: "{{ input.autoInstall }}" } }),
    { id: "pref", kind: "action", action: "pref.set", input: { plugin: "documents-ext", key: "plugin:documents", value: "{{ steps.plan.prefValue }}" } },
    { id: "done", kind: "return", value: { ok: true, message: "{{ steps.plan.message }}" } },
  ],
  requested: {},
  triggers: [{ kind: "manual" }],
};

const attachFlow = {
  name: "documents.attach",
  title: "Attach a document to a todo",
  description: "A document attached to a todo by hand: it shows in its context and goes into what the AI reads about it (input todo, doc).",
  inputs: [{ name: "todo", type: "number" }, { name: "doc", type: "number" }],
  nodes: [{ id: "ctx", kind: "action", action: "todos.add-context", input: { todo: "{{ input.todo }}", refs: ["doc:{{ input.doc }}"] } }, { id: "done", kind: "return", value: { ok: "{{ steps.ctx.ok }}" } }],
  requested: { todos: true },
  triggers: [{ kind: "manual" }],
};

const abstractsFlow = {
  name: "documents.abstracts",
  title: "Fetch the documents' abstracts",
  description: "The knowledge server is asked to take in and compile what is new; the abstracts and concepts of the documents it compiled are kept with them. Runs by itself every ten minutes.",
  inputs: [],
  nodes: [
    invoke("plan", "documents.abstracts-plan", {}),
    {
      id: "ask",
      kind: "if",
      when: "{{ steps.plan.ids }}",
      then: [
        { id: "sync", kind: "action", action: "knowledge.sync", input: {} },
        { id: "pages", kind: "action", action: "knowledge.pages", input: { ids: "{{ steps.plan.ids }}" } },
        invoke("res", "documents.abstracts-result", { pages: "{{ steps.pages.pages }}" }),
        { id: "wrote", kind: "if", when: "{{ steps.res.statements }}", then: [exec("write", "{{ steps.res.statements }}")], else: [] },
      ],
      else: [],
    },
    { id: "done", kind: "return", value: { ok: true, message: "{{ steps.res.n }}" } },
  ],
  requested: { store: STORES },
  triggers: [{ kind: "manual" }, { kind: "schedule", everyMinutes: 10 }],
};

const pullFlow = {
  name: "documents.pull",
  title: "Take back the Unread box of the document inbox",
  description: "A document ticked off (or on) in a row of the document inbox is seen (unread) — run before each read of the inbox (input rows).",
  inputs: [{ name: "rows", type: "json" }],
  nodes: [
    invoke("plan", "documents.pull-plan", { rows: "{{ input.rows }}" }),
    { id: "wrote", kind: "if", when: "{{ steps.plan.statements }}", then: [exec("write", "{{ steps.plan.statements }}")], else: [] },
    { id: "done", kind: "return", value: { ok: true, seen: "{{ steps.plan.seen }}", unread: "{{ steps.plan.unread }}" } },
  ],
  requested: { store: STORES },
  triggers: [{ kind: "manual" }],
};

const settingsDb = {
  id: "i11",
  parent: "i1",
  kind: "database",
  title: "Documents settings",
  icon: "⚙️",
  schema: { titleName: "Settings", properties: [], views: [{ id: "vdocs1", name: "Documents settings", type: "app", filter: { op: "and", rules: [] }, sorts: [], hidden: [], app: "template", template: documentsSettingsTemplate() }] },
  rows: [{ id: "r1", title: "Documents settings", cells: {}, content: { type: "doc", content: [{ type: "paragraph" }] } }],
};

write(
  "documents.package.json",
  JSON.stringify(
    {
      format: 1,
      id: "documents-ext",
      version: "1.0.0",
      name: "Documents",
      description: "Your documents: the text read out of them, the AI's todos from them and which documents belong to which todo, your local folders read in by themselves.",
      icon: "📄",
      items: [
        page("i1", null, "Documents", "📄"),
        page("i2", "i1", "Go through the documents for todos", "📄", reviewFlow),
        page("i3", "i1", "Match the documents to the todos", "📄", relateFlow),
        page("i4", "i1", "Read in your local folders", "📄", foldersFlow),
        page("i5", "i1", "Read the documents waiting", "📄", readFlow),
        page("i6", "i1", "Add a file as a document", "📄", addFlow),
        page("i7", "i1", "Do something with documents", "📄", actFlow),
        page("i8", "i1", "Change the local folders", "📄", folderFlow),
        page("i9", "i1", "Browse the folders of this computer", "📄", browseFlow),
        page("i10", "i1", "Save the audio transcriber", "📄", settingFlow),
        page("i13", "i1", "Attach a document to a todo", "📄", attachFlow),
        page("i14", "i1", "Fetch the documents' abstracts", "📄", abstractsFlow),
        page("i15", "i1", "Take back the Unread box of the document inbox", "📄", pullFlow),
        settingsDb,
      ],
    },
    null,
    2,
  ) + "\n",
);

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------------------------------------------------------------------------------
const col = (name: string, type: "text" | "integer" | "real" = "text") => ({ name, type });
const old = fs.existsSync(path.join(dir, "zeff-plugin.json")) ? (JSON.parse(fs.readFileSync(path.join(dir, "zeff-plugin.json"), "utf8")) as { version?: string }) : {};
write(
  "zeff-plugin.json",
  JSON.stringify(
    {
      $schema: "http://127.0.0.1:9333/ext/sdk/zeff-plugin.schema.json",
      id: "documents-ext",
      name: "Documents",
      version: old.version ?? "0.1.0",
      description: "Your documents: the text read out of text files, Office files, PDFs, pictures and recordings, the AI's todos from them, which documents belong to which todo, your local folders read in by themselves. Its steps are lambdas and flows you or the AI can change.",
      author: "Zeff",
      apiVersion: 1,
      permissions: [],
      contributes: {
        lambdas: "lambdas",
        workspacePackages: ["documents.package.json"],
        appViews: [{ id: "documents-ext", dataType: "documents", label: "Documents", icon: "🗂", template: "views/documents.html" }],
        sources: [{ id: "documents", label: "Documents", icon: "📄", hint: "The documents you dropped in or mail attachments brought — with their abstract, where they came from and whether you have seen them (Unread).", lambda: "documents.source", replaces: "documents", noNewRows: false, pull: "documents.pull" }],
        knowledgeDocs: [{ id: "documents", lambda: "documents.knowledge-docs", args: {}, everyMinutes: 30, replaces: "documents" }],
        stores: [
          { name: "documents", adopts: "documents", key: "id", columns: [col("id", "integer"), col("name"), col("mime"), col("size", "integer"), col("sha256"), col("kind"), col("status"), col("error"), col("file"), col("text"), col("summary"), col("concepts"), col("compiled", "integer"), col("created_at"), col("updated_at")] },
          { name: "gate", adopts: "doc_gate", key: "doc_id", columns: [col("doc_id", "integer"), col("state"), col("at")] },
          { name: "seen", adopts: "document_seen", key: "doc_id", columns: [col("doc_id", "integer"), col("at")] },
          { name: "local_files", adopts: "doc_local_files", key: "path", columns: [col("path"), col("folder_id"), col("rel"), col("doc_id", "integer"), col("size", "integer"), col("mtime", "integer"), col("missing_at")] },
        ],
        aiTasks: [
          { id: "doc-todos", label: "Document review", what: "Finds what you have to do in new and changed documents (Documents plugin)." },
          { id: "doc-relations", label: "Document matching", what: "Matches each todo with the documents it is about." },
        ],
      },
    },
    null,
    2,
  ) + "\n",
);
write("views/documents.html", documentsScreenTemplate());
write("views/documents-attach.html", documentsAttachTemplate());
write(
  "README.md",
  `# Documents (documents-ext)

Your documents as a plugin. Generated by Zeff's \`scripts/port-documents.mts\`.

- The plugin's stores are the built-in's own tables (\`documents\`, \`doc_gate\`, \`doc_local_files\`) — nothing is copied.
- The flow \`documents.review\` (a sync step in the place of "Document review") makes todos of what new and changed documents ask of you; \`documents.relate\` ("Document matching") attaches documents to todos; \`documents.folders\` ("Local folders") reads in the folders you chose; \`documents.read\` reads the text out of what waits.
- Their AI tasks are the rows "Document review" and "Document matching" of this plugin in Settings → AI; the prompt pages (System → Prompts → Documents) work as before.
- The Documents screen, uploads, the settings page and the knowledge server's abstracts are still the built-in's.
`,
);
console.log(`${dir}: Documents (${LAMBDAS.length} lambdas, ${keys.size} texts)`);
