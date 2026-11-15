import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * An update merged per field and line (plugins/workspace/merge-parts.ts, docs/zeff-kernel.md): what only the update changed comes in,
 * what only you changed stays, where both changed the same thing yours stays and the spot is named — fields, views and flow steps
 * matched by their ids, a page's text block by block.
 */

test("one value, an object, a list by ids", async () => {
  const { merge3, mergeById } = await import("@/plugins/workspace/merge-parts");
  assert.deepEqual(merge3(1, 1, 2, "x"), { value: 2, conflicts: [], took: ["x"] });
  assert.deepEqual(merge3(1, 3, 1, "x"), { value: 3, conflicts: [], took: [] });
  assert.deepEqual(merge3(1, 3, 2, "x"), { value: 3, conflicts: [{ where: "x", path: [], base: 1, mine: 3, theirs: 2 }], took: [] }, "a conflict carries its three sides");
  // Objects: inside, key by key.
  assert.deepEqual(merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 }, "o").value, { a: 2, b: 3 });
  const base = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
  const mine = [{ id: "b", name: "B" }, { id: "a", name: "Mine" }, { id: "c", name: "C changed" }, { id: "m", name: "My own" }];
  const theirs = [{ id: "a", name: "A" }, { id: "n", name: "New" }, { id: "b", name: "B2" }];
  const r = mergeById(base, mine, theirs, "fields");
  // b updated, a stays mine, c (dropped by the update, changed by me) stays as a conflict, m stays, n added after a (where the update has it).
  assert.deepEqual(r.value.map((x) => x.name), ["B2", "Mine", "New", "C changed", "My own"]);
  assert.equal(r.conflicts.length, 1);
  assert.match(r.conflicts[0].where, /C/);
  assert.deepEqual([r.conflicts[0].path, r.conflicts[0].removed, r.conflicts[0].theirs], [[{ id: "c" }], true, undefined], "where it is: the item by its id");
  // Deep inside: the path names each key and each item by its id.
  const deep = merge3({ views: [{ id: "v", template: "a" }] }, { views: [{ id: "v", template: "b" }] }, { views: [{ id: "v", template: "c" }] }, "schema");
  assert.deepEqual(deep.conflicts[0].path, ["views", { id: "v" }, "template"]);
});

test("a page's text: block by block", async () => {
  const { mergeDoc } = await import("@/plugins/workspace/merge-parts");
  const p = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
  const base = { content: [p("one"), p("two"), p("three")] };
  const mine = { content: [p("ONE (mine)"), p("two"), p("three")] };
  const theirs = { content: [p("one"), p("two"), p("three (new)"), p("four")] };
  const r = await mergeDoc(base, mine, theirs, "text");
  assert.deepEqual(r.value.content, [p("ONE (mine)"), p("two"), p("three (new)"), p("four")]);
  assert.deepEqual(r.conflicts, []);
  const both = await mergeDoc(base, { content: [p("mine"), p("two"), p("three")] }, { content: [p("theirs"), p("two"), p("three")] }, "text");
  assert.deepEqual(both.value.content, [p("mine"), p("two"), p("three")], "both changed the same block: yours stays");
  assert.equal(both.conflicts.length, 1);
});

test("an app update: your changes stay, the update's come in, both on one thing: yours, said", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  const w = await import("@/plugins/workspace/store");
  const life = await import("@/plugins/workspace/package-life");
  const flows = await import("@/plugins/workspace/flows/store");
  const p = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
  const doc = (...t: string[]) => ({ type: "doc", content: t.map(p) });
  const view = { id: "all", name: "All", type: "table", filter: { and: [] }, sorts: [], hidden: [] };
  const pkg = (version: string, props: unknown[], text: string[], nodes: unknown[]) => ({
    format: 1 as const,
    id: "mergeapp",
    name: "Merge app",
    version,
    items: [
      { id: "i1", kind: "page", title: "Merge app", content: doc(...text) },
      { id: "i2", parent: "i1", kind: "database", title: "Items", schema: { titleName: "Name", properties: props, views: [view] } },
      { id: "i3", parent: "i1", kind: "page", title: "Go", flow: { name: "mergeapp.go", title: "Go", nodes, permissions: {} } },
    ],
  });
  const n = (id: string, template: string) => ({ id, kind: "action", action: "text.template", input: { template } });
  await life.installTracked(pkg("1.0.0", [{ id: "a", name: "Colour", type: "text" }, { id: "b", name: "Size", type: "text" }], ["Intro", "Middle", "End"], [n("s1", "one"), n("s2", "two")]) as never, null);
  const inst = life.getInstalled("mergeapp")!;
  const [root, db, flowPage] = [inst.map.i1, inst.map.i2, inst.map.i3];

  // Yours: the first field renamed, a field of your own, the intro rewritten, the first step changed.
  const s = w.getDatabase(db)!.schema;
  w.updateSchema(db, { ...s, properties: [...s.properties.map((x) => (x.id === "a" ? { ...x, name: "Farbe" } : x)), { id: "mine", name: "Notes", type: "text" } as never] });
  w.updatePage(root, { content: doc("My intro", "Middle", "End") as never });
  const f = flows.getFlow(flowPage)!;
  flows.saveFlow(flowPage, { ...f, nodes: f.nodes.map((x) => (x.id === "s1" ? (n("s1", "mine") as never) : x)) });

  // The update: the first field renamed too (both!), the second one's type changed, a field added; the end rewritten, a paragraph
  // added; a step added.
  const r = await life.updateTracked("mergeapp", pkg("2.0.0", [{ id: "a", name: "Hue", type: "text" }, { id: "b", name: "Size", type: "number" }, { id: "c", name: "Price", type: "number" }], ["Intro", "Middle", "The end", "PS"], [n("s1", "one"), n("s2", "two"), n("s3", "three")]) as never);

  const props = w.getDatabase(db)!.schema.properties;
  assert.equal(props.find((x) => x.id === "a")!.name, "Farbe", "both renamed it: yours stays");
  assert.equal(props.find((x) => x.id === "b")!.type, "number", "only the update changed it: it comes in");
  assert.ok(props.some((x) => x.id === "c"), "a field the update adds");
  assert.ok(props.some((x) => x.id === "mine"), "a field of your own");
  const text = JSON.stringify(w.getPage(root)!.content);
  assert.match(text, /My intro/);
  assert.match(text, /The end/);
  assert.match(text, /PS/);
  const steps = flows.getFlow(flowPage)!.nodes as { id: string; input?: { template?: string } }[];
  assert.deepEqual(steps.map((x) => [x.id, x.input?.template]), [["s1", "mine"], ["s2", "two"], ["s3", "three"]]);
  assert.equal(r.conflicts?.length, 1);
  assert.match(r.conflicts![0], /name/);
});


test("a text of lines both changed: merged line by line, as git does — only the same lines changed on both sides conflict", async () => {
  const { merge3, mergeLines } = await import("@/plugins/workspace/merge-parts");
  const L = (...xs: string[]) => xs.join("\n");
  const base = L("<header/>", "<list source=rows>", "{{ title }}", "</list>", "<footer/>");
  const mine = L("<header title=Mine/>", "<list source=rows>", "{{ title }}", "</list>", "<footer/>");
  const theirs = L("<header/>", "<list source=rows>", "{{ title }}", "</list>", "<footer/>", "<qr value=x/>");
  const r = merge3({ template: base }, { template: mine }, { template: theirs }, "view");
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.value.template, L("<header title=Mine/>", "<list source=rows>", "{{ title }}", "</list>", "<footer/>", "<qr value=x/>"));
  const both = mergeLines(base, mine, L("<header title=Theirs/>", "<list source=rows>", "{{ title }}", "</list>", "<footer/>"));
  assert.equal(both.conflicts, 1);
  assert.deepEqual(both.hunks[0], { base: ["<header/>"], mine: ["<header title=Mine/>"], theirs: ["<header title=Theirs/>"] });
  assert.ok(both.marked.startsWith(L("<<<<<<< mine", "<header title=Mine/>", "||||||| base", "<header/>", "=======", "<header title=Theirs/>", ">>>>>>> theirs", "<list source=rows>")));
  // The same change on both sides: once.
  assert.deepEqual(mergeLines(L("a", "b"), L("a", "B"), L("a", "B")), { text: L("a", "B"), conflicts: 0, hunks: [], marked: L("a", "B") });
});

test("the update waits for you where both changed: each spot settled (yours, theirs, your own), then finished — or aborted", async () => {
  const w = await import("@/plugins/workspace/store");
  const life = await import("@/plugins/workspace/package-life");
  const pm = await import("@/plugins/workspace/package-merge");
  const L = (...xs: string[]) => xs.join("\n");
  const inst = life.getInstalled("mergeapp")!;
  const db = inst.map.i2;
  // The update before left one spot open: the field both renamed.
  let m = pm.pendingAppMerge("mergeapp")!;
  assert.equal(m.spots.length, 1);
  const spot = m.spots[0];
  assert.deepEqual([spot.part, spot.path, spot.base, spot.mine, spot.theirs], ["schema", ["properties", { id: "a" }, "name"], "Colour", "Farbe", "Hue"]);
  assert.equal(pm.pendingMergeOfPage(db)?.id, "mergeapp", "found from any page of the app");
  // While it is open, no next update.
  const view = { id: "all", name: "All", type: "table", filter: { and: [] }, sorts: [], hidden: [] };
  const next = (version: string, name: string, template: string) => ({ format: 1 as const, id: "mergeapp", name: "Merge app", version, items: [{ id: "i2", parent: "i1", kind: "database", title: "Items", schema: { titleName: "Name", properties: [{ id: "a", name, type: "text" }, { id: "b", name: "Size", type: "number" }, { id: "c", name: "Price", type: "number" }], views: [{ ...view, app: "template", template }] } }] });
  await assert.rejects(() => life.updateTracked("mergeapp", next("3.0.0", "Hue", "x") as never), /still waits for you/);
  await assert.rejects(() => pm.finishAppMerge("mergeapp"), /Still open: 1/);
  assert.throws(() => pm.settleSpot("mergeapp", 1, "both"), /page's text/);
  pm.settleSpot("mergeapp", 1, "theirs");
  const done = await pm.finishAppMerge("mergeapp");
  assert.equal(done.applied.length, 1);
  assert.equal(w.getDatabase(db)!.schema.properties.find((x) => x.id === "a")!.name, "Hue", "the update's, as you chose");
  assert.equal(pm.pendingAppMerge("mergeapp"), null);
  assert.match(life.getInstalled("mergeapp")!.history.at(-1)!.changes[0], /merge finished/);

  // 3.0.0 brings a view with a template; you change its first line, 4.0.0 changes the same line and adds one.
  await life.updateTracked("mergeapp", next("3.0.0", "Hue", L("<header/>", "<list source=rows>{{ title }}</list>")) as never);
  const s0 = w.getDatabase(db)!.schema;
  w.updateSchema(db, { ...s0, views: s0.views.map((v) => (v.id === "all" ? { ...v, template: L("<header title=Mine/>", "<list source=rows>{{ title }}</list>") } : v)) as never });
  const r = await life.updateTracked("mergeapp", next("4.0.0", "Hue", L("<header title=Theirs/>", "<list source=rows>{{ title }}</list>", "<qr value=x/>")) as never);
  assert.equal(r.merge?.open, 1);
  m = pm.pendingAppMerge("mergeapp")!;
  assert.match(m.spots[0].marked!, /<<<<<<< mine/);
  assert.throws(() => pm.settleSpot("mergeapp", 1, "edited", L("<<<<<<< mine", "x")), /markers/);
  pm.settleSpot("mergeapp", 1, "edited", L("<header title=Both/>", "<list source=rows>{{ title }}</list>", "<qr value=x/>"));
  await pm.finishAppMerge("mergeapp");
  assert.equal((w.getDatabase(db)!.schema.views.find((v) => v.id === "all") as { template?: string }).template, L("<header title=Both/>", "<list source=rows>{{ title }}</list>", "<qr value=x/>"));

  // 5.0.0 conflicts again — aborted: the whole app back to before the update, its version too.
  const s1 = w.getDatabase(db)!.schema;
  w.updateSchema(db, { ...s1, properties: s1.properties.map((x) => (x.id === "a" ? { ...x, name: "Tint" } : x)) });
  await life.updateTracked("mergeapp", next("5.0.0", "Shade", L("<header title=Both/>", "<list source=rows>{{ title }}</list>", "<qr value=x/>")) as never);
  assert.equal(pm.pendingAppMerge("mergeapp")!.spots.length, 1);
  assert.equal(w.getDatabase(db)!.schema.properties.find((x) => x.id === "a")!.name, "Tint", "yours stands while it is open");
  const ab = await pm.abortAppMerge("mergeapp");
  assert.equal(ab.to, "4.0.0");
  assert.equal(life.getInstalled("mergeapp")!.version, "4.0.0");
  assert.equal(w.getDatabase(db)!.schema.properties.find((x) => x.id === "a")!.name, "Tint", "as it was before the update");
  assert.equal(pm.pendingAppMerge("mergeapp"), null);
});

test("a spot's place is found again by its path; one that isn't there any more is said, not guessed", async () => {
  const { setAt } = await import("@/plugins/workspace/package-merge");
  const root = { properties: [{ id: "a", name: "A" }, { id: "b", name: "B" }], titleName: "N" };
  assert.deepEqual(setAt(root, ["properties", { id: "b" }, "name"], "B2"), { properties: [{ id: "a", name: "A" }, { id: "b", name: "B2" }], titleName: "N" });
  assert.deepEqual(setAt(root, ["properties", { id: "a" }], undefined), { properties: [{ id: "b", name: "B" }], titleName: "N" });
  assert.equal(setAt(root, ["properties", { id: "zz" }, "name"], "x"), null);
  assert.equal(root.properties[1].name, "B", "the part itself is not changed");
});
