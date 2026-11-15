import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "./actions";
import type { FieldSpec } from "./types";

/**
 * The kernel's mirrored databases: a plugin's records kept in a database of the Workspace (read-only there — where they live is where they
 * change), each sync writing only what changed. What the database has (its fields, options, views) and what each record says is the
 * plugin's; the kernel makes the database once, adds options named anew, writes rows by their key, the page from markdown, the record's
 * own times, and moves the rows no longer given to the trash. Named "<plugin>.<name>" and allowed by the flow's `store` permission for that
 * name. A port keeps its built-in's database (ADOPTED: the preference the built-in kept its id in). Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : v == null ? "" : String(v).slice(0, max));

/** The built-ins' databases their ports' mirrors go on with (the preference holding its id), by mirror name. */
export const ADOPTED_MIRRORS: Record<string, string> = {
  "keep-ext.google": "keep.googleDb",
};

const TYPES = new Set(["text", "number", "select", "multi_select", "checkbox", "date", "url"]);
const VIEW_TYPES = new Set(["table", "gallery", "board", "list", "calendar"]);

type Setup = {
  title: string;
  titleName: string;
  properties: { id: string; name: string; type: string; options?: { name: string; color: string }[] }[];
  views: { name: string; type: string; sorts?: { prop: string; dir: "asc" | "desc" }[]; hidden?: string[] }[];
  fullWidth: boolean;
  locked: boolean;
  source: string | null;
  briefing: boolean;
  knowledge: boolean;
};

function setupOf(v: unknown): Setup {
  const o = obj(v);
  const id = (x: unknown) => str(x, 40).replace(/[^a-zA-Z0-9_-]/g, "");
  return {
    title: str(o.title, 120) || "Untitled",
    titleName: str(o.titleName, 60) || "Name",
    properties: arr(o.properties).slice(0, 40).flatMap((p) => {
      const x = obj(p);
      return id(x.id) && TYPES.has(str(x.type)) ? [{ id: id(x.id), name: str(x.name, 80) || id(x.id), type: str(x.type), ...(Array.isArray(x.options) ? { options: arr(x.options).slice(0, 200).map((o2) => ({ name: str(obj(o2).name, 80), color: str(obj(o2).color, 20) || "gray" })).filter((o2) => o2.name) } : {}) }] : [];
    }),
    views: arr(o.views).slice(0, 8).flatMap((w) => {
      const x = obj(w);
      return VIEW_TYPES.has(str(x.type)) ? [{ name: str(x.name, 60) || "View", type: str(x.type), sorts: arr(x.sorts).map((s) => ({ prop: id(obj(s).prop), dir: obj(s).dir === "desc" ? ("desc" as const) : ("asc" as const) })), hidden: arr(x.hidden).map(id) }] : [];
    }),
    fullWidth: o.fullWidth === true,
    locked: o.locked === true,
    source: /^[a-z][a-z0-9-]{0,39}$/.test(str(o.source)) ? str(o.source) : null,
    briefing: o.briefing === true,
    knowledge: o.knowledge === true,
  };
}

/** The mirror's database (null: not made, or gone) — its own preference, else the built-in's it goes on with. */
async function mirrorDb(name: string): Promise<number | null> {
  const { getPref } = await import("@/lib/prefs");
  const { getDatabase } = await import("../store");
  for (const key of [`ext.mirror.${name}`, ADOPTED_MIRRORS[name]].filter(Boolean)) {
    const id = getPref<number | null>(key, null);
    if (id && getDatabase(id) && !getDatabase(id)!.page.archivedAt) return id;
  }
  return null;
}

async function ensureMirror(name: string, s: Setup): Promise<number> {
  const known = await mirrorDb(name);
  if (known) return known;
  const { createPage, updatePage } = await import("../store");
  const { newId, newView } = await import("../model");
  const schema = {
    titleName: s.titleName,
    properties: s.properties.map((p) => ({ id: p.id, name: p.name, type: p.type, ...(p.options ? { options: p.options.map((o) => ({ id: newId("o"), name: o.name, color: o.color })) } : {}) })),
    views: (s.views.length ? s.views : [{ name: "Table", type: "table", sorts: [], hidden: [] }]).map((v) => ({ ...newView(v.name, v.type as never), sorts: v.sorts ?? [], hidden: v.hidden ?? [] })),
  };
  const id = createPage({ kind: "database", title: s.title, schema: schema as never });
  updatePage(id, { fullWidth: s.fullWidth, locked: s.locked });
  if (s.source) (await import("../collections")).setDatabaseSource(id, s.source);
  if (s.briefing || s.knowledge) (await import("@/lib/items")).setCollection(`workspace:${id}`, { briefing: s.briefing, knowledge: s.knowledge });
  (await import("@/lib/prefs")).setPref(`ext.mirror.${name}`, id);
  return id;
}

type MirrorRecord = { key: string; title: string; cells: Record<string, unknown>; markdown: string; createdAt: string | null; updatedAt: string | null };

const recordOf = (v: unknown): MirrorRecord | null => {
  const o = obj(v);
  const key = str(o.key, 300);
  if (!key) return null;
  return { key, title: str(o.title, 300), cells: obj(o.cells), markdown: str(o.markdown, 100000), createdAt: str(o.createdAt, 40) || null, updatedAt: str(o.updatedAt, 40) || null };
};

/** The records written into the mirror's database: what changed only; the rows no longer given to the trash. */
export async function mirrorRecords(name: string, setupIn: unknown, keyProp: string, recordsIn: unknown[]): Promise<{ database: number; records: number; created: number; updated: number; archived: number }> {
  const s = setupOf(setupIn);
  const records = recordsIn.slice(0, 20000).flatMap((r) => recordOf(r) ?? []);
  const dbId = await ensureMirror(name, s);
  const ws = await import("../store");
  const { COLORS } = await import("../model");
  const { newId } = await import("../model");
  const { markdownToDoc } = await import("../doc");
  const { getSqlite } = await import("@/db");
  const out = { database: dbId, records: records.length, created: 0, updated: 0, archived: 0 };
  // Options named anew (a select's, a multi-select's): added, each a colour of its own after those there.
  const cur = ws.getDatabase(dbId)!.schema;
  const named = new Map<string, Set<string>>();
  for (const p of cur.properties.filter((x) => x.type === "select" || x.type === "multi_select")) {
    const want = new Set<string>();
    for (const r of records) {
      const v = r.cells[p.id];
      for (const n of Array.isArray(v) ? v : v == null || v === "" ? [] : [v]) want.add(str(n, 80));
    }
    named.set(p.id, want);
  }
  let schemaChanged = false;
  const properties = cur.properties.map((p) => {
    const want = named.get(p.id);
    if (!want) return p;
    const known = new Set((p.options ?? []).map((o) => o.name));
    const fresh = [...want].filter((n) => n && !known.has(n));
    if (!fresh.length) return p;
    schemaChanged = true;
    return { ...p, options: [...(p.options ?? []), ...fresh.map((n, i) => ({ id: newId("o"), name: n, color: COLORS[(known.size + i + 3) % COLORS.length] }))] };
  });
  if (schemaChanged) ws.updateSchema(dbId, { ...cur, properties });
  const schema = ws.getDatabase(dbId)!.schema;
  const optionId = (prop: string, n: unknown) => schema.properties.find((p) => p.id === prop)?.options?.find((o) => o.name === str(n, 80))?.id;
  const cellsOf = (r: MirrorRecord): Record<string, unknown> => {
    const out2: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.cells)) {
      const p = schema.properties.find((x) => x.id === k);
      if (!p) continue;
      if (p.type === "select") out2[k] = v == null || v === "" ? undefined : optionId(k, v);
      else if (p.type === "multi_select") out2[k] = Array.isArray(v) && v.length ? v.map((n) => optionId(k, n)).filter(Boolean) : undefined;
      else if (p.type === "checkbox") out2[k] = v === true || undefined;
      else out2[k] = v == null ? undefined : v;
    }
    out2[keyProp] = r.key;
    return out2;
  };
  const iso = (t: string | null) => new Date(t ?? Date.now()).toISOString();
  const rows = new Map(ws.rawRows(dbId).map((r) => [String(r.cells[keyProp] ?? ""), r]));
  const times = getSqlite().prepare("update ws_pages set created_at = ?, updated_at = ? where id = ?");
  const write = (row: number, r: MirrorRecord) => {
    ws.updatePage(row, { content: markdownToDoc(r.markdown) });
    times.run(iso(r.createdAt), iso(r.updatedAt ?? r.createdAt), row);
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? undefined) === JSON.stringify(b ?? undefined);
  for (const r of records) {
    const cells = cellsOf(r);
    const row = rows.get(r.key);
    if (!row) {
      write(ws.addRow(dbId, { title: r.title, cells }), r);
      out.created++;
      continue;
    }
    rows.delete(r.key);
    if (row.title === r.title && Object.entries(cells).every(([k, v]) => same(row.cells[k], v))) continue;
    if (row.title !== r.title) ws.updatePage(row.id, { title: r.title });
    for (const [k, v] of Object.entries(cells)) if (!same(row.cells[k], v)) ws.setCell(row.id, k, v ?? null);
    write(row.id, r);
    out.updated++;
  }
  for (const gone of rows.values()) {
    ws.archivePage(gone.id);
    out.archived++;
  }
  return out;
}

export const MIRROR_ACTIONS: FlowAction[] = [
  {
    name: "db.mirror",
    group: "databases",
    label: "Mirror records into a database",
    summary:
      'A plugin\'s records kept in a database of the Workspace (read-only there): name "<plugin>.<name>" (allowed by the flow\'s store permission for it), setup — made once — { title, titleName, properties [{ id, name, type, options [{ name, color }] }], views [{ name, type, sorts, hidden }], fullWidth, locked, source, briefing, knowledge }, key (the field holding a record\'s key), records [{ key, title, cells { field id: value — a select\'s option by its name }, markdown, createdAt, updatedAt }]. Only what changed is written; rows no longer given go to the trash.',
    input: [f("name", "text", { required: true }), f("setup", "json", { required: true }), f("key", "text", { required: true }), f("records", "json", { required: true })],
    output: "{ database, records, created, updated, archived }",
    writes: true,
    run: async (i, ctx) => {
      const name = String(i.name ?? "").trim();
      if (!(ctx.perms.store ?? []).includes(name)) throw new Error(`This flow may not keep the mirror “${name}” — grant it under the flow's permissions (store).`);
      if (ctx.dryRun) return { database: null, records: arr(i.records).length, created: 0, updated: 0, archived: 0 };
      return mirrorRecords(name, i.setup, String(i.key ?? "").replace(/[^a-zA-Z0-9_-]/g, "") || "key", arr(i.records));
    },
  },
];

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("core:mirror", MIRROR_ACTIONS);
