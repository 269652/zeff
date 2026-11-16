import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * What a flow can do to keep a copy of pages elsewhere (a sync with another service — the Notion plugin first, any plugin after): pages'
 * events (made, changed, moved, to the trash) for the pages below one, run once the page rests; never the flow that made the change;
 * a watch that asks a lambda cheaply and runs only when it says something changed; a page's text read and written as the editor keeps
 * it; pictures kept from the web and read as bytes; a database a flow makes is one it may write and change.
 */

async function world() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  await import("@/plugins/contributions");
  await import("@/plugins/workspace/server");
  return {
    ws: await import("@/plugins/workspace/store"),
    flows: await import("@/plugins/workspace/flows/store"),
    engine: await import("@/plugins/workspace/flows/engine"),
  };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits until `ok` holds (at most `ms`) — what runs after an event runs a moment later. */
async function until(ok: () => Promise<boolean>, ms = 10_000) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await ok()) return;
}
const runsOf = async (name: string) => {
  const { flowByName, flowRuns } = await import("@/plugins/workspace/flows/store");
  return flowRuns(flowByName(name)!.pageId, 50);
};

test("page events: only below the page named, once the page rests (settle), with the page and what changed; a flow's own change never starts it again", async () => {
  const { ws, flows } = await world();
  const top = ws.createPage({ title: "Oben" });
  const inside = ws.createPage({ title: "Drin", parentId: top });
  const outside = ws.createPage({ title: "Draußen" });
  flows.createFlow({
    name: "t.pages.watch",
    nodes: [{ id: "r", kind: "return", value: { page: "{{ input.page }}", event: "{{ input.event }}", field: "{{ input.field }}" } }],
    triggers: [
      { kind: "event", event: "page.changed", under: top, settle: 1 },
      { kind: "event", event: "page.removed", under: top },
    ],
  });
  ws.updatePage(inside, { title: "Drin 1" });
  ws.updatePage(inside, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] } });
  ws.updatePage(inside, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "ab" }] }] } });
  ws.updatePage(outside, { title: "Draußen 1" });
  await wait(300);
  assert.equal((await runsOf("t.pages.watch")).length, 0, "not yet: it waits for the page to rest");
  await until(async () => (await runsOf("t.pages.watch")).length > 0);
  await wait(1200);
  const runs = await runsOf("t.pages.watch");
  assert.equal(runs.length, 1, "three changes of one page, one run; the page outside none");
  assert.deepEqual(runs[0].output, { page: inside, event: "page.changed", field: "content" });

  ws.archivePage(inside);
  await until(async () => (await runsOf("t.pages.watch")).length > 1);
  assert.deepEqual((await runsOf("t.pages.watch"))[0].output, { page: inside, event: "page.removed", field: null });

  // A flow that changes a page it listens to doesn't start itself (no echo).
  const other = ws.createPage({ title: "Echo", parentId: top });
  flows.createFlow({
    name: "t.pages.echo",
    nodes: [{ id: "w", kind: "action", action: "meta.run", input: { op: "page.update", args: { id: "{{ input.page }}", title: "geschrieben" } } }],
    permissions: { meta: ["pages"] },
    triggers: [{ kind: "event", event: "page.changed", under: top }],
  });
  ws.updatePage(other, { title: "von dir" });
  await until(async () => ws.getPage(other)!.title === "geschrieben");
  await wait(500);
  assert.equal(ws.getPage(other)!.title, "geschrieben");
  assert.equal((await runsOf("t.pages.echo")).length, 1, "its own change didn't run it again");
});

test("a watch: the lambda asked every n seconds; the flow runs only when it says something changed, the token handed on", async () => {
  const { flows, engine } = await world();
  const lambdas = await import("@/plugins/workspace/lambdas/store");
  lambdas.createLambda({ manifest: { name: "t.watch.ask", label: "t", what: "t", kind: "function" }, files: { "index.mjs": "export async function handler(e) { return e.since === 'b' ? { changed: false, token: 'b' } : { changed: true, token: e.since ? 'b' : 'a', input: { saw: e.since ?? 'none' } }; }" } });
  flows.createFlow({ name: "t.watch.flow", inputs: [{ name: "saw", type: "text" }], nodes: [{ id: "r", kind: "return", value: "{{ input.saw }}" }], triggers: [{ kind: "watch", lambda: "t.watch.ask", everySeconds: 10 }] });
  const t0 = Date.now();
  assert.equal(await engine.runDueWatches(t0), 1, "first: changed — runs");
  assert.equal(await engine.runDueWatches(t0 + 3000), 0, "not due yet");
  assert.equal(await engine.runDueWatches(t0 + 11_000), 1, "changed again (since 'a')");
  assert.equal(await engine.runDueWatches(t0 + 22_000), 0, "nothing changed (since 'b'): no run");
  const runs = await runsOf("t.watch.flow");
  assert.deepEqual(runs.map((r) => r.output).reverse(), ["none", "a"]);
  assert.equal(flows.flowByName("t.watch.flow")!.triggers[0].kind, "watch");
  const tooFast = flows.createFlow({ name: "t.watch.fast", nodes: [], triggers: [{ kind: "watch", lambda: "t.watch.ask", everySeconds: 1 }] });
  assert.deepEqual(tooFast.triggers[0], { kind: "watch", lambda: "t.watch.ask", everySeconds: 10 }, "ten seconds at least");
});

test("the meta API: a page's text read and written as the editor keeps it (not lossy Markdown), a cover, moved, only if unchanged since (rev); a package's page by its place; options with their ids", async () => {
  const { ws } = await world();
  const { metaRun, metaAccess } = await import("@/plugins/workspace/meta");
  const doc = { type: "doc", content: [{ type: "callout", attrs: { icon: "⚠️", tone: "red" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Achtung", marks: [{ type: "highlight", attrs: { color: "yellow" } }] }] }] }] };
  const a = ws.createPage({ title: "A" });
  const made = metaRun("page.create", { title: "Neu", parent: a, doc, cover: "https://example.com/c.png" }) as { id: number; rev: number };
  const read = metaRun("page.read", { id: made.id }) as { doc: unknown; cover: string; parent: number; kind: string; rev: number };
  assert.deepEqual(read.doc, doc, "a callout with a highlight — as it was");
  assert.equal(read.cover, "https://example.com/c.png");
  assert.equal(read.parent, a);
  assert.equal(metaAccess("page.read", {}).key, "meta:pages-read");
  const b = ws.createPage({ title: "B" });
  const moved = metaRun("page.update", { id: made.id, parent: b, doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }, rev: read.rev }) as { rev: number };
  assert.equal(ws.getPage(made.id)!.parentId, b);
  assert.deepEqual(metaRun("page.update", { id: made.id, doc: { type: "doc", content: [] }, rev: read.rev }), { id: made.id, conflict: true, rev: moved.rev }, "changed since: not written");
  const dbId = metaRun("database.create", { title: "T", properties: [{ name: "Stand", type: "select", options: [{ name: "Offen", color: "red" }] }] }) as { id: number };
  const schema = metaRun("schema", { database: dbId.id }) as { properties: { name: string; options?: string[]; choices?: { id: string; name: string; color: string }[] }[] };
  const stand = schema.properties.find((p) => p.name === "Stand")!;
  assert.deepEqual(stand.options, ["Offen"]);
  assert.equal(stand.choices![0].name, "Offen");
  assert.ok(stand.choices![0].id, "the option's id: what a row keeps");
});

test("a database a flow makes through meta.run is one it may write and change; pictures kept from the web, a page's pictures kept, a kept picture read as bytes", async () => {
  const { flows, engine, ws } = await world();
  flows.createFlow({
    name: "t.meta.db",
    nodes: [
      { id: "mk", kind: "action", action: "meta.run", input: { op: "database.create", args: { title: "Gemacht", properties: [{ name: "N", type: "number" }] } } },
      { id: "add", kind: "action", action: "db.add", input: { database: "{{ steps.mk.id }}", title: "Zeile", values: { N: 2 } } },
      { id: "alt", kind: "action", action: "meta.run", input: { op: "database.alter", args: { database: "{{ steps.mk.id }}", ops: [{ op: "add_property", name: "M", type: "text" }] } } },
    ],
    permissions: { meta: ["databases"] },
  });
  const r = await engine.runFlow("t.meta.db", {});
  assert.equal(r.status, "done", r.error ?? "");

  const { PNG } = await import("./notion-fake");
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;
  try {
    const page = ws.createPage({ title: "Bilder", content: { type: "doc", content: [{ type: "image", attrs: { src: "https://www.example.com/a.png" } }, { type: "image", attrs: { src: "https://www.example.com/a.png" } }] } });
    flows.createFlow({
      name: "t.files",
      nodes: [
        { id: "keep", kind: "action", action: "files.keep-page", input: { page: page } },
        { id: "one", kind: "action", action: "files.save", input: { url: "https://www.example.com/b.png" } },
        { id: "read", kind: "action", action: "files.read", input: { src: "{{ steps.one.src }}" } },
      ],
      permissions: { web: ["www.example.com"], meta: ["pages"] },
    });
    const f = await engine.runFlow("t.files", {});
    assert.equal(f.status, "done", f.error ?? "");
    const srcs = (ws.getPage(page)!.content as unknown as { content: { attrs: { src: string } }[] }).content.map((n) => n.attrs.src);
    assert.ok(srcs.every((s) => s.startsWith("/api/workspace/files/")), "the page shows the kept copies");
    assert.equal(new Set(srcs).size, 1, "the same picture once");
    const out = (f.output ?? (await runsOf("t.files"))[0].journal) as unknown;
    void out;
    const { flowRuns } = await import("@/plugins/workspace/flows/store");
    const run = flowRuns(flows.flowByName("t.files")!.pageId, 1)[0];
    const log = JSON.stringify(run.log);
    assert.match(log, /image\/png/);
    flows.createFlow({ name: "t.files.no", nodes: [{ id: "k", kind: "action", action: "files.keep-page", input: { page: page } }], permissions: { web: ["www.example.com"] } });
    assert.match((await engine.runFlow("t.files.no", {})).error ?? "", /may not change pages/);
  } finally {
    globalThis.fetch = real;
  }
});
