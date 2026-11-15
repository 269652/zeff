/**
 * A stdio MCP client for driver lambdas ("zeff:automation/mcp-client"): one session — the server spawned, initialized — in which any
 * number of tools are called, then the server stopped. The same protocol and the same payload reading as the kernel's own client
 * (src/lib/mcp/stdio.ts), in plain JavaScript because a driver runs as a Node process of its own.
 *
 *   await runSession({ command, args, env }, async (call) => payloadOf(await call("tool", { … })), 180000)
 */
import { spawn } from "node:child_process";

export function runSession(config, body, timeoutMs = 150000) {
  const label = config.label ?? "MCP server";
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(config.command, config.args ?? [], { env: { ...process.env, ...(config.env ?? {}) }, cwd: config.cwd, stdio: ["pipe", "pipe", "pipe"], shell: false });
    } catch (e) {
      reject(new Error(`Cannot start the ${label} ("${config.command}"): ${e.message}`));
      return;
    }
    let stderr = "";
    let buffer = "";
    let settled = false;
    let nextId = 1;
    const pending = new Map();
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // gone already
      }
      fn();
    };
    const fail = (msg) => finish(() => reject(new Error(msg)));
    const timer = setTimeout(() => fail(`${label} timed out after ${timeoutMs}ms.${stderr ? ` stderr: ${stderr.slice(0, 400)}` : ""}`), timeoutMs);
    child.on("error", (e) => fail(`Cannot start the ${label} ("${config.command}"): ${e.message}${e.code === "ENOENT" ? ` — the program was not found: install it, or give its full path.` : ""}`));
    child.stdin.on("error", (e) => fail(`${label}: its input closed (${e.message}).${stderr ? ` stderr: ${stderr.slice(0, 400)}` : ""}`));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.stdout.on("data", (d) => {
      buffer += d.toString();
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id !== undefined && pending.has(Number(msg.id))) {
          const r = pending.get(Number(msg.id));
          pending.delete(Number(msg.id));
          r(msg);
        }
      }
    });
    child.on("exit", (code) => {
      if (!settled) fail(`${label} exited early (code ${code}).${stderr ? ` stderr: ${stderr.slice(0, 400)}` : ""}`);
    });
    const send = (method, params) => {
      const id = nextId++;
      const p = new Promise((res) => pending.set(id, res));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return p;
    };
    const call = async (toolName, args = {}) => {
      const res = await send("tools/call", { name: toolName, arguments: args });
      if (res.error) throw new Error(`tool "${toolName}" returned an error: ${res.error.message}`);
      if (res.result?.isError) {
        const text = (Array.isArray(res.result.content) ? res.result.content : []).map((c) => (typeof c.text === "string" ? c.text : "")).filter(Boolean).join(" ");
        throw new Error(`tool "${toolName}": ${text || "returned an error"}`);
      }
      return res.result;
    };
    (async () => {
      const init = await send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "zeff", version: "0.1.0" } });
      if (init.error) return fail(`${label} initialize failed: ${init.error.message}`);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
      const out = await body(call);
      finish(() => resolve(out));
    })().catch((e) => fail(`${label}: ${e.message}`));
  });
}

/** Some servers wrap the payload as { result: "<json string>" } — unwrapped. */
function unwrap(v) {
  if (v && typeof v === "object" && "result" in v) {
    const inner = v.result;
    if (typeof inner === "string") {
      try {
        return JSON.parse(inner);
      } catch {
        return inner;
      }
    }
    return inner;
  }
  return v;
}

/** The usable JSON (or text) of a tools/call result envelope. */
export function payloadOf(result) {
  if (result && typeof result === "object") {
    if (result.structuredContent !== undefined) return unwrap(result.structuredContent);
    if (Array.isArray(result.content)) {
      for (const c of result.content) {
        if (c.type === "text" && typeof c.text === "string") {
          try {
            return unwrap(JSON.parse(c.text));
          } catch {
            return c.text;
          }
        }
        if (c.resource) return c.resource;
      }
    }
  }
  return result;
}
