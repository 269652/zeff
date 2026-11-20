import { dayShortfalls } from "@/lib/day-status";
import { getWeeklyReport, listReporters } from "@/lib/entries";
import { listEntryTypes } from "@/lib/entry-types";
import { FALLBACK_TYPE_COLOR, typeMapOf } from "@/lib/entry-types-shared";
import { currentLocale, formatDate, formatHours, round2 } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { listJobs } from "@/lib/jobs";
import { lastAndCurrentMonth } from "@/lib/month";
import { getPastWeeksDue } from "@/lib/monthly";
import { formatPauses, totalPauseHours } from "@/lib/pauses-shared";
import { absenceHoursOn, bookedOnJob, getAbsenceJobs, getDefaultPauses, getFlexTime, getWeekTargets } from "@/lib/schedule";
import { getJobByNumber } from "@/lib/jobs";
import { latestPausesBefore, listPausesByDate } from "@/lib/pauses";
import { collectCandidates, detectParallel, groupOptionsOn } from "@/lib/entry-parallel";
import { getSpan, membersOf, spanOfHead } from "@/lib/entry-spans";
import { stretchOf } from "@/lib/entry-timeline";
import { listProjectOptions } from "@/lib/projects";
import { NO_JOB_NUMBER } from "@/lib/projects-shared";
import { getRewrittenReport, reportToText } from "@/lib/report";
import { absenceLabels, type AbsenceType } from "@/lib/schedule-shared";
import { listTags } from "@/lib/tags";
import { weekClose } from "@/lib/week-close";
import { ticketInfos } from "./tickets";
import { todoContextCounts } from "./entry-context";
import { closeSlotItems, closeWith, fullAction, fullCard, weekSlotData, type SlotMark } from "./time-slots";
import { currentWeek, formatDay, formatWeekRange, isoDate, resolveWeek, shiftWeek, todayIso } from "@/lib/week";
import { doneToday } from "@/lib/work/booking";
import { openSuggestions } from "@/lib/work/suggestions";
import { formatMinutes } from "@/lib/work/shared";

/**
 * The weekly report as figures and words, ready to draw: what src/app/page.tsx works out (the same functions, the same sentences) as plain data — the
 * week's cards, its table of hours per job and day, the closing steps, the agents' suggestions, what was done today, the report and the entries — for a
 * plugin's view of it. Read only; the writes (a booking, an hour changed, a suggestion taken over) are the actions beside it.
 */

type Tone = "plain" | "good" | "warn" | "bad";
const h = (n: number) => formatHours(n);

/** A status card's sign by its tone (cross: hours missing, info: a heads-up, check: all booked). */
function statusMark(tone: string): string {
  return ({ bad: "cross", warn: "info", good: "check" } as Record<string, string>)[tone] ?? "";
}

function bookedStatus(booked: number, target: number, days: { gap: number; state: string; label: string }[], started: boolean): { tone: Tone; caption: string } | null {
  const missing = days.filter((d) => d.state === "missing");
  if (missing.length) {
    const hours = round2(missing.reduce((a, d) => a + d.gap, 0));
    const names = missing.length > 4 ? `${missing.slice(0, 3).map((d) => d.label).join(", ")} +${missing.length - 3}` : missing.map((d) => d.label).join(", ");
    return { tone: "bad", caption: t("{hours} h missing · {days}", { hours: h(hours), days: names }) };
  }
  const onTarget = target > 0 && round2(booked) === round2(target);
  const over = round2(booked - target);
  if (target > 0 && over > 0) return { tone: "warn", caption: t("{hours} h over the target", { hours: h(over) }) };
  const today = days.find((d) => d.state === "short");
  if (today) return { tone: "warn", caption: t("{hours} h to go today", { hours: h(today.gap) }) };
  if (!started || target <= 0) return null;
  return { tone: "good", caption: onTarget ? t("Matches the target") : t("All booked so far") };
}

export async function weekScreen(input: { week?: string; by?: string } = {}) {
  const requested = resolveWeek(input.week);
  const week = requested ?? currentWeek();
  const by = String(input.by ?? "").trim() || undefined;
  const filtered = !!by;
  const today = todayIso();

  const report = getWeeklyReport(week, { reportedBy: by });
  // What the booking systems add (their places as data): cards, buttons, marks on entries and days.
  const slots = await weekSlotData({ week, entries: report.entries, by });
  const marksOf = (id: number): SlotMark[] => slots.flatMap((x) => (x.slot.entries?.[id] ? [x.slot.entries[id]] : []));
  const joinMarks = (marks: SlotMark[]) => ({ mark: marks.map((m) => m.text).filter(Boolean).join(" "), markTitle: marks.map((m) => m.title ?? "").filter(Boolean).join(" · "), approved: marks.length > 0 && marks.every((m) => m.approved), markTone: marks.find((m) => m.tone && m.tone !== "plain")?.tone ?? "plain" });
  const targets = getWeekTargets(week);
  const rewritten = getRewrittenReport(week, { reportedBy: by });
  const reportText = reportToText(rewritten, formatHours);
  const types = listEntryTypes();
  const typeMap = typeMapOf(types);
  const labels = absenceLabels(t);

  // --- the cards
  const shortfall = dayShortfalls(week, report.dayTotals, targets.targets, { today, filtered });
  const dayLabels = week.days.map((d, i) => ({ ...shortfall[i], label: d.toLocaleDateString(currentLocale(), { weekday: "short" }) }));
  const workdays = targets.targets.filter((x) => x > 0).length;
  const absentDays = targets.absenceByDay.filter(Boolean).length;
  const status = filtered ? null : bookedStatus(report.total, targets.weekTarget, dayLabels, week.startIso <= today);
  const todayIndex = week.days.findIndex((d) => isoDate(d) === today);
  const booked = {
    label: t("Booked this week"),
    value: `${h(report.total)} / ${h(targets.weekTarget)} h`,
    // (the card draws the booked hours big and "/ target h" after them; its sign says what the tone means)
    num: h(report.total),
    of: `/ ${h(targets.weekTarget)} h`,
    mark: status ? statusMark(status.tone) : "",
    todayHours: todayIndex >= 0 ? h(report.dayTotals[todayIndex]) : "",
    todayOf: todayIndex >= 0 ? (targets.targets[todayIndex] > 0 ? ` / ${h(targets.targets[todayIndex])} h` : ` h · ${t("day off")}`) : "",
    todayDone: todayIndex >= 0 && !filtered && targets.targets[todayIndex] > 0 && round2(report.dayTotals[todayIndex]) >= round2(targets.targets[todayIndex]),
    sub: status ? status.caption : `${workdays === 1 ? t("1 workday") : t("{n} workdays", { n: workdays })}${absentDays ? ` · ${absentDays === 1 ? t("1 day absent") : t("{n} days absent", { n: absentDays })}` : ""}`,
    tone: status?.tone ?? "plain",
    today:
      todayIndex >= 0
        ? `${t("Today")} ${h(report.dayTotals[todayIndex])}${targets.targets[todayIndex] > 0 ? ` / ${h(targets.targets[todayIndex])} h` : ` h · ${t("day off")}`}`
        : "",
  };
  const due = getPastWeeksDue(lastAndCurrentMonth().last.startIso, today, today, { reportedBy: by });
  const since = formatDate(due.fromIso, { weekday: false });
  const noPast = due.filtered || due.weeks.length === 0;
  const shortDays = due.weeks.reduce((a, w) => a + w.shortDays.length, 0);
  const pastStatus: { tone: Tone; caption: string } | null = noPast
    ? null
    : due.missing > 0
      ? { tone: "bad", caption: shortDays === 1 ? t("1 day short since {since}", { since }) : t("{n} days short since {since}", { n: shortDays, since }) }
      : { tone: "good", caption: t("All booked since {since}", { since }) };
  const past = {
    label: t("Due in past weeks"),
    value: noPast ? "–" : `${h(due.missing)} h`,
    sub: pastStatus ? pastStatus.caption : due.filtered ? t("Not shown while filtered") : t("No past weeks yet"),
    tone: pastStatus?.tone ?? "plain",
    mark: pastStatus ? statusMark(pastStatus.tone) : "",
    weeks: noPast
      ? []
      : due.weeks.map((w) => ({
          key: w.key,
          label: `${t("W{week}", { week: w.week })}${w.missing > 0 ? ` −${h(w.missing)}` : ""}`,
          missing: w.missing > 0,
          title:
            w.missing > 0
              ? t("Week {week}: {hours} h missing — {days}", { week: w.week, hours: h(w.missing), days: w.shortDays.map((d) => `${formatDate(d.date)} −${h(d.gap)}`).join(", ") })
              : t("Week {week}: {booked} of {target} h booked", { week: w.week, booked: h(w.booked), target: h(w.target) }),
        })),
  };

  // --- the table: hours per job and day
  const isoDays = week.days.map(isoDate);
  const nonWorking = (i: number) => targets.targets[i] === 0;
  const dayTone = (i: number): string => (isoDays[i] === today ? "accent" : nonWorking(i) ? "muted" : "plain");
  const dayHeads = week.days.map((d, i) => {
    const absence = targets.absenceByDay[i];
    return {
      name: formatDay(d, "EEE"),
      date: formatDay(d, "d MMM"),
      note: absence ? labels[absence.type as AbsenceType] : nonWorking(i) ? t("off") : "",
      tone: shortfall[i].state === "missing" ? "bad" : dayTone(i),
      dim: i >= 5,
      // (the column's tint — today, a day off — apart from the name's colour; an absence's note in amber, "off" grey)
      bg: dayTone(i),
      absence: !!absence,
    };
  });
  const rows = report.rows.map((row) => ({
    jobId: row.job.id,
    number: row.job.number,
    name: row.job.name,
    customer: row.job.customer ?? "",
    project: row.project?.title ?? "",
    noJob: row.job.number === NO_JOB_NUMBER,
    days: row.hoursByDay.map((x, i) => {
      const cell = x ? joinMarks(report.entries.filter((e) => e.jobId === row.job.id && (e.projectId ?? null) === (row.project?.id ?? null) && e.date === isoDays[i]).flatMap((e) => marksOf(e.id))) : joinMarks([]);
      return { text: x ? h(x) : "·", tone: cell.approved ? "good" : dayTone(i), dim: i >= 5, mark: cell.mark, markTitle: cell.markTitle };
    }),
    total: h(row.total),
  }));
  const missingTotal = round2(shortfall.reduce((a, s) => a + (s.state === "missing" ? s.gap : 0), 0));
  const pauses = listPausesByDate(week.startIso, week.endIso);
  const defaultPauses = getDefaultPauses();
  const isWorkday = (i: number) => targets.targets[i] > 0;
  const before = formatPauses(latestPausesBefore(week.startIso));
  const pauseRow = isoDays.map((iso, i) => {
    // (A day without a break is offered the latest earlier one: this week's, else the one before the week.)
    let suggest = before;
    for (let j = i - 1; j >= 0; j--) if (pauses[isoDays[j]]?.length) { suggest = formatPauses(pauses[isoDays[j]]); break; }
    const base = { iso, label: formatDay(week.days[i], "EEE d MMM"), current: pauses[iso]?.length ? formatPauses(pauses[iso]) : "", suggest, none: pauses[iso] !== undefined && !pauses[iso].length };
    // (hours: the break's length over its times — the default break greyed out on a working day without one of its own)
    if (pauses[iso]?.length) return { ...base, text: formatPauses(pauses[iso]), tone: "plain", hours: h(totalPauseHours(pauses[iso])) };
    if (pauses[iso] !== undefined) return { ...base, text: t("no break"), tone: "muted", hours: "" };
    const shadow = isWorkday(i) || report.dayTotals[i] > 0 ? defaultPauses : [];
    return { ...base, text: shadow.length ? formatPauses(shadow) : "", tone: "muted", hours: shadow.length ? h(totalPauseHours(shadow)) : "" };
  });
  const flex = getFlexTime();
  const flexJob = flex.jobNumber ? getJobByNumber(flex.jobNumber) : undefined;
  // The absences' shadow rows (Settings → absence jobs): per kind of absence in this week that has a job, its hours on each of its days — booked
  // not yet booked there, offered with a click (booked, it is a row of its own and the cell stays empty), as the flex row offers the missing hours.
  const absenceJobs = getAbsenceJobs();
  const absenceRows = (Object.keys(absenceJobs) as AbsenceType[]).flatMap((type) => {
    const job = getJobByNumber(absenceJobs[type]!);
    if (!job || filtered || !targets.absenceByDay.some((a) => a?.type === type)) return [];
    const onJob = bookedOnJob(job.number, isoDays[0], isoDays[6]);
    const cells = week.days.map((d, i) => {
      const a = targets.absenceByDay[i];
      const hours = a && a.type === type ? absenceHoursOn(a, targets.base[i]) : 0;
      const open = round2(Math.max(0, hours - (onJob.get(isoDays[i]) ?? 0)));
      return { iso: isoDays[i], label: formatDay(d, "EEE d MMM"), hours: hours ? h(hours) : "", open: open ? h(open) : "", openN: open, note: a && a.type === type ? (a.note ?? "") : "", tone: dayTone(i), dim: i >= 5 };
    });
    const openTotal = round2(cells.reduce((s, c) => s + c.openN, 0));
    // (all of it booked: no shadow row — the job shows once, as its own row)
    if (!openTotal) return [];
    return [{ type, job: `${job.number} ${job.name}`, label: t("Absence · {kind}", { kind: labels[type] }), cells, openDates: cells.filter((c) => c.open).map((c) => c.iso).join(","), openTotal: openTotal ? h(openTotal) : "" }];
  });
  const table = {
    heads: dayHeads,
    rows,
    foot: {
      booked: report.dayTotals.map((x, i) => ({
        mark: slots.map((s) => s.slot.days?.[i]?.text ?? "").filter(Boolean).join(" "),
        markTitle: slots.map((s) => s.slot.days?.[i]?.title ?? "").filter(Boolean).join(" · "),
        text: x ? h(x) : shortfall[i].state === "ok" ? "" : "0",
        tone: shortfall[i].state === "missing" ? "bad" : shortfall[i].state === "short" ? "warn" : dayTone(i),
        dim: i >= 5,
        title: shortfall[i].state === "ok" ? "" : shortfall[i].state === "short" ? t("{hours} h below the target (day not over yet)", { hours: h(shortfall[i].gap) }) : t("{hours} h below the target", { hours: h(shortfall[i].gap) }),
      })),
      bookedTotal: h(report.total),
      missing: missingTotal > 0 ? shortfall.map((s) => ({ text: s.state === "missing" ? h(s.gap) : "", tone: s.state === "missing" ? "bad" : "plain" })) : null,
      missingTotal: h(missingTotal),
      target: targets.targets.map((x, i) => ({ text: x ? h(x) : "", tone: nonWorking(i) ? "muted" : "plain", dim: i >= 5 })),
      targetTotal: h(targets.weekTarget),
      pause: pauseRow.map((x, i) => ({ ...x, off: nonWorking(i) })),
      pauseTotal: (() => { const x = round2(isoDays.reduce((a, d) => a + totalPauseHours(pauses[d] ?? []), 0)); return x ? h(x) : ""; })(),
    },
    empty: by ? t("No time booked in this week by {name} yet.", { name: by }) : t("No time booked in this week yet."),
    absences: absenceRows,
    flex: flexJob && !filtered ? { job: `${flexJob.number} ${flexJob.name}`, comment: flex.comment, cells: week.days.map((d, i) => ({ iso: isoDays[i], label: formatDay(d, "EEE d MMM"), gap: shortfall[i].state === "ok" ? 0 : shortfall[i].gap, tone: dayTone(i), dim: i >= 5 })), any: shortfall.some((x) => x.state !== "ok" && x.gap > 0) } : null,
  };

  // --- the form to book
  const jobs = listJobs();
  const bookOptions: [string, string][] = [
    ...jobs.map((j) => [`j:${j.number}`, `${j.number} ${j.name}`] as [string, string]),
    ...listProjectOptions().map((p) => [`p:${p.id}`, `${p.title}${p.jobNumber ? ` (${p.jobNumber} ${p.jobName ?? ""})`.replace(/ \)$/, ")") : ""}`] as [string, string]),
  ];
  const defaultDate = today >= week.startIso && today <= week.endIso ? today : week.startIso;

  // --- closing the week
  const base = await weekClose(week);
  const close = closeWith(base, await closeSlotItems({ week, now: new Date(), over: base.over, entries: report.entries, query: `week=${encodeURIComponent(week.key)}` }));
  const MARK = { ok: { icon: "✓", tone: "good", title: t("done") }, open: { icon: "•", tone: "bad", title: t("open") }, unknown: { icon: "?", tone: "warn", title: t("not known — fetch it first") }, later: { icon: "…", tone: "muted", title: t("not due yet — the week is still running") } };
  const closeDone = close.items.filter((i) => i.state === "ok").length;
  const closing = {
    head: t("Week close · W{week}", { week: week.week }),
    summary: close.done ? t("✓ Week closed") : t("{done} of {n} done", { done: closeDone, n: close.items.length }),
    tone: close.done ? "good" : close.over ? "bad" : "muted",
    items: close.items.map((i) => ({ key: i.key, label: i.label, detail: i.detail, state: i.state, icon: MARK[i.state].icon, tone: MARK[i.state].tone, title: MARK[i.state].title })),
    hidden: !!by,
  };

  // --- the agents' suggestions, and what was done today
  const sdate = (iso: string) => formatDate(iso);
  const suggestions = openSuggestions().map((s) => ({
    id: s.id,
    ref: s.ref,
    date: sdate(s.date),
    hours: s.hours,
    hoursText: h(s.hours),
    description: s.description,
    ticket: s.ticket ?? "",
    target: s.project ? s.project.title : s.job ? `${s.job.number} ${s.job.name}` : "",
    noJob: !s.project && !s.job,
    noJobText: s.ticket ? t("no job for {ticket} — set one on the Jira tab", { ticket: s.ticket }) : t("no job — set one on the Jira tab"),
    by: t("by {name}", { name: s.reportedBy }),
    // (the state that unfolds its evidence, and how much there is)
    evKey: `sev${s.id}`,
    hKey: `sh${s.id}`,
    evLabel: t("Evidence ({n})", { n: s.todos.length + s.runs.length + s.times.length }),
    evidence: [
      ...s.todos.map((td) => `${td.ref} ${td.text}`),
      ...s.times.map((r) => `${r.todo} ${formatMinutes(r.minutes)}${r.note ? ` · ${r.note}` : ""} — ${r.source === "hand" ? t("You") : r.by}`),
      ...s.runs.map((r) => `${r.ref} ${r.agent}${r.minutes !== null ? ` · ${t("{n} min", { n: r.minutes })}` : ""}${r.outcome ? ` · ${r.outcome}` : ""}${r.entryLine ? ` · “${r.entryLine}”` : ""}`),
    ].join("\n") || t("No evidence — only the agent's word."),
    title: s.job || s.project ? t("Book {hours} h on {day} on {target} — with the evidence as context", { hours: h(s.hours), day: sdate(s.date), target: s.project ? s.project.title : `${s.job!.number} ${s.job!.name}` }) : t("Set a job first"),
  }));
  const suggestionTotal = suggestions.reduce((a, s) => a + s.hours, 0);
  const done = doneToday().map((s) => ({
    ticket: s.ticket,
    summary: s.summary ?? "",
    job: s.job ? `${s.job.number} ${s.job.name}` : "",
    noJobText: t("no job for {ticket} — set one on the Jira tab", { ticket: s.ticket }),
    todoIds: s.todoIds,
    hours: s.hours,
    hoursText: h(s.hours),
    description: s.description,
    todos: s.todos.map((td) => `${td.ref} ${td.text}${td.done ? "" : ` (${t("still open")})`}`).join(" · "),
    time: s.time
      .filter((l) => l.kind !== "gap")
      .map((l) => `${l.todo} ${formatMinutes(l.minutes)}${l.by ? ` (${l.by})` : l.kind === "hand" ? ` (${t("by hand")})` : ""}`)
      .join(" · "),
  }));

  // --- the report
  const tk = ticketInfos([...report.entries.map((e) => e.ticket), ...rewritten.days.flatMap((d) => d.lines.flatMap((l) => l.entries.map((e) => e.ticket)))]);
  const ctxCount = todoContextCounts(report.entries.map((e) => e.id));
  const days = rewritten.days.map((d) => ({
    date: d.date,
    dateText: formatDate(d.date),
    // (the report's day head: "Monday, 16 Nov", what it holds while closed, today's open)
    dayText: formatDay(new Date(`${d.date}T00:00:00`), "EEEE, d MMM"),
    linesText: d.lines.length === 1 ? t("1 line") : t("{n} lines", { n: d.lines.length }),
    open: d.date === today,
    total: `${h(d.total)} h`,
    lines: d.lines.map((l, i) => ({
      // (the state that opens a line of several entries)
      key: `rl${d.date.replace(/-/g, "")}_${i}`,
      label: l.label,
      count: l.count > 1 ? `×${l.count}` : "",
      type: typeMap[l.type]?.label ?? l.type,
      color: typeMap[l.type]?.color ?? FALLBACK_TYPE_COLOR,
      tags: l.tags.map((x) => `#${x.name}`).join(" "),
      hours: `${h(l.hours)} h`,
      expandable: l.expandable,
      entries: l.entries.map((e) => ({ job: `${e.jobNumber} ${e.jobName}`, description: e.description, ticket: e.ticket ?? "", ticketUrl: tk(e.ticket).url, ticketTip: tk(e.ticket).tip, hours: `${h(e.hours)} h` })),
    })),
  }));

  return {
    unreadable: input.week && !requested ? t('Could not read week "{week}" — showing the current week instead.', { week: input.week }) : "",
    key: week.key,
    title: t("Week {week}", { week: week.week }),
    year: String(week.year),
    range: formatWeekRange(week),
    isCurrent: week.key === currentWeek().key,
    prev: shiftWeek(week, -1).key,
    next: shiftWeek(week, 1).key,
    current: currentWeek().key,
    by: by ?? "",
    reporters: listReporters(),
    everyone: t("Everyone"),
    csv: `/api/report?week=${week.key}${by ? `&by=${encodeURIComponent(by)}` : ""}`,
    booked,
    past,
    slots: { cards: slots.flatMap((x) => (x.slot.cards ?? []).map(fullCard)), actions: slots.flatMap((x) => (x.slot.actions ?? []).map(fullAction)), exports: slots.flatMap((x) => (x.slot.exports ?? []).map(fullAction)) },
    table,
    form: {
      defaultDate,
      bookOptions,
      typeOptions: types.map((x) => [x.key, x.label] as [string, string]),
      tags: listTags().map((x) => x.name),
      // The week's booked tickets, then the open Jira ones: picking one fills the job it is booked on and the type Ticket.
      tickets: (await import("@/lib/ticket-suggestions")).getEntryTicketSuggestions(week).slice(0, 400).map((x) => ({
        v: x.ticket,
        l: [x.jobName, x.description].filter(Boolean).join(" — "),
        set: { ...(x.jobNumber && jobs.some((j) => j.number === x.jobNumber) ? { n_bookon: `j:${x.jobNumber}` } : {}), n_type: "ticket" },
      })),
    },
    closing,
    suggestions: { head: t("Suggested entries"), count: `(${suggestions.length} · ${h(suggestionTotal)} h)`, items: suggestions },
    done,
    report: { head: t("Report · week {n}", { n: week.week }), days, text: reportText, empty: t("No entries."), total: `${h(rewritten.total)} h` },
    entriesHead: t("Entries in week {n}", { n: week.week }),
    // (what a drop is cleared with: the collecting entries' names in the state)
    dropClear: report.entries.filter((e) => e.isGroup && spanOfHead(e.id)?.mode === "collect").map((e) => `dr${e.id}=`).join("; "),
    contextKinds: [["note", t("Note")], ["teams", "Teams"], ["jira", "Jira"], ["gitlab", "GitLab"], ["email", t("Email")]] as [string, string][],
    parallel: {
      head: t("Parallel work"),
      hint: t("These were done at the same time, but are booked on top of each other. Book the stretch once — in the way that fits."),
      sets: detectParallel(week.startIso, week.endIso).map((p) => ({
        ids: JSON.stringify(p.ids),
        label: p.label,
        when: `${p.date} · ${p.from}–${p.to}`,
        cost: t("{sum} h booked, but the stretch is {span} h", { sum: h(p.sumHours), span: h(p.spanHours) }),
        span: h(p.spanHours),
        lines: p.entries.map((e) => `${e.start} · ${h(e.hours)} h${e.ticket ? ` · ${e.ticket}` : ""} · ${e.description}`),
      })),
    },
    entryList: report.entries.map((e) => {
      const span = e.spanId ? getSpan(e.spanId) : e.isGroup ? spanOfHead(e.id) : undefined;
      const groups = groupOptionsOn(e.date);
      const modeLabel = span ? ({ collect: t("Collecting entry"), combine: t("Combined parallel work"), divide: t("Divided parallel work"), sequential: t("Parallel work, one after the other"), remainder: t("Collecting entry") } as Record<string, string>)[span.mode] : "";
      const members = span ? membersOf(span.id) : [];
      const stretch = span ? stretchOf(members.map((m) => ({ start: m.start, hours: m.workedHours ?? m.hours })), pauses[span.date] ?? []) : null;
      return {
      bookOn: e.projectId ? `p:${e.projectId}` : `j:${e.job.number}`,
      tagsText: e.tags.map((x) => x.name).join(", "),
      comment: e.comment ?? "",
      start: e.start ?? "",
      isGroup: e.isGroup,
      groupFlag: e.isGroup ? "true" : "false",
      ctxCount: ctxCount[e.id] ?? 0,
      dropKey: e.isGroup && span?.mode === "collect" ? `dr${e.id}` : "",
      draggable: !e.isGroup && !e.spanId,
      reportedBy: e.reportedBy,
      typeKey: e.type,
      member: !!e.spanId,
      spanId: span?.id ?? "",
      groupText: span ? `${modeLabel}${stretch?.from && stretch?.to ? ` ${stretch.from}–${stretch.to}` : ""}` : "",
      books: span ? t("books {h} h", { h: h(e.hours) }) : "",
      worked: e.workedHours != null ? h(e.workedHours) : "",
      candidates: e.isGroup && span?.mode === "collect" ? collectCandidates(e.id).length : 0,
      groupOptions: [["", t("Separate entry")], ...groups.map((g) => [g.spanId, `${g.label} (${g.kind === "collect" ? t("Collecting entry") : t("Parallel work")})`])] as [string, string][],
      modeOptions: [["combine", t("Book all on group")], ["divide", t("Divide time on subtasks")], ["sequential", t("Book sequential")], ["remainder", t("Book subentries sequential and remaining time on group")], ["collect", t("Book all on group")]].filter(([m]) => (span?.mode === "collect" || span?.mode === "remainder" ? ["collect", "remainder"] : ["combine", "divide", "sequential"]).includes(m)) as [string, string][],
      id: e.id,
      date: e.date,
      dateText: formatDate(e.date),
      description: e.description,
      ticket: e.ticket ?? "",
      ticketUrl: tk(e.ticket).url,
      ticketTip: tk(e.ticket).tip,
      job: `${e.job.number} ${e.job.name}`.trim(),
      // (the entries' table names the job or the project the entry is booked on, its tags as badges)
      jobName: e.project?.title ?? e.job.name,
      tagNames: e.tags.map((x) => `#${x.name}`),
      project: e.project?.title ?? "",
      type: typeMap[e.type]?.label ?? e.type,
      color: typeMap[e.type]?.color ?? FALLBACK_TYPE_COLOR,
      hours: e.hours,
      hoursText: h(e.hours),
      by: e.reportedBy,
      ...(() => {
        const m = joinMarks(marksOf(e.id));
        return { mark: m.mark, markTitle: m.markTitle, markTone: m.markTone, approved: m.approved };
      })(),
      };
    }),
    figures: { total: report.total, target: targets.weekTarget, dayTotals: report.dayTotals, missing: missingTotal, due: due.missing, close: close.done },
  };
}
