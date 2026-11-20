#!/usr/bin/env node
/**
 * How fast `next dev` is — repeatable, on a disposable test server (scripts/test-server.mjs: own data, own dist dir, TTL), never the
 * live one.
 *
 *   node scripts/perf-dev.mjs [--routes "/,/todos,/work"] [--no-edit] [--out file.json] [--url http://127.0.0.1:PORT] [--keep]
 *
 * For each route, cold (the first visit after the start, in a fresh headless Chrome context) and then warm (a second visit):
 *   ttfb   the document's first byte (server compile + render)
 *   ready  React has hydrated the page (an element with React's props in the DOM) — what the user waits for
 *   log    Next's own line for it ("GET /todos 200 in 12s (compile: 11s, render: 1s)")
 * Then the edit → recompile time: a file is touched (a comment appended, put back afterwards) and the route requested again.
 * And the server's memory (its whole process tree) at the end. Prints a table; --out writes the JSON as well.
 * The server is stopped at the end (--keep: left running, stop it with `node scripts/test-server.mjs --stop <pid>`).
 * --url: measure an already running test server instead of starting one (its log isn't read then).
 * The test server's dist dir (.next-e2e, with Turbopack's file-system cache) is removed first: every run is cold (--warm-cache:
 *   kept — what a restarted dev server sees).
 * --log <file>: a copy of the server's log.
 * --trace: `next dev --internal-trace` — Turbopack's trace in .next-profiles/trace-turbopack.bin once the server is stopped
 *   (read it with `npx next internal trace <file>`, then `npx next internal query-trace`). --force: start with less than 4 GB free.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { startTestServer, stopTestServer } from "./test-server.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const REPO = path.resolve(import.meta.dirname, "..");
const CHROME = process.env.CHROME_PATH ?? (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined);

const argv = process.argv.slice(2);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (f) => argv.includes(f);
const ROUTES = (val("--routes") ?? "/,/todos,/work,/month,/workspace,/workspace/:page,/settings,/plugins").split(",").map((s) => s.trim()).filter(Boolean);
const EDITS = [
  // (a file every Workspace view uses — a shared client component — and a page of its own)
  { file: "src/plugins/workspace/ui/view-template.tsx", route: "/workspace" },
  { file: "src/app/todos/page.tsx", route: "/todos" },
];
const NAV_TIMEOUT = 600_000;

const sec = (ms) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`);
const now = () => performance.now();

/** The server's log from a byte offset on. */
const logFrom = (file, at) => {
  if (!file) return "";
  try {
    const buf = fs.readFileSync(file);
    return buf.subarray(at).toString("utf8");
  } catch {
    return "";
  }
};
const logSize = (file) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};
/** Next's request lines ("GET /x 200 in 3.2s (compile: 2.9s, render: 0.3s)"), ANSI colours removed. */
const requestLines = (text) =>
  text
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(GET|POST|HEAD) \S+ \d{3} in /.test(l));

/** Working set of a process and everything below it, in MB (Windows; elsewhere RSS from ps). */
function treeMemoryMb(pid) {
  try {
    if (process.platform === "win32") {
      const ps = `$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize; $set = @{${pid}=1}; do { $n = $set.Count; foreach ($p in $all) { if ($set.ContainsKey([int]$p.ParentProcessId)) { $set[[int]$p.ProcessId] = 1 } } } while ($set.Count -ne $n); ($all | Where-Object { $set.ContainsKey([int]$_.ProcessId) } | Measure-Object WorkingSetSize -Sum).Sum`;
      return Math.round(Number(execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", windowsHide: true }).trim()) / 1024 / 1024);
    }
    const out = execFileSync("ps", ["-eo", "pid=,ppid=,rss="], { encoding: "utf8" });
    const rows = out.trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
    const set = new Set([pid]);
    for (let n = -1; n !== set.size; ) {
      n = set.size;
      for (const [p, pp] of rows) if (set.has(pp)) set.add(p);
    }
    return Math.round(rows.filter(([p]) => set.has(p)).reduce((s, r) => s + r[2], 0) / 1024);
  } catch {
    return null;
  }
}

/** A folder's size in MB (0 when missing). */
function dirMb(dir) {
  let sum = 0;
  const walk = (d) => {
    let list = [];
    try {
      list = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) sum += fs.statSync(p).size;
    }
  };
  walk(dir);
  return Math.round(sum / 1024 / 1024);
}

async function visit(browser, base, route) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "de-DE" });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const t0 = now();
  let ttfb = null;
  page.on("response", (r) => {
    if (ttfb == null && r.request().isNavigationRequest()) ttfb = now() - t0;
  });
  let status = null;
  let ready = null;
  let load = null;
  try {
    const res = await page.goto(base + route, { waitUntil: "load" });
    status = res?.status() ?? null;
    load = now() - t0;
    await page.waitForFunction(
      () => [...document.querySelectorAll("button, a, input, [contenteditable]")].some((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))),
      null,
      { timeout: NAV_TIMEOUT, polling: 100 },
    );
    ready = now() - t0;
  } catch (e) {
    errors.push(`(${String(e).split("\n")[0].slice(0, 200)})`);
  }
  const finalUrl = page.url();
  await context.close();
  return { route, status, ttfb, load, ready, finalUrl, errors };
}

/** The first Workspace page linked from /workspace (for the route "/workspace/:page"). */
async function findWorkspacePage(browser, base) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${base}/workspace`, { waitUntil: "load", timeout: NAV_TIMEOUT });
    const href = await page
      .waitForFunction(() => [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).find((h) => /^\/workspace\/\d+/.test(h ?? "")), null, { timeout: 60_000 })
      .then((h) => h.jsonValue())
      .catch(() => null);
    return href;
  } finally {
    await context.close();
  }
}

async function timedGet(url) {
  const t0 = now();
  const r = await fetch(url, { signal: AbortSignal.timeout(NAV_TIMEOUT) });
  await r.arrayBuffer();
  return { status: r.status, ms: now() - t0 };
}

async function main() {
  let server = null;
  let base = val("--url")?.replace(/\/+$/, "");
  const tStart = now();
  if (!base) {
    // Cold means cold: Turbopack's file-system cache (in the dist dir) of an earlier run is removed first (--warm-cache keeps it).
    if (!has("--warm-cache")) fs.rmSync(path.join(REPO, ".next-e2e"), { recursive: true, force: true });
    server = await startTestServer({ ttlMs: 60 * 60_000, log: (s) => console.error(s), force: has("--force"), nextArgs: has("--trace") ? ["--internal-trace"] : [] });
    base = `http://127.0.0.1:${server.port}`;
  }
  const startMs = now() - tStart;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const result = { at: new Date().toISOString(), commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(), startMs, routes: [], edits: [] };
  try {
    for (let route of ROUTES) {
      if (route.includes(":page")) {
        const p = await findWorkspacePage(browser, base);
        if (!p) {
          console.error(`(no Workspace page found for ${route} — skipped)`);
          continue;
        }
        route = p;
      }
      const at = logSize(server?.log);
      const cold = await visit(browser, base, route);
      cold.log = requestLines(logFrom(server?.log, at));
      const at2 = logSize(server?.log);
      const warm = await visit(browser, base, route);
      warm.log = requestLines(logFrom(server?.log, at2));
      result.routes.push({ route, cold, warm });
      console.error(`${route}: cold ttfb ${sec(cold.ttfb)} ready ${sec(cold.ready)} | warm ttfb ${sec(warm.ttfb)} ready ${sec(warm.ready)}${cold.errors.length ? `  ! ${cold.errors.join(" ")}` : ""}`);
      for (const l of cold.log.slice(0, 6)) console.error(`    ${l}`);
    }
    if (!has("--no-edit")) {
      for (const { file, route } of EDITS) {
        const abs = path.join(REPO, file);
        if (!fs.existsSync(abs)) continue;
        const before = fs.readFileSync(abs, "utf8");
        try {
          await timedGet(base + route); // (warm first)
          fs.writeFileSync(abs, `${before}\n// perf-dev edit ${Date.now()}\n`);
          await new Promise((r) => setTimeout(r, 300)); // (the watcher's turn)
          const at = logSize(server?.log);
          const r = await timedGet(base + route);
          const again = await timedGet(base + route);
          result.edits.push({ file, route, recompileMs: r.ms, afterMs: again.ms, log: requestLines(logFrom(server?.log, at)) });
          console.error(`edit ${file} → ${route}: ${sec(r.ms)} (then ${sec(again.ms)})`);
        } finally {
          fs.writeFileSync(abs, before);
        }
      }
    }
    if (server) {
      result.memoryMb = treeMemoryMb(server.pid);
      // What the dev server wrote: its server and browser chunks (a measure of how often the same code was bundled again).
      const dev = path.join(REPO, server.distDir, "dev");
      result.distMb = { server: dirMb(path.join(dev, "server")), static: dirMb(path.join(dev, "static")), cache: dirMb(path.join(dev, "cache")) };
    }
  } finally {
    await browser.close();
    // (--log <file>: the server's own log kept — the test server's folder goes with it)
    if (server && val("--log")) fs.copyFileSync(server.log, val("--log"));
    if (server && !has("--keep")) await stopTestServer(server.pid).catch((e) => console.error(String(e)));
    else if (server) console.error(`left running: pid ${server.pid}, ${base} (node scripts/test-server.mjs --stop ${server.pid})`);
  }
  console.log(`\nperf-dev ${result.commit}  server up in ${sec(result.startMs)}  memory ${result.memoryMb ?? "—"} MB  written: server ${result.distMb?.server ?? "—"} MB, static ${result.distMb?.static ?? "—"} MB, cache ${result.distMb?.cache ?? "—"} MB`);
  console.log("| route | cold ttfb | cold ready | warm ttfb | warm ready | Next (cold) |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const { route, cold, warm } of result.routes) console.log(`| ${route} | ${sec(cold.ttfb)} | ${sec(cold.ready)} | ${sec(warm.ttfb)} | ${sec(warm.ready)} | ${cold.log.find((l) => l.includes(` ${route.split("?")[0]} `)) ?? cold.log[0] ?? ""} |`);
  for (const e of result.edits) console.log(`| edit ${e.file} | recompile ${sec(e.recompileMs)} | then ${sec(e.afterMs)} | | | ${e.log[0] ?? ""} |`);
  const out = val("--out");
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
