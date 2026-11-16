/**
 * Plugins' stores (manifest `contributes.stores` — docs/plugins/manifest.md): data of a plugin's own beyond Workspace databases — many rows,
 * looked up by key (a connector's messages, a case's sources) — kept by the kernel in tables of its own, `ext_<plugin>_<store>`, in the
 * account's database. Its columns are the declaration's (one added later is added to the table; none is ever dropped). Read and written only
 * through here: the store actions (flows/store-actions.ts) — a flow with the permission `store: ["<plugin>.<store>"]`, a plugin's lambdas
 * reading their own. A port may keep using its built-in's table (`adopts`), only one the kernel lets that built-in's port adopt (ADOPTABLE):
 * your data stays where it is, nothing is copied. Server only.
 */
import { getSqlite } from "@/db";
import { ensureAdoptedTables } from "./adopted-tables";
import { getPlugin } from "./registry";

type Column = { name: string; type: "text" | "integer" | "real" | "json" };
export type StoreDecl = { name: string; columns: Column[]; key: string | string[]; indexes: string[][]; adopts?: string };
/** A store's key as columns (one, or several together). */
const keyOf = (d: StoreDecl): string[] => (Array.isArray(d.key) ? d.key : [d.key]);
export type Where = Record<string, string | number | boolean | null>;

/**
 * The built-ins' tables their ports may keep using (`adopts`), by the port's plugin id: none other. A port named here reads and writes the
 * built-in's own rows — the built-in's code and its port see the same data while you switch.
 */
export const ADOPTABLE: Record<string, string[]> = {
  "cases-ext": ["cases", "case_sources", "case_parties", "bank_transactions", "case_warnings"],
  // (Finances reads the cases and their parties — the debts they hold)
  "finances-ext": ["cases", "case_parties"],
  // (keep_own_notes: only read — which of your boards' notes are synced with Google Keep)
  "keep-ext": ["keep_notes", "keep_own_notes"],
  // (the documents, the ones waiting for your confirmation and what is known of the files of your local folders)
  "documents-ext": ["documents", "doc_gate", "doc_local_files", "document_seen"],
  // (the Jira briefing: which tickets are open, on which boards, and the comments it reads fresh — the tables the Jira reader keeps)
  "jira-lage-ext": ["jira_tickets", "jira_boards", "jira_comments"],
  // (what became of each open loop: closed, dismissed, a proposal to close it, put off)
  "loops-ext": ["loops_state"],
  // (News: its sources, items, what was cleared away, the words it learned and the finds for an item)
  "news-ext": ["news_sources", "news_items", "news_gone", "news_terms", "news_similar"],
  // (the files Zeff recorded as its own in Drive: nothing goes up twice through the switch)
  "google-drive-ext": ["google_drive_files"],
};

/**
 * The preferences a port may read (the kernel's `pref.get`, for a lambda of that plugin): what its built-in kept there as its own settings
 * and data — nothing else (a preference can hold a key or a token: never open to a plugin by name).
 */
export const ADOPTABLE_PREFS: Record<string, string[]> = {
  "finances-ext": ["finances.ownAccounts", "cases.income", "cases.incomeFacts"],
  "auto-actions-ext": ["autoactions:offered"],
  "know-ext": ["know.autoSummary"],
  // (the folders read in by themselves, and when each was looked at)
  "documents-ext": ["documents:folders", "plugin:documents"],
  // (Calendar: how many days ahead appointments are read for todos, and the AI's verdicts on which give you something to do)
  "calendar-ext": ["calendar:todos-days", "calendar:todo-verdicts"],
  "news-ext": ["news:prefs", "news:taste", "news:digest", "news:funnel-stats", "news:discover-queries", "news:autodiscover-at", "news:lowdiscover-at", "news:low-turn", "news:discoveries", "news:expand-at"],
  // (the folders of your Drive the built-in read into the documents — taken over once)
  "google-drive-ext": ["googleDrive.pullFolders"],
};

/** The built-ins' sources their ports may stand in for (a source's `replaces`), by the port's plugin id: the databases that read it go on. */
export const REPLACEABLE_SOURCES: Record<string, string[]> = {
  "cases-ext": ["cases"],
  // (the document inbox: the rows of the documents, their Unread box taken back by the flow documents.pull)
  "documents-ext": ["documents"],
  "finances-ext": ["recurring", "debts"],
  // (News: the news you saved or liked, as a source of the databases)
  "news-ext": ["news"],
};

const SQL_TYPE: Record<Column["type"], string> = { text: "text", integer: "integer", real: "real", json: "text" };
const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]{0,79}$/.test(s)) throw new Error(`Not a name for a table or column: “${s}”.`);
  return `"${s}"`;
};

/** A store of an enabled plugin by its full name ("<plugin>.<store>"), with the table it is kept in. */
export function storeOf(full: string): { plugin: string; decl: StoreDecl; table: string } {
  const at = full.indexOf(".");
  const plugin = full.slice(0, at);
  const name = full.slice(at + 1);
  const p = getPlugin(plugin);
  if (!p?.enabled) throw new Error(`The plugin “${plugin}” isn't on.`);
  const decl = ((p.manifest.contributes as { stores?: StoreDecl[] }).stores ?? []).find((s) => s.name === name);
  if (!decl) throw new Error(`The plugin “${plugin}” has no store “${name}”.`);
  if (decl.adopts) {
    if (!(ADOPTABLE[plugin] ?? []).includes(decl.adopts)) throw new Error(`The plugin “${plugin}” may not use the table “${decl.adopts}” — only a port its built-in's tables, as the kernel allows (lib/ext/stores.ts).`);
    return { plugin, decl, table: decl.adopts };
  }
  return { plugin, decl, table: `ext_${plugin.replace(/-/g, "_")}_${name}` };
}

/** Its table there, with its columns and indexes (an adopted one: as the built-in made it — only checked). */
function ensure(s: { decl: StoreDecl; table: string }): void {
  const db = getSqlite();
  const have = (db.prepare(`pragma table_info(${ident(s.table)})`).all() as { name: string }[]).map((c) => c.name);
  if (s.decl.adopts) {
    if (!have.length) {
      // (a built-in that has left Zeff: its tables are made here — adopted-tables.ts)
      if (!ensureAdoptedTables(s.table)) throw new Error(`The table “${s.table}” isn't there (yet).`);
      return ensure(s);
    }
    const missing = s.decl.columns.filter((c) => !have.includes(c.name)).map((c) => c.name);
    if (missing.length) throw new Error(`The table “${s.table}” has no column ${missing.join(", ")}.`);
    return;
  }
  if (!have.length) {
    const cols = s.decl.columns.map((c) => `${ident(c.name)} ${SQL_TYPE[c.type]}`);
    db.exec(`create table if not exists ${ident(s.table)} (${cols.join(", ")}, primary key (${keyOf(s.decl).map(ident).join(", ")}))`);
  } else for (const c of s.decl.columns.filter((x) => !have.includes(x.name))) db.exec(`alter table ${ident(s.table)} add column ${ident(c.name)} ${SQL_TYPE[c.type]}`);
  s.decl.indexes.forEach((cols, i) => db.exec(`create index if not exists ${ident(`${s.table}_i${i}`)} on ${ident(s.table)} (${cols.map(ident).join(", ")})`));
}

const toDb = (c: Column, v: unknown): unknown => (c.type === "json" ? (v === undefined ? null : JSON.stringify(v)) : typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : v);
const fromDb = (c: Column, v: unknown): unknown => {
  if (c.type !== "json" || typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

function whereSql(decl: StoreDecl, where: Where | undefined): { sql: string; args: unknown[] } {
  const parts: string[] = [];
  const args: unknown[] = [];
  for (const [k, v] of Object.entries(where ?? {})) {
    const c = decl.columns.find((x) => x.name === k);
    if (!c) throw new Error(`The store “${decl.name}” has no column “${k}”.`);
    if (v === null) parts.push(`${ident(k)} is null`);
    else {
      parts.push(`${ident(k)} = ?`);
      args.push(toDb(c, v));
    }
  }
  return { sql: parts.length ? ` where ${parts.join(" and ")}` : "", args };
}

/** Rows of a store: those matching `where` (equal values; null: empty), by `order` ("col" or "-col"), at most `limit` (500 at most). */
export function storeQuery(full: string, q: { where?: Where; order?: string; limit?: number; offset?: number } = {}): { rows: Record<string, unknown>[]; total: number } {
  const s = storeOf(full);
  ensure(s);
  const w = whereSql(s.decl, q.where);
  const desc = q.order?.startsWith("-");
  const col = q.order?.replace(/^-/, "");
  if (col && !s.decl.columns.some((c) => c.name === col)) throw new Error(`The store “${s.decl.name}” has no column “${col}”.`);
  const limit = Math.max(1, Math.min(500, Number(q.limit) || 100));
  const offset = Math.max(0, Number(q.offset) || 0);
  const cols = s.decl.columns.map((c) => ident(c.name)).join(", ");
  const db = getSqlite();
  const raw = db.prepare(`select ${cols} from ${ident(s.table)}${w.sql}${col ? ` order by ${ident(col)}${desc ? " desc" : ""}` : ""} limit ? offset ?`).all(...w.args, limit, offset) as Record<string, unknown>[];
  const total = (db.prepare(`select count(*) as n from ${ident(s.table)}${w.sql}`).get(...w.args) as { n: number }).n;
  return { rows: raw.map((r) => Object.fromEntries(s.decl.columns.map((c) => [c.name, fromDb(c, r[c.name])]))), total };
}

/**
 * Rows written: each by its key — added, or the row with that key replaced in the columns it names. How many — `back`: and the rows as
 * they are now (read again by their key: an id the table gave a new row is in them).
 */
export function storePut(full: string, rows: Record<string, unknown>[], opts: { back?: boolean } = {}): { written: number; rows?: Record<string, unknown>[] } {
  const s = storeOf(full);
  ensure(s);
  if (rows.length > 1000) throw new Error("At most 1000 rows at once.");
  const db = getSqlite();
  let written = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const key = keyOf(s.decl);
      if (key.some((k) => row[k] === undefined || row[k] === null)) throw new Error(`A row needs its key “${key.join(", ")}”.`);
      const cols = s.decl.columns.filter((c) => row[c.name] !== undefined);
      const unknown = Object.keys(row).filter((k) => !s.decl.columns.some((c) => c.name === k));
      if (unknown.length) throw new Error(`The store “${s.decl.name}” has no column ${unknown.join(", ")}.`);
      // (a row there: only the columns named changed — an insert first would trip over the columns it leaves out; else added)
      const set = cols.filter((c) => !key.includes(c.name));
      const where = key.map((k) => `${ident(k)} = ?`).join(" and ");
      const keyArgs = key.map((k) => toDb(s.decl.columns.find((c) => c.name === k)!, row[k]));
      const there = db.prepare(`select 1 from ${ident(s.table)} where ${where}`).get(...keyArgs);
      if (there) {
        if (set.length) db.prepare(`update ${ident(s.table)} set ${set.map((c) => `${ident(c.name)} = ?`).join(", ")} where ${where}`).run(...set.map((c) => toDb(c, row[c.name])), ...keyArgs);
      } else db.prepare(`insert into ${ident(s.table)} (${cols.map((c) => ident(c.name)).join(", ")}) values (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => toDb(c, row[c.name])));
      written++;
    }
  });
  tx();
  if (!opts.back) return { written };
  const key = keyOf(s.decl);
  const back = rows.flatMap((row) => storeQuery(full, { where: Object.fromEntries(key.map((k) => [k, row[k] as string | number | boolean | null])), limit: 1 }).rows);
  return { written, rows: back };
}

/** Rows removed: those matching `where` (it must name something — never the whole store by mistake). How many. */
export function storeDelete(full: string, where: Where): { deleted: number } {
  const s = storeOf(full);
  ensure(s);
  if (!Object.keys(where ?? {}).length) throw new Error("Deleting needs a where (which rows).");
  const w = whereSql(s.decl, where);
  return { deleted: getSqlite().prepare(`delete from ${ident(s.table)}${w.sql}`).run(...w.args).changes };
}
