import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { BASE_DIR, accountDir, currentAccountId } from "@/db/accounts";
import { getSqlite } from "@/db";
import { seal, unseal } from "@/lib/ext/plugin-settings";

/**
 * The Secrets store: the tokens and logins Zeff needs (Jira, Microsoft, Google, the knowledge server …), kept encrypted
 * (AES-256-GCM, the key in `<data>/.secret-key` — the same as plugin secrets) instead of in `.env`.
 *
 * Per account, in one of two places:
 *  - "account" (default): the table `secrets` in the account's own database;
 *  - "separate": a database of its own beside it (`<account folder>/secrets.db`), so a copied or shared zeff.db carries none.
 *
 * `getSecret(name)` asks the store first and falls back to the environment (`.env`), so moving over is safe, one value at a time.
 * A value is never given back to the page — only whether it is set (an address or a login, `secret: false`, is shown). Never logged, never
 * put into a program's environment wholesale: each plugin reads the names it declared (src/plugins/<id>/secrets.ts). Server only.
 */

export type SecretMode = "account" | "separate";

/** One entry on the Secrets page: the name it is stored under (the environment variable it replaces), which plugin brings it, what it is. */
export type SecretDef = { name: string; /** the plugin's id (the page's anchor: /settings/secrets#jira) */ pluginId?: string; plugin: string; label: string; what: string; /** false: an address or a login, shown on the page. Default true. */ secret: boolean };

const NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
const MODES_FILE = () => path.join(/*turbopackIgnore: true*/ BASE_DIR, "secrets-mode.json");

// ── where an account keeps them ──────────────────────────────────────────────────────────────────────────────────────────────────

function readModes(): Record<string, SecretMode> {
  try {
    return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ MODES_FILE(), "utf8")) as Record<string, SecretMode>;
  } catch {
    return {};
  }
}

/** Where this account keeps its secrets (default: its own database). */
export const secretMode = (account = currentAccountId()): SecretMode => (readModes()[account] === "separate" ? "separate" : "account");

const TABLE = "create table if not exists secrets (name text primary key, value text not null, updated_at text not null)";

const separate = new Map<string, Database.Database>();
function separateDb(account: string): Database.Database {
  let db = separate.get(account);
  if (!db) {
    const file = path.join(/*turbopackIgnore: true*/ accountDir(account), "secrets.db");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.exec(TABLE);
    separate.set(account, db);
  }
  return db;
}

function inAccountDb(): Database.Database {
  const db = getSqlite();
  db.exec(TABLE);
  return db;
}

const dbFor = (mode: SecretMode, account = currentAccountId()): Database.Database => (mode === "separate" ? separateDb(account) : inAccountDb());
const store = (): Database.Database => dbFor(secretMode());

// ── reading and writing ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function storedValue(name: string): string | null {
  try {
    const r = store().prepare("select value from secrets where name = ?").get(name) as { value: string } | undefined;
    return r ? unseal(r.value) : null;
  } catch {
    return null; // (unreadable: another key, a damaged row — as if not set)
  }
}

/** A secret: this account's stored one, else the environment's (`.env`), else `fallback`. */
export function getSecret(name: string, fallback = ""): string {
  return (storedValue(name) ?? process.env[name] ?? fallback).trim();
}

export function setSecret(name: string, value: string): void {
  if (!NAME.test(name)) throw new Error(`“${name}” is not a valid name (capital letters, digits and _).`);
  const v = value.trim();
  if (!v) return deleteSecret(name);
  store().prepare("insert into secrets (name, value, updated_at) values (?, ?, ?) on conflict(name) do update set value = excluded.value, updated_at = excluded.updated_at").run(name, seal(v), new Date().toISOString());
}

export function deleteSecret(name: string): void {
  store().prepare("delete from secrets where name = ?").run(name);
}

export type SecretRow = SecretDef & { stored: boolean; inEnv: boolean; updatedAt: string | null; /** The value, when it isn't a secret (an address, a login). */ value: string | null };

/** What the Secrets page shows: every known entry, and the ones stored under other names. Never a secret's value. */
export function listSecrets(known: SecretDef[]): SecretRow[] {
  const rows = new Map((store().prepare("select name, updated_at as updatedAt from secrets").all() as { name: string; updatedAt: string }[]).map((r) => [r.name, r.updatedAt]));
  const names = new Set(known.map((d) => d.name));
  const defs: SecretDef[] = [...known, ...[...rows.keys()].filter((n) => !names.has(n)).map((name) => ({ name, plugin: "", label: name, what: "", secret: true }))];
  return defs.map((d) => ({ ...d, stored: rows.has(d.name), inEnv: !!process.env[d.name]?.trim(), updatedAt: rows.get(d.name) ?? null, value: !d.secret && rows.has(d.name) ? storedValue(d.name) : null }));
}

/**
 * Copy what `.env` holds (of what Zeff knows) into the store. Values already stored stay. Returns the names copied.
 * The file itself is left alone — remove its lines yourself once the page shows them as stored.
 */
export function importFromEnvFile(known: SecretDef[], file = path.join(/*turbopackIgnore: true*/ process.cwd(), ".env")): string[] {
  const KNOWN = new Set(known.map((d) => d.name));
  const done: string[] = [];
  let text = "";
  try {
    text = fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8");
  } catch {
    return done;
  }
  const have = new Set(listSecrets(known).filter((r) => r.stored).map((r) => r.name));
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trim().startsWith("#") || !KNOWN.has(m[1]) || have.has(m[1])) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!v) continue;
    setSecret(m[1], v);
    done.push(m[1]);
  }
  return done;
}

/** Move this account's secrets to the other place (and remember it). What was in the old place is removed there. */
export function moveSecrets(to: SecretMode): void {
  const account = currentAccountId();
  const from = secretMode(account);
  if (from === to) return;
  const src = dbFor(from, account);
  const dst = dbFor(to, account);
  const rows = src.prepare("select name, value, updated_at from secrets").all() as { name: string; value: string; updated_at: string }[];
  const put = dst.prepare("insert into secrets (name, value, updated_at) values (?, ?, ?) on conflict(name) do update set value = excluded.value, updated_at = excluded.updated_at");
  dst.transaction(() => rows.forEach((r) => put.run(r.name, r.value, r.updated_at)))();
  const modes = readModes();
  modes[account] = to;
  fs.writeFileSync(/*turbopackIgnore: true*/ MODES_FILE(), JSON.stringify(modes, null, 2));
  src.prepare("delete from secrets").run();
}
