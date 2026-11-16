import { getSqlite } from "@/db";
import { storeOf } from "./stores";

/**
 * SQL over a plugin's own stores (capability J): what code needs when it works on many rows at once — a join, a count, an update of every row that matches —
 * and a key-by-key store can't do. One statement at a time (a SELECT / WITH to read, an INSERT / UPDATE / DELETE / REPLACE to write), values bound
 * (`?`), only the tables of the stores the caller may use (a plugin's own — tables of its own or the built-in's it adopted — or the flow's granted
 * `store` permission). The check is SQLite's own: the statement is EXPLAINed and every table or index it opens must belong to those stores, so no quoting trick
 * reaches another table, the master table or another database. Server only.
 */
const READ = /^\s*(select|with)\b/i;
const WRITE = /^\s*(insert|update|delete|replace)\b/i;
const FIRST = 2000;

/** The tables behind these stores ("<plugin>.<store>"), made where they are not yet. */
export function tablesOfStores(stores: string[]): string[] {
  return [...new Set(stores.map((s) => storeOf(s).table))];
}

type Op = { opcode: string; p2: number; p3: number };

/** Throws unless every table and index the statement opens belongs to `tables`. */
function checkTables(sql: string, tables: string[], params: unknown[] = []): void {
  const db = getSqlite();
  // (the statement's values bound too: EXPLAIN of one with a `?` and no value fails)
  const rows = db.prepare(`explain ${sql}`).all(...(params as never[])) as Op[];
  const roots = new Map<number, string>();
  const quoted = tables.map(() => "?").join(",");
  for (const r of db.prepare(`select name, tbl_name, rootpage from sqlite_master where rootpage > 0 and tbl_name in (${quoted})`).all(...tables) as { name: string; tbl_name: string; rootpage: number }[]) roots.set(r.rootpage, r.tbl_name);
  // (An insert into a table with AUTOINCREMENT writes SQLite's counter table by itself: allowed — but a statement may not name it.)
  const noSequence = !/\bsqlite_sequence\b/i.test(sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").replace(/'(?:[^']|'')*'/g, "''"));
  if (noSequence) {
    const seq = db.prepare("select rootpage from sqlite_master where name = 'sqlite_sequence'").get() as { rootpage: number } | undefined;
    if (seq) roots.set(seq.rootpage, "sqlite_sequence");
  }
  // (The two table-valued functions of SQLite's JSON — json_each, json_tree — open a virtual table each, and only those: as many virtual tables as the statement
  // names them — comments and strings left out — so none of the account's other virtual tables, the search index among them, can be reached.)
  const bare = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").replace(/'(?:[^']|'')*'/g, "''");
  let allowedVirtual = (bare.match(/\bjson_(?:each|tree)\s*\(/gi) ?? []).length;
  for (const o of rows) {
    if (o.opcode === "VOpen") {
      if (allowedVirtual-- > 0) continue;
      throw new Error("A virtual table isn't one of this plugin's stores.");
    }
    if (o.opcode === "VCreate" || o.opcode === "VDestroy") throw new Error("A virtual table isn't one of this plugin's stores.");
    if (o.opcode === "OpenRead" || o.opcode === "OpenWrite" || o.opcode === "ReopenIdx") {
      if (o.p3 !== 0) throw new Error("Only the account's database.");
      if (!roots.has(o.p2)) throw new Error("This statement reads or writes a table that isn't one of this plugin's stores.");
    }
  }
}

/** The rows a SELECT gives (at most `limit`, 2000 at most). */
export function sqlQuery(stores: string[], sql: string, params: unknown[] = [], limit = 500): { rows: Record<string, unknown>[]; truncated: boolean } {
  if (!READ.test(sql)) throw new Error("sql.query: a SELECT (or WITH … SELECT).");
  const tables = tablesOfStores(stores);
  if (!tables.length) throw new Error("This caller has no store to read.");
  const stmt = getSqlite().prepare(sql);
  if (!stmt.reader) throw new Error("sql.query: the statement doesn't read.");
  checkTables(sql, tables, params);
  const max = Math.min(FIRST, Math.max(1, limit));
  const rows: Record<string, unknown>[] = [];
  let truncated = false;
  for (const r of stmt.iterate(...(params as never[]))) {
    if (rows.length >= max) {
      truncated = true;
      break;
    }
    rows.push(r as Record<string, unknown>);
  }
  return { rows, truncated };
}

/** Statements that write, one transaction: how many rows each changed (and the last inserted id). */
export function sqlExec(stores: string[], statements: { sql: string; params?: unknown[] }[]): { changes: number[]; lastId: (number | null)[] } {
  if (!statements.length) return { changes: [], lastId: [] };
  if (statements.length > 500) throw new Error("sql.exec: at most 500 statements at once.");
  const tables = tablesOfStores(stores);
  if (!tables.length) throw new Error("This caller has no store to write.");
  const db = getSqlite();
  const prepared = statements.map((s) => {
    if (!WRITE.test(s.sql)) throw new Error("sql.exec: an INSERT, UPDATE, DELETE or REPLACE.");
    const stmt = db.prepare(s.sql);
    if (stmt.reader && !/\breturning\b/i.test(s.sql)) throw new Error("sql.exec: the statement reads — use sql.query.");
    checkTables(s.sql, tables, s.params ?? []);
    return { stmt, params: (s.params ?? []) as never[] };
  });
  const changes: number[] = [];
  const lastId: (number | null)[] = [];
  db.transaction(() => {
    for (const p of prepared) {
      const r = p.stmt.run(...p.params);
      changes.push(r.changes);
      lastId.push(typeof r.lastInsertRowid === "bigint" ? Number(r.lastInsertRowid) : (r.lastInsertRowid as number) || null);
    }
  })();
  return { changes, lastId };
}
