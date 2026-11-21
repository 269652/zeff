import type Database from "better-sqlite3";

/**
 * The Workspace's own tables (pages, versions, links, the search index): made when a database is opened (src/db/index.ts), so
 * every reader finds them — also in a fresh account (the demo) before anything of the Workspace ran. Cheap to repeat.
 */
const DDL = `
    create table if not exists ws_pages (
      id integer primary key autoincrement, parent_id integer, db_id integer, kind text not null default 'page',
      title text not null default '', icon text not null default '', cover text not null default '',
      content text not null default '', body_text text not null default '', props text not null default '{}', schema text,
      position real not null default 0, favorite integer not null default 0, full_width integer not null default 0, small_text integer not null default 0,
      locked integer not null default 0, template integer not null default 0, archived_at text, rev integer not null default 1,
      created_at text not null, updated_at text not null, opened_at text
    );
    create index if not exists ws_pages_parent on ws_pages (parent_id);
    create index if not exists ws_pages_db on ws_pages (db_id);
    create table if not exists ws_versions (id integer primary key autoincrement, page_id integer not null, title text not null default '', content text not null, at text not null);
    create index if not exists ws_versions_page on ws_versions (page_id, id);
    create table if not exists ws_view_versions (id integer primary key autoincrement, db_id integer not null, view_id text not null, template text not null, by text not null default '', at text not null);
    create index if not exists ws_view_versions_view on ws_view_versions (db_id, view_id, id);
    create table if not exists ws_links (page_id integer not null, kind text not null, ref text not null, label text not null default '', primary key (page_id, kind, ref));
    create index if not exists ws_links_ref on ws_links (kind, ref);
    create virtual table if not exists ws_fts using fts5(title, body, tokenize = 'unicode61 remove_diacritics 2');
  `;

export function ensureWorkspaceTables(d: Database.Database): void {
  d.exec(DDL);
}
