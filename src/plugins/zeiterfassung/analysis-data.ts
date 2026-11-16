import { getAnalysis, getEarliestEntryDate } from "@/lib/analysis";
import { listEntryTypes } from "@/lib/entry-types";
import { FALLBACK_TYPE_COLOR } from "@/lib/entry-types-shared";
import { formatHours } from "@/lib/format";
import { t } from "@/lib/i18n/server";

/**
 * The analysis of the booked time as figures and words, ready to draw: what src/app/analysis/page.tsx works out from `getAnalysis` (the same
 * numbers, the same sentences) as plain data — the cards, the split by type, hours by job, the weeks (a column per week and type), the Jira
 * metrics where tickets are synced, hours by tag and by type, the top tickets. Read only.
 */
const h = (n: number) => formatHours(n);

export function analysisScreen(input: { weeks?: unknown; tickets?: string; split?: string } = {}) {
  const raw = String(input.weeks ?? "").trim();
  const weeks = /^\d+$/.test(raw) ? Number(raw) : 8;
  const mine = input.tickets === "mine";
  const split = input.split === "type" ? "type" : "tag";
  const a = getAnalysis({ weeks, earliest: getEarliestEntryDate(), ticketScope: mine ? "mine" : "all" });

  const configured = listEntryTypes();
  const known = new Set(configured.map((x) => x.key));
  const types = [...configured, ...Object.keys(a.byType).filter((k) => !known.has(k)).map((k) => ({ key: k, label: k, color: FALLBACK_TYPE_COLOR, builtin: false }))];
  const typesWithHours = types.filter((x) => (a.byType[x.key] ?? 0) > 0);
  const pct = (x: number) => (a.totalHours > 0 ? Math.round((x / a.totalHours) * 100) : 0);
  const days = (v: number | null) => (v === null ? "—" : `${h(v)} d`);

  const typeItems = [...typesWithHours]
    .sort((x, y) => (a.byType[y.key] ?? 0) - (a.byType[x.key] ?? 0))
    .map((x) => ({ key: x.key, label: x.label, value: a.byType[x.key] ?? 0, valueLabel: `${h(a.byType[x.key] ?? 0)} h`, color: x.color }));
  const tagItems = a.byTag.slice(0, 12).map((x) => ({ key: String(x.tag.id), label: `#${x.tag.name}`, value: x.hours, valueLabel: `${h(x.hours)} h`, color: "#14b8a6" }));
  if (a.untaggedHours > 0) tagItems.push({ key: "untagged", label: t("untagged"), value: a.untaggedHours, valueLabel: `${h(a.untaggedHours)} h`, color: "#d4d4d8" });

  const intro = `${a.range.allTime ? t("All recorded time") : t("Last {n} weeks", { n: a.range.weeks })} · ${a.range.fromIso} → ${a.range.toIso}${
    a.jira
      ? a.myTickets
        ? ` · ${a.myTickets.worked === 1 ? t("Jira metrics: 1 ticket you worked on") : t("Jira metrics: {n} tickets you worked on", { n: a.myTickets.worked })}${a.myTickets.inJira < a.myTickets.worked ? ` ${t("({n} in Jira)", { n: a.myTickets.inJira })}` : ""}`
        : ` · ${t("Jira metrics: all tickets")}`
      : ""
  }`;
  const card = (label: string, value: string, tone = "plain", hint = "") => ({ label, value, tone, hint });

  return {
    weeks,
    mine,
    split,
    ranges: [
      { weeks: 4, label: t("4 weeks") },
      { weeks: 8, label: t("8 weeks") },
      { weeks: 12, label: t("12 weeks") },
      { weeks: 26, label: t("26 weeks") },
      { weeks: 0, label: t("All time") },
    ].map((r) => ({ weeks: String(r.weeks), label: r.label })),
    intro,
    hasData: a.hasData,
    empty: t("No time booked in this range."),
    cards: [
      card(t("Total booked"), `${h(a.totalHours)} h`),
      card(t("Meetings"), `${a.meetingPercent}%`, "warn"),
      card(t("Avg meetings / day"), `${h(a.avgMeetingHoursPerActiveDay)} h`, "warn"),
      card(t("Distinct tickets"), String(a.distinctTickets)),
      card(t("Avg / active week"), `${h(a.avgHoursPerActiveWeek)} h`),
    ],
    jiraCards: a.jira
      ? [
          card(a.myTickets ? t("Worked on") : t("Jira tickets"), String(a.jira.total), "plain", a.myTickets ? t("Synced Jira tickets you booked time on in this range.") : t("All synced tickets on enabled boards, plus yours.")),
          card(t("Open"), String(a.jira.byCategory.todo + a.jira.byCategory.inprogress)),
          card(t("Done"), String(a.jira.byCategory.done), "warn"),
          card(t("Closed in range"), String(a.ticketsClosed), "warn"),
        ]
      : [],
    ticketCards:
      a.jira && a.hasTicketDates
        ? [
            card(t("Avg reaction time"), a.hasReactionData ? days(a.avgReactionDays) : "—", "plain", t("Time to respond: ticket opened → first status change (Jira changelog).")),
            card(t("Avg resolution time"), days(a.avgResolutionDays), "plain", t("Ticket opened → resolved, averaged over tickets resolved in range.")),
            card(t("Avg closed / week"), h(a.avgClosedPerWeek)),
            card(t("Avg parallel tickets"), h(a.avgParallelPerWeek), "warn"),
          ]
        : [],
    datesHint: a.jira && !a.hasTicketDates,
    meetingPercent: `${a.meetingPercent}%`,
    typeSplit: typesWithHours.map((x) => ({ key: x.key, label: x.label, color: x.color, hours: a.byType[x.key] ?? 0, hoursText: `${h(a.byType[x.key] ?? 0)} h`, pct: `${pct(a.byType[x.key] ?? 0)}%` })),
    jobItems: a.byJob.map((j) => ({ key: j.jobNumber, label: `${j.jobNumber} ${j.jobName}`, value: j.hours, valueLabel: `${h(j.hours)} h`, color: "#0ea5e9" })),
    weekRows: a.weeks.flatMap((w) => typesWithHours.map((x) => ({ week: `W${w.label}`, type: x.label, hours: w.byType[x.key] ?? 0 }))),
    weekBadges: a.weeks.map((w) => ({ week: `W${w.label}`, total: h(w.total), badge: a.jira ? (w.closed ? `${w.closed}✓` : "") : w.ticketsWorked ? `${w.ticketsWorked}🎫` : "" })),
    weekLegend: a.jira ? t("✓ tickets closed") : t("🎫 tickets worked"),
    performance: a.weeks.map((w) => ({ week: `W${w.label}`, days: w.avgResolutionDays ?? 0 })),
    parallel: a.weeks.map((w) => ({ week: `W${w.label}`, tickets: w.wip })),
    splitItems: split === "type" ? typeItems : tagItems,
    splitEmpty: split === "type" ? t("No entries.") : t("No tagged entries."),
    ticketItems: a.topTickets.map((x) => ({ key: x.ticket, label: x.ticket, value: x.hours, valueLabel: `${h(x.hours)} h`, color: "#6366f1" })),
    foot: a.jira
      ? t("“Tickets closed” buckets synced Jira tickets by their resolution date; some done tickets have no resolution date and aren't counted per week. Sync tickets on the Jira tab.")
      : t("“Tickets worked” counts distinct ticket keys booked in a week (activity, not closures). Sync Jira on the Jira tab to track actual closures."),
    figures: { total: a.totalHours, meetingPercent: a.meetingPercent, entries: a.entryCount, weeks: a.weeks.length, tickets: a.distinctTickets },
  };
}
