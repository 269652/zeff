import path from "node:path";
import { currentAccountId } from "@/db/accounts";
import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { FlowAction } from "@/plugins/workspace/flows/actions";
import type { FieldSpec } from "@/plugins/workspace/flows/types";

/**
 * What the Explorer lets lambdas and flows do with this computer's files (the kernel's service behind the plugin's screens — it works while the built-in
 * Explorer is on or its port is). Every path goes through the built-in's own guard (`normPath`: absolute, normalised, a container's mounted folders mapped),
 * and never into Zeff's own data folder (the database, the accounts, the keys). Reading is bounded: at most 5000 entries of a folder, text up to 10 MB,
 * and only the kinds of file the viewer knows. What changes something (saving a text, a new folder, importing, watching) is for flows with the permission
 * “api” (a lambda only reads). Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });

/** The folder Zeff keeps its own data in (the database, accounts.json, the plugins) — never shown, read or written from here. */
const zeffData = () => path.resolve(path.dirname(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "zeff.db")));

/** A path from a lambda or a flow, checked: the Explorer is on, the path is a real absolute one, not inside Zeff's own data. Gives the normalised path. */
export async function allowedPath(raw: unknown): Promise<string> {
  if (!isInstalled("explorer")) throw new Error(t("The Explorer plugin is not installed (Menu → Plugins)."));
  const { normPath, under } = await import("./files");
  const p = normPath(String(raw ?? ""));
  if (under(p, zeffData())) throw new Error(t("“{path}” holds Zeff's own data — it isn't shown here.", { path: String(raw) }));
  return p;
}

/** A list of paths given as a list or as JSON text (a view's ticked files). */
const pathList = (v: unknown): string[] => {
  let list: unknown = v;
  if (typeof v === "string") {
    try {
      list = JSON.parse(v);
    } catch {
      list = v.trim() ? [v] : [];
    }
  }
  return (Array.isArray(list) ? list : []).map(String).slice(0, 500);
};

const mayChange = (ctx: { may: (n: "api") => void }) => ctx.may("api");

export const EXPLORER_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "fs.places",
    group: "files",
    label: "The places of this computer",
    summary: "The Explorer's places: quick access (home, desktop, documents, downloads, pictures), the folders Documents watches, the drives — and which of the watched ones are watched live.",
    input: [],
    output: "{ quick: [{ name, path, icon }], watched: [{ id, mode, name, path, icon }], drives: [{ name, path, icon }], live: [path], canOpen }",
    run: async () => {
      if (!isInstalled("explorer")) throw new Error(t("The Explorer plugin is not installed (Menu → Plugins)."));
      const { places, canOpenHere } = await import("./files");
      const { liveFolders } = await import("./watch");
      return { ...places(), live: liveFolders(currentAccountId()), canOpen: canOpenHere() };
    },
  },
  {
    name: "fs.list",
    group: "files",
    label: "A folder's entries",
    summary: "The entries of a folder (no path: the drives): folders first, then files by name, hidden and system ones left out, at most 5000 — each with its size, time, whether it is in Documents (docId) and whether it changed since (changed). Never Zeff's own data folder.",
    input: [f("path", "text", { help: "Empty: This PC (the drives)." })],
    output: "{ path, parent, entries: [{ name, path, dir, size, mtime, docId, changed }], watched, cut }",
    run: async (i) => {
      const raw = String(i.path ?? "").trim();
      if (raw) await allowedPath(raw);
      else if (!isInstalled("explorer")) throw new Error(t("The Explorer plugin is not installed (Menu → Plugins)."));
      const { listDir } = await import("./files");
      const listing = listDir(raw || null);
      // (the data folder is left out of the list of the folder around it)
      return { ...listing, entries: listing.entries.filter((e) => !isZeffData(e.path)) };
    },
  },
  {
    name: "fs.stat",
    group: "files",
    label: "A file's facts",
    summary: "One file or folder: its name, size, time, kind (how the viewer shows it), the editor's language, whether Documents can read it, whether it is in Documents.",
    input: [f("path", "text", { required: true })],
    output: "{ path, name, dir, size, mtime, view, language, docId, changed, importable }",
    run: async (i) => {
      const p = await allowedPath(i.path);
      const fs = await import("node:fs");
      const { toHostPath } = await import("@/lib/hostpath");
      const { importState } = await import("./imports");
      const { viewKind, languageOf } = await import("./shared");
      const { kindOf, MAX_DOCUMENT_BYTES } = await import("@/plugins/documents/shared");
      const st = fs.statSync(/*turbopackIgnore: true*/ p);
      const name = path.basename(p) || p;
      const host = toHostPath(p);
      const state = st.isDirectory() ? undefined : importState([{ path: host, size: st.size, mtime: Math.round(st.mtimeMs) }]).get(host);
      return {
        path: host,
        name,
        dir: st.isDirectory(),
        size: st.isDirectory() ? 0 : st.size,
        mtime: Math.round(st.mtimeMs),
        view: st.isDirectory() ? "none" : viewKind(name),
        language: languageOf(name),
        docId: state?.docId ?? null,
        changed: state?.changed ?? false,
        importable: !st.isDirectory() && kindOf(name) !== "other" && st.size > 0 && st.size <= MAX_DOCUMENT_BYTES,
      };
    },
  },
  {
    name: "fs.read-text",
    group: "files",
    label: "Open a file for the viewer",
    summary: "A file as the viewer shows it: its kind, and for text, Markdown and CSV (10 MB at most) its text — editable when it is UTF-8 and up to 2 MB; for Office files the text Documents reads out of them. Pictures, PDFs, audio and video have no text (the viewer takes them from /api/explorer/file).",
    input: [f("path", "text", { required: true })],
    output: "{ path, name, size, mtime, view, text, editable, readOnlyWhy, language, docId, changed, importable }",
    run: async (i) => {
      const p = await allowedPath(i.path);
      return (await import("./files")).openFile(p);
    },
  },
  {
    name: "fs.save-text",
    group: "files",
    label: "Save a text file",
    summary: "A text file (txt, md, csv, code …) saved — refused when it changed on the disk since it was opened (mtime = what it was then), when it isn't UTF-8 or is over 2 MB. A file imported into Documents by hand has its document updated. Needs the flow's “api” permission.",
    input: [f("path", "text", { required: true }), f("text", "text", { required: true }), f("mtime", "number", { help: "The file's time when it was opened (0: not checked)." })],
    output: "{ mtime, size, message }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      const p = await allowedPath(i.path);
      if (ctx.dryRun) return { dryRun: true, path: p };
      const files = await import("./files");
      const saved = files.saveText(String(i.path), String(i.text ?? ""), Number(i.mtime) || 0);
      let message = t("Saved.");
      if (isInstalled("documents") && !files.watchedFolderOf(p)) {
        const { importState, importFiles } = await import("./imports");
        const had = importState([{ path: String(i.path), size: saved.size, mtime: saved.mtime }]).get(String(i.path));
        if (had?.changed) {
          await importFiles([String(i.path)]);
          message = t("Saved — its document in Documents is updated.");
        }
      }
      return { ...saved, message };
    },
  },
  {
    name: "fs.make",
    group: "files",
    label: "A new folder or text file",
    summary: "A new folder, or a new empty text file (.txt, .md, .csv …), in a folder; its path. Needs the flow's “api” permission.",
    input: [f("parent", "text", { required: true }), f("name", "text", { required: true }), f("kind", "text", { required: true, help: "folder or file" })],
    output: "{ path }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      const parent = await allowedPath(i.parent);
      if (ctx.dryRun) return { dryRun: true, parent };
      const files = await import("./files");
      return { path: String(i.kind) === "folder" ? files.makeFolder(parent, String(i.name ?? "")) : files.makeTextFile(parent, String(i.name ?? "")) };
    },
  },
  {
    name: "fs.open-here",
    group: "files",
    label: "Open a file on this computer",
    summary: "A file opened with the program this computer opens it with — or, reveal=true, shown in Windows Explorer. Programs and scripts are never started, only shown. Needs the flow's “api” permission.",
    input: [f("path", "text", { required: true }), f("reveal", "boolean")],
    output: "{ message }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      const p = await allowedPath(i.path);
      if (ctx.dryRun) return { dryRun: true, path: p };
      const reveal = i.reveal === true || i.reveal === "true";
      await (await import("./files")).openHere(p, reveal);
      return { message: reveal ? t("Shown in Windows Explorer.") : t("Opened on this computer.") };
    },
  },
  {
    name: "explorer.import-files",
    group: "files",
    label: "Import files into Documents",
    summary: "Files (paths: a list, or the JSON text of one — at most 500) imported into Documents; a changed one updates its document. Needs the flow's “api” permission and the Documents plugin.",
    input: [f("paths", "json", { required: true })],
    output: "{ message, docIds }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      if (!isInstalled("documents")) throw new Error(t("The Documents plugin is not installed (Menu → Plugins)."));
      const list = await Promise.all(pathList(i.paths).map((p) => allowedPath(p).then(() => p)));
      if (ctx.dryRun) return { dryRun: true, files: list.length };
      const { importFiles, importMessage } = await import("./imports");
      const r = await importFiles(list);
      return { message: importMessage(r), docIds: r.docIds };
    },
  },
  {
    name: "explorer.import-folder",
    group: "files",
    label: "Import a folder into Documents",
    summary: "Every file of a folder Documents can read (subfolders too, at most 500) imported once. Needs the flow's “api” permission and the Documents plugin.",
    input: [f("path", "text", { required: true })],
    output: "{ message }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      if (!isInstalled("documents")) throw new Error(t("The Documents plugin is not installed (Menu → Plugins)."));
      const p = await allowedPath(i.path);
      if (ctx.dryRun) return { dryRun: true, path: p };
      const { readableFiles, importFiles, importMessage, MAX_FOLDER_IMPORT } = await import("./imports");
      const { files, cut } = readableFiles(String(i.path));
      if (!files.length) return { message: t("Nothing in this folder that Documents reads.") };
      const r = await importFiles(files);
      return { message: `${importMessage(r)}${cut ? ` ${t("Only the first {n} files — watch the folder to take in all of it.", { n: MAX_FOLDER_IMPORT })}` : ""}` };
    },
  },
  {
    name: "explorer.watch",
    group: "files",
    label: "Watch a folder",
    summary: "A folder watched: a local folder of Documents (read in now, then on every change and on its schedule). mode: auto, or confirm (its documents wait for your confirmation). Needs the flow's “api” permission and the Documents plugin.",
    input: [f("path", "text", { required: true }), f("mode", "text", { help: "auto or confirm (default)" })],
    output: "{ message }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      if (!isInstalled("documents")) throw new Error(t("The Documents plugin is not installed (Menu → Plugins)."));
      const p = await allowedPath(i.path);
      if (ctx.dryRun) return { dryRun: true, path: p };
      const mode = String(i.mode) === "auto" ? "auto" : "confirm";
      const folder = (await import("@/plugins/documents/folders")).addFolder(String(i.path), mode);
      void (await import("@/lib/sync/registry")).startSync("localdocs");
      (await import("./watch")).watchFolder(currentAccountId(), folder.path);
      return { message: mode === "confirm" ? t("“{path}” is watched — its documents wait for your confirmation in Documents.", { path: folder.path }) : t("“{path}” is watched — what changes in it comes into Documents.", { path: folder.path }) };
    },
  },
  {
    name: "explorer.unwatch",
    group: "files",
    label: "Stop watching a folder",
    summary: "A watched folder no longer watched (its documents stay in Documents). Needs the flow's “api” permission.",
    input: [f("id", "text", { required: true })],
    output: "{ message }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      if (!isInstalled("documents")) throw new Error(t("The Documents plugin is not installed (Menu → Plugins)."));
      if (ctx.dryRun) return { dryRun: true };
      (await import("@/plugins/documents/folders")).removeFolder(String(i.id));
      await (await import("./watch")).refreshWatchers();
      return { message: t("No longer watched; its documents stay in Documents.") };
    },
  },
  {
    name: "explorer.watch-mode",
    group: "files",
    label: "When the AI may read a watched folder",
    summary: "A watched folder's mode: auto (on to the AI at once) or confirm (waits for your confirmation). Needs the flow's “api” permission.",
    input: [f("id", "text", { required: true }), f("mode", "text", { required: true })],
    output: "{ message }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      if (!isInstalled("documents")) throw new Error(t("The Documents plugin is not installed (Menu → Plugins)."));
      if (ctx.dryRun) return { dryRun: true };
      (await import("@/plugins/documents/folders")).setFolderMode(String(i.id), String(i.mode) === "auto" ? "auto" : "confirm");
      return { message: t("Saved.") };
    },
  },
];

/** Whether a path is Zeff's own data (or in it). */
function isZeffData(p: string): boolean {
  const root = zeffData();
  const a = path.resolve(p);
  const win = process.platform === "win32";
  const [x, y] = win ? [a.toLowerCase(), root.toLowerCase()] : [a, root];
  return x === y || x.startsWith(y + path.sep);
}

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("explorer", EXPLORER_FLOW_ACTIONS);
