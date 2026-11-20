// A stand-in for an ACP agent (`copilot --acp`) in tests: what Copilot CLI's server offers (images in a prompt, model and reasoning effort as session
// config options), every request it gets written to FAKE_ACP_LOG (one JSON line each). A prompt is answered with a short message and end_turn.
import fs from "node:fs";

const out = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
const note = (m) => process.env.FAKE_ACP_LOG && fs.appendFileSync(process.env.FAKE_ACP_LOG, `${JSON.stringify(m)}\n`);
const config = { model: "claude-sonnet-5.5", reasoning_effort: "medium" };
const options = () => [
  { type: "select", id: "mode", name: "Mode", category: "mode", currentValue: "https://agentclientprotocol.com/protocol/session-modes#agent", options: [{ value: "https://agentclientprotocol.com/protocol/session-modes#agent", name: "Agent" }] },
  { type: "select", id: "model", name: "Model", category: "model", currentValue: config.model, options: [{ value: "auto", name: "Auto" }, { value: "claude-sonnet-5.5", name: "Claude Sonnet 5.5" }, { value: "gpt-6.2-sol", name: "GPT-6.2 Sol" }] },
  { type: "select", id: "reasoning_effort", name: "Reasoning Effort", category: "thought_level", currentValue: config.reasoning_effort, options: ["low", "medium", "high"].map((v) => ({ value: v, name: v })) },
];
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let n;
  while ((n = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, n).trim();
    buf = buf.slice(n + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    note(m);
    if (m.method === "initialize") out({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: true, audio: false, embeddedContext: true } } } });
    else if (m.method === "session/new")
      out({ id: m.id, result: { sessionId: "s1", modes: { currentModeId: "https://agentclientprotocol.com/protocol/session-modes#agent", availableModes: [{ id: "https://agentclientprotocol.com/protocol/session-modes#agent", name: "Agent" }] }, configOptions: options() } });
    else if (m.method === "session/set_config_option") {
      config[m.params.configId] = m.params.value;
      out({ id: m.id, result: { configOptions: options() } });
    } else if (m.method === "session/prompt") {
      out({ method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done looking." } } } });
      out({ id: m.id, result: { stopReason: "end_turn" } });
    } else if (m.id !== undefined) out({ id: m.id, result: {} });
  }
});
