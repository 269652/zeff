import assert from "node:assert/strict";
import test from "node:test";
import { drawLive, flat } from "./news-live-render";

/**
 * The installed News screens as the browser draws them, on the data of a real account — a copy of its database (DATABASE_PATH) and of its plugins folder (ZEFF_PLUGINS_DIR),
 * NEWS_LIVE=1. The views are the ones stored in the account's Workspace (the page "News", the database "News settings"); each is drawn the way the page draws it — its
 * <data lambda> asked with the `with` it rendered, again with the answers — in the states a person gets to: For you, Discover, Latest, Saved, Filtered, Hidden, a category,
 * a topic, a story's thread, "more like this", the dialog open, stream and grid; the settings with a search and a language. 0 template errors, and nothing failed.
 */
const skip = process.env.NEWS_LIVE === "1" ? false : "NEWS_LIVE=1 with a copy of an account's database";

async function templates() {
  await import("@/plugins/contributions");
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  reg.setEnabled("news-ext", true);
  // (what the Workspace does when it opens: the page's copy of the template brought up to the plugin's)
  await (await import("@/plugins/workspace/news-app")).refreshNewsApp();
  const w = await import("@/plugins/workspace/store");
  const { getSqlite } = await import("@/db");
  const { getPref } = await import("@/lib/prefs");
  // (found by what they show, not by their names: a name is in the account's language)
  const viewsOf = (ids: number[]) => ids.flatMap((id) => w.getDatabase(id)!.schema.views.flatMap((v) => (v.template ? [{ id, name: v.name, template: v.template }] : [])));
  const idsLike = (needle: string) => (getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null and schema like ?").all(`%${needle}%`) as { id: number }[]).map((r) => r.id);
  const pick = (ids: number[], what: string) => {
    const v = viewsOf(ids);
    assert.ok(v.length, `the account has the ${what}`);
    return v;
  };
  const appId = getPref<number | null>("news.workspaceApp", null);
  return { news: pick(appId ? [appId] : [], "News page (the pref news.workspaceApp)"), settings: pick(idsLike("news.settings"), "settings database") };
}

const bad = (d: { errors: { line?: number; message: string }[] }) => JSON.stringify(d.errors);

test("the News page, in every state a person gets to", { skip }, async () => {
  const { news } = await templates();
  assert.ok(news.length, "the page has a template view");
  // The overview of the day (the AI's briefing) may not be there in this account: one is made of real items, in the shape the digest flow keeps.
  const { getPref, setPref } = await import("@/lib/prefs");
  if (!getPref("news:digest", null)) {
    const { getSqlite } = await import("@/db");
    const ids = (getSqlite().prepare("select id from news_items where state != 'hidden' order by published_at desc limit 6").all() as { id: number }[]).map((r) => r.id);
    setPref("news:digest", { at: new Date().toISOString(), overview: "A quiet day: three things matter.", themes: [{ title: "Theme", summary: "What it is about.", ids: ids.slice(0, 3) }], picks: ids.slice(3, 5).map((id) => ({ id, why: "Fits you." })) });
  }
  for (const v of news) {
    const first = await drawLive(v.template, {});
    assert.deepEqual(first.errors, [], `${v.name} (#${v.id}): ${bad(first)}`);
    const screen = first.data.news as { items: { id: number; tagList: { tag: string }[]; thread: string }[]; categories: { value: string }[]; stories: unknown[]; overview?: unknown };
    assert.ok(screen && Array.isArray(screen.items), "the screen's lambda answered");
    const topic = screen.items.flatMap((i) => i.tagList.map((t) => t.tag))[0];
    const thread = screen.items.find((i) => i.thread)?.thread;
    const states: Record<string, string>[] = ([
      ...["foryou", "discover", "latest", "saved", "filtered", "hidden"].flatMap((view) => [{ view }, { view, stream: "0" }]),
      ...screen.categories.slice(0, 3).map((c) => ({ view: "latest", category: c.value })),
      ...(topic ? [{ topic }] : []),
      ...(thread ? [{ topic: thread }, { topic: thread, stream: "0" }] : []),
      ...(screen.items[0] ? [{ like: String(screen.items[0].id) }, { reading: String(screen.items[0].id) }, { limit: "48" }] : []),
    ] as Record<string, string>[]);
    for (const s of states) {
      const d = await drawLive(v.template, s);
      assert.deepEqual(d.errors, [], `${v.name} ${JSON.stringify(s)}: ${bad(d)}`);
    }
    const foryou = await drawLive(v.template, { view: "foryou" });
    const types = new Set(flat(foryou.nodes).map((n) => n.t));
    assert.ok(types.has("grid"), "the cards are drawn");
    if ((foryou.data.news as { stories: unknown[] }).stories.length) assert.ok(types.has("stories"), "the stories strip");
    assert.ok((foryou.data.news as { overview?: unknown }).overview, "the overview is in the screen");
    assert.ok(types.has("speak"), "the overview can be listened to");
    console.log(`news page #${v.id}: ${states.length + 1} states, ${screen.items.length} cards, ${(screen.stories as unknown[]).length} stories, overview ${screen.overview ? "yes" : "no"}`);
  }
});

test("the settings page, with a search and a language", { skip }, async () => {
  const { settings } = await templates();
  assert.ok(settings.length, "the settings database has a template view");
  for (const v of settings)
    for (const s of [{}, { s_cq: "heise" }, { s_cl: "de" }, { s_cl: "en", s_cq: "tech" }, { s_find: "https://example.org", s_taste: "x" }] as Record<string, string>[]) {
      const d = await drawLive(v.template, s);
      assert.deepEqual(d.errors, [], `${v.name} ${JSON.stringify(s)}: ${bad(d)}`);
      assert.ok(d.data.s, "the settings lambda answered");
    }
});
