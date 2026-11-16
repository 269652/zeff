import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";

setupTempData();

/**
 * The Code tab's port (zeff-plugins/plugins/work-ext): its lambda `work.screen` gives what the screen draws from the kernel's reads (work.session-list /
 * work.session-open) — the same sessions, grouped and sorted as the built-in sidebar does (session-groups.ts) —, what changes something is a flow that needs
 * "api", and the screen (views/work.html) draws without an error. Never starts a worker: the runs here are rows and log files only.
 */

const skip = skipWithoutRepo("work-ext");
type Row = { id: number; title: string; ticket: string; dot: string; ago: string; selected: boolean; archived: boolean; active: boolean; todoId: number };
type Group = { key: string; heading: string; ticket: string; n: number; rows: Row[] };
type Line = { k: string; text: string; answer: string; bad: boolean };
type Screen = {
  mode: string;
  groups: Group[];
  total: number;
  archivedCount: number;
  running: number;
  ticketPage?: { title: string; sessions: { id: number }[] };
  session?: { found: boolean; runId: number; title: string; statusText: string; active: boolean; turns: { runId: number; ask: string; lines: Line[]; cut: string }[]; canReplyLive: boolean; asks: unknown[]; error: string };
};

let made: ReturnType<typeof build> | null = null;
const world = () => (made ??= build());
async function build() {
  const plugins = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-work-ext-"));
  process.env.ZEFF_PLUGINS_DIR = plugins;
  fs.cpSync(repoPlugin("work-ext"), path.join(plugins, "work-ext"), { recursive: true });
  const state = await import("@/plugins/state");
  for (const id of ["workspace", "todos", "work"]) state.setInstalled(id as never, true);
  await import("@/plugins/contributions");
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  reg.setEnabled("work-ext", true);
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("work-ext"), "work.package.json"), "utf8"));
  const r = await (await import("@/plugins/workspace/package-life")).installTracked(pkg, null, { allow: true });
  const lambdas = await import("@/plugins/workspace/lambdas/store");
  const { runLambda } = await import("@/plugins/workspace/lambdas/run");
  const call = async <T>(name: string, event: Record<string, unknown>): Promise<T> => {
    const l = lambdas.getLambda(name);
    assert.ok(l, `${name} is there`);
    const run = await runLambda(l!, event);
    assert.ok(run.ok, run.ok ? "" : run.error);
    return run.result as T;
  };
  // Sessions: a todo each with a finished run (a log with the worker's words and a tool call), one still queued, one failed, and one on another ticket.
  const { addSessionTodo } = await import("@/lib/todos/store");
  const { createRun, updateRun } = await import("@/lib/work/store");
  const { logPath } = await import("@/lib/work/log");
  const mk = (ticket: string, text: string, status: string, at: string) => {
    const todo = addSessionTodo({ ticket, text });
    assert.ok("id" in todo, "the todo is made");
    const run = createRun({ ticket, todoId: (todo as { id: number }).id, mode: "instruct", provider: "claude", model: null, permissionMode: null, repo: null, prompt: text });
    updateRun(run.id, { status, startedAt: at, finishedAt: status === "done" || status === "failed" ? at : null, error: status === "failed" ? "boom" : null });
    return { run: run.id, todo: (todo as { id: number }).id };
  };
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600e3).toISOString();
  const a = mk("PROJ-1", "Fix the login", "done", hoursAgo(1));
  const b = mk("PROJ-2", "Write the docs", "failed", hoursAgo(30));
  const c = mk("", "A question about the repo", "queued", hoursAgo(0.1));
  fs.mkdirSync(path.dirname(logPath(a.run)), { recursive: true });
  fs.writeFileSync(
    logPath(a.run),
    [
      { type: "system", subtype: "init", session_id: "s1", model: "sonnet", cwd: "C:/x", permissionMode: "auto" },
      { type: "assistant", message: { content: [{ type: "text", text: "I fixed it." }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "all green" }] } },
      { type: "result", subtype: "success", result: "done", total_cost_usd: 0.5 },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n",
  );
  return { allowed: r.allowed, call, a, b, c };
}

test("the screen's lambda lists the sessions as the built-in's sidebar: one per todo, grouped by time, the tickets, the queued one first by priority", { skip }, async () => {
  const { call, a, b, c } = await world();
  const { sessionTickets } = await import("@/lib/work/sessions");
  const built = sessionTickets().flatMap((t) => t.sessions.map((s) => s.id)).sort();
  const screen = await call<Screen>("work.screen", {});
  assert.equal(screen.mode, "new");
  assert.deepEqual(screen.groups.flatMap((g) => g.rows.map((r) => r.id)).sort(), built);
  assert.deepEqual(built, [a.run, b.run, c.run].sort());
  // (Newest: by time — the two recent ones today or earlier, the 30-hour-old one never in "Today" unless it is.)
  assert.ok(screen.groups.every((g) => g.heading), "every group has a heading by time");
  assert.ok(screen.groups.some((g) => g.rows.some((r) => r.id === b.run)));
  const byTicket = await call<Screen>("work.screen", { sort: "ticket" });
  assert.deepEqual(byTicket.groups.map((g) => g.ticket).sort(), ["No ticket", "PROJ-1", "PROJ-2"].sort());
  const byPriority = await call<Screen>("work.screen", { sort: "priority" });
  assert.equal(byPriority.groups[0].rows[0].id, c.run, "what works comes first");
  const alpha = await call<Screen>("work.screen", { sort: "alpha" });
  assert.deepEqual(alpha.groups[0].rows.map((r) => r.title), ["A question about the repo", "Fix the login", "Write the docs"]);
  const found = await call<Screen>("work.screen", { q: "docs" });
  assert.deepEqual(found.groups.flatMap((g) => g.rows.map((r) => r.id)), [b.run]);
  // The red and the green dot.
  const dots = Object.fromEntries(screen.groups.flatMap((g) => g.rows).map((r) => [r.id, r.dot]));
  assert.equal(dots[a.run], "🟢");
  assert.equal(dots[b.run], "🔴");
});

test("a session's page: the conversation lines as the log reads them, the state, the cost; a ticket's page; a missing session", { skip }, async () => {
  const { call, a, b } = await world();
  const s = await call<Screen>("work.screen", { sel: `run:${a.run}` });
  assert.equal(s.mode, "session");
  assert.equal(s.session!.found, true);
  assert.equal(s.session!.title, "Fix the login");
  assert.equal(s.session!.active, false);
  const lines = s.session!.turns.flatMap((t) => t.lines);
  assert.ok(lines.some((l) => l.k === "say" && l.text === "I fixed it."));
  assert.ok(lines.some((l) => l.k === "tool" && l.text.includes("npm test")));
  assert.equal(s.session!.canReplyLive, false);
  assert.ok(s.groups.flatMap((g) => g.rows).find((r) => r.id === a.run)!.selected);
  const failed = await call<Screen>("work.screen", { sel: `run:${b.run}` });
  assert.equal(failed.session!.error, "boom");
  const ticket = await call<Screen>("work.screen", { sel: "ticket:proj-1" });
  assert.equal(ticket.mode, "ticket");
  assert.deepEqual(ticket.ticketPage!.sessions.map((x) => x.id), [a.run]);
  const none = await call<Screen>("work.screen", { sel: "run:99999" });
  assert.equal(none.session!.found, false);
});

test("what changes something is a flow with the permission api: archive and delete a session, stop a queued run; the dry run touches nothing", { skip }, async () => {
  const { a, b, c, allowed } = await world();
  assert.deepEqual([...allowed].sort(), ["work.admin", "work.archive", "work.attach", "work.attach-remove", "work.branch", "work.dangling-end", "work.delete", "work.git", "work.live", "work.repo-delete", "work.repo-delivery", "work.repo-save", "work.repo-systems", "work.send", "work.setting", "work.start", "work.stop"]);
  const engine = await import("@/plugins/workspace/flows/engine");
  const { sessionTickets } = await import("@/lib/work/sessions");
  const ids = () => sessionTickets().flatMap((t) => t.sessions.map((s) => s.id));
  assert.equal((await engine.runFlow("work.archive", { todo: b.todo, archived: "true" }, { dry: true })).status, "done");
  assert.ok(ids().includes(b.run));
  assert.equal((await engine.runFlow("work.archive", { todo: b.todo, archived: "true" })).status, "done");
  assert.ok(!ids().includes(b.run), "archived: out of the list");
  assert.ok(sessionTickets({ archived: true }).flatMap((t) => t.sessions).some((s) => s.id === b.run && s.archived), "…and back with the archived ones");
  assert.equal((await engine.runFlow("work.archive", { todo: b.todo, archived: "false" })).status, "done");
  assert.ok(ids().includes(b.run));
  // A working (queued) session is not deleted; stopping it takes it out of the queue.
  assert.equal((await engine.runFlow("work.delete", { todo: c.todo })).status, "failed");
  assert.equal((await engine.runFlow("work.stop", { run: c.run })).status, "done");
  assert.equal((await engine.runFlow("work.delete", { todo: c.todo })).status, "done");
  assert.ok(!ids().includes(c.run));
  assert.equal((await engine.runFlow("work.delete", { todo: a.todo })).status, "done");
  assert.ok(!ids().includes(a.run));
});

test("the screen's template draws without an error: new, a session (idle and asking), a ticket, an empty list", { skip }, async () => {
  const { call, b } = await world();
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("work-ext"), "views", "work.html"), "utf8");
  const draw = (x: unknown, state: Record<string, string>) =>
    renderView(template, { rows: [], props: [], titleName: "Code", state: { ...state }, app: {}, data: { x, started: { runId: 1 } }, db: { id: 1, title: "Code" } } as never);
  assert.deepEqual(draw(await call("work.screen", {}), { sel: "" }).errors, []);
  assert.deepEqual(draw(await call("work.screen", { sel: `run:${b.run}` }), { sel: `run:${b.run}` }).errors, []);
  assert.deepEqual(draw(await call("work.screen", { sel: "ticket:PROJ-2" }), { sel: "ticket:PROJ-2" }).errors, []);
  assert.deepEqual(draw(await call("work.screen", { sel: "run:99999" }), { sel: "run:99999" }).errors, []);
  assert.deepEqual(draw(await call("work.screen", { q: "nothing-matches-this" }), { q: "nothing-matches-this" }).errors, []);
  // A live session asking: a permission, a plan, a question — shaped as the lambda gives them.
  const ASK_BASE = { has0: false, has1: false, has2: false, has3: false, qt0: "", qt1: "", qt2: "", qt3: "", submit: "{}", ready: false, more: "", diff: "", reason: "", alwaysLabel: "Always: Bash(npm test)", alwaysTip: "x" };
  const asking = {
    mode: "session",
    groups: [],
    total: 0,
    archivedCount: 0,
    running: 1,
    labels: { nothing: "", newTitle: "", newHint: "", showArchived: "" },
    session: {
      found: true,
      runId: 7,
      title: "T",
      statusText: "waits for your answer",
      active: true,
      status: "running",
      tone: "plain",
      elevated: false,
      ticket: "ABC-1",
      todoRef: "T-1",
      todoId: 1,
      cost: "$0.10",
      side: [{ todoId: 2, ref: "T-2", text: "side", active: true }],
      turns: [{ runId: 7, ref: "W-7", ask: "do it", cut: "3 earlier lines are cut.", lines: [{ i: 0, k: "say", text: "hi", answer: "", bad: false, diff: "" }, { i: 1, k: "tool", text: "Edit  a.ts", answer: "", bad: false, diff: "- a\n+ b" }, { i: 2, k: "out", text: "bad", answer: "", bad: true, diff: "" }, { i: 3, k: "ask", text: "ok?", answer: "yes", bad: false, diff: "" }] }],
      kind: "session",
      busy: true,
      queuedLabel: "1 message(s) wait their turn.",
      modes: [{ id: "default", label: "Ask", hint: "asks", sel: true }],
      models: [{ value: "", label: "Default", sel: true }],
      efforts: [{ value: "", label: "Effort: default", sel: true }],
      menu: [{ next: "/x ", label: "/x", hint: "" }],
      files: [{ ref: "a/b.png", name: "b.png", size: "3 KB" }],
      attachScope: "run:7",
      hasAsk: true,
      isShell: false,
      shellCmd: "",
      hostText: "waits for your answer",
      shellPendingLabel: "1 command output(s) go along with your next message",
      panels: [{ key: "x0", plugin: "p", entry: "e.html", title: "P" }],
      paneOptions: ",x0:P",
      copilot: { mode: "agent", modes: [{ id: "a#agent", name: "Agent", sel: true, hint: "h" }], waiting: "your move", idle: true, status: "waiting for you" },
      asks: [
        { requestId: "r1", tool: "Bash", plan: false, question: false, title: "It wants to use Bash", description: "", detail: "npm test", planText: "", always: true, questions: [], bypass: false, ...ASK_BASE, diff: "- a\n+ b", reason: "why", more: "(+2 more)" },
        { requestId: "r2", tool: "ExitPlanMode", plan: true, question: false, title: "Its plan", description: "", detail: "", planText: "# Plan", always: false, questions: [], bypass: true, ...ASK_BASE },
        { requestId: "r3", tool: "AskUserQuestion", plan: false, question: true, title: "It asks you", description: "", detail: "", planText: "", always: false, bypass: false, ...ASK_BASE, has0: true, has1: true, qt0: "Which?", qt1: "And?", ready: true, submit: "{}", questions: [{ question: "Which?", header: "H", idx: 0, multi: false, other: "", ready: true, answer: "A", options: [{ label: "A", description: "", on: true, mark: "● ", next: "{}" }] }] },
      ],
      permission: null,
      canReplyLive: true,
      error: "",
      placeholder: "Reply …",
    },
  };
  assert.deepEqual(draw(asking, { sel: "run:7" }).errors, []);
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("work-ext"), "work.package.json"), "utf8")) as { items: { schema?: { views: { template: string }[] } }[] };
  assert.equal(pkg.items.find((i) => i.schema)?.schema?.views[0].template, template);
});

test("the panes: a session's changes as the built-in's diff reads them (a changed, a new file), and a commit through the flow; the dev servers", { skip }, async () => {
  const { call, b: a } = await world(); // (the other two are gone by now)
  const { execFileSync } = await import("node:child_process");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-work-repo-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" });
  git("init", "-q");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  const base = git("rev-parse", "HEAD").trim();
  const { updateRun, getRun } = await import("@/lib/work/store");
  updateRun(a.run, { cwd: repo, repo, baseSha: base });
  fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
  fs.writeFileSync(path.join(repo, "b.txt"), "new\n");
  type Panes = { found: boolean; summary: string; empty: boolean; files: { path: string; status: string; added: number; removed: number; patch: string }[]; procs: unknown[]; noProcs: string };
  const panes = await call<Panes>("work.panes", { run: a.run });
  const { sessionDiff } = await import("@/lib/work/session-git");
  const built = await sessionDiff(getRun(a.run)!);
  assert.deepEqual(panes.files.map((f) => [f.path, f.added, f.removed]), built.files.map((f) => [f.path, f.added, f.removed]));
  assert.deepEqual(panes.files.map((f) => f.path).sort(), ["a.txt", "b.txt"]);
  assert.match(panes.files.find((f) => f.path === "a.txt")!.patch, /\+two/);
  assert.ok(panes.noProcs, "no launch file: said so");
  const engine = await import("@/plugins/workspace/flows/engine");
  assert.equal((await engine.runFlow("work.git", { run: a.run, do: "commit", message: "both" }, { dry: true })).status, "done");
  assert.equal(git("log", "--oneline").trim().split("\n").length, 1, "the dry run committed nothing");
  const done = await engine.runFlow("work.git", { run: a.run, do: "commit", message: "both" });
  assert.equal(done.status, "done", done.error ?? undefined);
  assert.equal(git("log", "--oneline").trim().split("\n").length, 2);
  assert.equal((await engine.runFlow("work.git", { run: a.run, do: "nonsense" })).status, "failed");
  // The template draws with the panes.
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("work-ext"), "views", "work.html"), "utf8");
  const x = await call("work.screen", { sel: `run:${a.run}` });
  const withProcs = { ...panes, procs: [{ name: "web", running: true, url: "http://localhost:3000", showUrl: true, log: "ready", dot: "🟢" }, { name: "api", running: false, url: "", showUrl: false, log: "", dot: "⚪" }] };
  for (const pane of ["chat", "changes", "preview"])
    assert.deepEqual(renderView(template, { rows: [], props: [], titleName: "Code", state: { sel: `run:${a.run}`, pane }, app: {}, data: { x, panes: withProcs, gitresult: { message: "ok" } }, db: { id: 1, title: "Code" } } as never).errors, [], pane);
});

test("the message box's options: providers, modes, repos as the built-in's composer offers them; a ticket's repo is inferred", { skip }, async () => {
  const { call } = await world();
  const { composerOptions } = await import("@/lib/work/composer-options");
  const built = await composerOptions();
  type C = { provider: string; providers: { id: string; sel: boolean }[]; modes: { id: string }[]; repos: { path: string; sel: boolean }[]; workspaces: { id: string }[]; live: boolean };
  const screen = await call<{ composer: C }>("work.screen", {});
  assert.deepEqual(screen.composer.providers.map((p) => p.id), built.providers.map((p) => p.id));
  assert.equal(screen.composer.provider, built.defaultProvider);
  assert.deepEqual(screen.composer.modes.map((m) => m.id), (built.choices[built.defaultProvider]?.modes ?? []).map((m) => m.id));
  assert.deepEqual(screen.composer.workspaces.map((w) => w.id), ["", "worktree", "branch", "checkout"]);
  assert.ok(screen.composer.repos[0].sel, "no repo picked: the first, as Zeff infers it");
});

test("the settings: read as the Settings page reads them, one setting changed at a time and checked, repos added, switched to direct delivery and removed", { skip }, async () => {
  const { call } = await world();
  const engine = await import("@/plugins/workspace/flows/engine");
  const { getWorkSettings, claudeSessionSettings } = await import("@/lib/work/store");
  type S = { parallel: number; permission: { id: string; sel: boolean }[]; claude: { live: boolean; mode: { id: string; sel: boolean }[] }; repos: { id: number; name: string; delivery: string }[]; models: { sel: boolean }[] };
  const s = await call<S>("work.settings", {});
  assert.equal(s.parallel, getWorkSettings().parallel);
  assert.equal(s.permission.find((p) => p.sel)?.id, getWorkSettings().permissionMode);
  assert.equal(s.claude.live, claudeSessionSettings().live);
  assert.ok(s.models.filter((m) => m.sel).length === 1);
  // A change keeps the rest.
  const before = getWorkSettings();
  assert.equal((await engine.runFlow("work.setting", { scope: "work", field: "parallel", value: "3" })).status, "done");
  assert.equal(getWorkSettings().parallel, 3);
  assert.equal(getWorkSettings().permissionMode, before.permissionMode);
  assert.equal((await engine.runFlow("work.setting", { scope: "work", field: "parallel", value: "99" })).status, "failed", "out of range: refused");
  assert.equal((await engine.runFlow("work.setting", { scope: "work", field: "isolation", value: "checkout" })).status, "done");
  assert.equal(getWorkSettings().isolation, "checkout");
  assert.equal((await engine.runFlow("work.setting", { scope: "work", field: "instructions", value: "Run the tests." })).status, "done");
  assert.equal(getWorkSettings().instructions, "Run the tests.");
  assert.equal((await engine.runFlow("work.setting", { scope: "claude", field: "mode", value: "plan" })).status, "done");
  assert.equal(claudeSessionSettings().mode, "plan");
  assert.equal((await engine.runFlow("work.setting", { scope: "claude", field: "mode", value: "bypassPermissions" })).status, "failed", "bypass isn't allowed yet");
  assert.equal((await engine.runFlow("work.setting", { scope: "claude", field: "allowBypass", value: "true" })).status, "done");
  assert.equal((await engine.runFlow("work.setting", { scope: "claude", field: "askTimeoutMin", value: "10" })).status, "done");
  assert.equal(claudeSessionSettings().askTimeoutMin, 10);
  assert.equal((await engine.runFlow("work.setting", { scope: "work", field: "parallel", value: "5" }, { dry: true })).status, "done");
  assert.equal(getWorkSettings().parallel, 3, "a dry run changes nothing");
  // Repos.
  const { execFileSync } = await import("node:child_process");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-work-repo2-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  assert.equal((await engine.runFlow("work.repo-save", { name: "Nowhere", path: path.join(repo, "nope") })).status, "failed", "not a git repo");
  const added = await engine.runFlow("work.repo-save", { name: "Mine", path: repo, tickets: "ABC-1, abc-2" });
  assert.equal(added.status, "done", added.error ?? undefined);
  const { listRepos } = await import("@/lib/repos");
  const mine = listRepos().find((r) => r.name === "Mine")!;
  assert.deepEqual(mine.tickets, ["ABC-1", "ABC-2"]);
  assert.equal(mine.delivery, "mr");
  assert.equal((await engine.runFlow("work.repo-delivery", { id: mine.id, delivery: "direct" })).status, "done");
  const after = listRepos().find((r) => r.id === mine.id)!;
  assert.equal(after.delivery, "direct");
  assert.deepEqual(after.tickets, ["ABC-1", "ABC-2"], "only the delivery changed");
  const shown = await call<S>("work.settings", {});
  assert.equal(shown.repos.find((r) => r.id === mine.id)?.delivery, "direct");
  assert.equal((await engine.runFlow("work.repo-delete", { id: mine.id })).status, "done");
  assert.ok(!listRepos().some((r) => r.id === mine.id));
  // The settings template draws.
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("work-ext"), "views", "work-settings.html"), "utf8");
  const withRepo = { ...shown, repos: [{ id: 1, name: "R", path: "C:/r", ok: true, state: "on main", gitlabProject: "", boardsText: "", boards: "no boards", tickets: "", instructions: "", systems: "", systemsNote: "Not read yet", delivery: "mr", mr: true, direct: false }], pools: [{ source: "learn", label: "Reserved for Learn", n: 1, more: 2, less: 0, hint: "x" }] };
  for (const state of [{}, { instred: "1", instr: "x" }, { agented: "1" }, { repoedit: "1" }])
    assert.deepEqual(renderView(template, { rows: [], props: [], titleName: "Code settings", state: { ...state }, app: {}, data: { s: withRepo, result: { message: "Saved." } }, db: { id: 1, title: "Code settings" } } as never).errors, [], JSON.stringify(state));
  assert.deepEqual(renderView(template, { rows: [], props: [], titleName: "Code settings", state: {}, app: {}, data: { s: null }, db: { id: 1, title: "Code settings" } } as never).errors, []);
});

test("the rest of the page: dangling sessions are listed and ended, a session's branch is switched, Admin sessions state is read", { skip }, async () => {
  const { call, b } = await world();
  const engine = await import("@/plugins/workspace/flows/engine");
  const { execFileSync } = await import("node:child_process");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-work-repo3-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  git("branch", "feature");
  const { updateRun } = await import("@/lib/work/store");
  updateRun(b.run, { cwd: repo, repo, branch: "main" });
  type Page = { dangling: { n: number; text: string }; session: { repoName: string; idle: boolean; branchList: { name: string; current: boolean; disabled: boolean }[]; branch: string } };
  const closed = await call<Page>("work.screen", { sel: `run:${b.run}` });
  assert.equal(closed.session.repoName, path.basename(repo));
  assert.equal(closed.session.idle, true);
  assert.deepEqual(closed.session.branchList, []);
  const open = await call<Page>("work.screen", { sel: `run:${b.run}`, branches: "true" });
  assert.deepEqual(open.session.branchList.map((x) => x.name).sort(), ["feature", "main"]);
  assert.ok(open.session.branchList.find((x) => x.name === "main")!.current);
  const sw = await engine.runFlow("work.branch", { run: b.run, branch: "feature" });
  assert.equal(sw.status, "done", sw.error ?? undefined);
  assert.equal(git("rev-parse", "--abbrev-ref", "HEAD").trim(), "feature");
  assert.equal((await engine.runFlow("work.branch", { run: b.run, branch: "nope" })).status, "failed");
  // Dangling: a "running" run nobody works on.
  const dang = await engine.runFlow("work.dangling-end", {}, { dry: true });
  assert.equal(dang.status, "done");
  const none = await call<Page>("work.screen", {});
  assert.equal(none.dangling.n, 0);
  // Admin sessions: the plugin isn't installed here.
  const adm = await engine.runFlow("work.admin", { do: "uac" });
  assert.equal(adm.status, "failed", "the Admin sessions plugin isn't installed");
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("work-ext"), "views", "work.html"), "utf8");
  for (const branches of ["false", "true"])
    assert.deepEqual(renderView(template, { rows: [], props: [], titleName: "Code", state: { sel: `run:${b.run}`, branchopen: branches }, app: {}, data: { x: { ...open, dangling: { n: 1, text: "1 sessions count as running" } }, result: { message: "ok" } }, db: { id: 1, title: "Code" } } as never).errors, [], branches);
  const sTemplate = fs.readFileSync(path.join(repoPlugin("work-ext"), "views", "work-settings.html"), "utf8");
  const s = await call<Record<string, unknown>>("work.settings", {});
  for (const adminInfo of [{ windows: true, elevated: true, task: false, how: "UAC", taskText: "not set up" }, { windows: true, elevated: false, task: true, how: "task", taskText: "set up" }, { windows: false }])
    assert.deepEqual(renderView(sTemplate, { rows: [], props: [], titleName: "Code settings", state: {}, app: {}, data: { s: { ...s, admin: true, adminInfo } }, db: { id: 1, title: "Code settings" } } as never).errors, [], JSON.stringify(adminInfo));
});

test("attachments: a staged upload is kept for the next message of its scope, listed on the screen and taken off again; the kit's frame shows another address only", { skip }, async () => {
  const { call } = await world();
  const engine = await import("@/plugins/workspace/flows/engine");
  const { stagingDir } = await import("@/plugins/workspace/uploads-staging");
  const dir = await stagingDir();
  fs.mkdirSync(dir, { recursive: true });
  const token = "a".repeat(32);
  fs.writeFileSync(path.join(dir, token), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  assert.equal((await engine.runFlow("work.attach", { scope: "bad", token, name: "x.png" })).status, "failed");
  const dry = await engine.runFlow("work.attach", { scope: "new", token, name: "shot.png" }, { dry: true });
  assert.equal(dry.status, "done");
  assert.ok(fs.existsSync(path.join(dir, token)), "a dry run keeps the staged file");
  const done = await engine.runFlow("work.attach", { scope: "new", token, name: "shot.png" });
  assert.equal(done.status, "done", done.error ?? undefined);
  assert.ok(!fs.existsSync(path.join(dir, token)), "the staged file is taken");
  type C = { composer: { files: { ref: string; name: string; size: string }[] } };
  const screen = await call<C>("work.screen", {});
  assert.deepEqual(screen.composer.files.map((f) => f.name), ["shot.png"]);
  const { resolveAttachments } = await import("@/lib/work/attachments");
  assert.equal(resolveAttachments([screen.composer.files[0].ref]).length, 1, "the worker can read it");
  assert.equal((await engine.runFlow("work.attach-remove", { scope: "new", ref: screen.composer.files[0].ref })).status, "done");
  assert.deepEqual((await call<C>("work.screen", {})).composer.files, []);
  // The frame of the kit.
  const { renderView } = await import("@/plugins/workspace/view-template");
  const draw = (t: string) => renderView(t, { rows: [], props: [], titleName: "x", state: {}, app: {}, data: {}, db: { id: 1, title: "x" } } as never);
  assert.deepEqual(draw('<frame src="http://localhost:3000" h=400 title="Preview"/>').errors, []);
  assert.deepEqual(draw('<frame plugin="my-plugin" entry="panel.html" run="3" ticket="A-1" todo="2"/>').errors, []);
  assert.equal(draw('<frame src="/api/work/1/prompt"/>').errors.length, 1, "a page of Zeff's own is refused");
  assert.equal(draw('<frame src="javascript:alert(1)"/>').errors.length, 1);
});

test("switching to the plugin: its pages are found, the built-in stands in through it, the engine's actions go on working", { skip }, async () => {
  const { call } = await world();
  const state = await import("@/plugins/state");
  const ports = await import("@/plugins/ports");
  const port = ports.PORTS.find((p) => p.builtin === "work");
  assert.ok(port, "the Code port is registered");
  await port!.switch();
  const { workCodePage, workSettingsPage } = await import("@/plugins/work/to-plugin");
  const { getPage } = await import("@/plugins/workspace/store");
  assert.equal(getPage(workCodePage()!)?.title, "Sessions");
  assert.equal(getPage(workSettingsPage()!)?.title, "Code settings");
  assert.equal(state.isInstalled("work"), true, "the built-in counts as there through its port");
  assert.equal(state.onlyThroughPort("work"), true);
  // The kernel's reads still answer (the screens of the port are what ask them).
  const screen = await call<{ settingsHref: string }>("work.screen", {});
  assert.equal(screen.settingsHref, `/workspace/${workSettingsPage()}`);
});
