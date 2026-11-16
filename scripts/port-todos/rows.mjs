/**
 * A todo as a row of the screen, ready to draw — shared by the list (todos.screen) and the tickets (todos.lage): its words, ticket with the link, kind, when it is due and
 * how urgent that is, whether it repeats, whether it is flagged or set aside, what a worker or an agent says of it. `t`: the translator; `data`: todos.rows' answer
 * (its tickets' links).
 */
export function rowTools(t, lang) {
  const locale = { de: "de-DE", es: "es-ES", en: "en-GB" }[lang] ?? "en-GB";
  const day = (iso, year) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });
  const KINDS = { reply: t("Reply"), comment: t("Comment"), update: t("Update ticket"), implement: t("Implement"), fix: t("Fix"), test: t("Test"), review: t("Review"), clarify: t("Clarify"), document: t("Docs"), deploy: t("Deploy"), merge: t("Deliver"), other: t("Other") };
  const FREQ = { daily: t("every day"), weekly: t("every week"), monthly: t("every month"), yearly: t("every year") };
  const dueText = (d, due) => (d < 0 ? (d === -1 ? t("overdue (1 day)") : t("overdue ({n} days)", { n: -d })) : d === 0 ? t("due today") : d === 1 ? t("due tomorrow") : t("due {date}", { date: day(due) }));

  const view = (r, data) => {
    const links = (keys) => keys.map((k) => ({ key: k, url: data.tickets?.[k]?.url ?? "", title: data.tickets?.[k]?.summary ?? "" }));
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
  return { view, day, locale, dueText };
}
