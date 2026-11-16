import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "@/plugins/workspace/flows/actions";
import type { FieldSpec } from "@/plugins/workspace/flows/types";

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const text = (v: unknown): string => (v == null ? "" : String(v));
const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => String(x).trim()).filter(Boolean);
import { inDataDir } from "@/lib/files/kept";

/**
 * What the Documents plugin lets lambdas and flows read (while it is built in): your letters that are read, with their text.
 * And the generic pieces its port builds on — none of them knows that plugin: reading a folder of this computer and keeping a file in the data
 * folder, the text out of a kept file, the AI's kept marks of a scope, the tickets of the last board run, the todos' refs and making todos from an AI's plan
 * (through the gate). Server only.
 */
export const DOCUMENTS_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "documents.texts",
    group: "documents",
    label: "Your letters' texts",
    summary: "The documents that are read (OCR and summary done): name, summary, the start of their text (up to chars, 6000 by default), when they came.",
    input: [{ name: "chars", type: "number", default: 6000 }],
    output: "{ docs: [{ id, name, summary, text, at }] }",
    run: async (i) => {
      const { getSqlite } = await import("@/db");
      const chars = Math.max(100, Math.min(20000, Number(i.chars) || 6000));
      try {
        return { docs: getSqlite().prepare("select id, name, summary, substr(text, 1, ?) text, created_at at from documents where status = 'ready'").all(chars) };
      } catch {
        return { docs: [] }; // (never ran here)
      }
    },
  },
  {
    name: "documents.origins",
    group: "documents",
    label: "Where documents came from",
    summary: "The mail an attachment-document was taken from (the first one, when several mails had it), by document id: { origins: { <id>: { mailKey, source, subject, from, receivedAt, file } } }. Empty for documents that did not come by mail.",
    input: [f("ids", "list", { required: true })],
    output: "{ origins }",
    run: async (i) => {
      const ids = list(i.ids).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 5000);
      try {
        return { origins: (await import("@/lib/mail/attachments-store")).documentOrigins(ids) };
      } catch {
        return { origins: {} };
      }
    },
  },
  {
    name: "files.scan",
    group: "files",
    label: "The files of a folder of this computer",
    summary:
      "The files of a folder (subfolders too; hidden files, Office's lock files and the system's own folders left out): path, rel (inside the folder), size, mtime (ms). Only those with one of exts (file endings, lower case; none: all), not empty and at most maxBytes (50 MB); at most 50 000 entries looked at. A host path is mapped to the mounted one in a container. Needs the flow's api permission (it reads this computer).",
    input: [f("root", "text", { required: true }), f("exts", "list"), f("maxBytes", "number", { default: 50 * 1024 * 1024 })],
    output: "{ exists, root, files: [{ path, rel, size, mtime }] }",
    run: async (i, ctx) => {
      ctx.may("api");
      const fs = await import("node:fs");
      const { normFolder, walkFiles } = await import("@/lib/files/local");
      const root = normFolder(text(i.root));
      if (!text(i.root).trim() || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) return { exists: false, root, files: [] };
      const exts = new Set(list(i.exts).map((e) => e.toLowerCase().replace(/^\./, "")));
      const ext = (n: string) => (/\.([a-z0-9]+)$/i.exec(n)?.[1] ?? "").toLowerCase();
      return { exists: true, root, files: walkFiles(root, { accept: (n) => !exts.size || exts.has(ext(n)), maxBytes: Math.max(1, Number(i.maxBytes) || 50 * 1024 * 1024) }) };
    },
  },
  {
    name: "files.hash",
    group: "files",
    label: "The hash of a file of this computer",
    summary: "The sha256 and the size of a file (path) — not empty, at most maxBytes (50 MB), else it throws with the reason. Needs the flow's api permission (it reads this computer).",
    input: [f("path", "text", { required: true }), f("maxBytes", "number", { default: 50 * 1024 * 1024 })],
    output: "{ sha256, size }",
    run: async (i, ctx) => {
      ctx.may("api");
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { createHash } = await import("node:crypto");
      const { toLocalPath } = await import("@/lib/hostpath");
      const from = path.resolve(toLocalPath(text(i.path)));
      const data = fs.readFileSync(/*turbopackIgnore: true*/ from);
      const max = Math.max(1, Number(i.maxBytes) || 50 * 1024 * 1024);
      if (!data.length) throw new Error(`“${path.basename(from)}” is empty.`);
      if (data.length > max) throw new Error(`“${path.basename(from)}” is too large (at most ${Math.round(max / 1024 / 1024)} MB).`);
      return { sha256: createHash("sha256").update(data).digest("hex"), size: data.length };
    },
  },
  {
    name: "files.keep",
    group: "files",
    label: "Keep a file of this computer in the data folder",
    summary:
      "Copies a file (path) into a folder of your data folder (dir) under the hash of its content: dir/<first 16 characters of the sha256>-<name>. { sha256, size, file, fresh } — fresh false: it was kept already. Needs the flow's api permission (it reads this computer). At most maxBytes (50 MB).",
    input: [f("path", "text", { required: true }), f("dir", "text", { required: true }), f("name", "text", { required: true }), f("maxBytes", "number", { default: 50 * 1024 * 1024 })],
    output: "{ sha256, size, file, fresh }",
    writes: true,
    run: async (i, ctx) => {
      ctx.may("api");
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { createHash } = await import("node:crypto");
      const { toLocalPath } = await import("@/lib/hostpath");
      const from = path.resolve(toLocalPath(text(i.path)));
      const data = fs.readFileSync(/*turbopackIgnore: true*/ from);
      const max = Math.max(1, Number(i.maxBytes) || 50 * 1024 * 1024);
      if (!data.length) throw new Error(`“${path.basename(from)}” is empty.`);
      if (data.length > max) throw new Error(`“${path.basename(from)}” is too large (at most ${Math.round(max / 1024 / 1024)} MB).`);
      const sha256 = createHash("sha256").update(data).digest("hex");
      const file = `${sha256.slice(0, 16)}-${text(i.name)}`;
      const target = await inDataDir(i.dir, file);
      const fresh = !fs.existsSync(target);
      if (fresh && !ctx.dryRun) {
        fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(target), { recursive: true });
        fs.writeFileSync(/*turbopackIgnore: true*/ target, data);
      }
      return { sha256, size: data.length, file, fresh };
    },
  },
  {
    name: "files.drop",
    group: "files",
    label: "Remove a kept file from the data folder",
    summary: "Removes a file (file) from a folder of your data folder (dir) — one kept with files.keep. { removed }.",
    input: [f("dir", "text", { required: true }), f("file", "text", { required: true })],
    output: "{ removed }",
    writes: true,
    run: async (i, ctx) => {
      const fs = await import("node:fs");
      const target = await inDataDir(i.dir, i.file);
      if (ctx.dryRun || !fs.existsSync(target)) return { removed: false };
      fs.rmSync(/*turbopackIgnore: true*/ target, { force: true });
      return { removed: true };
    },
  },
  {
    name: "files.take",
    group: "files",
    label: "Keep an uploaded file in the data folder",
    summary:
      "Takes the file a view's upload staged (token — what the upload gives the flow) into a folder of your data folder (dir) under the hash of its content: dir/<first 16 characters of the sha256>-<name>; the staged file is gone after. { sha256, size, file, fresh } — fresh false: it was there already. Not empty, at most maxBytes (50 MB), else it throws with the reason.",
    input: [f("token", "text", { required: true }), f("dir", "text", { required: true }), f("name", "text", { required: true }), f("maxBytes", "number", { default: 50 * 1024 * 1024 })],
    output: "{ sha256, size, file, name, fresh }",
    writes: true,
    run: async (i, ctx) => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { createHash } = await import("node:crypto");
      const { stagedPath } = await import("@/plugins/workspace/uploads-staging");
      const from = await stagedPath(i.token);
      if (!fs.existsSync(from)) throw new Error("The uploaded file isn't there any more — upload it again.");
      const bytes = fs.readFileSync(/*turbopackIgnore: true*/ from);
      // (a name that stays in its folder: no path, no odd characters)
      const name = (text(i.name).split(/[\\/]/).pop() ?? "").replace(/[^\p{L}\p{N}._ ()-]+/gu, "_").replace(/^\.+/, "").trim().slice(0, 120) || "file";
      const max = Math.max(1, Math.min(50 * 1024 * 1024, Number(i.maxBytes) || 50 * 1024 * 1024));
      if (!bytes.length) throw new Error(`“${name}” is empty.`);
      if (bytes.length > max) throw new Error(`“${name}” is too large (at most ${Math.round(max / 1024 / 1024)} MB).`);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const file = `${sha256.slice(0, 16)}-${name}`;
      const target = await inDataDir(i.dir, file);
      const fresh = !fs.existsSync(target);
      if (!ctx.dryRun) {
        if (fresh) {
          fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(target), { recursive: true });
          fs.writeFileSync(/*turbopackIgnore: true*/ target, bytes);
        }
        fs.rmSync(/*turbopackIgnore: true*/ from, { force: true });
      }
      return { sha256, size: bytes.length, file, name, fresh };
    },
  },
  {
    name: "files.browse",
    group: "files",
    label: "The subfolders of a folder of this computer",
    summary: "A folder's subfolders (none given: the drives, or / elsewhere; hidden ones left out): { path, parent, dirs: [{ name, path }] } — for choosing a folder. Needs the flow's api permission (it reads this computer).",
    input: [f("path", "text")],
    output: "{ path, parent, dirs }",
    run: async (i, ctx) => {
      ctx.may("api");
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { normFolder, SKIP_DIRS } = await import("@/lib/files/local");
      const raw = text(i.path).trim();
      if (!raw && process.platform === "win32") {
        const drives = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `${l}:\\`).filter((p) => fs.existsSync(p));
        return { path: null, parent: null, dirs: drives.map((p) => ({ name: p, path: p })) };
      }
      const p = normFolder(raw || "/");
      let entries: import("node:fs").Dirent[] = [];
      try {
        entries = fs.readdirSync(/*turbopackIgnore: true*/ p, { withFileTypes: true });
      } catch {
        throw new Error(`“${raw}” can't be opened.`);
      }
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("$") && !SKIP_DIRS.has(e.name.toLowerCase()))
        .map((e) => ({ name: e.name, path: path.join(p, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 500);
      const up = path.dirname(p);
      return { path: p, parent: up === p ? null : up, dirs };
    },
  },
  {
    name: "knowledge.pages",
    group: "knowledge",
    label: "What the knowledge server made of pages",
    summary: "Pages (by their ids, \"zeff:doc:12\") as the knowledge server has them: compiled in their current version, their abstract and concepts — { pages: [{ id, title, summary, concepts, compiled }] }. Empty while there is no knowledge server.",
    input: [f("ids", "list", { required: true })],
    output: "{ pages }",
    run: async (i) => {
      const { isInstalled } = await import("@/plugins/state");
      const ids = list(i.ids).filter((x) => /^zeff:[\w:.-]{1,80}$/.test(x)).slice(0, 200);
      if (!ids.length || !isInstalled("knowledge")) return { pages: [] };
      try {
        return { pages: await (await import("@/plugins/knowledge/client")).knowledgePages(ids) };
      } catch {
        return { pages: [] }; // (the server isn't answering: the abstracts come when it has compiled)
      }
    },
  },
  {
    name: "knowledge.sync",
    group: "knowledge",
    label: "Ask the knowledge server to take in what is new",
    summary: "The knowledge server is asked to read Zeff's pages again and compile what changed. { started } — false while there is no knowledge server (or it isn't answering).",
    input: [],
    output: "{ started }",
    writes: true,
    run: async (_i, ctx) => {
      const { isInstalled } = await import("@/plugins/state");
      if (ctx.dryRun || !isInstalled("knowledge")) return { started: false };
      try {
        return { started: !!(await (await import("@/plugins/knowledge/client")).knowledgeSync()).started };
      } catch {
        return { started: false };
      }
    },
  },
  {
    name: "todos.drop-ref",
    group: "todos",
    label: "Let the todos go of a thing",
    summary: "Takes a ref (\"doc:12\") out of what every todo keeps as its source or its context (the thing is gone): { changed } — how many todos changed.",
    input: [f("ref", "text", { required: true })],
    output: "{ changed }",
    writes: true,
    run: async (i, ctx) => {
      const ref = text(i.ref);
      if (!/^[a-z][a-z0-9-]{0,15}:[\w.-]{1,80}$/.test(ref)) throw new Error("ref: a thing's ref (\"doc:12\").");
      if (ctx.dryRun) return { changed: 0 };
      const { getDb, schema } = await import("@/db");
      const { eq, sql } = await import("drizzle-orm");
      const { emitChange } = await import("@/lib/events");
      const db = getDb();
      let changed = 0;
      for (const todo of db.select({ id: schema.todos.id, refs: schema.todos.refs }).from(schema.todos).where(sql`${schema.todos.refs} like ${`%"${ref}"%`}`).all()) {
        const refs = (JSON.parse(todo.refs) as string[]).filter((x) => x !== ref);
        db.update(schema.todos).set({ refs: JSON.stringify(refs) }).where(eq(schema.todos.id, todo.id)).run();
        changed++;
      }
      if (changed) emitChange("todos");
      return { changed };
    },
  },
  {
    name: "todos.add-context",
    group: "todos",
    label: "Attach things to a todo",
    summary: "Adds refs (\"doc:12\") to a todo's context — what it is about, shown with it and read by the AI with it; what it has stays. { ok } — false: there is no such todo. Needs the flow's permission todos.",
    input: [f("todo", "number", { required: true }), f("refs", "list", { required: true }), f("by", "text", { default: "Zeff" })],
    output: "{ ok }",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not change todos — grant it under the flow's permissions (todos).");
      const refs = list(i.refs).filter((r) => /^[a-z][a-z0-9-]{0,15}:[\w.-]{1,80}$/.test(r)).slice(0, 30);
      if (ctx.dryRun) return { ok: true };
      const { addTodoContext } = await import("@/lib/todos/store");
      return { ok: !!addTodoContext(Number(i.todo), refs, "", text(i.by) || "Zeff") };
    },
  },
  {
    name: "files.text",
    group: "files",
    label: "The text out of a kept file",
    summary:
      "The text of a file kept in your data folder (dir, file) as its kind says (text, office, pdf, image, audio; name: what it is called). lane fast: only what is read right here (text, Office files, a PDF with text) — what needs the Claude CLI or a transcriber answers slow: true; lane slow: everything, with a time limit. Not readable here: { unsupported } with the reason. Needs the flow's ai permission for lane slow (pictures and scans are read by the AI).",
    input: [f("dir", "text", { required: true }), f("file", "text", { required: true }), f("name", "text", { required: true }), f("kind", "text", { required: true }), f("lane", "text", { default: "fast" })],
    output: "{ text, slow, unsupported }",
    run: async (i, ctx) => {
      const lane = text(i.lane) === "slow" ? "slow" : "fast";
      if (lane === "slow") ctx.may("ai");
      const target = await inDataDir(i.dir, i.file);
      const { extractText, NeedsSlowLane, UnsupportedError } = await import("./extract");
      try {
        return { text: await extractText(target, text(i.name), text(i.kind) as never, { lane }), slow: false, unsupported: "" };
      } catch (e) {
        if (e instanceof NeedsSlowLane) return { text: "", slow: true, unsupported: "" };
        if (e instanceof UnsupportedError) return { text: "", slow: false, unsupported: e.message };
        throw e;
      }
    },
  },
  {
    name: "workspace.refresh-databases",
    group: "data",
    label: "Read a type of database again",
    summary: "The Workspace's databases of a data type (documents: the document inbox) read again from their source, in the background — after code changed what they show.",
    input: [f("dataType", "text", { required: true })],
    output: "{ ok }",
    writes: true,
    run: async (i, ctx) => {
      if (text(i.dataType) !== "documents") throw new Error("dataType: documents.");
      if (!ctx.dryRun) (await import("@/plugins/workspace/document-databases")).refreshDocumentDatabases();
      return { ok: true };
    },
  },
  {
    name: "ai.memo-all",
    group: "ai",
    label: "Every AI answer Zeff kept for a scope",
    summary: "All answers kept for a scope (the AI memo): [{ ref, hash, value, at }] — for a step that goes through many things and asks again only for what changed.",
    input: [f("scope", "text", { required: true })],
    output: "{ entries: [{ ref, hash, value, at }] }",
    run: async (i) => {
      if (!/^[a-z][a-z0-9:-]{0,63}$/.test(text(i.scope))) throw new Error("scope: lower-case words with dashes.");
      const { memoAll } = await import("@/lib/ai/memo");
      return { entries: [...memoAll<unknown>(text(i.scope))].map(([ref, e]) => ({ ref, hash: e.hash, value: e.value, at: e.at })) };
    },
  },
  {
    name: "board.tickets",
    group: "jira",
    label: "The tickets of the last good board run",
    summary: "The keys of the tickets the last good briefing had (the Ticket-Lage's), each with the summary Jira has of it (empty: not read): { tickets: [{ key, summary }] }.",
    input: [],
    output: "{ tickets: [{ key, summary }] }",
    run: async () => {
      const { lastGoodRun } = await import("@/lib/runs/store");
      const { getJiraTicket } = await import("@/lib/jira/store");
      return { tickets: (lastGoodRun()?.tickets ?? []).map((x) => ({ key: x.key, summary: getJiraTicket(x.key)?.summary ?? "" })) };
    },
  },
  {
    name: "jira.summaries",
    group: "jira",
    label: "What Jira calls tickets",
    summary: "The summary Jira has of each ticket key given (empty: not read): { summaries: { [key]: summary } }.",
    input: [f("keys", "list", { required: true })],
    output: "{ summaries }",
    run: async (i) => {
      const { getJiraTicket } = await import("@/lib/jira/store");
      return { summaries: Object.fromEntries(list(i.keys).slice(0, 500).map((k) => [k, getJiraTicket(k)?.summary ?? ""])) };
    },
  },
  {
    name: "todos.refs",
    group: "todos",
    label: "What the todos cite",
    summary: "The refs the todos (every status) keep as their source, those starting with prefix (\"doc:\"): { refs: [ref] }.",
    input: [f("prefix", "text", { required: true })],
    output: "{ refs }",
    run: async (i) => {
      const { listTodos } = await import("@/lib/todos/store");
      const prefix = text(i.prefix);
      return { refs: [...new Set(listTodos({ status: "all" }).flatMap((x) => x.refs.filter((r) => r.startsWith(prefix))))] };
    },
  },
  {
    name: "todos.propose",
    group: "todos",
    label: "Todos from what an AI went through",
    summary:
      "Makes todos from an AI's plan — each through the gate every todo goes through: one that repeats an open todo is merged into it, one you dropped isn't made again. items: [{ text, kind, owner (me|other), ticket, due (YYYY-MM-DD), refs, repeat: { freq (daily|weekly|monthly|yearly), until, start } }]; source: what the todo says it comes from; prefix: the kind of ref its refs keep (\"doc:\"); actor: who it is attributed to (default: the run, runId). { added, merged, known }. Needs the flow's todos permission.",
    input: [f("items", "json", { required: true }), f("source", "text", { required: true }), f("prefix", "text", { required: true }), f("actor", "text"), f("runId", "number")],
    output: "{ added, merged, known }",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not add todos — grant it under the flow's permissions (todos).");
      const items = (Array.isArray(i.items) ? i.items : []) as { text?: string; kind?: string; owner?: string; ticket?: string; due?: string | null; refs?: string[]; repeat?: { freq?: string; until?: string; start?: string } | null }[];
      const prefix = text(i.prefix);
      const source = text(i.source).trim().slice(0, 60);
      if (!/^[a-z][a-z0-9-]{0,15}:$/.test(prefix) || !source) throw new Error("prefix: a ref's kind with its colon (\"doc:\"); source: a name.");
      if (ctx.dryRun) return { added: 0, merged: 0, known: 0, dryRun: items.length };
      const { listTodos, droppedByYou, addRefTodo } = await import("@/lib/todos/store");
      const { duplicateTodo } = await import("@/lib/todos/similar");
      const { attributed } = await import("@/lib/todos/activity");
      const runId = Number(i.runId) > 0 ? Number(i.runId) : null;
      const actor = text(i.actor).trim() || (runId ? `lage:${runId}` : "plugin");
      const open = listTodos({ status: "open" });
      const dropped = droppedByYou();
      let added = 0;
      let merged = 0;
      let known = 0;
      for (const td of items) {
        const body = text(td.text).trim();
        if (!body) continue;
        // One you dropped isn't made again; one that repeats an open todo is merged into it (the gate).
        if (!duplicateTodo({ text: body, ops: [] }, open) && duplicateTodo({ text: body, ops: [] }, dropped)) continue;
        const made = attributed(actor, () =>
          addRefTodo({ ticket: text(td.ticket), text: body, kind: text(td.kind) || "other", owner: td.owner === "other" ? "other" : "me", refs: list(td.refs), runId, due: td.due ?? null }, { source, prefix }),
        );
        // A todo that comes back (a rate every month): its rule is kept on it — the calendar shows the series, done it comes again.
        if (td.repeat?.freq && ["daily", "weekly", "monthly", "yearly"].includes(td.repeat.freq) && made.outcome !== "known") {
          (await import("@/lib/todos/recurring")).setRecurrence(made.id, { freq: td.repeat.freq as "monthly", interval: 1, ...(td.repeat.until ? { until: td.repeat.until } : {}), ...(td.repeat.start ? { start: td.repeat.start } : {}) });
        }
        if (made.outcome === "merged") merged++;
        else if (made.outcome === "known") known++;
        else {
          open.push(made);
          added++;
        }
      }
      return { added, merged, known };
    },
  },
  {
    name: "todos.set-doc-related",
    group: "todos",
    label: "What the todos are related to",
    summary: "Adds to the todos the things an AI found them related to (what they have stays until you dismiss it): picks: { <todo id>: [ref] }, only refs starting with prefix (\"doc:\"). { changed } — how many todos changed.",
    input: [f("prefix", "text", { required: true }), f("picks", "json", { required: true })],
    output: "{ changed }",
    writes: true,
    run: async (i, ctx) => {
      const prefix = text(i.prefix);
      if (!/^[a-z][a-z0-9-]{0,15}:$/.test(prefix)) throw new Error("prefix: a ref's kind with its colon (\"doc:\").");
      if (ctx.dryRun) return { changed: 0 };
      const { setRelatedRefs } = await import("@/lib/todos/store");
      const picks = new Map<number, string[]>();
      for (const [id, refs] of Object.entries((i.picks && typeof i.picks === "object" ? i.picks : {}) as Record<string, unknown>)) if (Number.isInteger(Number(id))) picks.set(Number(id), list(refs));
      return { changed: setRelatedRefs((r) => r.startsWith(prefix), picks) };
    },
  },
];

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("documents", DOCUMENTS_FLOW_ACTIONS);
