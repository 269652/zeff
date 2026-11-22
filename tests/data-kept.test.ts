import assert from "node:assert/strict";
import test from "node:test";
import { nodeKey, type VNode } from "../src/plugins/workspace/card-template";
import type { Property, Row } from "../src/plugins/workspace/model";
import { forgetKept, keepAnswer, keptAnswer, onlyHeldChanged, preloadsOf } from "../src/plugins/workspace/ui/data-kept";
import { renderView, type ViewData } from "../src/plugins/workspace/view-template";

const data = (d: Record<string, unknown>): ViewData => ({ rows: [] as Row[], props: [] as Property[], titleName: "Name", state: {}, app: {}, data: d, db: { id: 1, title: "T" }, now: new Date("2026-11-22T10:00:00") }) as ViewData;
const find = (nodes: VNode[], t: string): Extract<VNode, object>[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [...(n.t === t ? [n] : []), ...find(n.c, t)]));

test("answers kept per input: the one asked again comes back, the oldest goes first", () => {
  forgetKept();
  keepAnswer("a", { n: 1 });
  keepAnswer("b", null);
  assert.deepEqual(keptAnswer("a"), { n: 1 });
  assert.equal(keptAnswer("b"), null);
  assert.equal(keptAnswer("c"), undefined);
  for (let i = 0; i < 100; i++) keepAnswer(`x${i}`, i);
  assert.equal(keptAnswer("a"), undefined);
  assert.equal(keptAnswer("x99"), 99);
});

test("hold=: only a held input changed keeps the answer on screen", () => {
  assert.equal(onlyHeldChanged({ scope: "open", filter: "" }, { scope: "open", filter: "ab" }, "filter, chips"), true);
  assert.equal(onlyHeldChanged({ scope: "open", filter: "" }, { scope: "done", filter: "" }, "filter"), false);
  assert.equal(onlyHeldChanged({ scope: "open" }, { scope: "done" }, undefined), false);
  assert.equal(onlyHeldChanged(null, { filter: "x" }, "filter"), false);
});

test("preload=: the other values of an input, at most six", () => {
  assert.deepEqual(preloadsOf("scope=open|done| worker"), [{ name: "scope", value: "open" }, { name: "scope", value: "done" }, { name: "scope", value: "worker" }]);
  assert.equal(preloadsOf("a=1|2|3|4; b=5|6|7|8").length, 6);
  assert.deepEqual(preloadsOf("nonsense"), []);
});

const TPL = "{{#if data.x.rows}}{{#each data.x.rows}}<text>{{ title }}</text>{{/each}}{{#else}}<text>none</text>{{/if}}";

test("a <data> loading for new inputs: its {{#if}}…{{#else}} and {{#each}} show the kit's loader, never 'none'", () => {
  const r = renderView(TPL, data({ x: null, x_loading: true, x_status: "loading" }));
  assert.deepEqual(r.errors, []);
  assert.equal(find(r.nodes, "loading").length, 1);
  assert.equal(find(r.nodes, "text").length, 0);
  const each = renderView("{{#each data.x.rows}}<text>{{ title }}</text>{{/each}}", data({ x: null, x_loading: true }));
  assert.equal(find(each.nodes, "loading").length, 1);
  // (No else: nothing — a second loader would be one too many.)
  assert.equal(find(renderView("{{#if data.x.n}}<text>n</text>{{/if}}", data({ x: null, x_loading: true })).nodes, "loading").length, 0);
  // (A condition that reads _last / _loading decides by itself.)
  assert.equal(find(renderView("{{#if not data.x_last}}<text>first</text>{{#else}}<text>{{ data.x_last.n }}</text>{{/if}}", data({ x: null, x_loading: true, x_last: { n: 3 } })).nodes, "loading").length, 0);
  // (Its answer in: as before.)
  const done = renderView(TPL, data({ x: { rows: [] }, x_loading: false }));
  assert.deepEqual(find(done.nodes, "text").map((n) => n.c.join("")), ["none"]);
  assert.equal(find(renderView("<loading/>", data({})).nodes, "loading").length, 1);
});

test("{{#each}} over items with an id: each item's nodes keyed by it — a newer answer keeps a row's place", () => {
  const r = renderView("{{#each data.x.rows}}<text>{{ title }}</text>{{/each}}", data({ x: { rows: [{ id: 7, title: "a" }, { id: 9, title: "b" }, { title: "no id" }] } }));
  const texts = find(r.nodes, "text");
  assert.equal(texts.length, 3);
  const [k1, k2, k3] = texts.map((n) => nodeKey(n));
  assert.match(String(k1), /:7:0$/);
  assert.match(String(k2), /:9:0$/);
  assert.equal(k3, undefined);
});
