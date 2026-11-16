import { getSqlite } from "@/db";

/**
 * The tables a port keeps (stores.ts `adopts`) whose built-in code has left Zeff: made here when an account does not have them yet (an account that had the built-in already has
 * them — made by it, the same statements). One group per port: any of its tables missing makes all of them. Server only.
 */
const GROUPS: Record<string, string[]> = {
  news: [
    "create table if not exists news_sources (id integer primary key autoincrement, name text not null, url text not null unique, enabled integer not null default 1, weight real not null default 1, votes integer not null default 0, last_at text, last_error text, created_at text not null, category text not null default '', lang text not null default '', etag text, modified text, fails integer not null default 0)",
    "create table if not exists news_items (id integer primary key autoincrement, source_id integer references news_sources(id) on delete set null, source_name text not null, guid text not null, url text not null, url_key text not null unique, title text not null, title_key text not null, summary text not null default '', published_at text not null, fetched_at text not null, state text not null default 'new', vote integer not null default 0, score real not null default 0, reasons text not null default '[]', image text not null default '', tags text not null default '[]', story text not null default '', tag_src text not null default '', seen_at text, content text not null default '', gate text not null default '', gate_why text not null default '', gate_at text)",
    "create index if not exists news_items_source on news_items (source_id)",
    "create index if not exists news_items_published on news_items (published_at)",
    "create index if not exists news_items_title on news_items (title_key)",
    "create index if not exists news_items_story on news_items (story)",
    "create table if not exists news_terms (term text primary key, score real not null)",
    "create table if not exists news_similar (item_id integer not null, like_of integer not null, score real not null, why text not null default '', at text not null, primary key (item_id, like_of))",
    "create table if not exists news_gone (url_key text primary key, title_key text not null default '', at text not null)",
  ],
};

const TABLES: Record<string, string> = { news_sources: "news", news_items: "news", news_terms: "news", news_similar: "news", news_gone: "news" };

/** Makes the tables of the group `table` belongs to; false: it is no table of a built-in that has left. */
export function ensureAdoptedTables(table: string): boolean {
  const group = TABLES[table];
  if (!group) return false;
  const db = getSqlite();
  for (const sql of GROUPS[group]) db.exec(sql);
  return true;
}
