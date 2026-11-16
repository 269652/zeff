import { tFor } from "./lib.mjs";

/**
 * What the Todos screen shows (views/todos.html reads it as data.x): the todos of a scope — open (yours, grouped by how urgent they are, and the ones you wait on),
 * done, or the workers' own — each ready to draw: its words, its ticket with the link, its kind, when it is due and how urgent that is, whether it repeats, whether it
 * is flagged or set aside, what a worker or an agent says of it. The kernel's read `todos.rows` does the looking (the built-in page's own: the same todos, the same
 * order); this puts the words of the page on it. event: { scope: open | done | worker, filter }.
 */
export async function handler(event, context) {
  const zeff = context.zeff;
  const t = tFor(context.language);
  const lang = context.language === "de" || context.language === "es" ? context.language : "en";
  const locale = { de: "de-DE", es: "es-ES", en: "en-GB" }[lang];
  const day = (iso, year) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });

  const scope = event?.scope === "done" || event?.scope === "worker" ? event.scope : "open";
  const q = String(event?.filter ?? "").trim().toLowerCase();
  const data = await zeff.call("todos.rows", { scope });

  const KINDS = { reply: t("Reply"), comment: t("Comment"), update: t("Update ticket"), implement: t("Implement"), fix: t("Fix"), test: t("Test"), review: t("Review"), clarify: t("Clarify"), document: t("Docs"), deploy: t("Deploy"), merge: t("Deliver"), other: t("Other") };
  const FREQ = { daily: t("every day"), weekly: t("every week"), monthly: t("every month"), yearly: t("every year") };
  const GROUPS = { important: [t("Important"), "#ef4444"], overdue: [t("Overdue"), "#ef4444"], today: [t("Today"), "#f59e0b"], week: [t("This week"), "#0ea5e9"], later: [t("Later"), "#a1a1aa"], none: [t("No due date"), "#a1a1aa"], deferred: [t("Set aside"), "#d4d4d8"] };

  const dueText = (d, due) => (d < 0 ? (d === -1 ? t("overdue (1 day)") : t("overdue ({n} days)", { n: -d })) : d === 0 ? t("due today") : d === 1 ? t("due tomorrow") : t("due {date}", { date: day(due) }));
  const links = (keys) => keys.map((k) => ({ key: k, url: data.tickets?.[k]?.url ?? "", title: data.tickets?.[k]?.summary ?? "" }));

  const view = (r) => {
    const closed = r.status !== "open";
    const asking = !closed && r.needsInput ? r.needsInput : "";
    const reported = !closed && !asking && r.workerDone && !r.workerDone.suggested ? r.workerDone : null;
    const suggested = !closed && !asking && r.workerDone && r.workerDone.suggested ? r.workerDone : null;
    const by = (w) => String(w.by).split(" · ")[0];
    const hasDue = !!r.due;
    const tone = !hasDue || closed ? "muted" : r.dueDays <= 0 ? "bad" : r.dueDays <= 3 ? "warn" : "muted";
    return {
      id: r.id,
      ref: r.ref,
      text: r.text,
      ticket: r.ticket,
      ticketUrl: data.tickets?.[r.ticket]?.url ?? "",
      ticketTitle: data.tickets?.[r.ticket]?.summary ?? "",
      also: links(r.alsoTickets ?? []),
      kind: KINDS[r.kind] ?? KINDS.other,
      closed,
      done: r.status === "done",
      dismissed: r.status === "dismissed",
      waiting: r.owner === "other",
      flagged: !!r.flagged && !closed,
      deferred: !!r.deferred && !closed,
      backUp: !closed && r.bubbledUp ? t("back on top: {why}", { why: r.bubbledUp }) : "",
      asking,
      askingTip: asking ? t("The agent is waiting for you: {question}", { question: asking }) : "",
      due: r.due,
      dueLabel: hasDue ? dueText(r.dueDays, r.due) : t("due date"),
      dueTone: tone,
      repeat: r.repeats ? FREQ[r.repeats] : "",
      reported: reported ? t("{by}: reported done", { by: by(reported) }) : "",
      reportedTip: reported ? (reported.note ? t("{by} reports this done: {note} — tick it off to close it", { by: reported.by, note: reported.note }) : t("{by} reports this done — tick it off to close it", { by: reported.by })) : "",
      suggested: suggested ? t("{by}: suggests done", { by: by(suggested) }) : "",
      suggestedTip: suggested ? (suggested.note ? t("{by} suggests this is done: {note} — tick it to confirm", { by: suggested.by, note: suggested.note }) : t("{by} suggests this is done — tick it to confirm", { by: suggested.by })) : "",
      lastError: !closed ? r.lastError : "",
      note: r.note,
      source: !r.note && r.source ? t("Source: {source}", { source: r.source }) : "",
      state: r.status === "dismissed" ? t("Dismissed") : "",
      doneAt: r.doneAt ? day(r.doneAt.slice(0, 10), true) : "",
      opsCount: r.opsCount,
      notesCount: r.notesCount,
    };
  };

  const match = (r) => !q || [r.text, r.ref, r.ticket, r.note, r.source, ...(r.alsoTickets ?? [])].some((s) => String(s ?? "").toLowerCase().includes(q));
  const rows = data.rows.filter(match).map(view);

  let groups = [];
  let waiting = [];
  if (scope === "open") {
    const mine = rows.filter((x) => !x.waiting);
    waiting = rows.filter((x) => x.waiting);
    const byGroup = new Map();
    for (const r of data.rows.filter(match)) {
      if (r.owner === "other") continue;
      byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), mine.find((x) => x.id === r.id)]);
    }
    groups = ["important", "overdue", "today", "week", "later", "none", "deferred"].filter((g) => byGroup.has(g)).map((g) => ({ key: g, label: GROUPS[g][0], color: GROUPS[g][1], overdue: g === "overdue", count: byGroup.get(g).length, items: byGroup.get(g) }));
  }

  return {
    scope,
    filtering: !!q,
    counts: data.counts,
    briefing: data.briefing,
    groups,
    waiting,
    nWaiting: waiting.length,
    rows: scope === "open" ? [] : rows,
    nRows: rows.length,
    nMine: scope === "open" ? rows.length - waiting.length : 0,
    empty: q ? t("Nothing matches the filter.") : scope === "open" ? t("Nothing open for you.") : scope === "done" ? t("Nothing done yet.") : t("No worker todos yet."),
  };
}
