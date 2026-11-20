/**
 * What a Zeff server does once when it starts (Node.js only) — called by instrumentation.ts: context items become one item per
 * linked source (see unifySources), work runs are picked up again, and the periodic syncs start.
 *
 * Its parts are imported here statically, not one `await import()` each: in the bundler every dynamic import is a chunk group of
 * its own, carrying everything it reaches that its parent hasn't got — with the parent holding nothing, each of the ~30 imports
 * here carried most of Zeff again (the dev server built and wrote the instrumentation ~48 times over: 1.2 GB, about a minute
 * before the first page). One import of this file from instrumentation.ts is one chunk group; what is still loaded on demand
 * below (only when it is needed) brings only what isn't in it yet.
 */
import { EventEmitter } from "node:events";
import { loadMods } from "./lib/mods/server";
import { failInterruptedRuns } from "./lib/runs/store";
import { accountsInstalled, listAccounts, withAccount } from "./db/accounts";
import { startSyncScheduler } from "./lib/sync-scheduler";
import { unifySources } from "./lib/contexts";
import "./lib/i18n/plugin-strings";
import { startPackagesWatch } from "./lib/ext/packages-sync";
import { lockEnabled } from "./lib/lock/shared";
import { delegates, runsWork } from "./lib/host/role";
import { isInstalled, RETIRED_PLUGINS_ONCE, rewriteRetiredPlugins } from "./plugins/state";
import { readingDocuments } from "./plugins/documents/store";
import { onceDone } from "./lib/once-done";
import { ensureSystemPrompts } from "./lib/prompts";
import { keepCommentsFromRuns } from "./lib/jira/comments";
import { resumeWork } from "./lib/work/runner";
import { writeKnowledgeInstances } from "./plugins/knowledge/instances";
import { startExtWatcher } from "./lib/ext/work";

type Boot = { bootStep: (step: string) => void; bootReady: () => void } | null;

export async function startServer(boot: Boot) {
  // The mods that are on (docs/mods.md): their hooks in place before the first request — also for what renders no page (API, actions).
  boot?.bootStep("loading the mods");
  try {
    const failed = loadMods(true);
    if (failed.length) console.warn("[mods] not loaded:", failed.join("; "));
  } catch (e) {
    console.error("[mods] loading failed", e);
  }
  // A big streamed page makes Next's gzip stream collect drain listeners while it waits for the socket: Node warned about
  // "a possible memory leak" on every such page (thousands of lines that hid the real errors in the log). They go when the
  // response ends, so the limit is raised — a true leak still shows, only later.
  EventEmitter.defaultMaxListeners = 50;
  // The sync host (see lib/host/role.ts) does only what the web server hands it: the scheduler and the runs.
  // Resuming work runs, documents, the plugin event watcher … stay with the web server — twice would be wrong.
  if (process.env.ZEFF_ROLE === "sync") {
    try {
      // A board run or recap can't outlive the server that ran it — this one, now.
      for (const a of listAccounts()) withAccount(a.id, failInterruptedRuns);
    } catch (e) {
      console.error("[sync host] marking interrupted runs failed", e);
    }
    startSyncScheduler();
    console.log("[sync host] the scheduler and the runs are here now");
    boot?.bootReady();
    return;
  }
  try {
    const { copies, split, merged } = unifySources();
    if (copies + split + merged) {
      console.log(`[context] one item per source: ${copies} copied message(s) cleared, ${split} item(s) split, ${merged} duplicate(s) merged`);
    }
  } catch (e) {
    console.error("[context] unifying linked sources failed", e);
  }
  // (The runtime plugins' own texts — contributes.locales — for t() on the server are read by the import of lib/i18n/plugin-strings above.)
  boot?.bootStep("following packages.json (the plugins)");
  try {
    // packages.json (the plugins this Zeff has, and where from): followed when it changes; the repositories checked for newer versions.
    startPackagesWatch();
  } catch (e) {
    console.error("[packages] starting the watch on packages.json failed", e);
  }
  try {
    // The lock (Settings → Lock): the key watcher ends every session the moment the security key is pulled out.
    if (lockEnabled()) (await import("./lib/lock/detect")).startKeyWatch();
  } catch (e) {
    console.error("[lock] starting the key watcher failed", e);
  }
  // A web server with a sync host: the briefing, the syncs and the recap run there, not here — so a restart of this
  // server interrupts none of them (and doesn't fail their rows). It copies what the host is doing instead.
  if (delegates()) (await import("./lib/host/mirror")).startHostMirror();
  try {
    if (!runsWork()) throw new Error("skipped");
    // A board run or recap can't outlive the server that ran it — in every account, not only the one you're in.
    for (const a of listAccounts()) withAccount(a.id, failInterruptedRuns);
  } catch (e) {
    if (!(e instanceof Error && e.message === "skipped")) console.error("[boards] marking interrupted runs failed", e);
  }
  try {
    // Documents a server that has gone left "being read": waiting again, and read — in every account that keeps documents.
    for (const a of listAccounts()) {
      await withAccount(a.id, async () => {
        if (!isInstalled("documents")) return;
        if (readingDocuments().length) (await import("./plugins/documents/process")).startProcessing();
      });
    }
  } catch (e) {
    console.error("[documents] picking up the waiting documents failed", e);
  }
  try {
    for (const a of listAccounts()) {
      // The ids of plugins that went (kanban, notes, keep-write) out of what you set — once.
      await withAccount(a.id, async () => {
        await onceDone(RETIRED_PLUGINS_ONCE, rewriteRetiredPlugins);
      }).catch((e) => console.error("[plugins] rewriting the retired plugin ids failed", e));
      // System → Prompts in the Workspace (a page per prompt; what the settings had goes in once).
      await withAccount(a.id, async () => ensureSystemPrompts()).catch((e) => console.error("[prompts] the system pages failed", e));
      // My briefing replaced by Meine Lage, a database with a pipeline like any other (where Jira is in use).
      await withAccount(a.id, async () => {
        if (isInstalled("jira-lage") && isInstalled("workspace")) await (await import("./plugins/jira-lage/to-workspace")).replaceBriefingOnce();
      }).catch((e) => console.error("[jira] Meine Lage as a pipeline database failed", e));
    }
  } catch (e) {
    console.error("[workspace] setting up the accounts failed", e);
  }
  try {
    keepCommentsFromRuns(); // once: the comments past runs read
  } catch (e) {
    console.error("[boards] keeping comments failed", e);
  }
  boot?.bootStep("resuming the work runs");
  try {
    // Workers that outlived the old server are watched again, the queue goes on — in every account: one left out kept its
    // live sessions (a lesson's chat waiting for you) counted as working, and with the workers taken a new message waited
    // in the queue for good.
    const ids = accountsInstalled() ? listAccounts().filter((a) => !a.demo).map((a) => a.id) : [null];
    for (const id of ids)
      try {
        if (id === null) resumeWork();
        else withAccount(id, () => resumeWork());
      } catch (e) {
        console.error(`[work] resuming work runs${id ? ` (account ${id})` : ""} failed`, e);
      }
  } catch (e) {
    console.error("[work] resuming work runs failed", e);
  }
  try {
    writeKnowledgeInstances(); // the launcher runs a knowledge server per account with the plugin
  } catch (e) {
    console.error("[knowledge] listing the knowledge servers failed", e);
  }
  boot?.bootStep("starting the plugins' event watcher");
  try {
    startExtWatcher(); // external plugins' work.changed / todos.changed events
  } catch (e) {
    console.error("[ext] starting the event watcher failed", e);
  }
  if (runsWork()) startSyncScheduler();
  // The first page after a start no longer pays for loading the flow engine, the lambda runner and the plugin scan: done now, in the
  // background, once the server is up (a failure here only means the first page does it, as before).
  setTimeout(() => {
    void (async () => {
      try {
        const { scanPlugins } = await import("./lib/ext/registry");
        await import("./plugins/contributions");
        await Promise.all([import("./plugins/workspace/flows/engine"), import("./plugins/workspace/lambdas/run"), import("./plugins/workspace/actions/flows"), import("./lib/data-cache")]);
        for (const a of listAccounts()) withAccount(a.id, () => scanPlugins());
      } catch {
        // the first page does it
      }
    })();
  }, 1500).unref?.();
  boot?.bootReady();
}
