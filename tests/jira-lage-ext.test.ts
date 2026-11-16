import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";

setupTempData();

/**
 * The Jira briefing's port (zeff-plugins/plugins/jira-lage-ext): the lambda that works out which tickets the Board-Lage reads is the built-in's own rule over the
 * same tables (adopted stores) — the same keys as the built-in; the fresh read (the kernel's jira.read-issues, here against a fake Jira MCP server) keeps the
 * comments through the plugin's store; the flow goes on to the Workspace's review (the AI isn't there: it fails as the built-in's step would) and says it in the built-in's words.
 */
const skip = skipWithoutRepo("jira-lage-ext");
const DAY = 864e5;
const ago = (n: number) => new Date(Date.now() - n * DAY).toISOString();

/** A lambda's answer (it must have run). */
async function ask<T>(name: string, event: unknown): Promise<T> {
  const { invokeLambda } = await import("@/plugins/workspace/lambdas/run");
  const r = await invokeLambda(name, event);
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  return (r.ok ? r.result : null) as T;
}

async function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-jira-lage-ext-"));
  process.env.ZEFF_PLUGINS_DIR = dir;
  fs.cpSync(repoPlugin("jira-lage-ext"), path.join(dir, "jira-lage-ext"), { recursive: true });
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos", "jira"]) setInstalled(id as never, true);
  await import("@/plugins/contributions");
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  reg.setEnabled("jira-lage-ext", true);
  const { getDb, schema } = await import("@/db");
  const db = getDb();
  if (!db.select().from(schema.jiraBoards).all().length) {
    db.insert(schema.jiraBoards).values([{ id: 1, name: "Board A", type: "kanban", projectKey: "AAA", enabled: true }, { id: 2, name: "Board B", type: "kanban", projectKey: "BBB", enabled: false }] as never).run();
    const t = (key: string, o: Record<string, unknown>) => db.insert(schema.jiraTickets).values({ key, summary: `S ${key}`, status: "Open", statusCategory: "todo", boardId: 1, updatedAt: ago(1), mine: false, ...o } as never).run();
    t("AAA-1", { mine: true }); // yours, moved lately
    t("AAA-2", { updatedAt: ago(90) }); // old, not yours
    t("AAA-3", { statusCategory: "inprogress", updatedAt: ago(90) }); // in progress (not yours)
    t("AAA-4", { mine: true, updatedAt: ago(90) }); // yours but untouched for long
    t("AAA-5", { mine: true, resolvedAt: ago(2) }); // resolved
    t("AAA-6", { statusCategory: "done" }); // done
    t("AAA-7", { updatedAt: ago(2) }); // moved lately, not yours
    t("AAA-8", { mine: true, updatedAt: ago(3) }); // the Ticket-Lage assessed it
    t("BBB-1", { boardId: 2, mine: true }); // a board that isn't enabled
    db.insert(schema.boardRuns).values({ status: "ok", jql: "x", tickets: JSON.stringify([{ key: "AAA-8", analyzed: true }, { key: "AAA-7", analyzed: false }]) } as never).run();
  }
  return { dir };
}

test("the plugin's lambda picks the tickets the built-in's rule picks, with you and all", { skip }, async () => {
  await world();
  const { relevantKeys } = await import("@/plugins/jira-lage/board-lage");
  for (const all of [false, true]) assert.deepEqual((await ask<{ keys: string[] }>("jira-lage.relevant", { all })).keys, relevantKeys(all), `all=${all}`);
  assert.deepEqual(relevantKeys(false), ["AAA-1"], "yours, moved lately — not the old, the done, the assessed, the other board's");
  assert.ok(relevantKeys(true).includes("AAA-7") && relevantKeys(true).includes("AAA-3") && !relevantKeys(true).includes("AAA-8"));
});

test("the page's lambda counts what the next run would read; the report says it in the built-in's words", { skip }, async () => {
  const ov = await ask<{ boards: { name: string; open: number }[]; withMe: { count: number }; all: { count: number } }>("jira-lage.overview", {});
  assert.deepEqual(ov.boards.map((b) => [b.name, b.open]), [["Board A", 7]]);
  assert.equal(ov.withMe.count, 1);
  assert.ok(ov.all.count >= 3);
  const { boardLageMessage } = await import("@/plugins/jira-lage/core");
  const tr = (s: string, v?: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v?.[k]));
  const rep = await ask("jira-lage.report", { all: true, reviewed: 3, unchanged: 5, failed: 1 });
  assert.deepEqual(rep, boardLageMessage({ ok: true, all: true, relevant: 9, analyzed: 3, unchanged: 5, failed: 1 }, tr));
  const bad = await ask<{ ok: boolean; message: string }>("jira-lage.report", { reviewed: 0, failed: 2, error: "no AI" });
  assert.deepEqual(bad, { ok: false, message: "no AI" });
});

test("jira.read-issues reads the tickets fresh through the Jira connection and the flow keeps their comments; the review then fails as the built-in's step would without an AI", { skip }, async () => {
  const dir = path.resolve("tests", "fake-jira-mcp.mjs");
  process.env.JIRA_MCP_COMMAND = process.execPath;
  process.env.JIRA_MCP_ARGS = JSON.stringify([dir]);
  const life = await import("@/plugins/workspace/package-life");
  await life.installTracked(JSON.parse(fs.readFileSync(path.join(repoPlugin("jira-lage-ext"), "jira-lage.package.json"), "utf8")), null, { allow: true });
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const flows = await import("@/plugins/workspace/flows/store");
  const f = flows.flowByName("jira-lage.board-lage");
  assert.deepEqual(f?.sync, { label: "Board briefing", what: f?.sync?.what, replaces: "boardlage" });
  const r = await runFlow("jira-lage.board-lage", { all: true }, { trigger: { kind: "manual" } });
  assert.equal(r.status, "done", r.error ?? "");
  const { getSqlite } = await import("@/db");
  const kept = getSqlite().prepare("select id, ticket, author, body from jira_comments order by id").all() as { id: string; ticket: string; author: string; body: string }[];
  assert.ok(kept.some((c) => c.id === "c-AAA-7" && c.ticket === "AAA-7" && c.author === "Pat" && c.body === "A comment on AAA-7."), JSON.stringify(kept));
  assert.equal((r.output as { ok?: boolean }).ok === false || typeof (r.output as { message?: string }).message === "string", true);
  delete process.env.JIRA_MCP_COMMAND;
  delete process.env.JIRA_MCP_ARGS;
});

test("the port's flow is a step of the Sync menu, standing in for the Board briefing", { skip }, async () => {
  const reg = await import("@/lib/sync/registry");
  const steps = reg.syncOverview().steps.map((s) => s.key);
  assert.ok(steps.includes("flow:jira-lage.board-lage"), "in the menu");
});
