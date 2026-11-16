import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";

setupTempData();

/**
 * The rest of News as a plugin (zeff-plugins/plugins/news-ext, scripts/port-news.mts): what the built-in's page had beyond the cards — the stories strip, the topic
 * chips with the dive banner, "you're all caught up", "N new", what was seen, the widget, the news you kept as a source, the Today page's line, the settings page's
 * catalog — run for real against the built-in's tables (adopted): the lambdas, the flows, and both pages drawn with zero errors.
 */
const skip = skipWithoutRepo("news-ext");
const H = 3600e3;
const ago = (n: number) => new Date(Date.now() - n * H).toISOString();

async function ask<T>(name: string, event: unknown = {}): Promise<T> {
  const { invokeLambda } = await import("@/plugins/workspace/lambdas/run");
  const r = await invokeLambda(name, event);
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  return (r.ok ? r.result : null) as T;
}

/** All the nodes of a drawn view, flat. */
type VN = { t: string; a: Record<string, string>; c: (VN | string)[] };
const flat = (nodes: (VN | string)[]): VN[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [n, ...flat(n.c)]));

let ready: Promise<void> | null = null;
function world(): Promise<void> {
  return (ready ??= (async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-news-ext-rest-"));
    process.env.ZEFF_PLUGINS_DIR = dir;
    fs.cpSync(repoPlugin("news-ext"), path.join(dir, "news-ext"), { recursive: true });
    const { setInstalled } = await import("@/plugins/state");
    for (const id of ["workspace", "todos"]) setInstalled(id as never, true);
    await import("@/plugins/contributions");
    const reg = await import("@/lib/ext/registry");
    reg.scanPlugins(true);
    reg.setEnabled("news-ext", true);
    // (the built-in makes its tables on first use; the plugin's stores adopt them)
    const { ensureAdoptedTables } = await import("@/lib/ext/adopted-tables");
    assert.equal(ensureAdoptedTables("news_items"), true);
    const { getSqlite } = await import("@/db");
    const d = getSqlite();
    const src = (name: string) => Number(d.prepare("insert into news_sources (name, url, created_at, category) values (?, ?, ?, 'Tech')").run(name, `https://${name.toLowerCase()}.example/feed`, ago(5)).lastInsertRowid);
    const [a, b, c] = [src("Alpha"), src("Beta"), src("Gamma")];
    const item = (n: number, sourceId: number, sourceName: string, o: Record<string, unknown> = {}) =>
      d
        .prepare(
          "insert into news_items (source_id, source_name, guid, url, url_key, title, title_key, summary, published_at, fetched_at, state, vote, score, reasons, image, tags, story, gate, gate_why, seen_at) values (@sid, @sn, @g, @u, @uk, @t, @tk, @s, @p, @f, @st, 0, @sc, '[]', @img, @tags, @story, @gate, @why, @seen)",
        )
        .run({ sid: sourceId, sn: sourceName, g: `g${n}`, u: `https://x.example/${n}`, uk: `k${n}`, t: `Headline ${n}`, tk: `h${n}`, s: `Summary of ${n}`, p: ago(n), f: ago(n), st: "new", sc: 10 - n, img: "", tags: "[]", story: "", gate: "", why: "", seen: null, ...o });
    // a story told by three outlets, one item the agent found important, three plain, one seen
    item(1, a, "Alpha", { story: "Streik bei der Bahn", tags: JSON.stringify(["Bahn", "Streik"]), image: "https://img.example/1.jpg" });
    item(2, b, "Beta", { story: "Streik bei der Bahn", tags: JSON.stringify(["Bahn"]) });
    item(3, c, "Gamma", { story: "Streik bei der Bahn", tags: JSON.stringify(["Bahn"]) });
    item(4, a, "Alpha", { tags: JSON.stringify(["Klima"]) });
    item(5, b, "Beta", { gate: "top", why: "Wichtig für dich" });
    item(6, c, "Gamma", { seen: ago(1) });
    item(7, c, "Gamma", { st: "saved", tags: JSON.stringify(["Klima"]), summary: "Saved one" });
  })());
}

const screen = (event: Record<string, unknown> = {}) => ask<Record<string, any>>("news.screen", { view: "foryou", ...event });

test("the screen brings the stories strip: Important first, the story told by three outlets after it", { skip }, async () => {
  await world();
  const r = await screen();
  const labels = (r.stories as { label: string; kind: string }[]).map((g) => `${g.kind}:${g.label}`);
  assert.ok(labels.includes("top:Important"), labels.join(" | "));
  assert.ok(labels.includes("story:Streik bei der Bahn"), labels.join(" | "));
  const story = (r.stories as { kind: string; items: { id: number; title: string; meta: string; seen: boolean }[] }[]).find((g) => g.kind === "story")!;
  assert.equal(story.items.length, 3);
  assert.deepEqual(story.items.map((i) => i.title), ["Headline 3", "Headline 2", "Headline 1"], "told oldest first");
  assert.match(story.items[0].meta, /Gamma · .*3 outlets/);
});

test("a chip's topic and a story's thread are followed: only their news, and the banner says what it is", { skip }, async () => {
  const bahn = await screen({ topic: "Bahn" });
  assert.deepEqual(bahn.items.map((i: { id: number }) => i.id).sort(), [1, 2, 3].map((n) => bahn.items.find((i: { title: string }) => i.title === `Headline ${n}`).id).sort());
  assert.equal(bahn.topicLabel, "Bahn");
  assert.equal(bahn.topicIsStory, false);
  assert.deepEqual(bahn.stories, [], "no stories strip while following");
  const thread = (await screen()).items.find((i: { title: string }) => i.title === "Headline 1");
  assert.equal(thread.thread, "story:Streik bei der Bahn");
  assert.equal(thread.outlets, "3 outlets");
  const followed = await screen({ topic: thread.thread });
  assert.equal(followed.items.length, 3);
  assert.equal(followed.topicIsStory, true);
  assert.equal(followed.topicLabel, "Streik bei der Bahn");
  assert.match(followed.topicAsk, /Streik bei der Bahn/);
});

test("'you're all caught up' sits where the seen items begin", { skip }, async () => {
  const r = await screen();
  const at = r.items.findIndex((i: { caught?: boolean }) => i.caught);
  assert.ok(at > 0, "after the unseen");
  assert.ok(r.items.slice(at).every((i: { seen: boolean }) => i.seen), "from there on only what was seen");
  assert.ok(r.items.slice(0, at).every((i: { seen: boolean }) => !i.seen));
  assert.ok(!(await screen({ topic: "Bahn" })).items.some((i: { caught?: boolean }) => i.caught), "not while following a topic");
});

test("both pages are drawn with zero errors: the news page (stories, masonry or stream, chips, banner, speak, visible) and the settings page (catalog)", { skip }, async () => {
  const { renderView } = await import("@/plugins/workspace/view-template");
  const base = { rows: [], props: [], titleName: "Title", app: {}, db: { id: 1, title: "News" } };
  const template = fs.readFileSync(path.join(repoPlugin("news-ext"), "views", "news.html"), "utf8");
  const feed = await screen();
  // a digest: the overview with "Listen"
  const withOverview = { ...feed, overview: { ago: "now", text: "Today", themes: [], picks: [], spoken: "Today is quiet." }, voice: "en-US" };
  for (const stream of ["1", "0"]) {
    const out = renderView(template, { ...base, state: { stream, topic: "" }, data: { news: withOverview, fresh: { count: 2 } } });
    assert.deepEqual(out.errors, [], JSON.stringify(out.errors));
    const types = new Set(flat(out.nodes as never).map((n) => n.t));
    for (const t of ["stories", "speak", "visible", "grid", "divider"]) assert.ok(types.has(t), `${t} in ${[...types].join(",")}`);
    const grid = flat(out.nodes as never).find((n) => n.t === "grid" && n.a.masonry === "true")!;
    assert.equal(grid.a.cols, stream === "1" ? "1" : "3");
    const stories = flat(out.nodes as never).find((n) => n.t === "stories")!;
    assert.ok(JSON.parse(stories.a.groups).length >= 2);
    assert.equal(stories.a.read, "reading");
  }
  const followed = await screen({ topic: "story:Streik bei der Bahn" });
  const out = renderView(template, { ...base, state: { stream: "1", topic: "story:Streik bei der Bahn" }, data: { news: followed, fresh: { count: 0 }, sofar: { answer: "Der Stand [1].", sources: [{ n: 1, url: "https://x.example/1", sourceName: "Alpha" }] } } });
  assert.deepEqual(out.errors, [], JSON.stringify(out.errors));
  const text = JSON.stringify(out.nodes);
  assert.ok(text.includes("Story so far") && text.includes("Der Stand [1]."), "the banner with the story so far");
  const settings = fs.readFileSync(path.join(repoPlugin("news-ext"), "zeff-plugin.json"), "utf8");
  assert.ok(settings.includes("news.kept") && settings.includes("news.widget"));
  const settingsDb = JSON.parse(fs.readFileSync(path.join(repoPlugin("news-ext"), "news.package.json"), "utf8")).items.find((i: { title: string }) => i.title === "News settings");
  const sData = await ask<Record<string, any>>("news.settings", { mode: "data", cq: "", cl: "" });
  const so = renderView(settingsDb.schema.views[0].template, { ...base, state: {}, data: { s: sData, found: {} } });
  assert.deepEqual(so.errors, [], JSON.stringify(so.errors));
});

test("the settings page's catalog: filtered by a search and a language, what is there marked, trust and taste details come with it", { skip }, async () => {
  const all = await ask<Record<string, any>>("news.settings", { mode: "data" });
  assert.ok(all.catalog.length >= 3 && all.catalogAll > 100);
  assert.ok(all.langs.some((l: { id: string }) => l.id === "de"));
  const de = await ask<Record<string, any>>("news.settings", { mode: "data", cl: "de" });
  assert.ok(de.catalog.every((c: { feeds: { lang: string }[] }) => c.feeds.every((f) => f.lang === "de")));
  const found = await ask<Record<string, any>>("news.settings", { mode: "data", cq: "tagesschau" });
  assert.ok(found.catalog.some((c: { feeds: { name: string }[] }) => c.feeds.some((f) => /tagesschau/i.test(f.name))));
  assert.ok(found.catalog.every((c: { total: number; todo: number; added: number }) => c.total === c.todo + c.added));
  assert.deepEqual(all.sources.map((s: { weight: number }) => s.weight), [1, 1, 1]);
  assert.equal(typeof all.taste.likes, "string");
});

test("'N new' counts what came in since the page loaded; Today's line counts since yesterday and names the best unseen", { skip }, async () => {
  const none = await ask<{ count: number }>("news.fresh", { since: new Date().toISOString() });
  assert.equal(none.count, 0);
  const some = await ask<{ count: number }>("news.fresh", { since: ago(100) });
  assert.equal(some.count, 6, "everything fetched and new (the saved one is no longer new)");
  const today = await ask<{ count: number; top: { title: string }[] }>("news.today", { since: ago(30) });
  assert.equal(today.count, 6);
  assert.ok(today.top.length >= 1 && today.top.length <= 3);
  assert.ok(!today.top.some((i) => i.title === "Headline 6"), "not what was seen");
});

test("the widget lists the best new items with buttons; its flow saves, likes or hides what it names", { skip }, async () => {
  const w = await ask<{ kind: string; items: { id: string; text: string; actions: { id: string }[] }[]; footer: { href: string } }>("news.widget", { config: { limit: 3 } });
  assert.equal(w.kind, "list");
  assert.equal(w.items.length, 3);
  assert.deepEqual(w.items[0].actions.map((a) => a.id), ["save", "like", "hide"]);
  assert.equal(w.footer.href, "/news");
  const life = await import("@/plugins/workspace/package-life");
  await life.installTracked(JSON.parse(fs.readFileSync(path.join(repoPlugin("news-ext"), "news.package.json"), "utf8")), null, { allow: true });
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const { getSqlite } = await import("@/db");
  const id = Number(w.items[0].id);
  for (const [action, check] of [
    ["save", () => (getSqlite().prepare("select state from news_items where id = ?").get(id) as { state: string }).state === "saved"],
    ["hide", () => (getSqlite().prepare("select state from news_items where id = ?").get(id) as { state: string }).state === "hidden"],
    ["like", () => (getSqlite().prepare("select vote from news_items where id = ?").get(id) as { vote: number }).vote === 1],
  ] as const) {
    const r = await runFlow("news.widget-act", { action, payload: { id: String(id) } }, { trigger: { kind: "manual" } });
    assert.equal(r.status, "done", r.error ?? "");
    assert.ok(check(), `${action} was written`);
  }
});

test("what was seen on screen goes in through the page's flow (a comma list of ids)", { skip }, async () => {
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const { getSqlite } = await import("@/db");
  const ids = (getSqlite().prepare("select id from news_items where seen_at is null and state = 'new' order by id limit 2").all() as { id: number }[]).map((r) => r.id);
  assert.equal(ids.length, 2);
  const r = await runFlow("news.act", { op: "seen", ids: ids.join(",") }, { trigger: { kind: "manual" } });
  assert.equal(r.status, "done", r.error ?? "");
  const left = getSqlite().prepare(`select count(*) n from news_items where seen_at is not null and id in (${ids.join(",")})`).get() as { n: number };
  assert.equal(left.n, 2);
});

test("the news you kept are a source with their text and tags, in the built-in's own shape", { skip }, async () => {
  const records = await ask<{ ref: string; title: string; updatedAt: string; dataType: string; typed: { id: string; value: unknown }[] }[]>("news.kept", {});
  const { getSqlite } = await import("@/db");
  const kept = getSqlite().prepare("select id from news_items where state = 'saved' or (vote = 1 and state != 'hidden')").all() as { id: number }[];
  assert.deepEqual(records.map((r) => r.ref).sort(), kept.map((i) => `news:${i.id}`).sort());
  const mine = records.find((r) => r.title === "Headline 7")!;
  assert.equal(mine.dataType, "news");
  assert.equal(mine.updatedAt, "saved:0");
  const field = (id: string) => mine.typed.find((t) => t.id === id)?.value;
  assert.equal(field("newssaved"), true);
  assert.equal(field("newspublisher") ?? field("newssource"), "Gamma");
  assert.equal(field("newstags"), "Klima");
});

test("the end of the feed starts the search for new feeds (the flow keeps its own pace)", { skip }, async () => {
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const { flowByName } = await import("@/plugins/workspace/flows/store");
  assert.ok(flowByName("news.auto-find"));
  const r = await runFlow("news.auto-find", {}, { trigger: { kind: "manual" } });
  assert.notEqual(r.status, "failed", r.error ?? "");
});

test("the News page and its settings are reached through the plugin: /news makes the Workspace page once with the plugin's template; the old built-in app view is converted", { skip }, async () => {
  const { newsApp } = await import("@/plugins/workspace/news-app");
  const id = await newsApp();
  assert.ok(id, "the page is made");
  assert.equal(await newsApp(), id, "once");
  const w = await import("@/plugins/workspace/store");
  const d = w.getDatabase(id!)!;
  assert.equal(d.schema.dataType, "news");
  assert.equal(d.schema.views[0].app, "template");
  assert.ok(d.schema.views[0].template?.includes("news.screen"));
  // made while News was the built-in: its app view `news` is given the template
  w.updateSchema(id!, { ...d.schema, views: [{ ...d.schema.views[0], app: "news", template: undefined }] });
  assert.equal(await newsApp(), id);
  assert.equal(w.getDatabase(id!)!.schema.views[0].app, "template");
  const life = await import("@/plugins/workspace/package-life");
  void life;
  assert.ok(w.search("News settings", 10).some((h) => h.title === "News settings" && h.kind === "database"), "the settings database of the package is found");
});

test("an account that had the built-in keeps its data: the retired plugin row goes, the tables stay as they were", { skip }, async () => {
  const { getDb, schema } = await import("@/db");
  const { rewriteRetiredPlugins } = await import("@/plugins/state");
  getDb().insert(schema.plugins).values({ id: "news", installed: false, changedAt: new Date().toISOString() } as never).run();
  assert.ok(rewriteRetiredPlugins() >= 1);
  assert.ok(!getDb().select().from(schema.plugins).all().some((r) => r.id === "news"));
  const { getSqlite } = await import("@/db");
  assert.equal((getSqlite().prepare("select count(*) n from news_items").get() as { n: number }).n >= 7, true);
});

test("the pages as the browser draws them: the page's lambdas asked with what the render gave, again with the answers — in every view, 0 errors", { skip }, async () => {
  const { drawLive } = await import("./news-live-render");
  const template = fs.readFileSync(path.join(repoPlugin("news-ext"), "views", "news.html"), "utf8");
  for (const s of [{}, { view: "discover" }, { view: "latest", stream: "0" }, { view: "saved" }, { view: "filtered" }, { view: "hidden" }, { topic: "Bahn" }, { topic: "story:Streik bei der Bahn" }, { category: "Tech" }, { like: "1" }, { reading: "1" }, { limit: "48" }] as Record<string, string>[]) {
    const d = await drawLive(template, s);
    assert.deepEqual(d.errors, [], `${JSON.stringify(s)}: ${JSON.stringify(d.errors)}`);
    assert.ok(d.data.news && (d.data.fresh as { count?: number } | undefined)?.count !== undefined, "the screen's and the fresh count's answers came");
  }
});

test("the page's copy of the template follows the plugin: a copy made before is replaced once, one you changed is left alone", { skip }, async () => {
  const { newsApp, refreshNewsApp } = await import("@/plugins/workspace/news-app");
  const w = await import("@/plugins/workspace/store");
  const { getPref, setPref } = await import("@/lib/prefs");
  const id = (await newsApp())!;
  const plugin = fs.readFileSync(path.join(repoPlugin("news-ext"), "views", "news.html"), "utf8");
  const old = '<state name="view" value="foryou"/>\n<data name="news" lambda="news.screen" with="view={{ state.view }}"/>\n<text>old</text>';
  const set = (template: string) => {
    const d = w.getDatabase(id)!;
    w.updateSchema(id, { ...d.schema, views: d.schema.views.map((v) => ({ ...v, template })) });
  };
  const now = () => w.getDatabase(id)!.schema.views[0].template;
  setPref("news.workspaceApp.templateHash", ""); // (made before the hash was kept)
  set(old);
  await refreshNewsApp();
  assert.equal(now(), plugin, "replaced once");
  set(old + "\n<text>mine</text>"); // (changed here, the hash is the plugin's)
  await refreshNewsApp();
  assert.ok(now()!.includes("mine"), "left alone");
  assert.ok(getPref<string>("news.workspaceApp.templateHash", ""));
});
