import { randomUUID } from "node:crypto";

/**
 * A Notion that keeps its pages, databases and blocks in memory and answers the API the Notion plugin uses (2022-06-28): search, pages,
 * databases, block children (with `after`), updating and deleting blocks, file uploads. What it gives back looks like Notion's own:
 * rich text with plain_text, all annotations and href; edit times to the minute. For tests: `fetch` stands in for the network.
 */

type Rich = Record<string, unknown>;
export type FakeBlock = { id: string; type: string; body: Record<string, unknown>; parent: string; archived?: boolean };
export type FakePage = { id: string; object: "page" | "database"; parent: Record<string, unknown>; properties: Record<string, unknown>; title?: Rich[]; icon: unknown; cover: unknown; archived: boolean; edited: string };

const dashed = (id: string) => {
  const p = id.replace(/-/g, "");
  return `${p.slice(0, 8)}-${p.slice(8, 12)}-${p.slice(12, 16)}-${p.slice(16, 20)}-${p.slice(20)}`;
};
const plainId = (id: string) => String(id).replace(/-/g, "").toLowerCase();
export const newId = () => randomUUID().replace(/-/g, "");
const minute = (ms = Date.now()) => new Date(Math.floor(ms / 60000) * 60000).toISOString();
const ANN = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" };

export class FakeNotion {
  pages = new Map<string, FakePage>();
  blocks = new Map<string, FakeBlock>();
  kids = new Map<string, string[]>();
  uploads = new Map<string, { name: string; bytes: number }>();
  calls: { method: string; path: string; body?: unknown }[] = [];
  /** The time Notion says things were edited (minute steps; tests move it on). */
  clock = Date.now();

  now() {
    return minute(this.clock);
  }
  tick(minutes = 2) {
    this.clock += minutes * 60000;
  }

  /** Rich text as Notion gives it back. */
  rich(items: Rich[] = []): Rich[] {
    return items.map((r) => {
      const a = { ...ANN, ...((r.annotations as object) ?? {}) };
      if (r.type === "mention") {
        const m = r.mention as { type?: string; page?: { id: string }; database?: { id: string } };
        const id = plainId(m.page?.id ?? m.database?.id ?? "");
        const title = this.titleOf(id);
        return { type: "mention", mention: { type: m.page ? "page" : "database", [m.page ? "page" : "database"]: { id: dashed(id) } }, annotations: a, plain_text: title, href: `https://www.notion.so/${id}` };
      }
      if (r.type === "equation") {
        const e = r.equation as { expression: string };
        return { type: "equation", equation: e, annotations: a, plain_text: e.expression, href: null };
      }
      const t = (r.text ?? {}) as { content?: string; link?: { url: string } | null };
      return { type: "text", text: { content: t.content ?? "", link: t.link ?? null }, annotations: a, plain_text: t.content ?? "", href: t.link?.url ?? null };
    });
  }

  titleOf(id: string): string {
    const p = this.pages.get(id);
    if (!p) return "Untitled";
    if (p.object === "database") return (p.title ?? []).map((r) => r.plain_text).join("");
    for (const v of Object.values(p.properties) as { type: string; title?: Rich[] }[]) if (v.type === "title") return (v.title ?? []).map((r) => r.plain_text).join("");
    return "";
  }

  // -- building the world -------------------------------------------------------------------------------------------------------

  addPage(v: { title: string; parent?: { page?: string; database?: string }; icon?: string; props?: Record<string, unknown>; titleProp?: string }): string {
    const id = newId();
    const parent = v.parent?.database ? { type: "database_id", database_id: dashed(v.parent.database) } : v.parent?.page ? { type: "page_id", page_id: dashed(v.parent.page) } : { type: "workspace", workspace: true };
    const titleProp = v.titleProp ?? "title";
    this.pages.set(id, { id, object: "page", parent, properties: { [titleProp]: { id: "title", type: "title", title: this.rich([{ type: "text", text: { content: v.title } }]) }, ...(v.props ?? {}) }, icon: v.icon ? { type: "emoji", emoji: v.icon } : null, cover: null, archived: false, edited: this.now() });
    this.kids.set(id, []);
    // (A sub-page is a child_page block of its parent.)
    if (v.parent?.page) this.appendRaw(v.parent.page, [{ id, type: "child_page", body: { title: v.title } }]);
    return id;
  }

  addDatabase(v: { title: string; parent: string; properties: Record<string, unknown> }): string {
    const id = newId();
    const properties = Object.fromEntries(Object.entries(v.properties).map(([name, def]) => [name, { id: newId().slice(0, 4), name, type: Object.keys(def as object)[0], ...(def as object) }]));
    this.pages.set(id, { id, object: "database", parent: { type: "page_id", page_id: dashed(v.parent) }, properties, title: this.rich([{ type: "text", text: { content: v.title } }]), icon: null, cover: null, archived: false, edited: this.now() });
    this.kids.set(id, []);
    this.appendRaw(v.parent, [{ id, type: "child_database", body: { title: v.title } }]);
    return id;
  }

  /** Blocks as a request gives them ({ type, [type]: { …, children } }), kept; their ids. */
  append(parent: string, blocks: Record<string, unknown>[], after?: string): string[] {
    const ids: string[] = [];
    const list = this.kids.get(parent) ?? [];
    let at = after ? list.indexOf(plainId(after)) + 1 : list.length;
    for (const b of blocks) {
      const type = String(b.type);
      const { children, ...body } = (b[type] ?? {}) as Record<string, unknown> & { children?: Record<string, unknown>[] };
      const id = newId();
      this.blocks.set(id, { id, type, body: this.store(type, body), parent });
      this.kids.set(id, []);
      list.splice(at++, 0, id);
      ids.push(id);
      if (children?.length) this.append(id, children);
    }
    this.kids.set(parent, list);
    this.touch(parent);
    return ids;
  }

  private appendRaw(parent: string, blocks: { id: string; type: string; body: Record<string, unknown> }[]) {
    const list = this.kids.get(parent) ?? [];
    for (const b of blocks) {
      this.blocks.set(b.id, { ...b, parent });
      list.push(b.id);
    }
    this.kids.set(parent, list);
  }

  private store(type: string, body: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...body };
    if (Array.isArray(out.rich_text)) out.rich_text = this.rich(out.rich_text as Rich[]);
    if (Array.isArray(out.caption)) out.caption = this.rich(out.caption as Rich[]);
    if (type === "table_row") out.cells = ((out.cells as Rich[][]) ?? []).map((c) => this.rich(c));
    if (type === "image" && (body as { type?: string }).type === "file_upload") {
      const id = (body.file_upload as { id: string }).id;
      return { caption: out.caption ?? [], type: "file", file: { url: `https://prod-files-secure.s3.us-west-2.amazonaws.com/${id}.png?X-Amz-Expires=3600`, expiry_time: new Date(Date.now() + 3600e3).toISOString() } };
    }
    return out;
  }

  /** A page (or the page a block is on) edited now. */
  touch(id: string) {
    let cur: string | undefined = id;
    for (let i = 0; cur && i < 20; i++) {
      const p = this.pages.get(cur);
      if (p) {
        p.edited = this.now();
        return;
      }
      cur = this.blocks.get(cur)?.parent;
    }
  }

  blockJson(id: string) {
    const b = this.blocks.get(id)!;
    const kids = (this.kids.get(id) ?? []).filter((k) => !this.blocks.get(k)?.archived);
    const childPage = b.type === "child_page" || b.type === "child_database";
    return { object: "block", id: dashed(id), type: b.type, has_children: childPage ? false : kids.length > 0, archived: false, in_trash: false, last_edited_time: this.now(), [b.type]: b.body };
  }
  pageJson(id: string) {
    const p = this.pages.get(id)!;
    return { object: p.object, id: dashed(id), parent: p.parent, properties: p.properties, ...(p.object === "database" ? { title: p.title } : {}), icon: p.icon, cover: p.cover, archived: p.archived, in_trash: p.archived, last_edited_time: p.edited, url: `https://www.notion.so/${id}` };
  }

  /** The texts of a page's blocks (top level), for asserting: "type: text". */
  outline(id: string): string[] {
    return (this.kids.get(id) ?? [])
      .filter((k) => !this.blocks.get(k)?.archived)
      .map((k) => {
        const b = this.blocks.get(k)!;
        const text = Array.isArray(b.body.rich_text) ? (b.body.rich_text as { plain_text: string }[]).map((r) => r.plain_text).join("") : String(b.body.title ?? "");
        return `${b.type}: ${text}`;
      });
  }

  // -- the API ------------------------------------------------------------------------------------------------------------------

  handle(method: string, url: URL, body: unknown): { status: number; json: unknown } {
    const path = url.pathname.replace(/^\/v1/, "");
    this.calls.push({ method, path, body });
    const b = (body ?? {}) as Record<string, unknown>;
    const notFound = { status: 404, json: { object: "error", code: "object_not_found", message: "Could not find it." } };
    let m: RegExpExecArray | null;
    if (method === "POST" && path === "/search") {
      const all = [...this.pages.values()].filter((p) => !p.archived).sort((x, y) => (x.edited < y.edited ? 1 : x.edited > y.edited ? -1 : 0));
      const start = Number((b.start_cursor as string) ?? 0);
      const size = Number(b.page_size ?? 100);
      const page = all.slice(start, start + size);
      return { status: 200, json: { results: page.map((p) => this.pageJson(p.id)), has_more: start + size < all.length, next_cursor: start + size < all.length ? String(start + size) : null } };
    }
    if ((m = /^\/(pages|databases)\/([0-9a-f-]+)$/.exec(path))) {
      const id = plainId(m[2]);
      const p = this.pages.get(id);
      if (!p) return notFound;
      if (method === "GET") return { status: 200, json: this.pageJson(id) };
      if (method === "PATCH") {
        if (b.archived === true) {
          p.archived = true;
          // (Its block on the parent page goes with it.)
          const own = this.blocks.get(id);
          if (own) own.archived = true;
        }
        if ("icon" in b) p.icon = b.icon;
        if ("cover" in b) p.cover = b.cover;
        if (Array.isArray(b.title)) p.title = this.rich(b.title as Rich[]);
        for (const [k, v] of Object.entries((b.properties as Record<string, Record<string, unknown>>) ?? {})) {
          if (p.object === "database") {
            p.properties[k] = { id: newId().slice(0, 4), name: k, type: Object.keys(v)[0], ...v };
            continue;
          }
          const type = Object.keys(v)[0];
          const val = v[type];
          p.properties[k] = { type, [type]: type === "title" || type === "rich_text" ? this.rich(val as Rich[]) : val };
        }
        p.edited = this.now();
        return { status: 200, json: this.pageJson(id) };
      }
    }
    if (method === "POST" && path === "/pages") {
      const parent = b.parent as { page_id?: string; database_id?: string };
      const props = (b.properties ?? {}) as Record<string, Record<string, unknown>>;
      const titleKey = Object.keys(props).find((k) => "title" in props[k]) ?? "title";
      const id = this.addPage({ title: (props[titleKey]?.title as { text: { content: string } }[] | undefined)?.map((r) => r.text.content).join("") ?? "", parent: parent.database_id ? { database: plainId(parent.database_id) } : { page: plainId(parent.page_id!) }, titleProp: titleKey });
      const p = this.pages.get(id)!;
      for (const [k, v] of Object.entries(props)) {
        if (k === titleKey) continue;
        const type = Object.keys(v)[0];
        p.properties[k] = { type, [type]: type === "rich_text" ? this.rich(v[type] as Rich[]) : v[type] };
      }
      if (b.icon) p.icon = b.icon;
      if (b.cover) p.cover = b.cover;
      return { status: 200, json: this.pageJson(id) };
    }
    if (method === "POST" && path === "/databases") {
      const parent = b.parent as { page_id: string };
      const id = this.addDatabase({ title: ((b.title as { text: { content: string } }[]) ?? []).map((r) => r.text.content).join(""), parent: plainId(parent.page_id), properties: b.properties as Record<string, unknown> });
      return { status: 200, json: this.pageJson(id) };
    }
    if ((m = /^\/blocks\/([0-9a-f-]+)\/children$/.exec(path))) {
      const id = plainId(m[1]);
      if (!this.kids.has(id)) return notFound;
      if (method === "GET") {
        const list = (this.kids.get(id) ?? []).filter((k) => !this.blocks.get(k)?.archived);
        const start = Number(url.searchParams.get("start_cursor") ?? 0);
        const size = Number(url.searchParams.get("page_size") ?? 100);
        return { status: 200, json: { results: list.slice(start, start + size).map((k) => this.blockJson(k)), has_more: start + size < list.length, next_cursor: start + size < list.length ? String(start + size) : null } };
      }
      if (method === "PATCH") {
        const ids = this.append(id, b.children as Record<string, unknown>[], b.after as string | undefined);
        return { status: 200, json: { results: ids.map((k) => this.blockJson(k)), has_more: false } };
      }
    }
    if ((m = /^\/blocks\/([0-9a-f-]+)$/.exec(path))) {
      const id = plainId(m[1]);
      const blk = this.blocks.get(id);
      if (!blk || blk.archived) return notFound;
      if (method === "GET") return { status: 200, json: { ...this.blockJson(id), parent: this.pages.has(blk.parent) ? { type: "page_id", page_id: dashed(blk.parent) } : { type: "block_id", block_id: dashed(blk.parent) } } };
      if (method === "DELETE") {
        if (blk.type === "child_page" || blk.type === "child_database") {
          const p = this.pages.get(id);
          if (p) p.archived = true;
        }
        blk.archived = true;
        this.touch(blk.parent);
        return { status: 200, json: this.blockJson(id) };
      }
      if (method === "PATCH") {
        const body2 = (b[blk.type] ?? {}) as Record<string, unknown>;
        blk.body = this.store(blk.type, { ...blk.body, ...body2 });
        this.touch(blk.parent);
        return { status: 200, json: this.blockJson(id) };
      }
    }
    if (method === "POST" && path === "/file_uploads") {
      const id = newId();
      this.uploads.set(id, { name: String(b.filename), bytes: 0 });
      return { status: 200, json: { object: "file_upload", id, upload_url: `https://api.notion.com/v1/file_uploads/${id}/send`, status: "pending" } };
    }
    if ((m = /^\/file_uploads\/([0-9a-f]+)\/send$/.exec(path)) && method === "POST") {
      const u = this.uploads.get(m[1]);
      if (!u) return notFound;
      return { status: 200, json: { object: "file_upload", id: m[1], status: "uploaded" } };
    }
    return { status: 400, json: { object: "error", code: "invalid_request_url", message: `${method} ${path} isn't known here.` } };
  }
}

/** A tiny PNG (the bytes of a picture), what a picture's address answers. */
export const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082", "hex");
