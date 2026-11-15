// A driver lambda's process (lambdas/run.ts starts it for driver.call): unlike runner.mjs NOT sandboxed — it reaches the account's
// automation Chrome (context.chrome: Zeff's generic Chrome helper, scripts/chrome-cdp.mjs) and the network itself, as the plugin's
// programs did. Only what a flow allowed calls it (its `driver` permission), a plugin's only while it is granted exec. One job, then it ends.
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// Zeff's generic automation helpers by fixed names — what a scraper imports, wherever it is kept:
//   zeff:chrome             the account's Chrome over CDP (connectToChrome, withTabLock, ChromeConnectError — scripts/chrome-cdp.mjs)
//   zeff:automation/<name>  the automation kit (contract, probe, … — scripts/automation/<name>.mjs); mcp-stdio only collects the tools
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, "..", "..", "..", "..", "scripts");
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "zeff:chrome") return { url: pathToFileURL(path.join(SCRIPTS, "chrome-cdp.mjs")).href, shortCircuit: true };
    if (specifier === "zeff:automation/mcp-stdio") return { url: pathToFileURL(path.join(HERE, "driver-mcp.mjs")).href, shortCircuit: true };
    const m = /^zeff:automation\/([a-z0-9-]+)$/.exec(specifier);
    if (m) return { url: pathToFileURL(path.join(SCRIPTS, "automation", `${m[1]}.mjs`)).href, shortCircuit: true };
    return next(specifier, context);
  },
});

let seq = 0;
const waiting = new Map();
const ask = (msg) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    process.send({ ...msg, id });
  });
process.on("message", (m) => {
  if (m?.type === "job") return void run(m);
  const w = waiting.get(m?.id);
  if (!w) return;
  waiting.delete(m.id);
  if (m.error) w.reject(new Error(m.error));
  else w.resolve(m.value);
});

const logs = [];
const say = (...args) => {
  if (logs.length >= 300) return;
  logs.push(args.map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ").slice(0, 4000));
};
console.log = console.info = console.warn = console.error = console.debug = say;

async function run(job) {
  const started = Date.now();
  try {
    const helper = await import(job.chromeHelper);
    const mod = await import(pathToFileURL(path.join(job.dir, "index.mjs")).href);
    const handler = mod.handler ?? mod.default;
    if (typeof handler !== "function") throw new Error("index.mjs exports no handler (export async function handler(event, context) { … }).");
    const context = {
      name: job.name,
      language: job.language ?? "en",
      secrets: Object.freeze({ ...job.secrets }),
      log: say,
      deadline: started + job.timeoutMs,
      remainingMs: () => Math.max(0, started + job.timeoutMs - Date.now()),
      zeff: { call: (name, input = {}) => ask({ type: "call", name, input }) },
      /** A program's name as this computer runs it (uv, uvx found where they are installed, not only on Zeff's PATH); any other as it is. */
      resolveCommand: (command) => job.commands?.[String(command).trim().replace(/.exe$/i, "").toLowerCase()] ?? command,
      /** A scraper written as an MCP server (serveMcp): its tools, called here — a tool's text answer, JSON parsed. */
      mcp: {
        get tools() {
          return (globalThis.__zeffDriverMcp?.tools ?? []).map((t) => t.name);
        },
        call: async (tool, args = {}) => {
          const h = globalThis.__zeffDriverMcp?.handlers?.[tool];
          if (!h) throw new Error(`The driver has no tool “${tool}”.`);
          const out = await h(args);
          if (typeof out !== "string") return out;
          const s = out.trim();
          try {
            return s.startsWith("{") || s.startsWith("[") ? JSON.parse(s) : s;
          } catch {
            return s;
          }
        },
      },
      /** The account's automation Chrome: connect (Playwright's browser, attached over CDP — launchUrls starts it with these tabs), one tab at a time per app (withTabLock). */
      chrome: {
        endpoint: job.cdp,
        connect: (opts = {}) => helper.connectToChrome(job.cdp, opts),
        withTabLock: (app, tool, fn) => helper.withTabLock(app, tool, fn, () => {}),
        ConnectError: helper.ChromeConnectError,
      },
    };
    const result = await handler(job.event, context);
    process.send({ type: "done", ok: true, result: result === undefined ? null : JSON.parse(JSON.stringify(result)), logs, ms: Date.now() - started }, () => process.exit(0));
  } catch (e) {
    process.send({ type: "done", ok: false, error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? String(e.stack ?? "").split("\n").slice(0, 8).join("\n") : "", logs, ms: Date.now() - started }, () => process.exit(0));
  }
}
