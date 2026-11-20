import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { FlowAction } from "../workspace/flows/actions";
import type { FieldSpec } from "../workspace/flows/types";

/**
 * What the Code engine lets lambdas and flows do with its sessions (the kernel's service behind the Code screens — it works while the built-in Code plugin is
 * on or its port is): the session list, a session's conversation with what it asks of you, and — for flows with the permission “api” — starting a session,
 * sending a message, answering a permission, interrupting, stopping, archiving, deleting. The workers, runs, the work host and the log files stay the kernel's;
 * a lambda only reads. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const mayChange = (ctx: { may: (n: "api") => void }) => ctx.may("api");
const need = () => {
  if (!isInstalled("work")) throw new Error(t("The Code plugin is not installed (Menu → Plugins)."));
};
const int = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
const bool = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The rule "allow always" would add, in words (null: none). */
function alwaysLabel(suggestions: unknown[]): string | null {
  const parts: string[] = [];
  for (const s of suggestions as { type?: string; mode?: string; rules?: { toolName?: string; ruleContent?: string }[]; directories?: string[] }[]) {
    if (s.type === "setMode" && s.mode) parts.push(s.mode === "acceptEdits" ? t("accept edits this session") : t("mode {m}", { m: s.mode }));
    else if (s.type === "addRules") parts.push(...(s.rules ?? []).map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : (r.toolName ?? "?"))));
    else if (s.type === "addDirectories") parts.push(t("access to {d}", { d: (s.directories ?? []).join(", ") }));
  }
  return parts.length ? parts.join(", ").slice(0, 80) : null;
}

/** The files and pictures waiting to go with the next message (scope: "new" or "run:<id>") — kept in a pref, taken when it is sent. */
const PENDING_KEY = "workPendingAttachments";
async function pendingOf(scope: string): Promise<{ ref: string; name: string; size: number }[]> {
  const { getPref } = await import("@/lib/prefs");
  const all = getPref<Record<string, { ref: string; name: string; size: number }[]>>(PENDING_KEY, {});
  return Array.isArray(all[scope]) ? all[scope] : [];
}
async function setPending(scope: string, list: { ref: string; name: string; size: number }[]) {
  const { getPref, setPref } = await import("@/lib/prefs");
  const all = { ...getPref<Record<string, unknown>>(PENDING_KEY, {}) };
  if (list.length) all[scope] = list;
  else delete all[scope];
  setPref(PENDING_KEY, all);
}
const scopeOf = (v: unknown) => (/^(new|run:\d+)$/.test(String(v ?? "")) ? String(v) : "");

/** A log line with its long texts cut (a live view re-reads the tail every second: bounded). */
function slim(l: import("@/lib/work/shared").WorkLogLine) {
  const o: Record<string, unknown> = { ...l };
  for (const k of ["text", "answer", "cmd"]) if (typeof o[k] === "string") o[k] = clip(o[k] as string, k === "text" ? 2400 : 600);
  delete o.full;
  delete o.detail;
  if (Array.isArray(o.diff)) o.diff = (o.diff as { old: string; new: string }[]).slice(0, 3).map((d) => ({ old: clip(d.old, 400), new: clip(d.new, 400) }));
  return o;
}

export const WORK_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "work.session-list",
    group: "work",
    label: "The sessions of the Code tab",
    summary:
      "The tickets with sessions (a session = a todo's conversation with a worker, shown as its newest run), each with its sessions: id, ref, status, whether it is live or waits for you, provider, title, time, todo, branch, archived; and how many are archived and running.",
    input: [f("archived", "boolean", { help: "Your archived sessions too (marked)." })],
    output: "{ tickets: [{ ticket, summary, status, url, openTodos, active, lastAt, sessions: [{ id, ref, status, live, waiting, provider, title, at, todoId, branch, archived }] }], archivedCount, running, gitMissing, settingsPage, tabs: [{ id, title, plugin, href }], panels: [{ id, plugin, entry, title }] }",
    run: async (i) => {
      need();
      const { sessionTickets } = await import("@/lib/work/sessions");
      const { archivedSessions } = await import("@/lib/work/session-admin");
      const tickets = sessionTickets({ archived: bool(i.archived) });
      const running = tickets.reduce((n, x) => n + x.sessions.filter((s) => s.status === "running").length, 0);
      const { gitAvailable, gitMissingMessage } = await import("@/lib/git");
      const { extWorkPanels } = await import("@/lib/ext/work");
      return {
        tickets: tickets.filter((x) => x.sessions.length > 0),
        archivedCount: archivedSessions().size,
        running,
        gitMissing: gitAvailable() ? "" : gitMissingMessage(),
        settingsPage: (await import("./to-plugin")).workSettingsPage(),
        tabs: extWorkPanels("tab").map((x) => ({ id: x.id, title: x.title, plugin: x.pluginName, href: x.href })),
        panels: extWorkPanels("session").map((x) => ({ id: x.id, plugin: x.plugin, entry: x.entry, title: x.title })),
      };
    },
  },
  {
    name: "work.asks",
    group: "work",
    label: "What the workers on a todo ask of you",
    summary:
      "What the live sessions on a todo (input todo) wait on you for — a permission to allow, a question, a plan — each with the answers that can be given (buttons with the flow input work.live takes: run, do, requestId, behavior, option …) and the modes the session can be switched to (Agent, Plan, Autopilot / Auto …). Nothing waiting: an empty list.",
    input: [f("todo", "number", { required: true })],
    output: "{ codePage, asks: [{ run, ref, provider, title, detail, openOnly, buttons: [{ label, primary, with }], modes: [{ label, sel, with }] }] }",
    run: async (i) => {
      need();
      const { runsForTodos } = await import("@/lib/work/store");
      const { workRef } = await import("@/lib/work/shared");
      const { askTitle } = await import("@/lib/work/live-driver");
      const todo = int(i.todo);
      const asks = (runsForTodos([todo]).get(todo) ?? [])
        .filter((r) => r.status === "running")
        .flatMap((r) => {
          const modes = (r.live?.modes ?? []).map((m) => ({ label: m.name || m.id, sel: m.id === r.live?.mode, with: `run=${r.id}, do=mode, mode=${m.id}` }));
          const base = { run: r.id, ref: workRef(r.id), provider: r.provider, modes };
          const s = r.session;
          if (s?.asks.length) {
            const a = s.asks[0];
            const open = a.tool === "ExitPlanMode" || a.tool === "AskUserQuestion";
            const answer = `run=${r.id}, do=answer, requestId=${a.requestId}`;
            const detail = clip(String(a.input.command ?? a.input.file_path ?? a.input.path ?? a.input.url ?? a.input.pattern ?? a.description ?? ""), 600);
            return [
              {
                ...base,
                title: askTitle(a, t),
                detail,
                openOnly: open,
                buttons: open
                  ? []
                  : [
                      { label: t("Allow"), primary: true, with: `${answer}, behavior=allow` },
                      ...(a.suggestions.length > 0 ? [{ label: alwaysLabel(a.suggestions) ? t("Always: {rule}", { rule: alwaysLabel(a.suggestions) ?? "" }) : t("Always"), primary: false, with: `${answer}, behavior=allow, always=true` }] : []),
                      { label: t("Deny"), primary: false, with: `${answer}, behavior=deny` },
                    ],
              },
            ];
          }
          const p = r.live?.permission;
          if (p) {
            return [{ ...base, title: p.title, detail: p.detail ?? "", openOnly: false, buttons: p.options.map((o) => ({ label: o.name, primary: o.kind === "allow_once", with: `run=${r.id}, do=answer-option, option=${o.id}` })) }];
          }
          return [];
        });
      return { asks, codePage: (await import("./to-plugin")).workCodePage() ?? 0 };
    },
  },
  {
    name: "work.session-open",
    group: "work",
    label: "A session: its conversation",
    summary:
      "A session (any run of its conversation): the todo, its ticket card, the newest run's state, the conversation — every run on the todo, oldest first, each with your words and the last `tail` log lines of all (default 150) — and what a live session asks of you (asks: a permission, a plan, a question), its modes, whether it works.",
    input: [f("run", "number", { required: true }), f("tail", "number", { help: "How many log lines at most (all runs together), the newest." })],
    output:
      "{ found, todo: { id, ref, text }, ticket, card, last: { id, ref, status, provider, branch, repo, cwd, costUsd, elevated }, active, statusText, cost, side: [{ todoId, text, active }], turns: [{ runId, ref, label, ask, status, lines }], live: { busy, host, queued, modes, asks }, git }",
    run: async (i) => {
      need();
      const { getRun, runsForTodos, toRunView } = await import("@/lib/work/store");
      const { getTodo } = await import("@/lib/todos/store");
      const { todoRef } = await import("@/lib/todos/shared");
      const { getTicketCards } = await import("@/lib/jira/store");
      const { isActive, WORK_MODE_LABELS } = await import("@/lib/work/shared");
      const { sideTodos } = await import("@/lib/work/actions");
      const { readLog } = await import("@/lib/work/log");
      const raw = getRun(int(i.run));
      if (!raw) return { found: false, error: t("That session doesn't exist any more.") };
      const run = toRunView(raw);
      const todo = getTodo(run.todoId);
      const runs = [...(runsForTodos([run.todoId]).get(run.todoId) ?? [run])].reverse().map((r) => (r.id === run.id ? run : r));
      const last = runs[runs.length - 1] ?? run;
      const active = isActive(last.status);
      const card = last.ticket ? getTicketCards([last.ticket])[last.ticket.toUpperCase()] : undefined;
      let room = Math.max(10, Math.min(500, Number(i.tail) || 150));
      // The newest turns get the lines (the oldest are cut first).
      const turns = runs
        .slice()
        .reverse()
        .map((r) => {
          const lines = readLog(r.id).lines;
          const take = Math.min(lines.length, Math.max(0, room));
          room -= take;
          return {
            runId: r.id,
            ref: r.ref,
            label: `${WORK_MODE_LABELS[r.mode]}${todo ? ` · ${todoRef(todo.id)} ${todo.text}` : ""}`,
            ask: todo?.userNotes.filter((n) => n.kind === "instruction" && n.run === r.id).map((n) => n.text).join("\n\n") || null,
            status: r.status,
            cut: lines.length - take,
            lines: lines.slice(lines.length - take).map(slim),
          };
        })
        .reverse();
      const s = last.session;
      const l = last.live;
      const busyNow = last.status === "running" ? (await (await import("@/lib/work/live-state")).liveState(last.id)).busy : false;
      const live = s
        ? { kind: "session", busy: !!busyNow, host: s.host, queued: s.queued, modes: s.modes, asks: s.asks.map((a) => ({ requestId: a.requestId, tool: a.tool, description: a.description, reason: a.reason, at: a.at, always: a.suggestions.length > 0, alwaysLabel: alwaysLabel(a.suggestions), diffs: a.tool === "Edit" ? [{ old: clip(String(a.input.old_string ?? ""), 1500), new: clip(String(a.input.new_string ?? ""), 1500) }] : a.tool === "MultiEdit" && Array.isArray(a.input.edits) ? (a.input.edits as Record<string, string>[]).slice(0, 8).map((x) => ({ old: clip(String(x.old_string ?? ""), 800), new: clip(String(x.new_string ?? ""), 800) })) : [], input: { command: clip(String(a.input.command ?? ""), 1500), file_path: String(a.input.file_path ?? a.input.path ?? ""), plan: clip(String(a.input.plan ?? ""), 8000), questions: Array.isArray(a.input.questions) ? a.input.questions.slice(0, 4) : undefined, url: String(a.input.url ?? ""), pattern: String(a.input.pattern ?? "") } })), mode: l?.mode ?? "", model: s.model, models: s.models.map((m) => ({ value: m.value, label: m.label })), effort: s.effort, allowBypass: s.allowBypass, features: s.features, provider: s.provider, commands: s.commands.slice(0, 300), shellPending: s.shellPending, sessionElevated: s.elevated }
        : l
          ? { kind: "live", busy: !!l.busy, permission: l.permission ?? null, mode: l.mode, modes: l.modes, waiting: l.waiting }
          : null;
      const cost = runs.reduce((n, r) => n + (r.costUsd ?? 0), 0) + (s?.costUsd && !last.costUsd ? s.costUsd : 0);
      return {
        found: true,
        todo: todo ? { id: todo.id, ref: todoRef(todo.id), text: todo.text } : null,
        ticket: last.ticket,
        card: card ? { summary: card.summary ?? "", status: card.status ?? "", assignee: card.assignee ?? "", url: card.url ?? "", issueType: card.issueType ?? "" } : null,
        last: { id: last.id, ref: last.ref, status: last.status, provider: last.provider, branch: last.branch, repo: last.repo, cwd: last.cwd, costUsd: last.costUsd, elevated: !!s?.elevated, summary: last.summary, error: last.error },
        active,
        cost,
        side: sideTodos(runs.map((r) => r.id))
          .filter((x) => x.todoId !== run.todoId)
          .map((x) => ({ todoId: x.todoId, ref: todoRef(x.todoId), text: getTodo(x.todoId)?.text ?? "", active: x.active })),
        turns,
        live,
        git: !!last.cwd && !!last.repo,
      };
    },
  },
  {
    name: "work.session-changes",
    group: "work",
    label: "A session's changes",
    summary: "Every file a session changed since it began (git, in its folder): path, status, added, removed, the patch (cut) — and its dev servers from .claude/launch.json with their state and output (procs).",
    input: [f("run", "number", { required: true })],
    output: "{ found, base, files: [{ path, status, added, removed, patch, binary }], truncated, procs: [{ name, port, url, running, startedAt, log }], error }",
    run: async (i) => {
      need();
      const { getRun } = await import("@/lib/work/store");
      const run = getRun(int(i.run));
      if (!run) return { found: false, error: t("That session doesn't exist any more.") };
      const { sessionDiff } = await import("@/lib/work/session-git");
      const { listProcs } = await import("@/lib/work/session-procs");
      let diff: Awaited<ReturnType<typeof sessionDiff>> = { base: "", files: [], truncated: false };
      let error = "";
      try {
        diff = await sessionDiff(run);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      let procs: unknown[] = [];
      try {
        procs = listProcs(run).map((p) => ({ ...p, log: clip(p.log ?? "", 6000) }));
      } catch {
        // no launch file
      }
      return { found: true, base: diff.base, files: diff.files.map((x) => ({ ...x, patch: clip(x.patch ?? "", 20000) })), truncated: diff.truncated, procs, error };
    },
  },
  {
    name: "work.session-git",
    group: "work",
    label: "Commit, push, merge request, dev servers of a session",
    summary: "do = commit (message) | push | mr (title) | proc-start (name) | proc-stop (name) in the session's folder. Needs the “api” permission. Output { message, url }.",
    input: [f("run", "number", { required: true }), f("do", "text", { required: true }), f("message", "text"), f("title", "text"), f("name", "text")],
    output: "{ message, url }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      need();
      if (ctx.dryRun) return { dryRun: true };
      const { getRun } = await import("@/lib/work/store");
      const run = getRun(int(i.run));
      if (!run) throw new Error(t("That session doesn't exist any more."));
      const g = await import("@/lib/work/session-git");
      switch (String(i.do)) {
        case "commit":
          return { message: t("Committed: {c}", { c: await g.commitSession(run, String(i.message ?? "").slice(0, 4000)) }) };
        case "push":
          return { message: t("Pushed {b}", { b: await g.pushSession(run) }) };
        case "mr": {
          const r = await g.openSessionMr(run, String(i.title ?? "").slice(0, 300));
          return { message: r.existed ? t("There was one already: {u}", { u: r.url ?? "" }) : t("Opened: {u}", { u: r.url ?? "" }), url: r.url ?? "" };
        }
        case "proc-start":
          await (await import("@/lib/work/session-procs")).startProc(run, String(i.name ?? ""));
          return { message: "" };
        case "proc-stop":
          (await import("@/lib/work/session-procs")).stopProc(run, String(i.name ?? ""));
          return { message: "" };
        default:
          throw new Error(t("Unknown action."));
      }
    },
  },
  {
    name: "work.composer",
    group: "work",
    label: "What the message box offers",
    summary: "The Code tab's message box: the installed backends (provider, whether live) with their modes, models, effort, administrator choice and defaults, the repos (id, name, path), and each ticket's repo as Zeff infers it.",
    input: [f("tickets", "list", { help: "Tickets to infer a repo for." })],
    output: "{ defaultProvider, providers: [{ id, label, live }], choices: { <provider>: { modes: [{ id, label, hint, tone }], defaultMode, models: [{ value, label }], effort, defaultEffort, admin } }, repos: [{ id, name, path }], ticketRepos: { <ticket>: path } }",
    run: async (i) => {
      need();
      const { composerOptions } = await import("@/lib/work/composer-options");
      const { listRepos, repoForTicket } = await import("@/lib/repos");
      const c = await composerOptions();
      const keys = (Array.isArray(i.tickets) ? i.tickets : String(i.tickets ?? "").split(",")).map((x) => String(x).trim().toUpperCase()).filter(Boolean).slice(0, 100);
      const ticketRepos: Record<string, string> = {};
      for (const k of keys) {
        const m = repoForTicket(k);
        if (m) ticketRepos[k] = m.repo.path;
      }
      return { ...c, repos: listRepos().map((r) => ({ id: r.id, name: r.name, path: r.path })), ticketRepos };
    },
  },
  {
    name: "work.settings",
    group: "work",
    label: "The Code settings",
    summary:
      "The workers' settings (how many at once, reserved pools, permission mode, Copilot mode, where code work happens, model, house rules, the copied instructions), the live Claude sessions' settings, the models of the chosen provider, the repos (with their folder state, boards, tickets, delivery) and the choices for them (GitLab projects, Jira boards), whether Admin sessions is installed.",
    input: [],
    output: "{ settings, claude, preferred, defaultModel, models, pools, repos, choices, limits: { maxParallel, maxReserved }, admin }",
    run: async () => {
      need();
      const { workSettingsData } = await import("@/lib/work/view");
      const { aiChoice } = await import("@/lib/ai");
      const { claudeSessionSettings } = await import("@/lib/work/store");
      const { MAX_PARALLEL, MAX_RESERVED } = await import("@/lib/work/slots");
      const { listRepos, repoChoices } = await import("@/lib/repos");
      const { getRepoSystems } = await import("@/plugins/knowledge/repo-systems-store");
      const copilot = aiChoice().provider === "copilot" ? await (await import("@/plugins/copilot-cli/cli")).copilotModels() : [];
      const d = workSettingsData(copilot);
      return { settings: d.settings, claude: claudeSessionSettings(), preferred: d.preferred, defaultModel: d.defaultModel, models: d.models, pools: d.pools, repos: listRepos().map((r) => ({ ...r, systems: getRepoSystems(r.id)?.summary ?? null, systemsRead: !!getRepoSystems(r.id) })), choices: repoChoices(), limits: { maxParallel: MAX_PARALLEL, maxReserved: MAX_RESERVED }, admin: isInstalled("work-elevated") };
    },
  },
  {
    name: "work.settings-save",
    group: "work",
    label: "Change a Code setting",
    summary:
      "One setting changed, the rest kept: scope = work (field: parallel | permissionMode | copilotMode | isolation | model | instructions | agentInstructionCode | agentInstructionOther | reserved:<source>) or claude (field: live | mode | autoMode | effort | allowBypass | askTimeoutMin); value as text (true/false for switches). Checked as the Settings page checks it. Needs the “api” permission.",
    input: [f("scope", "text", { required: true }), f("field", "text", { required: true }), f("value", "text")],
    output: "{ message }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      need();
      if (ctx.dryRun) return { dryRun: true };
      const { getWorkSettings, claudeSessionSettings } = await import("@/lib/work/store");
      const { saveWorkSettingsAction, saveClaudeSessionSettingsAction } = await import("./server-actions");
      const field = String(i.field ?? "");
      const value = String(i.value ?? "");
      const fd = new FormData();
      if (i.scope === "claude") {
        const c = { ...claudeSessionSettings(), [field]: field === "live" || field === "allowBypass" ? bool(value) : field === "askTimeoutMin" ? Number(value) || 0 : value } as Record<string, unknown>;
        for (const k of ["mode", "autoMode", "effort", "askTimeoutMin"]) fd.set(k, String(c[k] ?? ""));
        if (c.live) fd.set("live", "on");
        if (c.allowBypass) fd.set("allowBypass", "on");
        const r = await saveClaudeSessionSettingsAction(null, fd);
        if (!r?.ok) throw new Error(r?.error ?? t("Didn't work."));
        return { message: r.message ?? t("Saved.") };
      }
      if (i.scope !== "work") throw new Error(t("Unknown action."));
      const s = getWorkSettings();
      const cur: Record<string, string> = { parallel: String(s.parallel), permissionMode: s.permissionMode, copilotMode: s.copilotMode, isolation: s.isolation, model: s.model, instructions: s.instructions, agentInstructionCode: s.agentInstructions.code, agentInstructionOther: s.agentInstructions.other };
      for (const [src, n] of Object.entries(s.reserved)) cur[`reserved:${src}`] = String(n);
      cur[field] = value;
      for (const [k, v] of Object.entries(cur)) fd.set(k, v);
      const r = await saveWorkSettingsAction(null, fd);
      if (!r?.ok) throw new Error(r?.error ?? t("Didn't work."));
      return { message: r.message ?? t("Saved.") };
    },
  },
  {
    name: "work.repo-save",
    group: "work",
    label: "Add or change a repo",
    summary: "A repo for workers: new, or the one with id changed (part = delivery changes only the delivery). name, path, gitlabProject, boards (ids, comma separated), tickets (keys), instructions, delivery mr | direct. Needs the “api” permission.",
    input: [f("id", "number"), f("part", "text"), f("name", "text"), f("path", "text"), f("gitlabProject", "text"), f("boards", "text"), f("tickets", "text"), f("instructions", "text"), f("delivery", "text")],
    output: "{ message }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      need();
      if (ctx.dryRun) return { dryRun: true };
      const { saveRepoAction } = await import("./server-actions");
      const { listRepos } = await import("@/lib/repos");
      const id = int(i.id);
      const was = id ? listRepos().find((r) => r.id === id) : undefined;
      if (id && !was) throw new Error(t("That repo isn't there any more."));
      const fd = new FormData();
      if (id) fd.set("id", String(id));
      const delivery = String(i.delivery ?? "") === "direct" ? "direct" : String(i.delivery ?? "") === "mr" ? "mr" : (was?.delivery ?? "mr");
      if (was && i.part === "delivery") {
        fd.set("name", was.name);
        fd.set("path", was.path);
        fd.set("gitlabProject", was.gitlabProject ?? "");
        for (const b of was.boards) fd.append("boards", String(b));
        fd.set("tickets", was.tickets.join(","));
        fd.set("instructions", was.instructions);
      } else {
        fd.set("name", String(i.name ?? ""));
        fd.set("path", String(i.path ?? ""));
        fd.set("gitlabProject", String(i.gitlabProject ?? ""));
        for (const b of String(i.boards ?? "").split(/[\s,;]+/).filter(Boolean)) fd.append("boards", b);
        fd.set("tickets", String(i.tickets ?? ""));
        fd.set("instructions", String(i.instructions ?? ""));
      }
      fd.set("delivery", delivery);
      const r = await saveRepoAction(null, fd);
      if (!r?.ok) throw new Error(r?.error ?? t("Didn't work."));
      return { message: r.message ?? t("Saved.") };
    },
  },
  {
    name: "work.repo-delete",
    group: "work",
    label: "Remove a repo",
    summary: "A repo taken off the list (its folder is not touched). Needs the “api” permission.",
    input: [f("id", "number", { required: true })],
    output: "{}",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      need();
      if (ctx.dryRun) return { dryRun: true };
      (await import("@/lib/repos")).deleteRepo(int(i.id));
      return {};
    },
  },
  {
    name: "work.attach",
    group: "work",
    label: "Attach a file or picture to the next message",
    summary: "A file a view's upload brought (token) kept for the next message of this scope (new | run:<id>): pictures and documents, at most 10, 20 MB each — the worker reads them (a live session takes pictures). Needs the “api” permission.",
    input: [f("scope", "text", { required: true }), f("token", "text", { required: true }), f("name", "text", { required: true })],
    output: "{ ref, name, size }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      need();
      const scope = scopeOf(i.scope);
      if (!scope) throw new Error(t("Unknown action."));
      const fsx = await import("node:fs");
      const { stagedPath } = await import("@/plugins/workspace/uploads-staging");
      const from = await stagedPath(i.token);
      if (!fsx.existsSync(from)) throw new Error(t("The uploaded file isn't there any more — upload it again."));
      if (ctx.dryRun) return { dryRun: true };
      const { saveAttachment, MAX_ATTACHMENTS } = await import("@/lib/work/attachments");
      const list = await pendingOf(scope);
      if (list.length >= MAX_ATTACHMENTS) throw new Error(t("At most {n} files.", { n: MAX_ATTACHMENTS }));
      const saved = saveAttachment(String(i.name ?? "file"), fsx.readFileSync(/*turbopackIgnore: true*/ from));
      fsx.rmSync(/*turbopackIgnore: true*/ from, { force: true });
      await setPending(scope, [...list, saved]);
      return saved;
    },
  },
  {
    name: "work.attach-remove",
    group: "work",
    label: "Take an attachment off the next message",
    summary: "One waiting attachment (ref) or all of them (no ref) of a scope dropped. Needs the “api” permission.",
    input: [f("scope", "text", { required: true }), f("ref", "text")],
    output: "{}",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      need();
      const scope = scopeOf(i.scope);
      if (!scope || ctx.dryRun) return {};
      await setPending(scope, i.ref ? (await pendingOf(scope)).filter((x) => x.ref !== String(i.ref)) : []);
      return {};
    },
  },
  {
    name: "work.attachments",
    group: "work",
    label: "The attachments waiting for the next message",
    summary: "The files and pictures of a scope (new | run:<id>) waiting to go with the next message.",
    input: [f("scope", "text", { required: true })],
    output: "{ files: [{ ref, name, size }] }",
    run: async (i) => {
      need();
      return { files: await pendingOf(scopeOf(i.scope)) };
    },
  },
  {
    name: "work.session-files",
    group: "work",
    label: "Files of a session's folder, for @",
    summary: "The files in a session's folder whose path contains q (at most what the message box shows).",
    input: [f("run", "number", { required: true }), f("q", "text")],
    output: "{ files: [path] }",
    run: async (i) => {
      need();
      const { getRun } = await import("@/lib/work/store");
      const run = getRun(int(i.run));
      if (!run?.cwd) return { files: [] };
      const { sessionFiles } = await import("@/lib/work/session-git");
      try {
        return { files: await sessionFiles(run, String(i.q ?? "")) };
      } catch {
        return { files: [] };
      }
    },
  },
  {
    name: "work.repo-systems",
    group: "work",
    label: "Read the repos' systems from the knowledge",
    summary: "The systems (Prod, Test/Stage, Dev) of all repos read from the knowledge again by the AI. Needs the “api” permission.",
    input: [],
    output: "{ message }",
    writes: true,
    run: async (_i, ctx) => {
      mayChange(ctx);
      need();
      if (ctx.dryRun) return { dryRun: true };
      const { readRepoSystemsAction } = await import("./server-actions");
      const r = await readRepoSystemsAction();
      if (!r?.ok) throw new Error(r?.error ?? t("Didn't work."));
      return { message: r.message ?? t("Saved.") };
    },
  },
  {
    name: "work.branches",
    group: "work",
    label: "The branches a session can switch to",
    summary: "The branches of the git repo a session works in (and where each is checked out), with the current one.",
    input: [f("run", "number"), f("path", "text")],
    output: "{ ok, error, current, branches: [{ name, remote, current, worktree }] }",
    run: async (i) => {
      need();
      const { getRun } = await import("@/lib/work/store");
      const { listBranches, repoRoot } = await import("@/lib/work/git");
      // (A folder of its own instead of a session: the branches a new session can start from.)
      const own = String(i.path ?? "").trim();
      if (own) {
        if (!repoRoot(own)) return { ok: false, error: t("{folder} isn't in a git repo.", { folder: own }), branches: [] };
        return { ok: true, ...listBranches(own) };
      }
      const run = getRun(int(i.run));
      if (!run?.cwd) return { ok: false, error: t("This session has no folder of its own."), branches: [] };
      if (!repoRoot(run.cwd)) return { ok: false, error: t("{folder} isn't in a git repo.", { folder: run.cwd }), branches: [] };
      return { ok: true, ...listBranches(run.cwd) };
    },
  },
  {
    name: "work.folders",
    group: "work",
    label: "The folders of this computer",
    summary: "The sub-folders of a folder (names only; no path: the home folder, ::drives: the drives on Windows), with which are git repos — what a new session's folder is picked from.",
    input: [f("path", "text")],
    output: "{ ok, error, path, parent, repo, dirs: [{ name, path, repo }] }",
    run: async (i) => {
      need();
      const { listFolder } = await import("@/lib/work/folders");
      try {
        return { ok: true, ...listFolder(String(i.path ?? "")) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e), dirs: [] };
      }
    },
  },
  {
    name: "work.session-branch",
    group: "work",
    label: "Switch a session's branch",
    summary: "The branch a session works on switched (when it is idle, nothing is uncommitted and the branch isn't checked out elsewhere). Needs the “api” permission.",
    input: [f("run", "number", { required: true }), f("branch", "text", { required: true })],
    output: "{ message }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      need();
      if (ctx.dryRun) return { dryRun: true };
      const { switchSessionBranchAction } = await import("./server-actions");
      const r = await switchSessionBranchAction(int(i.run), String(i.branch ?? ""));
      if (!r.ok) throw new Error(r.error);
      return { message: t("Now on {branch}.", { branch: r.branch }) };
    },
  },
  {
    name: "work.dangling",
    group: "work",
    label: "Sessions that count as running but aren't working",
    summary: "The runs that hold a worker without working (a session waiting for you or left over from before a restart, a worker whose process is gone) and how many runs wait for a worker.",
    input: [],
    output: "{ dangling: [{ id, ref, why }], queued }",
    run: async () => {
      need();
      const { danglingRuns } = await import("@/lib/work/runner");
      const { runsByStatus } = await import("@/lib/work/store");
      return { dangling: danglingRuns(), queued: runsByStatus(["queued"]).length };
    },
  },
  {
    name: "work.dangling-end",
    group: "work",
    label: "Kill all dangling sessions",
    summary: "Each dangling session stopped, their workers free, the queue goes on. Needs the “api” permission.",
    input: [],
    output: "{ ended: [id], message }",
    writes: true,
    run: async (_i, ctx) => {
      mayChange(ctx);
      need();
      if (ctx.dryRun) return { dryRun: true };
      const { endDanglingRuns } = await import("@/lib/work/runner");
      const r = endDanglingRuns() as { ended?: number[] };
      return { ...r, message: t("{n} sessions ended — the workers are free.", { n: r.ended?.length ?? 0 }) };
    },
  },
  {
    name: "work.admin",
    group: "work",
    label: "Admin sessions: how they start",
    summary: "Whether the Admin sessions plugin is installed, the platform is Windows, the scheduled task is set up, Zeff itself runs elevated, and how admin sessions start (task | uac).",
    input: [],
    output: "{ installed, windows, task, elevated, mode }",
    run: async () => {
      need();
      if (!isInstalled("work-elevated")) return { installed: false, windows: process.platform === "win32", task: false, elevated: false, mode: "uac" };
      const e = await import("@/plugins/work-elevated/elevate");
      const windows = process.platform === "win32";
      const [task, elevated] = windows ? await Promise.all([e.taskInstalled(), e.zeffElevated()]) : [false, false];
      return { installed: true, windows, task, elevated, mode: e.elevationMode() };
    },
  },
  {
    name: "work.admin-do",
    group: "work",
    label: "Set up or remove automatic admin sessions",
    summary: "do = install (the scheduled task — Windows asks for administrator rights once) | remove | uac (ask each time). Needs the “api” permission.",
    input: [f("do", "text", { required: true })],
    output: "{ message }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      need();
      if (ctx.dryRun) return { dryRun: true };
      const { setAdminSessionsAction } = await import("./server-actions");
      const fd = new FormData();
      fd.set("do", String(i.do ?? ""));
      const r = await setAdminSessionsAction(null, fd);
      if (!r?.ok) throw new Error(r?.error ?? t("Didn't work."));
      return { message: r.message ?? t("Saved.") };
    },
  },
  {
    name: "work.session-start",
    group: "work",
    label: "Start a session",
    summary: "A new session (a new todo and a worker on it, like the Code tab's message box): instruction, ticket, repoId, provider. Needs the flow's “api” permission. Never in a dry run.",
    input: [f("instruction", "text", { required: true }), f("ticket", "text"), f("repoId", "number"), f("provider", "text"), f("repoPath", "text"), f("branch", "text"), f("workspace", "text", { help: "worktree | branch | checkout" }), f("mode", "text"), f("model", "text"), f("effort", "text"), f("elevated", "boolean"), f("attach", "text", { help: "The pending attachments of this scope (new | run:<id>) go with it." })],
    output: "{ runId }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      need();
      if (ctx.dryRun) return { dryRun: true };
      const { startSessionAction } = await import("./server-actions");
      const scope = scopeOf(i.attach);
      const pending = scope ? await pendingOf(scope) : [];
      const r = await startSessionAction({ attachments: pending.map((x) => x.ref), instruction: String(i.instruction ?? ""), ticket: String(i.ticket ?? ""), repoId: int(i.repoId) || undefined, provider: String(i.provider ?? "") || undefined,
        repoPath: String(i.repoPath ?? "") || undefined,
        branch: String(i.branch ?? "") || undefined,
        workspace: String(i.workspace ?? "") || undefined,
        session: { ...(i.mode ? { permissionMode: String(i.mode) } : {}), ...(i.model ? { model: String(i.model) } : {}), ...(i.effort ? { effort: String(i.effort) as never } : {}), ...(bool(i.elevated) ? { elevated: true } : {}) },
      });
      if (!r.ok) throw new Error(r.error);
      if (scope) await setPending(scope, []);
      return { runId: r.runId };
    },
  },
  {
    name: "work.session-send",
    group: "work",
    label: "Send a message into a session",
    summary: "Your next message in a session's conversation (queued while the worker still answers; a finished run goes on with it). Needs the “api” permission.",
    input: [f("run", "number", { required: true }), f("text", "text"), f("attach", "text")],
    output: "{ runId }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      need();
      if (ctx.dryRun) return { dryRun: true };
      const { startSessionAction } = await import("./server-actions");
      const scope = scopeOf(i.attach);
      const pending = scope ? await pendingOf(scope) : [];
      const r = await startSessionAction({ instruction: String(i.text ?? ""), continueRunId: int(i.run), attachments: pending.map((x) => x.ref) });
      if (!r.ok) throw new Error(r.error);
      if (scope) await setPending(scope, []);
      return { runId: r.runId };
    },
  },
  {
    name: "work.session-live",
    group: "work",
    label: "Do something in a live session",
    summary:
      "What you do in a live session: do = send (text) | interrupt | mode (mode) | model (model) | effort (effort) | wrap-up | close | answer (requestId, behavior allow|deny, always, message, interrupt, then (the mode a plan goes on in), answers (JSON: question → answer)) | answer-option (a Copilot permission: option). Needs the “api” permission.",
    input: [
      f("run", "number", { required: true }),
      f("do", "text", { required: true }),
      f("requestId", "text"),
      f("behavior", "text"),
      f("always", "boolean"),
      f("message", "text"),
      f("interrupt", "boolean"),
      f("then", "text"),
      f("answers", "text"),
      f("mode", "text"),
      f("model", "text"),
      f("effort", "text"),
      f("option", "text"),
      f("text", "text"),
      f("cmd", "text"),
      f("attach", "text"),
    ],
    output: "{ out, code }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      need();
      if (ctx.dryRun) return { dryRun: true };
      const { liveDo } = await import("@/lib/work/live-actions");
      const what = String(i.do ?? "");
      let answers: Record<string, string> | undefined;
      if (i.answers && typeof i.answers === "string") {
        try {
          const v = JSON.parse(i.answers);
          if (v && typeof v === "object" && !Array.isArray(v)) answers = v as Record<string, string>;
        } catch {
          // not JSON: no answers
        }
      } else if (i.answers && typeof i.answers === "object") answers = i.answers as Record<string, string>;
      const body =
        what === "answer-option"
          ? { do: "answer", option: String(i.option ?? "") }
          : what === "answer"
            ? { do: "answer", requestId: String(i.requestId ?? ""), answer: { behavior: i.behavior === "deny" ? ("deny" as const) : ("allow" as const), always: bool(i.always), message: String(i.message ?? "") || undefined, interrupt: bool(i.interrupt), then: String(i.then ?? "") || undefined, answers } }
            : { do: what, text: String(i.text ?? ""), mode: String(i.mode ?? ""), model: String(i.model ?? ""), effort: String(i.effort ?? "") };
      // Pictures waiting for this message go along with it (base64, as the message box sends them).
      const scope = scopeOf(i.attach);
      if (what === "send" && scope) {
        const pending = await pendingOf(scope);
        if (pending.length) {
          const { resolveAttachments } = await import("@/lib/work/attachments");
          const fsx = await import("node:fs");
          const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
          const images = resolveAttachments(pending.map((x) => x.ref)).map((a) => ({ mediaType: types[a.name.split(".").pop()?.toLowerCase() ?? ""] ?? "", data: fsx.readFileSync(/*turbopackIgnore: true*/ a.path).toString("base64") }));
          (body as { images?: unknown }).images = images;
        }
      }
      if (what === "shell") (body as { cmd?: string }).cmd = String(i.cmd ?? "");
      const out = await liveDo(int(i.run), body);
      if (what === "send" && scope && !(out as { fresh?: unknown }).fresh) await setPending(scope, []);
      return out;
    },
  },
  {
    name: "work.session-stop",
    group: "work",
    label: "Stop a session's run",
    summary: "A run stopped, or taken out of the queue. Needs the “api” permission.",
    input: [f("run", "number", { required: true })],
    output: "{}",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      need();
      if (ctx.dryRun) return { dryRun: true };
      const { cancelRun } = await import("@/lib/work/runner");
      cancelRun(int(i.run));
      return {};
    },
  },
  {
    name: "work.session-archive",
    group: "work",
    label: "Archive a session (or bring it back)",
    summary: "A session (a todo's conversation) put out of the sidebar, or back (archived false). Needs the “api” permission.",
    input: [f("todo", "number", { required: true }), f("archived", "boolean")],
    output: "{}",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      need();
      if (ctx.dryRun) return { dryRun: true };
      const { setSessionArchived } = await import("@/lib/work/session-admin");
      setSessionArchived(int(i.todo), i.archived === undefined ? true : bool(i.archived));
      return {};
    },
  },
  {
    name: "work.session-delete",
    group: "work",
    label: "Delete a session",
    summary: "A session deleted for good: its runs and logs (not while it works); its todo stays. Needs the “api” permission.",
    input: [f("todo", "number", { required: true })],
    output: "{ runs }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      need();
      if (ctx.dryRun) return { dryRun: true };
      const { deleteSession } = await import("@/lib/work/session-admin");
      return { runs: deleteSession(int(i.todo)) };
    },
  },
];

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("work", WORK_FLOW_ACTIONS);
