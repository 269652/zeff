// A stand-in for the Jira MCP server (mcp-atlassian): newline-delimited JSON-RPC on stdin/stdout; jira_search answers the keys asked for ("key in (A-1,B-2)")
// with one comment each. Tests start it through JIRA_MCP_COMMAND.
import readline from "node:readline";

const send = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return;
  if (msg.method === "initialize") return send({ id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake-jira", version: "0" } } });
  if (msg.method === "tools/call" && msg.params?.name === "jira_search") {
    const keys = /\(([^)]*)\)/.exec(String(msg.params.arguments?.jql ?? ""))?.[1]?.split(",").map((k) => k.trim()).filter(Boolean) ?? [];
    const issues = keys.map((key) => ({
      key,
      summary: `Summary of ${key}`,
      status: { name: "In Progress", category: "inprogress" },
      comments: [{ id: `c-${key}`, author: { display_name: "Pat" }, created: "2026-11-10T09:30:00.000+0100", body: `A comment on ${key}.` }],
    }));
    return send({ id: msg.id, result: { content: [{ type: "text", text: JSON.stringify({ issues }) }] } });
  }
  send({ id: msg.id, error: { code: -32601, message: `no such method: ${msg.method}` } });
});
