import { dayShortfalls } from "@/lib/day-status";
import { listReporters } from "@/lib/entries";
import { listEntryTypes } from "@/lib/entry-types";
import { FALLBACK_TYPE_COLOR, typeMapOf } from "@/lib/entry-types-shared";
import { formatDate, formatHours, round2 } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { currentMonth, formatMonth, resolveMonth, shiftMonth, weekRangeInMonth } from "@/lib/month";
import { getMonthlyReport, getPastWeeksDue } from "@/lib/monthly";
import { NO_JOB_NUMBER } from "@/lib/projects-shared";
import { getJobReportSummaries, jobSummariesToText } from "@/lib/report";
import { getDayTargets } from "@/lib/schedule";
import { absenceLabels, type AbsenceType } from "@/lib/schedule-shared";
import { isoDate, todayIso } from "@/lib/week";

/**
 * The monthly report as figures and words, ready to draw: what src/app/month/page.tsx works out from the booked time, the schedule and the report rules
 * (the same functions, the same sentences), as plain data — for a plugin's view of it (time tracking's core stays the kernel's; the screen is a plugin).
 * Read only.
 */

type Tone = "plain" | "good" | "warn" | "bad";
/** A card's colour as the tile says it: red bad, orange/amber warn, green good. */
const TONE: Record<string, Tone> = { red: "bad", orange: "warn", amber: "warn", green: "good" };
const h = (n: number) => formatHours(n);

/** The booked card's status, as StatCard's bookedView says it. */
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

export function monthScreen(input: { month?: string; by?: string } = {}) {
  const requested = resolveMonth(input.month);
  const month = requested ?? currentMonth();
  const by = String(input.by ?? "").trim() || undefined;
  const filtered = !!by;
  const today = todayIso();

  const report = getMonthlyReport(month, { reportedBy: by });
  const targets = getDayTargets(month.days);
  const target = round2(targets.reduce((a, x) => a + x.target, 0));
  const shortfalls = dayShortfalls(month, report.dayTotals, targets.map((x) => x.target), { today, filtered });

  const dayIndex = new Map(month.days.map((d, i) => [isoDate(d), i]));
  const perWeek = (value: (i: number) => number) =>
    month.weeks.map((w) =>
      round2(
        w.days.reduce((a, d) => {
          const i = dayIndex.get(isoDate(d));
          return i === undefined ? a : a + value(i);
        }, 0),
      ),
    );
  const weekTargets = perWeek((i) => targets[i].target);
  const weekMissing = perWeek((i) => (shortfalls[i].state === "missing" ? shortfalls[i].gap : 0));
  const workdays = targets.filter((x) => x.target > 0).length;
  const absentDays = targets.filter((x) => x.absence).length;

  // --- the three cards
  const dayLabels = month.days.map((d, i) => ({ ...shortfalls[i], label: formatDate(d, { weekday: false }) }));
  const status = filtered ? null : bookedStatus(report.total, target, dayLabels, month.startIso <= today);
  const booked = {
    label: t("Booked this month"),
    value: `${h(report.total)} / ${h(target)} h`,
    sub: status
      ? status.caption
      : `${workdays === 1 ? t("1 workday") : t("{n} workdays", { n: workdays })}${absentDays ? ` · ${absentDays === 1 ? t("1 day absent") : t("{n} days absent", { n: absentDays })}` : ""}`,
    tone: status?.tone ?? "plain",
  };

  const due = getPastWeeksDue(month.startIso, month.endIso, today, { reportedBy: by });
  const since = formatDate(due.fromIso, { weekday: false });
  const shortDays = due.weeks.reduce((a, w) => a + w.shortDays.length, 0);
  const noPast = due.filtered || due.weeks.length === 0;
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

  const noJob = report.entries.filter((e) => e.job.number === NO_JOB_NUMBER);
  const monthOver = today > month.endIso;
  const projectIds = [...new Set(noJob.flatMap((e) => (e.projectId == null ? [] : [e.projectId])))];
  const entries = {
    label: t("Entries"),
    value: String(report.entries.length),
    sub: report.entries.length === 0 ? "" : noJob.length === 0 ? t("All entries have a job") : noJob.length === 1 ? t("1 entry without a job") : t("{n} entries without a job", { n: noJob.length }),
    tone: (report.entries.length === 0 ? "plain" : noJob.length === 0 ? "good" : monthOver ? "bad" : "warn") as Tone,
    project: noJob.length ? (projectIds.length === 1 ? projectIds[0] : 0) : null,
  };

  // --- the calendar: a row per week, a cell per day
  const weekdays = [t("Mon"), t("Tue"), t("Wed"), t("Thu"), t("Fri"), t("Sat"), t("Sun")];
  const labels = absenceLabels(t);
  const calendar = month.weeks.map((w) => {
    const inMonth = w.days.map((d) => dayIndex.get(isoDate(d)));
    const bookedW = round2(inMonth.reduce<number>((a, i) => a + (i === undefined ? 0 : report.dayTotals[i]), 0));
    const targetW = round2(inMonth.reduce<number>((a, i) => a + (i === undefined ? 0 : targets[i].target), 0));
    return {
      key: w.key,
      label: t("W{week}", { week: w.week }),
      title: t("Open week {week}", { week: w.week }),
      booked: bookedW ? h(bookedW) : "–",
      of: targetW > 0 ? t("of {hours}", { hours: h(targetW) }) : "",
      cells: w.days.map((d, k) => {
        const i = inMonth[k];
        if (i === undefined) return { in: false, day: "", note: "", hours: "", tone: "plain", title: "", today: false, week: w.key };
        const hours = report.dayTotals[i];
        const tg = targets[i];
        const sf = shortfalls[i];
        const off = tg.target <= 0;
        const future = isoDate(d) > today;
        const note = tg.absence ? labels[tg.absence.type as AbsenceType] : off && tg.base <= 0 ? t("off") : "";
        const title = [
          t("{hours} h booked", { hours: hours ? h(hours) : 0 }),
          tg.target > 0 ? t("target {hours} h", { hours: h(tg.target) }) : "",
          sf.state !== "ok" ? (sf.state === "missing" ? t("{hours} h missing", { hours: h(sf.gap) }) : t("{hours} h still due", { hours: h(sf.gap) })) : "",
          note,
        ]
          .filter(Boolean)
          .join(" · ");
        const shown = hours > 0 ? h(hours) : future || off ? "" : "0";
        return {
          in: true,
          day: String(d.getDate()),
          note,
          hours: `${shown}${sf.state !== "ok" ? ` −${h(sf.gap)}` : ""}`.trim(),
          tone: sf.state === "missing" ? "bad" : sf.state === "short" ? "warn" : off ? "muted" : "plain",
          title,
          today: isoDate(d) === today,
          week: w.key,
        };
      }),
    };
  });

  // --- hours per job and week
  const share = (x: number) => (report.total > 0 ? `${Math.round((x / report.total) * 100)}%` : "");
  const jobRows = report.rows.map((row) => ({
    jobId: row.job.id,
    projectId: row.project?.id ?? null,
    number: row.job.number,
    name: row.job.name,
    customer: row.job.customer ?? "",
    project: row.project?.title ?? "",
    noJob: row.job.number === NO_JOB_NUMBER,
    weeks: row.hoursByWeek.map((x) => (x ? h(x) : "·")),
    total: h(row.total),
    share: share(row.total),
  }));
  const missingTotal = round2(weekMissing.reduce((a, b) => a + b, 0));
  const foot = {
    booked: report.weekTotals.map((x) => (x ? h(x) : "")),
    bookedTotal: h(report.total),
    missing: missingTotal > 0 ? weekMissing.map((x) => (x > 0 ? h(x) : "")) : null,
    missingTotal: h(missingTotal),
    target: weekTargets.map((x) => (x ? h(x) : "")),
    targetTotal: h(round2(weekTargets.reduce((a, b) => a + b, 0))),
  };

  // --- by type and by tag
  const types = listEntryTypes();
  const known = new Set(types.map((x) => x.key));
  const typeItems = [...types, ...Object.keys(report.byType).filter((k) => !known.has(k)).map((k) => ({ key: k, label: k, color: FALLBACK_TYPE_COLOR, builtin: false }))]
    .filter((x) => (report.byType[x.key] ?? 0) > 0)
    .sort((a, b) => (report.byType[b.key] ?? 0) - (report.byType[a.key] ?? 0))
    .map((x) => ({ key: x.key, label: x.label, value: report.byType[x.key] ?? 0, valueLabel: `${h(report.byType[x.key] ?? 0)} h`, color: x.color }));
  const tagItems = report.byTag.slice(0, 12).map((x) => ({ key: String(x.tag.id), label: `#${x.tag.name}`, value: x.hours, valueLabel: `${h(x.hours)} h`, color: "#14b8a6" }));
  if (report.untaggedHours > 0) tagItems.push({ key: "untagged", label: t("untagged"), value: report.untaggedHours, valueLabel: `${h(report.untaggedHours)} h`, color: "#d4d4d8" });

  // --- what each job's time went to
  const jobs = getJobReportSummaries(month.startIso, month.endIso, { reportedBy: by });
  const typeMap = typeMapOf(types);
  const reportLines = jobs.reduce((a, j) => a + j.lines.length, 0);
  const summaries = jobs.map((j) => ({
    number: j.jobNumber,
    name: j.jobName,
    hours: `${h(j.hours)} h`,
    share: report.total > 0 ? `${Math.round((j.hours / report.total) * 100)}%` : "",
    lines: j.lines.map((l) => ({
      label: l.label,
      count: l.count > 1 ? `×${l.count}` : "",
      days: l.days === 1 ? t("1 day") : t("{n} days", { n: l.days }),
      title: t("{entries} on {days}", { entries: l.count === 1 ? t("1 entry") : t("{n} entries", { n: l.count }), days: l.days === 1 ? t("1 day") : t("{n} days", { n: l.days }) }),
      type: typeMap[l.type]?.label ?? l.type,
      color: typeMap[l.type]?.color ?? FALLBACK_TYPE_COLOR,
      hours: `${h(l.hours)} h`,
    })),
  }));
  const summaryText = jobSummariesToText(`${formatMonth(month)}${by ? ` · ${by}` : ""}`, report.total, jobs, h);

  const first = month.weeks[0];
  const last = month.weeks[month.weeks.length - 1];
  return {
    unreadable: input.month && !requested ? t('Could not read month "{month}" — showing the current month instead.', { month: input.month }) : "",
    key: month.key,
    label: formatMonth(month),
    weeksText: t("Weeks {first}–{last}", { first: first.week, last: last.week }),
    isCurrent: month.key === currentMonth().key,
    prev: shiftMonth(month, -1).key,
    next: shiftMonth(month, 1).key,
    current: currentMonth().key,
    by: by ?? "",
    reporters: listReporters(),
    csv: `/api/report?month=${month.key}${by ? `&by=${encodeURIComponent(by)}` : ""}`,
    booked,
    past,
    entries,
    weekdays,
    calendar,
    calendarHint: t("booked hours · click a day to open its week"),
    weekHeads: month.weeks.map((w) => ({ key: w.key, label: t("W{week}", { week: w.week }), range: weekRangeInMonth(w, month) })),
    jobRows,
    foot,
    emptyJobs: by ? t("No time booked in this month by {name}.", { name: by }) : t("No time booked in this month."),
    typeItems,
    tagItems,
    reportHead: t("Report · {month}", { month: formatMonth(month) }),
    reportMeta: `${t("What each job's time went to, named by your report rules")}${by ? ` · ${by}` : ""}${
      report.entries.length > 0
        ? ` · ${t("{entries} in {lines}", {
            entries: report.entries.length === 1 ? t("1 entry") : t("{n} entries", { n: report.entries.length }),
            lines: reportLines === 1 ? t("1 line") : t("{n} lines", { n: reportLines }),
          })}`
        : ""
    }`,
    summaries,
    summaryText,
    entryList: report.entries.map((e) => ({
      id: e.id,
      date: e.date,
      dateText: formatDate(e.date),
      description: e.description,
      ticket: e.ticket ?? "",
      job: `${e.job.number} ${e.job.name}`.trim(),
      project: e.project?.title ?? "",
      type: typeMap[e.type]?.label ?? e.type,
      color: typeMap[e.type]?.color ?? FALLBACK_TYPE_COLOR,
      hours: h(e.hours),
      by: e.reportedBy,
    })),
    entriesHead: t("Entries in {month}", { month: formatMonth(month) }),
    everyone: t("Everyone"),
    // The totals the built-in's page has in numbers (for the comparison)
    figures: { total: report.total, target, dayTotals: report.dayTotals, weekMissing, weekTargets, due: due.missing },
  };
}
