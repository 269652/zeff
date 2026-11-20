import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

/**
 * A live Copilot session over ACP (plugins/copilot-cli/interactive.ts) against a stand-in agent (tests/fake-acp-agent.mjs): what it offers is read
 * (images, its models and reasoning efforts), the model and the effort are set through session/set_config_option, a message carries pictures as
 * image blocks and files as resource links, and a turn is stopped with session/cancel — through the same entry the Code screen uses (liveDo).
 */
const dir = setupTempData();
const acpLog = path.join(dir, "acp.jsonl");
process.env.FAKE_ACP_LOG = acpLog;
const sent = () =>
  fs
    .readFileSync(acpLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { method?: string; params?: Record<string, unknown> });
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 30));
  assert.ok(ok(), "in time");
};

test("a Copilot session: its model and effort set, pictures and files sent with a message, a turn stopped", async () => {
  const { startInteractive } = await import("@/plugins/copilot-cli/interactive");
  const { liveView, lives } = await import("@/plugins/copilot-cli/live-state");
  const { liveDo } = await import("@/lib/work/live-actions");
  const runId = 4711;
  await startInteractive({ runId, command: process.execPath, args: [path.join(ROOT, "tests", "fake-acp-agent.mjs")], cwd: dir, env: process.env, prompt: "Look around.", autopilot: false });
  const v = () => liveView(runId)!;
  assert.deepEqual(v().features?.sort(), ["effort", "files", "images", "model"]);
  assert.equal(v().model, "claude-sonnet-5.5");
  assert.deepEqual(v().models?.map((m) => m.value), ["auto", "claude-sonnet-5.5", "gpt-6.2-sol"]);
  assert.deepEqual(v().efforts, ["low", "medium", "high"]);
  await until(() => !v().busy);

  await liveDo(runId, { do: "model", model: "gpt-6.2-sol" });
  assert.equal(v().model, "gpt-6.2-sol");
  await liveDo(runId, { do: "effort", effort: "high" });
  assert.equal(v().effort, "high");
  await assert.rejects(liveDo(runId, { do: "effort", effort: "enormous" }));
  assert.deepEqual(
    sent().filter((m) => m.method === "session/set_config_option").map((m) => [m.params?.configId, m.params?.value]),
    [["model", "gpt-6.2-sol"], ["reasoning_effort", "high"]],
  );

  const file = path.join(dir, "notes.md");
  fs.writeFileSync(file, "# notes\n");
  await liveDo(runId, { do: "send", text: "Read these.", images: [{ mediaType: "image/png", data: "iVBORw0KGgo=" }], files: [{ name: "notes.md", path: file }] });
  await until(() => sent().filter((m) => m.method === "session/prompt").length === 2);
  const prompt = sent().filter((m) => m.method === "session/prompt")[1].params!.prompt as { type: string; mimeType?: string; uri?: string; name?: string }[];
  assert.deepEqual(prompt.map((b) => b.type), ["text", "image", "resource_link"]);
  assert.equal(prompt[1].mimeType, "image/png");
  assert.equal(prompt[2].name, "notes.md");
  assert.match(prompt[2].uri ?? "", /^file:\/\/.*notes\.md$/);

  await until(() => !v().busy);
  await liveDo(runId, { do: "interrupt" });
  await until(() => sent().some((m) => m.method === "session/cancel"));

  const live = lives.get(runId)!;
  lives.delete(runId, live.account);
  live.child.kill();
});
