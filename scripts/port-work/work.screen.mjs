import { groupSessions, priorityOf, stamp, tFor } from "./lib.mjs";

/**
 * What the Code screen shows (views/work.html reads it as data.x): the session list (grouped and sorted like the built-in's sidebar), and — by what is picked —
 * a session's conversation, a ticket's page or the new-session page. The kernel's reads work.session-list and work.session-open do the looking (the engine's own);
 * this shapes it for the view language: every line already a row of text, every ask already its buttons.
 * event: { sel ("run:12" | "ticket:ABC-1" | "ticket:-" | ""), q, sort, archived, tail }
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
  const groups = groupSessions(found, sort, Date.now()).map((g) => ({
    key: g.key,
    heading: g.id === "ticket" ? "" : headings[g.id],
    ticket: g.id === "ticket" ? g.ticket || t("No ticket") : "",
    ticketKey: g.id === "ticket" ? g.ticket || "-" : "",
    summary: g.summary ?? "",
    n: g.rows.length,
    rows: g.rows.slice(0, 60).map((s) => ({
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
    total: groups.reduce((n, g) => n + g.rows.length, 0),
    archivedCount: list.archivedCount,
    running: list.running,
    labels: {
      nothing: t("Nothing found."),
      newTitle: t("What should we work on?"),
      newHint: list.running ? t("Ask a question or give a task — on a ticket, in its repo or one you pick. Sessions run side by side ({n} working now).", { n: list.running }) : t("Ask a question or give a task — on a ticket, in its repo or one you pick. Sessions run side by side."),
      showArchived: t("Show archived ({n})", { n: list.archivedCount }),
    },
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
      const modes = live?.kind === "session" ? live.modes.map((m) => ({ id: m.id, label: t(m.label), hint: t(m.hint) })) : [];
      const asks =
        live?.kind === "session"
          ? live.asks.map((a) => {
              const qs = (a.input.questions ?? []).map((q) => ({
                question: q.question,
                header: q.header ?? "",
                options: (q.options ?? []).map((o) => ({ requestId: a.requestId, label: o.label, description: o.description ?? "", json: JSON.stringify({ [q.question]: o.label }) })),
              }));
              return {
                requestId: a.requestId,
                tool: a.tool,
                plan: a.tool === "ExitPlanMode",
                question: a.tool === "AskUserQuestion",
                title: a.tool === "ExitPlanMode" ? t("Its plan — go ahead?") : a.tool === "AskUserQuestion" ? t("It asks you") : t("It wants to use {tool}", { tool: a.tool }),
                description: a.description ?? "",
                detail: a.input.command || a.input.file_path || a.input.url || a.input.pattern || "",
                planText: a.input.plan ?? "",
                always: a.always,
                questions: qs,
                oneQuestion: qs.length === 1,
                bypass: !!live.allowBypass,
              };
            })
          : [];
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
        asks,
        permission: live?.kind === "live" && live.permission ? { title: live.permission.title, detail: live.permission.detail ?? "", options: live.permission.options } : null,
        canReplyLive: status === "running" && (live?.kind === "session" || live?.kind === "live"),
        error: status === "failed" ? (s.last.error ?? "") : "",
        placeholder: s.active ? (status === "queued" ? t("Waiting for a free worker … — your reply is sent after it") : t("Working … — your reply is sent as soon as it has answered")) : t("Reply …"),
        priority: priorityOf({ waiting: asks.length > 0, live: !!live, status }),
      };
    }
  }
  return out;
}
