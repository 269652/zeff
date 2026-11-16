import { dayShortfalls } from "@/lib/day-status";
import { getWeeklyReport, listReporters } from "@/lib/entries";
import { listEntryTypes } from "@/lib/entry-types";
import { FALLBACK_TYPE_COLOR, typeMapOf } from "@/lib/entry-types-shared";
import { formatDate, formatHours, round2 } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { listJobs } from "@/lib/jobs";
import { lastAndCurrentMonth } from "@/lib/month";
import { getPastWeeksDue } from "@/lib/monthly";
import { formatPauses } from "@/lib/pauses-shared";
import { getDefaultPauses, getFlexTime, getWeekTargets } from "@/lib/schedule";
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
  const targets = getWeekTargets(week);
  const rewritten = getRewrittenReport(week, { reportedBy: by });
  const reportText = reportToText(rewritten, formatHours);
  const types = listEntryTypes();
  const typeMap = typeMapOf(types);
  const labels = absenceLabels(t);

  // --- the cards
  const shortfall = dayShortfalls(week, report.dayTotals, targets.targets, { today, filtered });
  const dayLabels = week.days.map((d, i) => ({ ...shortfall[i], label: d.toLocaleDateString(undefined, { weekday: "short" }) }));
  const workdays = targets.targets.filter((x) => x > 0).length;
  const absentDays = targets.absenceByDay.filter(Boolean).length;
  const status = filtered ? null : bookedStatus(report.total, targets.weekTarget, dayLabels, week.startIso <= today);
  const todayIndex = week.days.findIndex((d) => isoDate(d) === today);
  const booked = {
    label: t("Booked this week"),
    value: `${h(report.total)} / ${h(targets.weekTarget)} h`,
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
    };
  });
  const rows = report.rows.map((row) => ({
    jobId: row.job.id,
    number: row.job.number,
    name: row.job.name,
    customer: row.job.customer ?? "",
    project: row.project?.title ?? "",
    noJob: row.job.number === NO_JOB_NUMBER,
    days: row.hoursByDay.map((x, i) => ({ text: x ? h(x) : "·", tone: dayTone(i) })),
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
    if (pauses[iso]?.length) return { ...base, text: formatPauses(pauses[iso]), tone: "plain" };
    if (pauses[iso] !== undefined) return { ...base, text: t("none"), tone: "muted" };
    return { ...base, text: isWorkday(i) || report.dayTotals[i] > 0 ? formatPauses(defaultPauses) || "＋" : "＋", tone: "muted" };
  });
  const flex = getFlexTime();
  const flexJob = flex.jobNumber ? getJobByNumber(flex.jobNumber) : undefined;
  const table = {
    heads: dayHeads,
    rows,
    foot: {
      booked: report.dayTotals.map((x, i) => ({
        text: x ? h(x) : shortfall[i].state === "ok" ? "" : "0",
        tone: shortfall[i].state === "missing" ? "bad" : shortfall[i].state === "short" ? "warn" : dayTone(i),
        title: shortfall[i].state === "ok" ? "" : shortfall[i].state === "short" ? t("{hours} h below the target (day not over yet)", { hours: h(shortfall[i].gap) }) : t("{hours} h below the target", { hours: h(shortfall[i].gap) }),
      })),
      bookedTotal: h(report.total),
      missing: missingTotal > 0 ? shortfall.map((s) => ({ text: s.state === "missing" ? h(s.gap) : "", tone: s.state === "missing" ? "bad" : "plain" })) : null,
      missingTotal: h(missingTotal),
      target: targets.targets.map((x, i) => ({ text: x ? h(x) : "", tone: nonWorking(i) ? "muted" : "plain" })),
      targetTotal: h(targets.weekTarget),
      pause: pauseRow,
    },
    empty: by ? t("No time booked in this week by {name} yet.", { name: by }) : t("No time booked in this week yet."),
    flex: flexJob && !filtered ? { job: `${flexJob.number} ${flexJob.name}`, comment: flex.comment, days: week.days.map((d, i) => ({ iso: isoDays[i], label: formatDay(d, "EEE d MMM"), gap: shortfall[i].state === "ok" ? 0 : shortfall[i].gap })).filter((x) => x.gap > 0) } : null,
  };

  // --- the form to book
  const jobs = listJobs();
  const bookOptions: [string, string][] = [
    ...jobs.map((j) => [`j:${j.number}`, `${j.number} ${j.name}`] as [string, string]),
    ...listProjectOptions().map((p) => [`p:${p.id}`, `${p.title}${p.jobNumber ? ` (${p.jobNumber} ${p.jobName ?? ""})`.replace(/ \)$/, ")") : ""}`] as [string, string]),
  ];
  const defaultDate = today >= week.startIso && today <= week.endIso ? today : week.startIso;

  // --- closing the week
  const close = await weekClose(week);
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
  const days = rewritten.days.map((d) => ({
    date: d.date,
    dateText: formatDate(d.date),
    total: `${h(d.total)} h`,
    lines: d.lines.map((l) => ({
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
    table,
    form: {
      defaultDate,
      bookOptions,
      typeOptions: types.map((x) => [x.key, x.label] as [string, string]),
      tags: listTags().map((x) => x.name),
    },
    closing,
    suggestions: { head: t("Suggested entries"), count: `(${suggestions.length} · ${h(suggestionTotal)} h)`, items: suggestions },
    done,
    report: { head: t("Report · week {n}", { n: week.week }), days, text: reportText, empty: t("No entries.") },
    entriesHead: t("Entries in week {n}", { n: week.week }),
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
      project: e.project?.title ?? "",
      type: typeMap[e.type]?.label ?? e.type,
      color: typeMap[e.type]?.color ?? FALLBACK_TYPE_COLOR,
      hours: e.hours,
      hoursText: h(e.hours),
      by: e.reportedBy,
      };
    }),
    figures: { total: report.total, target: targets.weekTarget, dayTotals: report.dayTotals, missing: missingTotal, due: due.missing, close: close.done },
  };
}
