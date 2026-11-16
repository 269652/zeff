import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";

setupTempData();

/**
 * People's port, slice 2 (zeff-plugins/plugins/people-ext): the screens — the overview and a person's page — made of the view language alone. Their data are the
 * lambdas `people.screen` / `people.person` (the built-in's own view-data.ts / row-data.ts, bundled, over the kernel's reads `people.screen-data`, `people.page-data`,
 * `people.wiki-of`); what a button does is the flows `people.tool` / `people.person-op` over the kernel's `people.run-tool` / `people.run-op` (the built-in's own
 * peopleTool / personOp). The same people, the same lists, the same changes as the built-in's; both templates draw without an error.
 */

const skip = skipWithoutRepo("people-ext");
const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

let made: ReturnType<typeof build> | null = null;
const world = () => (made ??= build());
async function build() {
  const plugins = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-people-screens-"));
  process.env.ZEFF_PLUGINS_DIR = plugins;
  fs.cpSync(repoPlugin("people-ext"), path.join(plugins, "people-ext"), { recursive: true });
  const state = await import("@/plugins/state");
  for (const id of ["workspace", "todos", "people"]) state.setInstalled(id as never, true);
  await import("@/plugins/contributions");
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  reg.setEnabled("people-ext", true);
  const life = await import("@/plugins/workspace/package-life");
  const pkg = await life.offeredPackage("people-ext");
  assert.ok(pkg, "the plugin brings its package");
  await life.installTracked(pkg, null, { allow: true });
  const people = await import("@/plugins/people/store");
  const anna = people.createPerson({ name: "Anna Berg", emails: ["anna@example.org"] });
  const tom = people.createPerson({ name: "Tom Keller", whatsapp: "Tom K" });
  people.updatePerson(anna, { starred: true, note: "Likes tea" });
  people.setCircle(anna, "friends", "manual");
  const { ensurePeopleDatabase, peopleDatabase } = await import("@/plugins/workspace/people-database");
  await ensurePeopleDatabase();
  const db = peopleDatabase();
  assert.ok(db, "the people database is there");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  await runPipeline(db!, { ai: false });
  const { getDb, schema } = await import("@/db");
  getDb()
    .insert(schema.emails)
    .values({ key: "e1|x", convId: "c-e1", syncedAt: ago(0), folder: "Posteingang", fromName: "Anna Berg", fromEmail: "anna@example.org", subject: "Hi", preview: "Hello there", receivedAt: ago(10) } as never)
    .run();
  const lambdas = await import("@/plugins/workspace/lambdas/store");
  const { runLambda } = await import("@/plugins/workspace/lambdas/run");
  const call = async <T>(name: string, event: Record<string, unknown>): Promise<T> => {
    const l = lambdas.getLambda(name);
    assert.ok(l, `${name} is there`);
    const run = await runLambda(l!, event);
    assert.ok(run.ok, run.ok ? "" : run.error);
    return run.result as T;
  };
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  return { anna, tom, db: db!, call, runFlow };
}

type Screen = { count: number; shown?: unknown; cards: { id: number; personId: number; name: string; starred: boolean; circle: string; circleOpts: { with: string }[] }[]; circleOptions: string; groups: { key: string; items: { id: number; on: string; yes: string; no: string }[] }[]; settings: { weeks: number }; shownCount: number; toCheck: number };

test("the plugin's pieces are all there and sound", { skip }, async () => {
  await world();
  const { flowByName } = await import("@/plugins/workspace/flows/store");
  for (const n of ["people.tool", "people.person-op"]) assert.ok(flowByName(n), n);
  const { getLambda } = await import("@/plugins/workspace/lambdas/store");
  for (const n of ["people.screen", "people.person"]) assert.ok(getLambda(n), n);
  const dir = repoPlugin("people-ext");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "zeff-plugin.json"), "utf8")) as { description: string; contributes: { appViews: { template: string }[] } };
  assert.ok(manifest.description.length <= 300);
  assert.ok(fs.existsSync(path.join(dir, manifest.contributes.appViews[0].template)));
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "people.package.json"), "utf8")) as { id: string; version: string };
  assert.equal(pkg.id, "people-ext");
  assert.ok(pkg.version);
  // (the kernel's reads and writes: lambdas may call the reads, only a flow the writes)
  const { flowAction } = await import("@/plugins/workspace/flows/actions");
  for (const n of ["people.screen-data", "people.page-data", "people.wiki-of"]) assert.ok(flowAction(n) && !flowAction(n)!.writes, `${n} only reads`);
  for (const n of ["people.run-tool", "people.run-op"]) assert.equal(flowAction(n)?.writes, true, `${n} writes`);
});

test("the overview: the same people, circles and lists as the built-in's", { skip }, async () => {
  const { call, anna } = await world();
  const { peopleOverview } = await import("@/plugins/people/tools");
  const { peopleAppData } = await import("@/plugins/people/view-data");
  const { translator } = await import("@/lib/i18n/shared");
  const { rawRows } = await import("@/plugins/workspace/store");
  const { peopleDatabase } = await import("@/plugins/workspace/people-database");
  const rows = rawRows(peopleDatabase()!);
  const o = await peopleOverview();
  const built = peopleAppData(o, rows, { t: translator("en"), state: { circle: "all", only: "", sort: "name" }, now: Date.now() }) as { shown: { name: string; personId: number }[]; circleOptions: string; count: number; toCheck: number; groups: unknown[] };
  const port = await call<Screen>("people.screen", {});
  assert.deepEqual(
    port.cards.map((c) => c.name),
    built.shown.map((p) => p.name),
    "the same people in the same order",
  );
  assert.equal(port.count, built.count);
  assert.equal(port.circleOptions, built.circleOptions);
  assert.equal(port.toCheck, built.toCheck);
  assert.deepEqual(port.groups, built.groups);
  assert.equal(port.cards.find((c) => c.name === "Anna Berg")?.starred, true);
  assert.equal(port.cards.find((c) => c.name === "Anna Berg")?.circle, "friends");
  assert.equal(port.cards.find((c) => c.personId === anna)?.circleOpts.length, 6);
  // The filters and the sort of the state
  const friends = await call<Screen>("people.screen", { circle: "friends" });
  assert.deepEqual(friends.cards.map((c) => c.name), ["Anna Berg"]);
  const starred = await call<Screen>("people.screen", { only: "starred", sort: "quiet" });
  assert.deepEqual(starred.cards.map((c) => c.name), ["Anna Berg"]);
});

test("a button's flow does what the built-in's tool does: add, circle, todo, settings", { skip }, async () => {
  const { call, runFlow, tom } = await world();
  const people = await import("@/plugins/people/store");
  let r = await runFlow("people.tool", { tool: "add", name: "Clara Vogel" });
  assert.equal(r.status, "done", r.error ?? "");
  assert.ok(people.listPeople().some((p) => p.name === "Clara Vogel"), "the person is made");
  r = await runFlow("people.tool", { tool: "circle", id: tom, circle: "work" });
  assert.equal(r.status, "done", r.error ?? "");
  assert.equal(people.getPerson(tom)?.circle, "work");
  r = await runFlow("people.tool", { tool: "circle", id: tom, circle: "" });
  assert.equal(people.getPerson(tom)?.circle, "");
  r = await runFlow("people.tool", { tool: "todo", id: tom, text: "Call about the trip" });
  assert.equal(r.status, "done", r.error ?? "");
  assert.equal((r.output as { message: string }).message, "Todo added ✓");
  r = await runFlow("people.tool", { tool: "settings", weeks: 6, myName: "Mum Berg", aboutMe: "" });
  assert.equal(r.status, "done", r.error ?? "");
  const s = await call<Screen>("people.screen", {});
  assert.equal(s.settings.weeks, 6);
  // the people database reads the profiles again: the new person is a card
  const { getSqlite } = await import("@/db");
  assert.ok(getSqlite());
  r = await runFlow("people.tool", { tool: "snooze", id: tom, days: 14 });
  assert.equal(r.status, "done", r.error ?? "");
});

test("the verdicts on what waits: a claim confirmed, a link rejected", { skip }, async () => {
  const { call, runFlow, anna } = await world();
  const { getSqlite } = await import("@/db");
  getSqlite()
    .prepare("insert into people_claims (person_id, kind, text, evidence, source_ref, confidence, status, direction, created_at) values (?, 'fact', 'Likes sailing', 'she said so', 'm1', 0.8, 'proposed', '', ?)")
    .run(anna, ago(1));
  const s = await call<Screen>("people.screen", {});
  const group = s.groups.find((g) => g.key === "read");
  assert.ok(group, "what the AI read waits to be checked");
  const item = group!.items[0];
  assert.equal(item.on, "claim");
  assert.ok(/tool=claim/.test(item.yes) && /action=reject/.test(item.no));
  const r = await runFlow("people.tool", { tool: "claim", id: item.id, action: "confirm" });
  assert.equal(r.status, "done", r.error ?? "");
  const row = getSqlite().prepare("select status from people_claims where id = ?").get(item.id) as { status: string };
  assert.equal(row.status, "confirmed");
});

test("a person's page: the same data as the built-in's, what the buttons change, the page goes when a profile is merged", { skip }, async () => {
  const { call, runFlow, db, anna, tom } = await world();
  const { rawRows } = await import("@/plugins/workspace/store");
  const row = rawRows(db).find((x) => x.cells.srcref === `person:${anna}`)!;
  assert.ok(row, "Anna's row");
  const { personBundle } = await import("@/plugins/people/blocks");
  const { personPageData } = await import("@/plugins/people/row-data");
  const { translator } = await import("@/lib/i18n/shared");
  const built = personPageData({ person: await personBundle(anna), error: null, loading: false, wiki: null }, { t: translator("en"), locale: "en" }) as Record<string, unknown>;
  const page = await call<Record<string, unknown>>("people.person", { row: row.id, part: "page" });
  assert.equal(page.ready, true);
  for (const k of ["name", "starred", "profile", "note", "details", "dates", "known", "relations", "contacts", "todos", "tickets"]) assert.deepEqual(page[k], built[k], k);
  assert.equal((page.profile as { emails: string }).emails, "anna@example.org");
  // not a person
  const none = await call<{ ready: boolean }>("people.person", { row: 999999, part: "page" });
  assert.equal(none.ready, false);
  // the profile's lines, the note, a date, a detail, a relation
  const people = await import("@/plugins/people/store");
  let r = await runFlow("people.person-op", { row: row.id, op: "profile", name: "Anna Berg", aliases: "Annie", emails: "anna@example.org, anna@work.example", whatsapp: "", jira: "" });
  assert.equal(r.status, "done", r.error ?? "");
  assert.deepEqual(people.getPerson(anna)?.aliases, ["Annie"]);
  assert.deepEqual(people.getPerson(anna)?.emails, ["anna@example.org", "anna@work.example"]);
  r = await runFlow("people.person-op", { row: row.id, op: "note", note: "Prefers coffee, actually" });
  assert.equal(people.getPerson(anna)?.note, "Prefers coffee, actually");
  r = await runFlow("people.person-op", { row: row.id, op: "addDate", kind: "birthday", date: "16.10.1980", label: "" });
  assert.equal(r.status, "done", r.error ?? "");
  let page2 = await call<{ dates: { id: number; label: string; remindDays: number; confirmed: boolean }[] }>("people.person", { row: row.id, part: "page" });
  assert.equal(page2.dates.length, 1);
  r = await runFlow("people.person-op", { row: row.id, op: "dateRemind", id: page2.dates[0].id, days: 14 });
  page2 = await call("people.person", { row: row.id, part: "page" });
  assert.equal(page2.dates[0].remindDays, 14);
  r = await runFlow("people.person-op", { row: row.id, op: "detail", action: "add", key: "phone", value: "+49 30 1234" });
  r = await runFlow("people.person-op", { row: row.id, op: "addRelation", rel: "friend", other: tom });
  assert.equal(r.status, "done", r.error ?? "");
  const rel = await call<{ relations: { out: { rel: string }[] }; details: { key: string }[] }>("people.person", { row: row.id, part: "page" });
  assert.equal(rel.relations.out[0].rel, "friend");
  assert.equal(rel.details.some((d) => d.key === "phone"), true);
  // the knowledge part without the Knowledge plugin: nothing
  const wiki = await call<{ showWiki: boolean }>("people.person", { row: row.id, part: "wiki" });
  assert.equal(wiki.showWiki, false);
  // a merge: the profile goes, and says where the page goes now
  const tomRow = rawRows(db).find((x) => x.cells.srcref === `person:${tom}`)!;
  r = await runFlow("people.person-op", { row: tomRow.id, op: "merge", keep: anna });
  assert.equal(r.status, "done", r.error ?? "");
  assert.equal((r.output as { gone: boolean }).gone, true);
  assert.ok(String((r.output as { href: string }).href).startsWith("/workspace/"));
  assert.equal(people.getPerson(tom) ?? null, null);
  assert.ok(people.getPerson(anna)?.aliases.includes("Tom Keller"), "its name is an alias of the other now");
});

test("both templates draw without an error", { skip }, async () => {
  const { call, db, anna } = await world();
  const { renderView } = await import("@/plugins/workspace/view-template");
  const dir = repoPlugin("people-ext");
  const people = fs.readFileSync(path.join(dir, "views", "people.html"), "utf8");
  const person = fs.readFileSync(path.join(dir, "views", "person.html"), "utf8");
  const { rawRows } = await import("@/plugins/workspace/store");
  const row = rawRows(db).find((x) => x.cells.srcref === `person:${anna}`)!;
  const screen = await call<Screen>("people.screen", {});
  const base = { rows: [], props: [], titleName: "People", app: {}, db: { id: db, title: "People" }, now: new Date(), locale: "en", current: { id: row.id, title: "Anna Berg", icon: "", cells: {}, createdAt: "", updatedAt: "" } };
  const draw = (tpl: string, data: Record<string, unknown>, state: Record<string, string>) => renderView(tpl, { ...base, state: { ...state }, data } as never);
  for (const state of [{} as Record<string, string>, { tab: "more" }, { adding: "true" }, { todoFor: String(anna) }, { greetFor: String(anna) }, { only: "starred" }]) assert.deepEqual(draw(people, { people: screen, greeting: { draft: "Happy birthday!" } }, state).errors, [], JSON.stringify(state));
  assert.deepEqual(draw(people, {}, {}).errors, [], "while loading");
  // the data loaded with something to check, a meeting and a nudge as the lists have them
  const full = { ...screen, toCheck: 3, confident: 1, running: true, datesProgress: "Searching dates… 1 of 3 · 0 found", compileProgress: "Compiling … 1 of 3", suggestions: { persons: [{ id: 1, name: "X", pages: 3 }], chats: [{ name: "Y", messages: 4 }], error: "", n: 2, any: true }, groups: [{ key: "read", title: "What the AI read", n: 1, items: [{ id: 1, on: "claim", rowId: row.id, person: "Anna Berg", text: "Likes sailing", detail: "“she said so” · 80%", yes: "tool=claim, id=1, action=confirm", no: "tool=claim, id=1, action=reject", yesLabel: "Right", noLabel: "Wrong" }] }], meetings: [{ key: "1-1", rowId: row.id, name: "Anna Berg", title: "Lunch", when: "Mon 12:00", lastMet: "Last met 2 weeks ago", sinceTitle: "Since then", since: [{ ago: "today", text: "Hello" }], owed: [{ mine: true, text: "Send photos", due: "" }], cases: [{ title: "Rent", label: "A1", hasOpen: true, open: 12 }], nothing: false }], nudges: [{ personId: anna, rowId: row.id, name: "Anna Berg", note: "6 weeks without contact · last: Mail", write: "mailto:anna@example.org", icon: "✉" }], upcoming: [{ key: "1", rowId: row.id, title: "Anna's birthday", when: "in 3 days", soon: true }] };
  assert.deepEqual(draw(people, { people: full }, { tab: "more" }).errors, [], "the second tab, full");
  const page = await call<Record<string, unknown>>("people.person", { row: row.id, part: "page" });
  const wiki = await call<Record<string, unknown>>("people.person", { row: row.id, part: "wiki" });
  const pageState = {};
  assert.deepEqual(draw(person, { page, wiki }, pageState).errors, [], "the person's page");
  const wikiFull = { ...wiki, showWiki: true, wikiFull: true, hasWikiMerge: true, wikiMerge: { id: 1, text: "Two entries", label: "Merge" }, wikiPagesTitle: "1 pages", wiki: { summary: "A friend", related: [{ name: "Tom", rels: ["knows"] }], pages: [{ id: "p", title: "Page", space: "S", href: "http://x/y" }], graph: "http://x/graph", error: "", merge: null } };
  assert.deepEqual(draw(person, { page: { ...page, account: { name: "Anna", iban: "DE89370400440532013000", bic: "COBADEFFXXX" }, canPay: true }, wiki: wikiFull }, { ...pageState, transfer: "true", amount: "12" }).errors, [], "with the knowledge and a transfer");
  assert.deepEqual(draw(person, { page: { ready: false, error: "x" } }, pageState).errors, [], "not a person");
});

test("the widgets: each lambda gives what the built-in's widget gives; the buttons are flows", { skip }, async () => {
  const { call, runFlow, anna } = await world();
  const people = await import("@/plugins/people/store");
  const { getSqlite } = await import("@/db");
  getSqlite()
    .prepare("insert into people_claims (person_id, kind, text, evidence, source_ref, confidence, status, direction, due, created_at) values (?, 'commitment', 'Send the photos', 'q', 'm2', 0.9, 'confirmed', 'mine', '2026-01-01', ?)")
    .run(anna, ago(2));
  people.addDate(anna, { kind: "birthday", label: "", day: new Date().getDate(), month: new Date().getMonth() + 1, year: 1980, yearly: true, remindDays: 7, source: "manual", sourceText: "", confirmed: true });
  const { PEOPLE_WIDGETS } = await import("@/plugins/people/widgets");
  const { PERSON_WIDGETS } = await import("@/plugins/people/widgets-person");
  const { PERSON_DETAIL_WIDGETS } = await import("@/plugins/people/widgets-person-more");
  const all = [...PEOPLE_WIDGETS, ...PERSON_WIDGETS, ...PERSON_DETAIL_WIDGETS];
  assert.equal(all.length, 13);
  const dump = JSON.parse(fs.readFileSync(path.join(repoPlugin("people-ext"), "zeff-plugin.json"), "utf8")) as { contributes: { widgets: { id: string; replaces: string; lambda: string; actFlow?: string }[] } };
  assert.deepEqual(dump.contributes.widgets.map((w) => w.replaces).sort(), all.map((w) => w.id).sort(), "every widget of the built-in is declared");
  for (const w of all) {
    const config = { person: "Anna Berg", limit: 10, days: 30, who: "all" };
    const built = JSON.parse(JSON.stringify(await w.data(config)));
    const decl = dump.contributes.widgets.find((x) => x.replaces === w.id)!;
    const port = await call(decl.lambda, { config });
    assert.deepEqual(port, built, w.id);
    assert.equal(!!decl.actFlow, !!w.act, `${w.id}: a flow for its buttons`);
  }
  // a button: "Kept" on a promise
  const owed = (await call<{ items: { id: string }[] }>("people.widget.owed", { config: { who: "all" } })).items;
  assert.ok(owed.length >= 1);
  const r = await runFlow("people.widget-act.owed", { action: "done", payload: { id: owed[0].id }, config: { who: "all" } });
  assert.equal(r.status, "done", r.error ?? "");
  const after = (await call<{ items: { id: string }[] }>("people.widget.owed", { config: { who: "all" } })).items;
  assert.ok(!after.some((x) => x.id === owed[0].id), "the promise is kept");
});

test("what People has you confirm: the lambdas list what the built-in lists, the flows decide, and the built-in's sources stand aside", { skip }, async () => {
  const { call, runFlow, anna } = await world();
  const { getSqlite } = await import("@/db");
  const ins = getSqlite().prepare("insert into people_claims (person_id, kind, text, evidence, source_ref, confidence, status, direction, created_at) values (?, 'fact', ?, 'she said', 'm3', 0.7, 'proposed', '', ?)");
  ins.run(anna, "Plays the cello", ago(1));
  ins.run(anna, "Hates mushrooms", ago(1));
  const { PEOPLE_REVIEW_OWN, PEOPLE_REVIEW } = await import("@/plugins/people/review");
  for (const [short, id] of [["claim", "people-claim"], ["link", "people-link"], ["stale", "people-stale"], ["date", "people-date"], ["followup", "people-followup"]]) {
    const built = JSON.parse(JSON.stringify(await PEOPLE_REVIEW_OWN.find((x) => x.id === id)!.list()));
    assert.deepEqual(await call(`people.review.${short}`, {}), built, id);
    // (the built-in's source lists nothing while the port's are there)
    assert.deepEqual(await PEOPLE_REVIEW.find((x) => x.id === id)!.list(), [], `${id} stands aside`);
  }
  const { reviewSources } = await import("@/lib/review/point");
  const port = reviewSources.all().flatMap((c) => c.impl).find((x) => x.id === "people-ext-claim");
  assert.ok(port, "the port's source is in the review queue");
  const entries = await port!.list();
  assert.equal(entries.length >= 2, true);
  const msg = await port!.act(entries[0].id, "yes");
  assert.equal(typeof msg === "string" || msg === undefined, true);
  const row = getSqlite().prepare("select status from people_claims where id = ?").get(Number(entries[0].id)) as { status: string };
  assert.equal(row.status, "confirmed");
  const r = await runFlow("people.review-act.claim", { item: entries[1].id, action: "no" });
  assert.equal(r.status, "done", r.error ?? "");
  assert.equal((getSqlite().prepare("select status from people_claims where id = ?").get(Number(entries[1].id)) as { status: string }).status, "rejected");
});

test("the rest: the badges of the rows, the days in touch for the Correlations, what runs in the background, open loops on a person's page", { skip }, async () => {
  const { call, anna, db } = await world();
  const { getSqlite } = await import("@/db");
  // badges: the same as the built-in's own, in the registry the port's stand in
  const { PEOPLE_ROW_BADGES_OWN, PEOPLE_ROW_BADGES } = await import("@/plugins/people/badges");
  const own = JSON.parse(JSON.stringify(Object.fromEntries(await PEOPLE_ROW_BADGES_OWN.badges())));
  assert.deepEqual(await call("people.row-badges", {}), own);
  assert.equal((await PEOPLE_ROW_BADGES.badges()).size, 0, "the built-in's stands aside");
  const { rowBadgeSources } = await import("@/plugins/workspace/row-badge-point");
  const port = rowBadgeSources.all().flatMap((c) => c.impl).filter((x) => x.prefix === "person:");
  assert.equal(port.length >= 1, true);
  const viaPort = (await Promise.all(port.map((x) => x.badges()))).flatMap((m) => [...m.keys()]);
  assert.deepEqual(viaPort.sort(), Object.keys(own).sort(), "the same rows get badges");
  // the series: one per person in touch, 1 on a day in touch
  const day = ago(10).slice(0, 10);
  const range = { from: ago(30).slice(0, 10), to: new Date().toISOString().slice(0, 10) };
  const series = await call<{ id: string; kind: string; values: Record<string, number> }[]>("people.series", range);
  const mine = series.find((x) => x.id === `people:${anna}:contact`);
  assert.ok(mine, "Anna's series");
  assert.equal(mine!.kind, "binary");
  assert.equal(Object.values(mine!.values).includes(1), true);
  assert.equal(day.length, 10);
  const { correlationSeries } = await import("@/lib/series/series-point");
  const provider = correlationSeries.all().flatMap((c) => c.impl).find((x) => x.id === "people.contact" && x !== undefined);
  assert.ok(provider);
  const all = (await Promise.all(correlationSeries.all().flatMap((c) => c.impl).filter((x) => x.id === "people.contact").map((x) => x.series(range)))).flat();
  assert.deepEqual(all.map((x) => x.id), series.map((x) => x.id), "the registry gives the port's series once");
  // what runs in the background
  const prog = await call<{ running: boolean }>("people.progress", {});
  assert.equal(prog.running, false);
  // open loops on the page: off without the Open loops plugin, listed with it
  const { rawRows } = await import("@/plugins/workspace/store");
  const row = rawRows(db).find((x) => x.cells.srcref === `person:${anna}`)!;
  const off = await call<{ any: boolean; off: boolean }>("people.person", { row: row.id, part: "loops" });
  assert.equal(off.any, false);
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("loops" as never, true);
  getSqlite()
    .prepare("insert or ignore into people_claims (person_id, kind, text, evidence, source_ref, confidence, status, direction, due, created_at) values (?, 'commitment', 'Call the dentist', 'q', 'm9', 0.9, 'confirmed', 'theirs', '2026-01-02', ?)")
    .run(anna, ago(3));
  const on = await call<{ any: boolean; items: { text: string; ref: string; open: boolean }[] }>("people.person", { row: row.id, part: "loops" });
  assert.equal(on.any, true);
  assert.ok(on.items.some((x) => x.text === "Call the dentist" && x.open));
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const item = on.items.find((x) => x.text === "Call the dentist")!;
  const r = await runFlow("people.loop", { ref: item.ref, op: "close" });
  assert.equal(r.status, "done", r.error ?? "");
  assert.equal((r.output as { ok: boolean }).ok, true);
  const after = await call<{ items: { text: string; open: boolean }[] }>("people.person", { row: row.id, part: "loops" });
  assert.equal(after.items.find((x) => x.text === "Call the dentist")?.open ?? false, false);
  // the templates with these
  const { renderView } = await import("@/plugins/workspace/view-template");
  const dir = repoPlugin("people-ext");
  const person = fs.readFileSync(path.join(dir, "views", "person.html"), "utf8");
  const page = await call<Record<string, unknown>>("people.person", { row: row.id, part: "page" });
  const v = renderView(person, { rows: [], props: [], titleName: "P", app: {}, db: { id: db, title: "People" }, now: new Date(), locale: "en", state: {}, data: { page, loops: on }, current: { id: row.id, title: "Anna", icon: "", cells: {}, createdAt: "", updatedAt: "" } } as never);
  assert.deepEqual(v.errors, []);
});

test("the switch puts the screens in place: the overview and the person's page are the plugin's, and stay when the workspace opens", { skip }, async () => {
  const { db, anna } = await world();
  const { switchPeopleScreensToPlugin } = await import("@/plugins/people/to-plugin");
  assert.deepEqual(await switchPeopleScreensToPlugin(), { db });
  const { getDatabase } = await import("@/plugins/workspace/store");
  const d = getDatabase(db)!;
  assert.ok(d.schema.views.some((v) => v.type === "app" && v.app === "template" && /people\.screen/.test(v.template ?? "")), "the overview is the plugin's");
  assert.ok(!d.schema.views.some((v) => v.type === "app" && v.app === "people"), "the built-in's overview is gone");
  assert.ok(/people\.person/.test(d.schema.rowTemplate ?? ""), "the person's page is the plugin's");
  const { rowViewFor } = await import("@/plugins/workspace/row-views");
  assert.equal(rowViewFor(d.schema)?.id, "detail");
  const { ensurePeopleDatabase } = await import("@/plugins/workspace/people-database");
  await ensurePeopleDatabase();
  assert.equal(getDatabase(db)!.schema.views.filter((v) => v.type === "app").length, d.schema.views.filter((v) => v.type === "app").length, "not made again");
  assert.ok(anna);
  // What Zeff keeps is what is drawn: the stored overview and the stored person page (a rowTemplate is cut at 20000 characters — a longer page lost its end) draw without an error
  const { renderView } = await import("@/plugins/workspace/view-template");
  const stored = getDatabase(db)!.schema;
  assert.ok((stored.rowTemplate ?? "").length >= fs.readFileSync(path.join(repoPlugin("people-ext"), "views", "person.html"), "utf8").length - 2, "the whole page is kept");
  const { rawRows } = await import("@/plugins/workspace/store");
  const row = rawRows(db).find((x) => x.cells.srcref === `person:${anna}`)!;
  const { call } = await world();
  const page = await call<Record<string, unknown>>("people.person", { row: row.id, part: "page" });
  const screen = await call<Record<string, unknown>>("people.screen", {});
  const base = { rows: [], props: [], titleName: "People", app: {}, db: { id: db, title: "People" }, now: new Date(), locale: "de-DE", state: {} };
  assert.deepEqual(renderView(stored.rowTemplate!, { ...base, data: { page, wiki: {}, loops: {} }, current: { id: row.id, title: "Anna", icon: "", cells: {}, createdAt: "", updatedAt: "" } } as never).errors, [], "the stored person page");
  const view = stored.views.find((v) => v.type === "app" && v.app === "template")!;
  assert.deepEqual(renderView(view.template!, { ...base, data: { people: screen, prog: {} } } as never).errors, [], "the stored overview");
  // (and the plugin's files are within what Zeff keeps)
  assert.ok(fs.readFileSync(path.join(repoPlugin("people-ext"), "views", "person.html"), "utf8").length < 20000);
});
