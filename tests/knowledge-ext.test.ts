import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";

setupTempData();

/**
 * Knowledge's port (zeff-plugins/plugins/knowledge-ext) against a stand-in for the knowledge server on this machine: the screen's state, the chat
 * (a question about text goes to the server, the conversation is kept by the flow), reading and adding through the kernel's `service.send`,
 * and the matching of the knowledge's pages to the open todos by the lambda `knowledge.match` and the flow `knowledge.relate` (a fake AI picks).
 */

const skip = skipWithoutRepo("knowledge-ext");
const result = (r: unknown): unknown => (r as { result?: unknown }).result;
const calls: { method: string; url: string; auth: string; body: unknown }[] = [];

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method: req.method ?? "", url: req.url ?? "", auth: String(req.headers.authorization ?? ""), body });
    const out = (v: unknown, status = 200) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(v)));
    const url = req.url ?? "";
    if (url === "/api/status") return out({ counts: { pages: 10, compiled: 8, chunks: 40, entities: 5, relations: 7, spaces: 2 }, confluence: "https://wiki.example.com", running: { sync: false, compile: true }, runs: [{ id: 1, kind: "sync", started_at: "2026-11-14T08:00:00.000Z", finished_at: null, ok: 1, message: null }] });
    if (url === "/api/ask") return out({ answer: "Per Pipeline [1].", sources: [{ n: 1, title: "Deploy", url: "https://wiki.example.com/deploy", heading: "Test", excerpt: "…" }], entities: [{ id: 1, name: "Pipeline", type: "system", summary: "CI", aliases: [], pages: 1, related: [] }], searchedFor: "deploy", model: null, durationMs: 5 });
    if (url === "/api/related")
      return out({
        pages: [
          { id: "conf:1", title: "Login einrichten", space: "TECH", url: "", summary: "So geht der Login", snippet: "Login", heading: "", score: 1, updatedAt: null },
          { id: "zeff:todo:999", title: "ein Todo", space: "Zeff · Todos", url: "", summary: null, snippet: "", heading: "", score: 1, updatedAt: null },
        ],
        entities: [],
      });
    if (url.startsWith("/api/sync")) return out({ started: true });
    if (url === "/api/own") return out({ id: "own:1", entry: { id: "own:1", title: "Mein Fakt" } });
    out({ error: "not found" }, 404);
  });
});
test.before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.KNOWLEDGE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.KNOWLEDGE_TOKEN = "zk_test_token";
});
test.after(() => server.close());

let ready: Promise<void> | null = null;
const setup = () => (ready ??= setupOnce());
async function setupOnce() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-knowledge-ext-"));
  process.env.ZEFF_PLUGINS_DIR = dir;
  fs.cpSync(repoPlugin("knowledge-ext"), path.join(dir, "knowledge-ext"), { recursive: true });
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos", "llm", "claude-cli", "knowledge"]) setInstalled(id as never, true);
  setInstalled("questions" as never, false); // (a question about text: no structured plan to try first)
  await import("@/plugins/contributions");
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  reg.setEnabled("knowledge-ext", true);
  const life = await import("@/plugins/workspace/package-life");
  const pkg = await life.offeredPackage("knowledge-ext");
  assert.ok(pkg, "the plugin brings its package");
  await life.installTracked(pkg!, null, { allow: true });
}

test("the screen's state, the chat kept by its flow, reading and adding — through the kernel's service calls with the token", { skip }, async () => {
  await setup();
  const { invokeLambda } = await import("@/plugins/workspace/lambdas/run");
  const { runFlow } = await import("@/plugins/workspace/flows/engine");

  const screen = await invokeLambda("knowledge.screen", {});
  assert.ok(screen.ok, screen.ok ? "" : screen.error);
  const s = result(screen) as { ok: boolean; counts: { label: string; n: number }[]; notCompiled: string; busy: boolean; last: string };
  assert.equal(s.ok, true);
  assert.deepEqual(s.counts.map((c) => c.n), [10, 2, 5, 7]);
  assert.equal(s.notCompiled, "2 not compiled yet");
  assert.equal(s.busy, true);
  assert.match(s.last, /^Last read /);
  assert.equal(calls.find((c) => c.url === "/api/status")?.auth, "Bearer zk_test_token", "the token Zeff holds for this account goes along");

  // (no structured-questions plugin: the question is a text one — the server answers)
  const asked = await runFlow("knowledge.ask", { question: "Wie deploye ich?" });
  assert.equal(asked.status, "done", asked.error ?? undefined);
  const turns = (asked.output as { turns: { mine: boolean; text: string; sources: { n: number; url: string }[]; entities: { name: string }[] }[] }).turns;
  assert.equal(turns.length, 2);
  assert.equal(turns[0].mine, true);
  assert.equal(turns[1].text, "Per Pipeline [1].");
  assert.equal(turns[1].sources[0].url, "https://wiki.example.com/deploy");
  assert.equal(turns[1].entities[0].name, "Pipeline");
  const chat = await invokeLambda("knowledge.chat", {});
  assert.equal((result(chat) as { turns: unknown[] }).turns.length, 2, "the conversation is kept");
  await runFlow("knowledge.ask", { question: "Und dann?" });
  const second = calls.filter((c) => c.url === "/api/ask").at(-1)!.body as { history: { role: string }[] };
  assert.equal(second.history.length, 2, "the server gets the conversation so far");
  await runFlow("knowledge.chat-new", {});
  assert.equal((result(await invokeLambda("knowledge.chat", {})) as { turns: unknown[] }).turns.length, 0);

  const sync = await runFlow("knowledge.sync", {});
  assert.equal(sync.status, "done", sync.error ?? undefined);
  assert.ok(calls.some((c) => c.method === "POST" && c.url === "/api/sync?compile=1"));
  const add = await runFlow("knowledge.add", { text: "Mein Fakt" });
  assert.equal(add.status, "done", add.error ?? undefined);
  assert.deepEqual(calls.filter((c) => c.url === "/api/own").at(-1)!.body, { text: "Mein Fakt" });
  assert.equal((add.output as { title: string }).title, "Mein Fakt");
});

test("the plugin's own address and token win; an address off this machine is refused", { skip }, async () => {
  await setup();
  const { saveSettings } = await import("@/lib/ext/plugin-settings");
  const setPluginSettings = (id: string, m: Parameters<typeof saveSettings>[1], v: Record<string, unknown>) => saveSettings(id, m, v, Object.entries(v).filter(([, x]) => x === "").map(([k]) => k));
  const reg = await import("@/lib/ext/registry");
  const p = reg.getPlugin("knowledge-ext")!;
  setPluginSettings("knowledge-ext", p.manifest, { serviceUrl: "http://example.com:9555", serviceToken: "mine" });
  const { invokeLambda } = await import("@/plugins/workspace/lambdas/run");
  const r = await invokeLambda("knowledge.screen", {});
  assert.ok(r.ok);
  assert.equal((result(r) as { ok: boolean }).ok, false);
  assert.match((result(r) as { error: string }).error, /local|isn't an address on this machine/);
  setPluginSettings("knowledge-ext", p.manifest, { serviceUrl: process.env.KNOWLEDGE_URL!, serviceToken: "mine" });
  assert.equal((result(await invokeLambda("knowledge.screen", {})) as { ok: boolean }).ok, true);
  assert.equal(calls.filter((c) => c.url === "/api/status").at(-1)!.auth, "Bearer mine", "the plugin's token, not the account's");
  setPluginSettings("knowledge-ext", p.manifest, { serviceUrl: "", serviceToken: "" });
});

test("the matching: due todos get the pages that fit, the AI's picks kept on the todo; the todo itself and the others are no knowledge", { skip }, async () => {
  await setup();
  const { getDb, schema } = await import("@/db");
  const now = new Date().toISOString();
  const row = (text: string, ticket = "") => getDb().insert(schema.todos).values({ ticket, text, kind: "other", owner: "me", status: "open", source: "test", refs: "[]", ops: "[]", planned: "[]", createdAt: now, updatedAt: now }).returning({ id: schema.todos.id }).get().id;
  const a = row("Login auf dem Testsystem einrichten");
  process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ todos: [{ id: a, pages: [{ id: "conf:1", why: "Wie der Login eingerichtet wird" }, { id: "erfunden", why: "x" }], entities: [], links: [] }] });
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });

  const { invokeLambda } = await import("@/plugins/workspace/lambdas/run");
  const m = await invokeLambda("knowledge.match", {});
  assert.ok(m.ok, m.ok ? "" : m.error);
  const r = result(m) as { items: { id: number; value: { pages: { id: string; why: string }[] } }[]; todos: number; assigned: number; failed: number };
  assert.equal(r.todos, 1);
  assert.equal(r.failed, 0);
  assert.deepEqual(r.items[0].value.pages.map((p) => [p.id, p.why]), [["conf:1", "Wie der Login eingerichtet wird"]], "only a candidate the AI picked; nothing invented");
  assert.equal(getDb().select({ k: schema.todos.knowledge }).from(schema.todos).get()?.k ?? null, null, "a lambda writes nothing");

  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const flow = await runFlow("knowledge.relate", {});
  assert.equal(flow.status, "done", flow.error ?? undefined);
  assert.equal((flow.output as { assigned: number }).assigned, 1);
  const { parseTodoKnowledge } = await import("@/plugins/knowledge/shared");
  const kept = parseTodoKnowledge(getDb().select({ k: schema.todos.knowledge }).from(schema.todos).get()?.k);
  assert.equal(kept?.pages.length, 1);
  assert.equal(kept?.pages[0].why, "Wie der Login eingerichtet wird");
  // (nothing changed since: not due again)
  const again = result(await invokeLambda("knowledge.match", {})) as { todos: number };
  assert.equal(again.todos, 0);
  // (the kernel's step asks the port's flow while the plugin stands in for the built-in)
  const { setInstalled, onlyThroughPort } = await import("@/plugins/state");
  setInstalled("knowledge" as never, false);
  assert.equal(onlyThroughPort("knowledge" as never), true);
  const { relateKnowledge } = await import("@/plugins/knowledge/relations");
  assert.deepEqual(await relateKnowledge(), { ok: true, todos: 0, assigned: 0 });
});

test("a service of this account only: the public web and unknown names are refused", { skip }, async () => {
  await setup();
  const { flowAction } = await import("@/plugins/workspace/flows/actions");
  const read = flowAction("service.read")!;
  const ctx = { flow: "t", runId: null, dryRun: false, perms: {}, web: async () => new URL("http://x"), canWrite: () => undefined, may: () => undefined, log: () => undefined } as never;
  await assert.rejects(async () => read.run({ service: "nope", path: "/api/status" }, ctx), /no service/);
  await assert.rejects(async () => read.run({ service: "knowledge", path: "//evil" }, ctx), /single/);
  const send = flowAction("service.send")!;
  await assert.rejects(async () => send.run({ service: "knowledge", path: "/api/sync" }, { ...(ctx as object), may: () => { throw new Error("no api"); } } as never), /no api/);
});

test("the page draws without an error: the state, a conversation with its sources, how it was computed, an error", { skip }, async () => {
  const { renderView } = await import("../src/plugins/workspace/view-template");
  const { vnodeToString } = await import("../src/plugins/workspace/card-template");
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("knowledge-ext"), "knowledge.package.json"), "utf8")) as { items: { kind: string; schema?: { views: { template: string }[] } }[] };
  const template = pkg.items.find((i) => i.kind === "database")!.schema!.views[0].template;
  const draw = (data: Record<string, unknown>, state: Record<string, string> = {}) => renderView(template, { rows: [], props: [], titleName: "Chat", state, app: {}, data, db: { id: 7, title: "Chat" }, now: Date.now(), locale: "de-DE" } as never, { parts: [], actions: [] });
  const ok = { ok: true, counts: [{ label: "Pages", n: 10 }, { label: "Spaces", n: 2 }, { label: "Entities", n: 5 }, { label: "Relations", n: 7 }], notCompiled: "2 not compiled yet", confluence: "https://wiki.example.com", last: "Last read 14.11.", busy: false };
  const turns = [
    { mine: true, text: "Wie viel Arbeitszeit?" },
    { mine: false, text: "Per Pipeline [1].", sources: [{ n: 1, title: "Deploy", url: "https://wiki.example.com/deploy", heading: "Test" }], entities: [{ name: "Pipeline", type: "system", tip: "CI" }], queries: [{ explain: "time sum", total: "12", rows: 3, groups: [{ key: "Mai", value: "5", count: 1 }], more: 2 }] },
  ];
  const a = draw({ k: ok, chat: { turns }, asked: { error: "Nope" } });
  assert.deepEqual(a.errors, []);
  const text = vnodeToString(a.nodes);
  for (const w of ["Per Pipeline", "Deploy", "How it was computed", "time sum", "not compiled yet", "Nope", "Read Confluence now"]) assert.ok(text.includes(w), w);
  const none = draw({ k: { ok: false, error: "The service at http://127.0.0.1:9555 isn't answering — is it running?" }, chat: { turns: [] } });
  assert.deepEqual(none.errors, []);
  assert.match(vnodeToString(none.nodes), /isn't answering/);
  assert.doesNotMatch(vnodeToString(none.nodes), /Read Confluence now/);
});

test("the switch: the plugin on, its Chat page found for the menu, the built-in off and standing in through its port", { skip }, async () => {
  await setup();
  const { setInstalled, onlyThroughPort, isInstalled } = await import("@/plugins/state");
  setInstalled("knowledge" as never, true);
  const { switchKnowledgeToPlugin } = await import("@/plugins/knowledge/to-plugin");
  const r = await switchKnowledgeToPlugin();
  assert.ok(r.page, "the Chat page of the package");
  const { getPref } = await import("@/lib/prefs");
  assert.equal(getPref("knowledge.chatPage", null), r.page);
  assert.equal(onlyThroughPort("knowledge" as never), true);
  assert.equal(isInstalled("knowledge" as never), true, "it counts as there: the export, the todo panel and the menu go on");
});
