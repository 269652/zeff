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
    output: "{ tickets: [{ ticket, summary, status, url, openTodos, active, lastAt, sessions: [{ id, ref, status, live, waiting, provider, title, at, todoId, branch, archived }] }], archivedCount, running }",
    run: async (i) => {
      need();
      const { sessionTickets } = await import("@/lib/work/sessions");
      const { archivedSessions } = await import("@/lib/work/session-admin");
      const tickets = sessionTickets({ archived: bool(i.archived) });
      const running = tickets.reduce((n, x) => n + x.sessions.filter((s) => s.status === "running").length, 0);
      return { tickets: tickets.filter((x) => x.sessions.length > 0), archivedCount: archivedSessions().size, running };
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
        ? { kind: "session", busy: !!busyNow, host: s.host, queued: s.queued, modes: s.modes, asks: s.asks.map((a) => ({ requestId: a.requestId, tool: a.tool, description: a.description, reason: a.reason, at: a.at, always: a.suggestions.length > 0, input: { command: clip(String(a.input.command ?? ""), 1500), file_path: String(a.input.file_path ?? a.input.path ?? ""), plan: clip(String(a.input.plan ?? ""), 8000), questions: Array.isArray(a.input.questions) ? a.input.questions.slice(0, 4) : undefined, url: String(a.input.url ?? ""), pattern: String(a.input.pattern ?? "") } })), model: s.model, effort: s.effort, allowBypass: s.allowBypass, features: s.features, provider: s.provider }
        : l
          ? { kind: "live", busy: !!l.busy, permission: l.permission ?? null }
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
      const copilot = aiChoice().provider === "copilot" ? await (await import("@/plugins/copilot-cli/cli")).copilotModels() : [];
      const d = workSettingsData(copilot);
      return { settings: d.settings, claude: claudeSessionSettings(), preferred: d.preferred, defaultModel: d.defaultModel, models: d.models, pools: d.pools, repos: listRepos(), choices: repoChoices(), limits: { maxParallel: MAX_PARALLEL, maxReserved: MAX_RESERVED }, admin: isInstalled("work-elevated") };
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
    name: "work.session-start",
    group: "work",
    label: "Start a session",
    summary: "A new session (a new todo and a worker on it, like the Code tab's message box): instruction, ticket, repoId, provider. Needs the flow's “api” permission. Never in a dry run.",
    input: [f("instruction", "text", { required: true }), f("ticket", "text"), f("repoId", "number"), f("provider", "text"), f("repoPath", "text"), f("branch", "text"), f("workspace", "text", { help: "worktree | branch | checkout" }), f("mode", "text"), f("model", "text"), f("effort", "text"), f("elevated", "boolean")],
    output: "{ runId }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      need();
      if (ctx.dryRun) return { dryRun: true };
      const { startSessionAction } = await import("./server-actions");
      const r = await startSessionAction({ instruction: String(i.instruction ?? ""), ticket: String(i.ticket ?? ""), repoId: int(i.repoId) || undefined, provider: String(i.provider ?? "") || undefined,
        repoPath: String(i.repoPath ?? "") || undefined,
        branch: String(i.branch ?? "") || undefined,
        workspace: String(i.workspace ?? "") || undefined,
        session: { ...(i.mode ? { permissionMode: String(i.mode) } : {}), ...(i.model ? { model: String(i.model) } : {}), ...(i.effort ? { effort: String(i.effort) as never } : {}), ...(bool(i.elevated) ? { elevated: true } : {}) },
      });
      if (!r.ok) throw new Error(r.error);
      return { runId: r.runId };
    },
  },
  {
    name: "work.session-send",
    group: "work",
    label: "Send a message into a session",
    summary: "Your next message in a session's conversation (queued while the worker still answers; a finished run goes on with it). Needs the “api” permission.",
    input: [f("run", "number", { required: true }), f("text", "text", { required: true })],
    output: "{ runId }",
    writes: true,
    run: async (i, ctx) => {
      mayChange(ctx);
      need();
      if (ctx.dryRun) return { dryRun: true };
      const { startSessionAction } = await import("./server-actions");
      const r = await startSessionAction({ instruction: String(i.text ?? ""), continueRunId: int(i.run) });
      if (!r.ok) throw new Error(r.error);
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
    ],
    output: "{}",
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
      return await liveDo(int(i.run), body);
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
