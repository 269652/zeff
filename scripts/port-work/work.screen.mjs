import { groupSessions, priorityOf, stamp, tFor } from "./lib.mjs";

/**
 * What the Code screen shows (views/work.html reads it as data.x): the session list (grouped and sorted like the built-in's sidebar), and — by what is picked —
 * a session's conversation, a ticket's page or the new-session page. The kernel's reads work.session-list and work.session-open do the looking (the engine's own);
 * this shapes it for the view language: every line already a row of text, every ask already its buttons.
 * event: { sel ("run:12" | "ticket:ABC-1" | "ticket:-" | ""), q, sort, archived, tail, branches, all, msg, qpick, qo0..qo3, cprov, cmode, cmodel, ceffort, crepo, cws, cbrowse, cdir, cuse }
 */
const DOT = { running: "🔵", queued: "⚪", done: "🟢", failed: "🔴", cancelled: "⚪", interrupted: "🟠" };

export async function handler(event, context) {
  const zeff = context.zeff;
  const t = tFor(context.language);
  const sel = String(event?.sel ?? "");
  const run = /^run:(\d+)$/.test(sel) ? Number(sel.slice(4)) : 0;
  const ticketArg = sel.startsWith("ticket:") ? (sel.slice(7) === "-" ? "" : sel.slice(7).toUpperCase()) : undefined;
  const sort = ["newest", "priority", "ticket", "alpha"].includes(String(event?.sort)) ? String(event.sort) : "newest";
  const showArchived = String(event?.archived) === "true" || event?.archived === true;
  const words = String(event?.q ?? "").trim().toLowerCase();

  const statusText = (s) => ({ queued: t("queued"), running: t("working"), done: t("done"), failed: t("failed"), cancelled: t("stopped"), interrupted: t("interrupted") })[s] ?? s;
  const ago = (iso) => {
    const at = stamp(iso);
    if (!at) return "";
    const min = Math.max(0, Math.round((Date.now() - at) / 60000));
    return min < 1 ? t("now") : min < 60 ? `${min}m` : min < 1440 ? `${Math.floor(min / 60)}h` : min < 14 * 1440 ? `${Math.floor(min / 1440)}d` : `${Math.floor(min / (7 * 1440))}w`;
  };
  const when = (iso) => (iso ? new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).toLocaleString(context.language === "de" ? "de-DE" : context.language === "es" ? "es-ES" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");

  // ── the list
  const list = await zeff.call("work.session-list", { archived: showArchived });
  const found = list.tickets
    .map((tk) => ({ ...tk, sessions: tk.sessions.filter((s) => !words || `${tk.ticket} ${tk.summary ?? ""} ${s.title} ${s.branch ?? ""}`.toLowerCase().includes(words)) }))
    .filter((tk) => tk.sessions.length);
  const headings = { all: "", today: t("Today"), yesterday: t("Yesterday"), week: t("Previous 7 days"), older: t("Earlier"), waiting: t("Needs you"), working: t("Working"), attention: t("Failed or cut off"), other: t("Other"), ticket: "" };
  let left = event?.all === true || String(event?.all) === "true" ? Infinity : 60;
  const take = (rows) => {
    const r = rows.slice(0, Math.max(0, left));
    left -= r.length;
    return r;
  };
  const grouped = groupSessions(found, sort, Date.now());
  const groups = grouped.map((g) => ({
    key: g.key,
    heading: g.id === "ticket" ? "" : headings[g.id],
    ticket: g.id === "ticket" ? g.ticket || t("No ticket") : "",
    ticketKey: g.id === "ticket" ? g.ticket || "-" : "",
    summary: g.summary ?? "",
    n: g.rows.length,
    items: take(g.rows).map((s) => ({
      id: s.id,
      todoId: s.todoId,
      title: s.title,
      ticket: g.id !== "ticket" ? s.ticket : "",
      ago: ago(s.at),
      dot: s.waiting ? "🟡" : (DOT[s.status] ?? "⚪"),
      tip: `${s.ref} · ${statusText(s.status)}${s.ticket ? ` · ${s.ticket}` : ""}${s.branch ? ` · ⎇ ${s.branch}` : ""}`,
      archived: s.archived,
      active: s.status === "running" || s.status === "queued",
      selected: s.id === run,
    })),
  }));
  const out = {
    mode: run ? "session" : ticketArg !== undefined ? "ticket" : "new",
    groups,
    total: groups.reduce((n, g) => n + g.items.length, 0),
    hidden: grouped.reduce((n, g) => n + g.rows.length, 0) - groups.reduce((n, g) => n + g.items.length, 0),
    gitMissing: list.gitMissing ?? "",
    settingsHref: list.settingsPage ? "/workspace/" + list.settingsPage : "/settings/time#work",
    tabs: list.tabs ?? [],
    archivedCount: list.archivedCount,
    running: list.running,
    labels: {
      nothing: t("Nothing found."),
      newTitle: t("What should we work on?"),
      newHint: list.running ? t("Ask a question or give a task — on a ticket, in its repo or one you pick. Sessions run side by side ({n} working now).", { n: list.running }) : t("Ask a question or give a task — on a ticket, in its repo or one you pick. Sessions run side by side."),
      showArchived: t("Show archived ({n})", { n: list.archivedCount }),
      showMore: t("Show more ({n})", { n: grouped.reduce((n, g) => n + g.rows.length, 0) - groups.reduce((n, g) => n + g.items.length, 0) }),
    },
  };

  // ── the message box's options (the new-session page, a ticket's page): provider, mode, model, effort, repo, where it works
  if (!run) {
    const c = await zeff.call("work.composer", { tickets: ticketArg ?? "" });
    const prov = c.providers.some((p) => p.id === event?.cprov) ? String(event.cprov) : c.defaultProvider;
    const ch = c.choices[prov];
    const pick = (list, want, def) => (list.some((x) => x.id === want) ? want : def);
    const mode = ch ? pick(ch.modes, event?.cmode, ch.defaultMode) : "";
    const model = ch && ch.models.some((m) => m.value === event?.cmodel) ? String(event.cmodel) : "";
    const efforts = ["", "low", "medium", "high", "xhigh", "max"].filter((e) => {
      const m = ch?.models.find((x) => x.value === model);
      return e === "" || !m?.efforts || m.efforts.includes(e);
    });
    const effort = efforts.includes(String(event?.ceffort ?? "")) && event?.ceffort ? String(event.ceffort) : ch?.defaultEffort ?? "";
    const inferred = ticketArg ? (c.ticketRepos[ticketArg] ?? "") : "";
    const repo = event?.cuse ? String(event.cuse) : c.repos.some((r) => r.path === event?.crepo) ? String(event.crepo) : inferred;
    // The folder picker: any folder of this computer (the registered repos are the shortcuts), and the branches of the one chosen.
    const browsing = String(event?.cbrowse) === "1";
    let folders = null;
    if (browsing) {
      const l = await zeff.call("work.folders", { path: String(event?.cdir ?? "") });
      folders = l.ok ? { ok: true, path: l.path, parent: l.parent, repo: l.repo, dirs: l.dirs.map((d) => ({ name: (d.repo ? "⎇ " : "") + d.name, path: d.path })) } : { ok: false, error: l.error, path: "", parent: "", dirs: [] };
    }
    const br = repo ? await zeff.call("work.branches", { path: repo }) : null;
    const branchOf = String(event?.cbranch ?? "");
    const ws = ["worktree", "branch", "checkout"].includes(String(event?.cws)) ? String(event.cws) : "";
    out.composer = {
      provider: prov,
      live: !!ch,
      providers: c.providers.map((p) => ({ id: p.id, label: p.label, sel: p.id === prov })),
      modes: (ch?.modes ?? []).map((m) => ({ id: m.id, label: t(m.label), hint: t(m.hint), sel: m.id === mode })),
      mode,
      models: (ch?.models ?? []).map((m) => ({ value: m.value, label: m.label || t("Default (the CLI's)"), sel: m.value === model })),
      model,
      showEffort: !!ch?.effort,
      efforts: efforts.map((e) => ({ value: e, label: e || t("The model's default"), sel: e === effort })),
      effort,
      admin: !!ch?.admin,
      repos: [{ path: "", name: inferred ? t("As Zeff infers it") : t("None"), sel: !repo }, ...c.repos.map((r) => ({ path: r.path, name: r.name, sel: r.path === repo }))],
      repo,
      repoNow: repo ? repo : t("As Zeff infers it"),
      browsing,
      folders,
      branches: br?.ok ? br.branches.filter((b) => !b.remote).slice(0, 40).map((b) => ({ name: b.name, label: (b.current ? "● " : "") + b.name, sel: b.name === branchOf })) : [],
      workspaces: [
        { id: "", label: t("As set in the Code settings"), sel: !ws },
        { id: "worktree", label: t("A worktree of its own"), sel: ws === "worktree" },
        { id: "branch", label: t("A branch"), sel: ws === "branch" },
        { id: "checkout", label: t("In the checkout"), sel: ws === "checkout" },
      ],
      workspace: ws,
      files: ((await zeff.call("work.attachments", { scope: "new" })).files ?? []).map((x) => ({ ref: x.ref, name: x.name, size: `${Math.max(1, Math.round(x.size / 1024))} KB` })),
      labels: { browse: t("Choose another folder …"), up: t("Up"), use: t("Use this folder"), go: t("Go"), folder: t("Folder"), branches: t("Branches"), options: t("Options"), provider: t("Backend"), mode: t("Mode"), model: t("Model"), effort: t("Effort"), repo: t("Repo"), where: t("Where it works"), branch: t("Branch (optional)") },
    };
  }

  // ── sessions that hold a worker without working
  const dang = await zeff.call("work.dangling", {});
  out.dangling = {
    n: dang.dangling.length,
    text: dang.dangling.length ? t("{n} sessions count as running but aren't working:", { n: dang.dangling.length }) + " " + dang.dangling.map((d) => `${d.ref} (${d.why})`).join(", ") : "",
  };

  // ── a ticket's page
  if (!run && ticketArg !== undefined) {
    const tk = list.tickets.find((x) => x.ticket === ticketArg);
    out.ticketPage = {
      ticket: ticketArg,
      title: ticketArg || t("No ticket"),
      url: tk?.url ?? "",
      summary: tk?.summary ?? "",
      facts: tk ? [tk.status].filter(Boolean).join(" · ") : "",
      sessions: (tk?.sessions ?? []).map((s) => ({ id: s.id, ref: s.ref, title: s.title, status: s.waiting ? t("waiting for you") : statusText(s.status), at: when(s.at) })),
      sessionsLabel: t("Sessions ({n})", { n: tk?.sessions.length ?? 0 }),
    };
  }

  // ── a session
  if (run) {
    const s = await zeff.call("work.session-open", { run, tail: Number(event?.tail) || 150 });
    if (!s.found) {
      out.session = { found: false, error: s.error };
    } else {
      const live = s.live;
      const status = s.last.status;
      const liveText = live?.kind === "session" ? (live.asks.length ? t("waits for your answer") : live.host === "starting" ? t("starting") : live.busy ? t("working") : t("waiting for you")) : live?.kind === "live" ? (live.permission ? t("asks for permission") : live.busy ? t("working") : t("waiting for you")) : statusText(status);
      const turns = s.turns.map((turn) => ({
        runId: turn.runId,
        ref: turn.ref,
        label: turn.label,
        ask: turn.ask ?? "",
        cut: turn.cut ? t("{n} earlier lines are cut.", { n: turn.cut }) : "",
        lines: turn.lines.map((l, i) => ({
          i,
          k: l.k,
          text: l.k === "shell" ? `! ${l.cmd}${l.text ? `\n${l.text}` : ""}` : l.k === "tool" ? `${l.tool}  ${l.text}` : (l.text ?? ""),
          answer: l.k === "ask" && l.answer ? l.answer : "",
          bad: (l.k === "out" && l.error) || l.k === "deny" || (l.k === "end" && !l.ok) || (l.k === "shell" && !l.ok) || (l.k === "ask" && l.ok === false),
          diff: Array.isArray(l.diff) ? l.diff.map((d) => `- ${d.old}\n+ ${d.new}`).join("\n") : "",
        })),
      }));
      const modes = live?.kind === "session" ? live.modes.map((m) => ({ id: m.id, label: t(m.label), hint: t(m.hint), sel: m.id === live.mode })) : [];
      // The questions of an ask: what is picked (qpick: { question: [labels] }) and your own words (qo0 … qo3), as the built-in's card keeps them.
      let picked = {};
      try {
        const v = JSON.parse(String(event?.qpick ?? "{}"));
        if (v && typeof v === "object" && !Array.isArray(v)) picked = v;
      } catch {
        picked = {};
      }
      const asks =
        live?.kind === "session"
          ? live.asks.map((a, ai) => {
              const qs = (a.input.questions ?? []).map((q, qi) => {
                const mine = Array.isArray(picked[q.question]) ? picked[q.question] : [];
                const other = String(event?.["qo" + qi] ?? "").trim();
                return {
                  question: q.question,
                  header: q.header ?? "",
                  idx: qi,
                  multi: !!q.multiSelect,
                  other,
                  ready: mine.length > 0 || !!other,
                  answer: [...mine, ...(other ? [other] : [])].join(", "),
                  options: (q.options ?? []).map((o) => {
                    const on = mine.includes(o.label);
                    const next = q.multiSelect ? (on ? mine.filter((x) => x !== o.label) : [...mine, o.label]) : [o.label];
                    return { label: o.label, description: o.description ?? "", on, mark: on ? "● " : "", next: JSON.stringify({ ...picked, [q.question]: next }) };
                  }),
                };
              });
              return {
                requestId: a.requestId,
                tool: a.tool,
                plan: a.tool === "ExitPlanMode",
                question: a.tool === "AskUserQuestion",
                title: a.tool === "ExitPlanMode" ? t("Its plan — go ahead?") : a.tool === "AskUserQuestion" ? t("It asks you") : t("It wants to use {tool}", { tool: a.tool }),
                description: a.description ?? "",
                detail: a.input.file_path ? a.input.file_path + (a.input.command ? "\n" + a.input.command : "") : a.input.command || a.input.url || a.input.pattern || "",
                diff: (a.diffs ?? []).map((d) => "- " + d.old + "\n+ " + d.new).join("\n\n"),
                reason: a.reason && a.reason !== "This command requires approval" ? a.reason : "",
                planText: a.input.plan || t("(no plan text)"),
                always: !!a.alwaysLabel,
                alwaysLabel: a.alwaysLabel ? t("Always: {rule}", { rule: a.alwaysLabel }) : "",
                alwaysTip: a.alwaysLabel ? t("Allow, and from now on: {rule}", { rule: a.alwaysLabel }) : "",
                questions: qs,
                has0: qs.length > 0,
                has1: qs.length > 1,
                has2: qs.length > 2,
                has3: qs.length > 3,
                qt0: qs[0]?.question ?? "",
                qt1: qs[1]?.question ?? "",
                qt2: qs[2]?.question ?? "",
                qt3: qs[3]?.question ?? "",
                submit: JSON.stringify(Object.fromEntries(qs.map((q) => [q.question, q.answer]))),
                ready: qs.every((q) => q.ready),
                more: ai === 0 && live.asks.length > 1 ? t("(+{n} more)", { n: live.asks.length - 1 }) : "",
                first: ai === 0,
                bypass: !!live.allowBypass,
              };
            })
          : [];
      // Only the first ask is asked at a time, like the built-in's card.
      const askNow = asks.slice(0, 1);
      // The message box: /commands at the start, @files anywhere, !shell, the pictures waiting.
      const msg = String(event?.msg ?? "");
      let menu = [];
      let menuKind = "";
      if (live?.kind === "session" && status === "running") {
        const slash = /^\/([\w:.-]*)$/.exec(msg);
        const at = /(^|\s)@([^\s@]*)$/.exec(msg);
        if (slash && (live.features ?? []).includes("commands")) {
          const q = slash[1].toLowerCase();
          menu = live.commands
            .filter((x) => x.name.toLowerCase().includes(q))
            .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
            .slice(0, 12)
            .map((x) => ({ next: "/" + x.name + " ", label: "/" + x.name + (x.hint ? " " + x.hint : ""), hint: x.description }));
          menuKind = "/";
        } else if (at) {
          const r = await zeff.call("work.session-files", { run, q: at[2] });
          menu = (r.files ?? []).slice(0, 12).map((f) => ({ next: msg.slice(0, msg.length - at[2].length - 1) + "@" + f + " ", label: f, hint: "" }));
          menuKind = "@";
        }
      }
      const attachScope = "run:" + run;
      const files = ((await zeff.call("work.attachments", { scope: attachScope })).files ?? []).map((x) => ({ ref: x.ref, name: x.name, size: Math.max(1, Math.round(x.size / 1024)) + " KB" }));
      const hostText = live?.kind === "session" ? (live.host === "starting" ? (live.sessionElevated ? t("starting as administrator — confirm Windows' prompt (UAC)") : t("starting …")) : live.host === "down" ? t("restarting …") : live.asks.length ? t("waits for your answer") : live.busy ? t("working …") : t("waiting for you")) : "";
      const models = live?.kind === "session" ? [...(live.models.some((m) => m.value === live.model) ? [] : [{ value: live.model ?? "", label: live.model || t("Default model") }]), ...live.models].map((m) => ({ value: m.value, label: m.label, sel: m.value === (live.model ?? "") })) : [];
      const efforts = live?.kind === "session" && (live.features ?? []).includes("effort") ? ["", "low", "medium", "high", "xhigh", "max"].map((e) => ({ value: e, label: e ? t("Effort: {e}", { e }) : t("Effort: default"), sel: e === live.effort })) : [];
      out.session = {
        found: true,
        runId: s.last.id,
        title: s.todo?.text ?? s.last.summary ?? s.last.ref,
        statusText: liveText,
        active: s.active,
        status,
        tone: status === "failed" ? "bad" : status === "done" ? "good" : status === "interrupted" ? "warn" : "plain",
        elevated: s.last.elevated,
        elevatedLabel: t("Administrator"),
        ticket: s.ticket,
        noTicket: t("no ticket"),
        cardSummary: s.card?.summary ?? "",
        branch: s.last.branch ?? "",
        repoName: s.last.repo ? s.last.repo.split(/[\\/]/).filter(Boolean).pop() : "",
        worktree: !!s.last.cwd && !!s.last.repo && s.last.cwd !== s.last.repo,
        idle: !s.active,
        branchTip: s.active ? t("Working - switch the branch once it has answered") : t("Switch the branch of this session"),
        branchList: [],
        todoRef: s.todo?.ref ?? "",
        todoId: s.todo?.id ?? 0,
        cost: s.cost > 0 ? `$${s.cost.toFixed(2)}` : "",
        side: s.side,
        turns,
        kind: live?.kind ?? "",
        busy: !!live?.busy,
        host: live?.host ?? "",
        queued: live?.queued ?? 0,
        queuedLabel: live?.queued ? t("{n} message(s) wait their turn.", { n: live.queued }) : "",
        modes,
        asks: askNow,
        hasAsk: askNow.length > 0,
        models,
        efforts,
        hostText,
        shellPendingLabel: live?.shellPending ? t("{n} command output(s) go along with your next message", { n: live.shellPending }) : "",
        features: live?.features ?? [],
        canShell: (live?.features ?? []).includes("shell"),
        isShell: msg.startsWith("!"),
        shellCmd: msg.startsWith("!") ? msg.slice(1).trim() : "",
        menu,
        menuKind,
        files,
        attachScope,
        panels: (list.panels ?? []).map((x, i) => ({ ...x, key: "x" + i })),
        paneOptions: (list.panels ?? []).map((x, i) => ",x" + i + ":" + String(x.title).replace(/[,:]/g, " ")).join(""),
        copilot: live?.kind === "live" ? { mode: live.mode, modes: (live.modes ?? []).map((m) => ({ id: m.id, name: m.name, sel: m.id === live.mode, hint: ({ agent: t("Asks you before it does anything that isn't allowed"), plan: t("Plans first, carries it out after your OK"), autopilot: t("Allows itself everything and runs through to the end") })[m.id.replace(/^.*#/, "")] ?? m.name })), waiting: live.waiting ?? "", idle: !live.busy, status: live.busy ? (live.permission ? t("waiting for your permission") : t("working…")) : t("waiting for you") } : null,
        permission: live?.kind === "live" && live.permission ? { title: live.permission.title, detail: live.permission.detail ?? "", options: live.permission.options } : null,
        canReplyLive: status === "running" && (live?.kind === "session" || live?.kind === "live"),
        error: status === "failed" ? (s.last.error ?? "") : "",
        placeholder: s.active ? (status === "queued" ? t("Waiting for a free worker … — your reply is sent after it") : t("Working … — your reply is sent as soon as it has answered")) : t("Reply …"),
        priority: priorityOf({ waiting: asks.length > 0, live: !!live, status }),
      };
    }
  }
  if (run && out.session?.found && (event?.branches === true || String(event?.branches) === "true")) {
    const b = await zeff.call("work.branches", { run });
    out.session.branchError = b.ok ? "" : b.error;
    out.session.branchList = (b.branches ?? []).map((x) => ({ name: x.name, remote: x.remote, current: x.current, worktree: x.worktree ?? "", disabled: x.current || !!x.worktree, tip: x.worktree ? t("Checked out in {path}", { path: x.worktree }) : "" }));
  }
  return out;
}
