import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";
import { FakeNotion, PNG } from "./notion-fake";

setupTempData();

/**
 * The Notion plugin (zeff-plugins/plugins/notion-ext): Notion's blocks ↔ a Zeff page's text, compared in Zeff's terms; a three-way merge
 * that keeps what only Zeff has; and the two flows against a Notion kept in memory — pulled in (pages, a sub-page, a database with rows,
 * pictures kept), pushed back (only the blocks that differ, changed ones in place, sub-pages never deleted), a row's fields both ways,
 * new pages and the trash both ways.
 */
const skip = skipWithoutRepo("notion-ext");
const lib = (f: string) => import(pathToFileURL(path.join(repoPlugin("notion-ext"), "lambdas", f)).href);

// ---------------------------------------------------------------------------------------------------------------------------------
// The conversion, alone
// ---------------------------------------------------------------------------------------------------------------------------------

const t = (content: string, annotations: Record<string, unknown> = {}, link?: string) => ({ type: "text", text: { content, link: link ? { url: link } : null }, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default", ...annotations }, plain_text: content, href: link ?? null });
const blk = (type: string, body: Record<string, unknown>, children?: unknown[]) => ({ object: "block", id: Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32), type, has_children: !!children?.length, [type]: body, ...(children ? { children } : {}) });

test("Notion's blocks become Zeff's nodes: text with marks, lists with their children, to-dos, toggles, callouts, code, tables, columns, what Zeff can't show as a link", { skip }, async () => {
  const c = await lib("notion.merge/convert.mjs");
  const ctx = { zeffOf: (id: string) => (id === "a".repeat(32) ? 7 : null), unresolved: false, pictures: false };
  const blocks = [
    blk("heading_1", { rich_text: [t("Plan")] }),
    blk("paragraph", { rich_text: [t("fett", { bold: true }), t(" und "), t("Link", {}, "https://example.com"), { type: "mention", mention: { type: "page", page: { id: "a".repeat(32) } }, annotations: { color: "default" }, plain_text: "Ziel", href: "" }] }),
    blk("bulleted_list_item", { rich_text: [t("eins")] }, [blk("bulleted_list_item", { rich_text: [t("unter")] })]),
    blk("bulleted_list_item", { rich_text: [t("zwei")] }),
    blk("to_do", { rich_text: [t("erledigen")], checked: true }),
    blk("toggle", { rich_text: [t("Mehr")] }, [blk("paragraph", { rich_text: [t("drin")] })]),
    blk("callout", { rich_text: [t("Achtung")], icon: { type: "emoji", emoji: "⚠️" }, color: "red_background" }),
    blk("code", { rich_text: [t("print(1)")], language: "python" }),
    blk("equation", { expression: "e=mc^2" }),
    blk("table", { table_width: 2, has_column_header: true, has_row_header: false }, [blk("table_row", { cells: [[t("A")], [t("B")]] }), blk("table_row", { cells: [[t("1")], [t("2")]] })]),
    blk("column_list", {}, [blk("column", {}, [blk("paragraph", { rich_text: [t("links")] })]), blk("column", {}, [blk("paragraph", { rich_text: [t("rechts")] })])]),
    blk("bookmark", { url: "https://zeff.dev", caption: [] }),
    blk("child_page", { title: "Neu" }),
  ];
  const doc = c.docFromFlat(c.flatFromBlocks(blocks, ctx));
  const types = doc.content.map((n: { type: string }) => n.type);
  assert.deepEqual(types, ["heading", "paragraph", "bulletList", "taskList", "details", "callout", "codeBlock", "codeBlock", "table", "flexBox", "paragraph"], "the sub-page not synced yet: shown once it is");
  assert.equal(ctx.unresolved, true, "a sub-page Zeff doesn't have yet: read again later");
  const p = doc.content[1].content;
  assert.deepEqual(p[0], { type: "text", text: "fett", marks: [{ type: "bold" }] });
  assert.deepEqual(p[2].marks, [{ type: "link", attrs: { href: "https://example.com" } }]);
  assert.deepEqual(p[3].marks, [{ type: "link", attrs: { href: "/workspace/7" } }], "a mention of a synced page leads to its Zeff page");
  assert.equal(doc.content[2].content.length, 2, "two items in one list");
  assert.equal(doc.content[2].content[0].content[1].type, "bulletList", "the item's child below it");
  assert.equal(doc.content[3].content[0].attrs.checked, true);
  assert.deepEqual(doc.content[5].attrs, { icon: "⚠️", tone: "red" });
  assert.deepEqual(doc.content[7].attrs, { language: "latex" });
  assert.equal(doc.content[8].content[0].content[0].type, "tableHeader");
  assert.equal(doc.content[9].content.length, 2, "two columns");
  assert.match(JSON.stringify(doc.content[10]), /↗ https:\/\/zeff\.dev/);

  // Back: the blocks Notion is given say the same — converted again, the same keys.
  const back = c.blocksFromNodes(doc.content, { zeffOf: ctx.zeffOf, notionOf: (z: number) => (z === 7 ? "a".repeat(32) : null) });
  assert.deepEqual(back.map((b: { type: string }) => b.type), ["heading_1", "paragraph", "bulleted_list_item", "bulleted_list_item", "to_do", "toggle", "callout", "code", "equation", "table", "column_list", "paragraph"]);
  assert.equal(back[1].paragraph.rich_text[3].type, "mention", "the link to a synced page is a mention again");
  assert.equal(back[2].bulleted_list_item.children[0].type, "bulleted_list_item");
  const fake = new FakeNotion();
  // (The mentioned page is called “Ziel” in Notion — what a mention shows.)
  fake.titleOf = (id: string) => (id === "a".repeat(32) ? "Ziel" : "Untitled");
  const again = c.flatFromBlocks(
    back.map((b: Record<string, unknown>) => normalize(fake, b)),
    { zeffOf: ctx.zeffOf, unresolved: false },
  );
  assert.equal(c.keyOf(again.slice(0, 11)), c.keyOf(c.flatOfDoc(doc).slice(0, 11)), "Zeff → Notion → Zeff: the same");
});

/** A block as Notion would give it back (rich text with plain_text, children below). */
function normalize(fake: FakeNotion, b: Record<string, unknown>): Record<string, unknown> {
  const type = String(b.type);
  const { children, ...body } = (b[type] ?? {}) as Record<string, unknown> & { children?: Record<string, unknown>[] };
  if (Array.isArray(body.rich_text)) body.rich_text = fake.rich(body.rich_text as never);
  if (type === "table_row") body.cells = (body.cells as never[][]).map((x) => fake.rich(x));
  return { object: "block", id: Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32), type, has_children: !!children?.length, [type]: body, ...(children ? { children: children.map((k) => normalize(fake, k)) } : {}) };
}

test("the three-way merge: Notion's change comes in, what only Zeff has stays where it was, a removal on either side removes", { skip }, async () => {
  const c = await lib("notion.merge/convert.mjs");
  const para = (s: string) => ({ type: "paragraph", content: [{ type: "text", text: s }] });
  const widget = { type: "zeffApp", attrs: { title: "Uhr", html: "<b>12:00</b>" } };
  const units = (nodes: unknown[]) => c.unitsOfFlat(c.flatOfDoc({ content: nodes }));
  const base = units([para("A"), para("B"), para("C")]).map((u: { key: string; n: number }) => ({ key: u.key, n: u.n }));
  const mine = units([para("A"), widget, para("B"), para("C"), para("Z")]);
  const theirs = units([para("A"), para("B2"), para("C")]).map((u: { key: string; n: number; flat: unknown }) => ({ key: u.key, n: u.n, flat: u.flat }));
  const { handler } = await lib("notion.merge/index.mjs");
  const r = await handler({ current: { type: "doc", content: [para("A"), widget, para("B"), para("C"), para("Z")] }, base, theirs });
  assert.deepEqual(
    r.doc.content.map((n: { type: string; content?: { text: string }[] }) => (n.type === "zeffApp" ? "widget" : n.content?.[0]?.text)),
    ["A", "widget", "B2", "C", "Z"],
    "B became B2 (Notion), the widget and Z (Zeff's own) stay",
  );
  assert.equal(r.same, false);
  const same = await handler({ current: { type: "doc", content: [para("A"), para("B"), para("C")] }, base, theirs: units([para("A"), para("B"), para("C")]) });
  assert.equal(same.same, true, "nothing new: the page isn't written");
  void mine;
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The flows, against a Notion in memory
// ---------------------------------------------------------------------------------------------------------------------------------

const notion = new FakeNotion();
const realFetch = globalThis.fetch;
const uploads: { type: string; bytes: number }[] = [];

before(async () => {
  if (skip) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-notion-ext-"));
  process.env.ZEFF_PLUGINS_DIR = dir;
  fs.cpSync(repoPlugin("notion-ext"), path.join(dir, "notion-ext"), { recursive: true });
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  await import("@/plugins/contributions");
  await import("@/plugins/workspace/server");
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  reg.setEnabled("notion-ext", true);
  (await import("@/lib/ext/plugin-settings")).saveSettings("notion-ext", reg.getPlugin("notion-ext")!.manifest, { NOTION_TOKEN: "secret_test" });
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.notion.com") {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer secret_test");
      if (/\/send$/.test(url.pathname)) uploads.push({ type: headers.get("content-type") ?? "", bytes: (init?.body as Buffer)?.length ?? 0 });
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const r = notion.handle(String(init?.method ?? "GET"), url, body);
      return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
    }
    if (url.hostname.endsWith("amazonaws.com")) return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    return new Response("not here", { status: 404 });
  }) as typeof fetch;
  // The package installed, its flows allowed what they ask (as “install and allow” does) — the push started by hand here, not by events.
  const life = await import("@/plugins/workspace/package-life");
  const pkg = await life.offeredPackage("notion-ext");
  assert.ok(pkg, "the plugin brings its package");
  await life.installTracked(pkg!, null, { allow: true });
  const flows = await import("@/plugins/workspace/flows/store");
  for (const name of ["notion.pull", "notion.push"]) {
    const f = flows.flowByName(name)!;
    flows.saveFlow(f.pageId, { ...f, triggers: [] });
  }
});
after(() => {
  globalThis.fetch = realFetch;
});

const pull = async () => {
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const r = await runFlow("notion.pull", {});
  assert.equal(r.status, "done", r.error ?? JSON.stringify(r.output));
  return r.output as { ok: boolean; message: string };
};
const push = async (page: number, event = "page.changed", field?: string) => {
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const r = await runFlow("notion.push", { page, event, ...(field ? { field } : {}) });
  assert.equal(r.status, "done", r.error ?? JSON.stringify(r.output));
  return r.output as { ok: boolean; message: string };
};
const zeffOf = async (notionId: string): Promise<number> => {
  const { getSqlite } = await import("@/db");
  const row = getSqlite().prepare("select * from sqlite_master where type = 'table' and name like '%notion%links%'").get() as { name: string } | undefined;
  assert.ok(row, "the links store is there");
  const link = getSqlite().prepare(`select zeff_id from "${row!.name}" where notion_id = ?`).get(notionId) as { zeff_id: number } | undefined;
  assert.ok(link, `linked: ${notionId}`);
  return link!.zeff_id;
};
const texts = (doc: { content?: { type: string; content?: { type: string; text?: string }[] }[] }) => (doc.content ?? []).map((n) => `${n.type}: ${(n.content ?? []).map((x) => x.text ?? "").join("")}`);

let projekt = "";
let unter = "";
let db = "";
let row1 = "";

test("pulled in: a page, its sub-page, a database with its fields and rows, a picture kept in Zeff — under My Notion; the sub-page then shown on its parent", { skip }, async () => {
  projekt = notion.addPage({ title: "Projekt", icon: "🚀" });
  notion.append(projekt, [
    { type: "heading_1", heading_1: { rich_text: [{ type: "text", text: { content: "Ziele" } }] } },
    { type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "Erster Absatz" }, annotations: { bold: true } }] } },
    { type: "to_do", to_do: { rich_text: [{ type: "text", text: { content: "Angebot schreiben" } }], checked: false } },
    { type: "image", image: { type: "file_upload", file_upload: { id: "abc" } } },
  ]);
  unter = notion.addPage({ title: "Unterseite", parent: { page: projekt } });
  notion.append(unter, [{ type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "Unten" } }] } }]);
  db = notion.addDatabase({
    title: "Aufgaben",
    parent: projekt,
    properties: { Name: { title: {} }, Status: { select: { options: [{ name: "Offen", color: "red" }, { name: "Fertig", color: "green" }] } }, Fällig: { date: {} }, Erledigt: { checkbox: {} }, Notiz: { rich_text: {} }, Punkte: { number: { format: "number" } } },
  });
  row1 = notion.addPage({ title: "Steuer", parent: { database: db }, titleProp: "Name", props: { Status: { type: "select", select: { name: "Offen" } }, Fällig: { type: "date", date: { start: "2026-12-01" } }, Erledigt: { type: "checkbox", checkbox: false }, Notiz: { type: "rich_text", rich_text: notion.rich([{ type: "text", text: { content: "bis Freitag" } }]) }, Punkte: { type: "number", number: 3 } } });

  const out = await pull();
  assert.match(out.message, /new/);
  const ws = await import("@/plugins/workspace/store");
  const { packagePage } = await import("@/plugins/workspace/package-refs");
  const root = packagePage("@notion-ext.i2")!;
  const pz = await zeffOf(projekt);
  const page = ws.getPage(pz)!;
  assert.equal(page.title, "Projekt");
  assert.equal(page.icon, "🚀");
  assert.equal(page.parentId, root, "at the top of My Notion");
  assert.deepEqual(texts(page.content as never).slice(0, 3), ["heading: Ziele", "paragraph: Erster Absatz", "taskList: "]);
  const img = (page.content as { content: { type: string; attrs?: { src: string } }[] }).content.find((n) => n.type === "image")!;
  assert.match(img.attrs!.src, /^\/api\/workspace\/files\//, "Notion's picture kept in Zeff (its link would expire)");
  const uz = await zeffOf(unter);
  assert.equal(ws.getPage(uz)!.parentId, pz);
  const dz = await zeffOf(db);
  const d = ws.getDatabase(dz)!;
  assert.equal(d.page.parentId, pz);
  assert.deepEqual(d.schema.properties.map((p) => [p.name, p.type]).filter(([n]) => ["Status", "Fällig", "Erledigt", "Notiz", "Punkte"].includes(String(n))), [["Status", "select"], ["Fällig", "date"], ["Erledigt", "checkbox"], ["Notiz", "text"], ["Punkte", "number"]]);
  const rz = await zeffOf(row1);
  const row = ws.getPage(rz)!;
  assert.equal(row.title, "Steuer");
  const status = d.schema.properties.find((p) => p.name === "Status")!;
  assert.equal(status.options!.find((o) => o.id === row.props[status.id])?.name, "Offen");
  assert.equal(row.props[d.schema.properties.find((p) => p.name === "Fällig")!.id], "2026-12-01");
  assert.equal(row.props[d.schema.properties.find((p) => p.name === "Punkte")!.id], 3);

  // The sub-page and the database weren't in Zeff when Projekt was read: read again, now shown where they are.
  await pull();
  const again = ws.getPage(pz)!.content as { content: { type: string; attrs?: Record<string, unknown> }[] };
  assert.ok(again.content.some((n) => n.type === "pageEmbed" && n.attrs!.pageId === uz), "the sub-page on its parent");
  assert.ok(again.content.some((n) => n.type === "databaseView" && n.attrs!.dbId === dz), "the database on its page");
  const third = await pull();
  assert.match(third.message, /Nothing new/, "nothing written twice");
});

test("pushed: only what changed — a paragraph changed in place, one added at the top and one at the end, a widget stays in Zeff, sub-pages untouched", { skip }, async () => {
  const ws = await import("@/plugins/workspace/store");
  const pz = await zeffOf(projekt);
  const before = notion.kids.get(projekt)!.filter((k) => !notion.blocks.get(k)!.archived);
  const paraId = before[1];
  const doc = JSON.parse(JSON.stringify(ws.getPage(pz)!.content)) as { content: Record<string, unknown>[] };
  doc.content[1] = { type: "paragraph", content: [{ type: "text", text: "Erster Absatz, geändert" }] };
  doc.content.unshift({ type: "paragraph", content: [{ type: "text", text: "Ganz oben" }] });
  doc.content.push({ type: "zeffApp", attrs: { title: "Uhr", html: "<b>12</b>" } }, { type: "paragraph", content: [{ type: "text", text: "Am Ende" }] });
  ws.updatePage(pz, { content: doc });
  notion.calls = [];
  await push(pz, "page.changed", "content");
  const outline = notion.outline(projekt);
  assert.deepEqual(outline, ["paragraph: Ganz oben", "heading_1: Ziele", "paragraph: Erster Absatz, geändert", "to_do: Angebot schreiben", "image: ", "child_page: Unterseite", "child_database: Aufgaben", "paragraph: Am Ende"]);
  const now = notion.kids.get(projekt)!.filter((k) => !notion.blocks.get(k)!.archived);
  assert.ok(now.includes(paraId), "the changed paragraph updated in place (its comments stay)");
  assert.ok(!notion.calls.some((c) => c.method === "DELETE" && c.path.includes(unter)), "the sub-page never deleted");
  assert.ok(!JSON.stringify(notion.calls).includes("zeffApp") && !outline.some((l) => l.includes("Uhr")), "the widget stays in Zeff");
  notion.calls = [];
  await push(pz, "page.changed", "content");
  assert.ok(!notion.calls.some((c) => c.method !== "GET" && c.path !== "/search"), "the same again: nothing written");
});

test("Notion edits again: merged — Notion's change in, Zeff's widget kept where it is", { skip }, async () => {
  const ws = await import("@/plugins/workspace/store");
  const pz = await zeffOf(projekt);
  notion.tick();
  const heading = notion.kids.get(projekt)!.find((k) => notion.blocks.get(k)!.type === "heading_1" && !notion.blocks.get(k)!.archived)!;
  notion.handle("PATCH", new URL(`https://api.notion.com/v1/blocks/${heading}`), { heading_1: { rich_text: [{ type: "text", text: { content: "Ziele 2027" } }] } });
  await pull();
  const lines = texts(ws.getPage(pz)!.content as never);
  assert.ok(lines.includes("heading: Ziele 2027"), lines.join(" | "));
  assert.ok(lines.includes("zeffApp: "), "the widget is still there");
  assert.ok(lines.includes("paragraph: Ganz oben") && lines.includes("paragraph: Am Ende"));
});

test("a row's fields both ways; a page made in Zeff is made in Notion; the trash both ways", { skip }, async () => {
  const ws = await import("@/plugins/workspace/store");
  const rz = await zeffOf(row1);
  const dz = await zeffOf(db);
  const d = ws.getDatabase(dz)!;
  const status = d.schema.properties.find((p) => p.name === "Status")!;
  ws.setCell(rz, status.id, status.options!.find((o) => o.name === "Fertig")!.id);
  ws.setCell(rz, d.schema.properties.find((p) => p.name === "Erledigt")!.id, true);
  await push(rz, "row.changed", "Status");
  const props = notion.pages.get(row1)!.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(props.Status.select, { name: "Fertig" });
  assert.equal(props.Erledigt.checkbox, true);

  // A new page under Projekt in Zeff → under Projekt in Notion, with its text.
  const pz = await zeffOf(projekt);
  const neu = ws.createPage({ parentId: pz, title: "Notizen aus Zeff", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hallo Notion" }] }] } });
  await push(neu, "page.added");
  const made = [...notion.pages.values()].find((p) => notion.titleOf(p.id) === "Notizen aus Zeff");
  assert.ok(made, "made in Notion");
  assert.equal((made!.parent as { page_id: string }).page_id.replace(/-/g, ""), projekt);
  assert.deepEqual(notion.outline(made!.id), ["paragraph: Hallo Notion"]);
  assert.equal(await zeffOf(made!.id), neu, "and linked");

  // Zeff's trash → Notion's.
  ws.archivePage(neu);
  await push(neu, "page.removed");
  assert.equal(notion.pages.get(made!.id)!.archived, true);

  // Notion's trash → Zeff's (the check every ten minutes: due on the first run).
  notion.pages.get(unter)!.archived = true;
  const { getSqlite } = await import("@/db");
  const st = getSqlite().prepare("select name from sqlite_master where type = 'table' and name like '%notion%state%'").get() as { name: string };
  getSqlite().prepare(`delete from "${st.name}" where name = 'checked_at'`).run();
  const uz = await zeffOf(unter);
  await pull();
  assert.ok(ws.getPage(uz)!.archivedAt, "the sub-page moved to Zeff's trash");
});

test("a picture uploaded in Zeff goes to Notion as an upload (its bytes, as a form)", { skip }, async () => {
  const ws = await import("@/plugins/workspace/store");
  const { keepPicture } = await import("@/plugins/workspace/flows/file-actions");
  const src = await keepPicture(PNG);
  const pz = await zeffOf(projekt);
  const doc = JSON.parse(JSON.stringify(ws.getPage(pz)!.content)) as { content: Record<string, unknown>[] };
  doc.content.push({ type: "image", attrs: { src, alt: "Foto" } });
  ws.updatePage(pz, { content: doc });
  uploads.length = 0;
  await push(pz, "page.changed", "content");
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].type, /^multipart\/form-data; boundary=/);
  assert.ok(uploads[0].bytes > PNG.length, "the picture's bytes in the form");
  assert.equal(notion.outline(projekt).at(-1), "image: ");
});
