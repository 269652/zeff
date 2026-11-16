import { tFor } from "./lib.mjs";
import { rowTools } from "./rows.mjs";

/**
 * The briefing and the Tickets tab (views/todos.html reads it as data.lage): whether a run goes on and since when, the run shown (when, model, duration, cost, tickets analyzed),
 * the last failure, the lede and the sources that weren't well — and per ticket what Jira says and what the run made of it: its attention, lead, summary, what happened, flags,
 * the changes it suggests (done or still to do), questions, and the todos on it. The kernel's reads `todos.board` and `todos.rows` do the looking (the built-in page's own).
 * event: { att: an attention to filter by, or "" }.
 */
export async function handler(event, context) {
  const zeff = context.zeff;
  const t = tFor(context.language);
  const lang = context.language === "de" || context.language === "es" ? context.language : "en";
  const { view, day, locale } = rowTools(t, lang);
  const b = await zeff.call("todos.board", {});
  const todos = await zeff.call("todos.rows", { scope: "open" });
  const att = String(event?.att ?? "");
  const ATT = { feedback: [t("Open question"), "#f97316"], active: [t("In progress"), "#0d9488"], check: [t("Testing / Review"), "#6366f1"], spec: [t("Spec"), "#a855f7"], blocked: [t("Waiting on others"), "#a1a1aa"], ready: [t("Ready"), "#cbd5e1"], stale: [t("Stalled"), "#d6d3d1"] };
  const PHASES = { sync: t("syncing first"), jira: t("reading Jira and Zeff"), ai: t("analyzing"), saving: t("saving"), mailtodos: t("finding todos in mails and WhatsApp"), mails: t("matching mails to the todos"), notetodos: t("finding todos in notes"), knowledge: t("matching knowledge to the todos"), notes: t("matching notes to the todos"), calendarmatch: t("matching appointments to the todos"), calendartodos: t("finding todos in appointments"), documents: t("finding todos in documents"), docrelations: t("matching documents to the todos"), people: t("finding the people in the todos"), autoactions: t("taking actions for the todos") };
  const when = (iso) => (iso ? new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) || iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  const mins = (ms) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")} min` : "");
  const since = b.since ? Math.max(0, Math.round((Date.now() - b.since) / 1000)) : 0;

  const onTicket = (r, key) => r.ticket === key || (r.alsoTickets ?? []).includes(key);
  const chips = b.counts.map((c) => ({ attention: c.attention, label: ATT[c.attention][0], color: ATT[c.attention][1], n: c.n, on: att === c.attention }));
  const tickets = b.tickets
    .filter((x) => !att || x.attention === att)
    .map((x) => ({
      ...x,
      attLabel: x.analyzed ? ATT[x.attention][0] : "",
      attColor: ATT[x.attention][1],
      followLabel: x.followed ? t("followed") : "",
      flags: x.flags.map((text) => ({ text })),
      happened: x.happened.map((h) => ({ when: h.when ? day(h.when.slice(0, 10)) : "", who: h.who ?? "", what: h.what })),
      actions: x.actions.map((a) => ({ ...a, ticket: x.key, doneAt: a.done ? when(a.done.at) : "", ok: a.done?.status === "done", failed: a.done?.status === "failed", detail: a.done?.detail ?? "", icon: a.type === "transition" ? "→" : a.type === "assign" ? "👤" : "💬" })),
      todos: todos.rows.filter((r) => onTicket(r, x.key)).map((r) => view(r, todos)),
    }));
  return {
    running: b.running,
    runningText: b.running ? `${since ? `${Math.floor(since / 60)}:${String(since % 60).padStart(2, "0")}` : ""} · ${b.phase === "ai" ? t("{provider} analyzing", { provider: b.provider }) : (PHASES[b.phase] ?? t("running"))}` : "",
    asOf: b.shown ? t("As of: {when}", { when: when(b.shown.at) }) : "",
    facts: b.shown ? [b.shown.analyzed === 1 ? t("1 ticket analyzed") : t("{n} tickets analyzed", { n: b.shown.analyzed }), b.shown.model, mins(b.shown.durationMs), b.shown.costUsd != null ? `≈ $${b.shown.costUsd.toFixed(2)}` : ""].filter(Boolean).map((text) => ({ text })) : [],
    runId: b.shown?.id ?? 0,
    none: b.shown ? "" : t("No briefing yet — “Run now” reads your tickets and has the AI ({ai}) write the briefing (takes a minute or two).", { ai: b.provider }),
    failed: b.failed ? t("The last run ({when}) failed: {error}", { when: when(b.failed.at), error: b.failed.error }) + (b.shown ? ` — ${t("this is the one before.")}` : "") : "",
    lede: b.lede,
    gaps: b.gaps.length ? t("Not up to date when this ran:") : "",
    gapList: b.gaps.map((g) => ({ label: g.label, href: g.href, state: g.state })),
    chips,
    nAll: b.tickets.length,
    att,
    tickets,
    nTickets: tickets.length,
    left: b.left,
    listed: b.listed.map((x) => ({ ...x, day: x.updatedAt ? day(x.updatedAt.slice(0, 10)) : "" })),
    nListed: b.listed.length,
    empty: t("No open tickets on the chosen boards."),
    presync: b.presync,
  };
}
