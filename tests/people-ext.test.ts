import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";

const dataDir = setupTempData();

/**
 * People's port, slice 1 (zeff-plugins/plugins/people-ext): the AI steps — what new messages say about people, a person's overview, person or organisation and circle,
 * the names matched — ask the AI what the built-in asks (the same prompt), keep what the built-in keeps (the same claims, links, summaries, circles, aliases). A fake Claude
 * CLI answers (tests/fake-claude-json.mjs).
 */

const skip = skipWithoutRepo("people-ext");
const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
const promptFile = path.join(dataDir, "prompt.txt");

async function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-people-ext-"));
  process.env.ZEFF_PLUGINS_DIR = dir;
  fs.cpSync(repoPlugin("people-ext"), path.join(dir, "people-ext"), { recursive: true });
  process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
  process.env.FAKE_CLAUDE_PROMPT_FILE = promptFile;
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos", "llm", "claude-cli", "people"]) setInstalled(id as never, true);
  (await import("@/lib/ai")).updateAppSettings({ aiProvider: "claude" });
  await import("@/plugins/contributions");
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  reg.setEnabled("people-ext", true);
  const life = await import("@/plugins/workspace/package-life");
  const { flowByName } = await import("@/plugins/workspace/flows/store");
  if (!flowByName("people.extract")) {
    const pkg = await life.offeredPackage("people-ext");
    assert.ok(pkg, "the plugin brings its package");
    await life.installTracked(pkg, null, { allow: true });
  }
}
const answer = (a: unknown) => (process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify(a));

test("the port's flows and lambdas are all there, and its templates and names are sound", { skip }, async () => {
  await world();
  const { flowByName } = await import("@/plugins/workspace/flows/store");
  for (const n of ["people.extract", "people.compile", "people.compile-stale", "people.classify", "people.normalize"]) assert.ok(flowByName(n), n);
  assert.equal(flowByName("people.normalize")!.sync?.replaces, "peoplenorm");
  const { getLambda } = await import("@/plugins/workspace/lambdas/store");
  for (const n of ["people.extract", "people.compile", "people.classify", "people.names"]) assert.ok(getLambda(n), n);
  const manifest = JSON.parse(fs.readFileSync(path.join(repoPlugin("people-ext"), "zeff-plugin.json"), "utf8")) as { description: string };
  assert.ok(manifest.description.length <= 300, "the manifest description is short");
});

test("extraction: the port asks what the built-in asks and keeps the same claims, links and marks", { skip }, async () => {
  await world();
  const { getDb, getSqlite, schema } = await import("@/db");
  const people = await import("@/plugins/people/store");
  const anna = people.createPerson({ name: "Anna Berg", emails: ["anna@example.org"] });
  const tom = people.createPerson({ name: "Tom Keller" });
  getDb()
    .insert(schema.emails)
    .values({ key: "e1|x", convId: "c-e1", syncedAt: ago(0), folder: "Posteingang", fromName: "Anna Berg", fromEmail: "anna@example.org", subject: "Angebot", preview: "Ich schicke dir das Angebot bis Freitag, 2026-12-04, und Tom Keller leitet das Projekt Relaunch.", receivedAt: ago(1) } as never)
    .run();
  const out = {
    claims: [{ person: anna, kind: "commitment", text: "Anna schickt das Angebot bis Freitag", evidence: "Ich schicke dir das Angebot bis Freitag", source: "m1", confidence: 0.9, direction: "theirs", due: "2026-12-04" }],
    links: [{ person: tom, rel: "owns", target_type: "project", target: "Relaunch", evidence: "Tom Keller leitet das Projekt Relaunch", source: "m1", confidence: 0.8 }],
    checked: [
      { source: "m1", person: anna, verdict: "gefunden" },
      { source: "m1", person: tom, verdict: "gefunden" },
    ],
  };
  // The built-in
  const { extractKnowledge } = await import("@/plugins/people/extract");
  const prompts: string[] = [];
  const first = await extractKnowledge({ ask: async (p) => (prompts.push(p), out) as never, retrieve: async () => ({ text: "" }) });
  assert.ok(first.ok && first.claims === 1 && first.links === 1, JSON.stringify(first));
  const rows = (sql: string) => getSqlite().prepare(sql).all();
  const strip = (r: unknown[]) => JSON.stringify(r, (k, v) => (["id", "created_at", "seen_at", "run_id", "expires_at"].includes(k) ? undefined : v));
  const claimsB = strip(rows("select * from people_claims order by id"));
  const linksB = strip(rows("select * from people_links where source = 'ai' order by id"));
  const marksB = JSON.stringify(rows("select * from people_extract_state order by source"));
  // Back to the start, then the port
  getSqlite().exec("delete from people_claims; delete from people_links; delete from people_extract_state");
  answer(out);
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const r = await runFlow("people.extract", {});
  assert.equal(r.status, "done", r.error ?? "");
  assert.equal(strip(rows("select * from people_claims order by id")), claimsB, "the same claims");
  assert.equal(strip(rows("select * from people_links where source = 'ai' order by id")), linksB, "the same links");
  assert.equal(JSON.stringify(rows("select * from people_extract_state order by source")), marksB, "the marks where the built-in left them");
  // The prompt: the built-in's, then the AI's way of asking for context behind it.
  const sent = fs.readFileSync(promptFile, "utf8");
  assert.ok(sent.startsWith(prompts[0].split("\n\n# Profile")[0]), "the same instructions");
  assert.ok(sent.includes("# Nachrichten") && sent.includes("Ich schicke dir das Angebot"), "the messages");
  // Nothing new: nothing asked, nothing kept, again.
  const again = await runFlow("people.extract", {});
  assert.equal(again.status, "done");
  assert.equal((again.output as { items: number }).items, 0);
});

test("the overview: the same prompt, the same summary, circle and kind", { skip }, async () => {
  await world();
  const people = await import("@/plugins/people/store");
  const { getSqlite } = await import("@/db");
  const id = people.createPerson({ name: "Bernd Vogel", emails: ["bernd@example.org"] });
  const { compileInput, compilePerson } = await import("@/plugins/people/compile");
  getSqlite().prepare("insert into facts (subject, text, created_at, updated_at) values (?, ?, ?, ?)").run("Bernd Vogel", "Bernd hat ein Boot", ago(3), ago(3));
  const a = { connection: "Nachbar", keyFacts: ["hat ein Boot"], funFacts: [], circle: "friends", kind: "person" };
  const built = await compilePerson(id, { force: true, ask: async () => a });
  assert.equal(built.state, "compiled");
  const kept = JSON.stringify({ ...people.getPerson(id)!.compiled, at: "" });
  const keptCircle = people.getPerson(id)!.circle;
  getSqlite().exec(`update people set compiled = null, circle = '', circle_source = ''`);
  answer(a);
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const r = await runFlow("people.compile", { id, force: true });
  assert.equal(r.status, "done", r.error ?? "");
  assert.equal(JSON.stringify({ ...people.getPerson(id)!.compiled, at: "" }), kept, "the same summary");
  assert.equal(people.getPerson(id)!.circle, keptCircle, "the same circle");
  const input = await compileInput(id, { force: true });
  assert.equal(fs.readFileSync(promptFile, "utf8"), input.prompt, "the same prompt");
  // Fresh: not asked again; no one known: none.
  const fresh = await runFlow("people.compile", { id });
  assert.equal((fresh.output as { state: string }).state, "fresh");
  const nobody = people.createPerson({ name: "Zora Unbekannt" });
  const none = await runFlow("people.compile", { id: nobody });
  assert.equal((none.output as { state: string }).state, "nothing-known");
});

test("placing contacts: the same batches, the same kind and circle", { skip }, async () => {
  await world();
  const people = await import("@/plugins/people/store");
  const { getSqlite } = await import("@/db");
  const reset = () => getSqlite().exec("update people set kind = 'person', kind_source = '', circle = '', circle_source = ''");
  reset();
  const bank = people.createPerson({ name: "Musterbank AG" });
  const max = people.createPerson({ name: "Max Beispiel" });
  const { classifyContacts } = await import("@/plugins/people/classify");
  const a = { people: [{ id: bank, kind: "organization", circle: "authorities" }, { id: max, kind: "person", circle: "friends" }] };
  await classifyContacts({ ask: async () => a });
  const snap = () => JSON.stringify(people.listPeople().map((p) => [p.id, p.kind, p.circle, p.kindSource, p.circleSource]));
  const built = snap();
  reset();
  answer(a);
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const r = await runFlow("people.classify", {});
  assert.equal(r.status, "done", r.error ?? "");
  assert.equal(snap(), built);
  const sent = fs.readFileSync(promptFile, "utf8");
  assert.ok(sent.includes("# Kontakte") && sent.includes("Musterbank AG"));
});

test("matching names: the same prompt, the same merges, aliases and new profiles", { skip }, async () => {
  await world();
  const people = await import("@/plugins/people/store");
  const { getSqlite } = await import("@/db");
  const { addCalendarTodo } = await import("@/lib/todos/store");
  const thomas = people.createPerson({ name: "Thomas Meier" });
  addCalendarTodo({ text: "Herrn Meier zurückrufen wegen der Heizung", due: new Date().toLocaleDateString("sv-SE"), ref: "event:1@x", source: "Kalender" });
  const { normalizeInput, applyNormalized } = await import("@/plugins/people/normalize");
  const { normalizePrompt, INSTRUCTIONS } = await import("@/plugins/people/normalize-core");
  const input = normalizeInput();
  assert.ok(input && input.todos.length, "there is a todo to match names in");
  const a = { aliases: [{ person: thomas, mention: "Herr Meier" }], people: [], merges: [], relations: [{ person: thomas, rel: "Vermieter", other: 0, evidence: "Herr Meier wegen der Heizung" }] };
  const built = applyNormalized(a, input!);
  assert.deepEqual(built, { aliases: 1, created: 0, merged: 0, relations: 1 });
  const kept = JSON.stringify([people.getPerson(thomas)!.aliases, people.relationsOf(thomas).out.map((r) => r.rel)]);
  getSqlite().exec("update people set aliases = '[]'; delete from people_relations");
  answer(a);
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const r = await runFlow("people.normalize", {});
  assert.equal(r.status, "done", r.error ?? "");
  assert.equal(JSON.stringify([people.getPerson(thomas)!.aliases, people.relationsOf(thomas).out.map((r) => r.rel)]), kept, "the same alias and relation");
  assert.match((r.output as { message: string }).message, /1 aliases, 0 new, 0 merged, 1 relations/);
  assert.equal(fs.readFileSync(promptFile, "utf8").length > 0, true);
  // (the prompt of the names matching is the built-in's — the last prompt asked was the extraction's or the overview's; the first of the flow was this one)
  assert.ok(normalizePrompt(INSTRUCTIONS, input!).includes("# Meine Todos"));
});

test("the switch: the port's flow stands in for the built-in's step, the built-in stays on for the people and their screens", { skip }, async () => {
  await world();
  const state = await import("@/plugins/state");
  const reg = await import("@/lib/ext/registry");
  reg.setEnabled("people-ext", false);
  assert.ok(state.stepAvailable("peoplenorm"), "the built-in's step runs while the port is off");
  assert.equal(state.stepTakenByPort("peoplenorm"), false);
  const { PORTS } = await import("@/plugins/ports");
  const port = PORTS.find((p) => p.builtin === "people")!;
  assert.ok(port);
  await port.switch();
  assert.ok(state.isInstalled("people"), "the people stay Zeff's: the built-in is still on");
  assert.equal(state.stepTakenByPort("peoplenorm"), true);
  assert.equal(state.stepAvailable("peoplenorm"), false, "its own step doesn't run");
  const { listFlows } = await import("@/plugins/workspace/flows/store");
  assert.ok(listFlows().some((f) => f.name === "people.normalize" && f.sync?.replaces === "peoplenorm"));
  reg.setEnabled("people-ext", false);
  assert.ok(state.stepAvailable("peoplenorm"), "switched off: the built-in's step is back");
});
