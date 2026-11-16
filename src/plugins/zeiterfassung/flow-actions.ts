import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "../workspace/flows/actions";
import type { FieldSpec } from "../workspace/flows/types";

/**
 * The kernel's reads (and, below, writes) of the booked time for plugins' lambdas and flows: the month and the week as the reports show them — figures,
 * words, calendar — worked out from the bookings, the schedule and the report rules. Time tracking's core (jobs, projects, bookings) stays the kernel's;
 * a plugin draws its screens over these. Nothing here knows a plugin. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const text = (v: unknown): string => (v == null ? "" : String(v));

export const TIME_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "time.month",
    group: "time",
    label: "A month of booked time, as the report shows it",
    summary:
      "The monthly report's figures and words for a month (input month: 2026-09, default the current; by: only what one reporter booked): the booked/target card, hours due in past weeks, the entries card, the calendar (a row per week, a cell per day with its hours, shortfall, absence), hours per job and week with their totals, by type and by tag, what each job's time went to (named by the report rules), the copy text and the entries.",
    input: [f("month", "text"), f("by", "text")],
    output: "{ key, label, weeksText, prev, next, current, isCurrent, by, reporters, booked, past, entries, calendar, jobRows, foot, typeItems, tagItems, summaries, summaryText, entryList, … }",
    run: async (i) => {
      const { monthScreen } = await import("./month-data");
      return monthScreen({ month: text(i.month), by: text(i.by) });
    },
  },
  {
    name: "time.week",
    group: "time",
    label: "A week of booked time, as the report shows it",
    summary:
      "The weekly report for a week (input week: 2026-W41 or any day of it, default the current; by: one reporter): the booked card with today, hours due in past weeks, the table of hours per job and day with the missing and target rows and the breaks, the options of the booking form, the closing steps, the agents' suggestions, what was done today, the report by day (as the report rules name it, with its copy text) and the entries.",
    input: [f("week", "text"), f("by", "text")],
    output: "{ key, title, range, prev, next, current, booked, past, table, form, closing, suggestions, done, report, entryList, … }",
    run: async (i) => {
      const { weekScreen } = await import("./week-data");
      return weekScreen({ week: text(i.week), by: text(i.by) });
    },
  },
  {
    name: "time.entry-add",
    group: "time",
    label: "Book time",
    summary:
      'Books an entry as the weekly report\'s form does (input date, hours, description, bookOn: "j:<job number>" or "p:<project id>" — none: the job the ticket was last booked on —, ticket, type, tags (comma separated), comment): the default tags are the form\'s, work running parallel to a collecting entry is grouped with it. Output { ok, message }; a refusal is an error.',
    input: [f("date", "date", { required: true }), f("hours", "text", { required: true }), f("description", "text"), f("bookOn", "text"), f("ticket", "text"), f("type", "text"), f("tags", "text"), f("comment", "text")],
    output: "{ ok, message, error, id }",
    writes: true,
    run: async (i) => {
      const { errorMessage } = await import("@/lib/errors");
      const { t } = await import("@/lib/i18n/server");
      try {
        const { createEntry, getJobNumberForTicket } = await import("@/lib/entries");
        const { parseBookOn } = await import("@/lib/projects-shared");
        const { formatHours } = await import("@/lib/format");
        const hours = Number(text(i.hours).trim().replace(",", "."));
        if (!text(i.hours).trim() || !Number.isFinite(hours)) throw new Error(t("Hours is required (e.g. 1.5)."));
        const ticket = text(i.ticket).trim() || undefined;
        const bookOn = parseBookOn(text(i.bookOn));
        // Reuse the job a ticket was last booked on when none was chosen.
        const ticketJob = !bookOn && ticket ? getJobNumberForTicket(ticket) : undefined;
        const target = bookOn ?? (ticketJob ? { jobNumber: ticketJob } : undefined);
        if (!target) throw new Error(t("Pick a job or a project to book on."));
        const entry = createEntry(
          {
            ...target,
            date: text(i.date).trim(),
            hours,
            description: text(i.description).trim(),
            comment: text(i.comment).trim() || null,
            ticket,
            type: text(i.type).trim() || undefined,
            tags: text(i.tags).split(",").map((x) => x.trim().replace(/^#/, "")).filter(Boolean),
            isGroup: false,
          },
          "web",
        );
        const { autoGroup, parallelSaid } = await import("@/lib/entry-parallel");
        const g = autoGroup(entry.id);
        const v = { hours: formatHours(hours), project: entry.project?.title, job: entry.job.name, number: entry.job.number, date: entry.date };
        const base = entry.project ? t("Booked {hours}h on {project} ({job}) for {date}.", v) : t("Booked {hours}h on {number} for {date}.", v);
        return { ok: true, id: entry.id, message: g ? `${base} ${parallelSaid(g)}` : base };
      } catch (err) {
        throw new Error(errorMessage(err));
      }
    },
  },
  {
    name: "time.entry-hours",
    group: "time",
    label: "Change the hours of an entry",
    summary: "Sets the hours of one entry (input id, hours). Output { ok, message }; a refusal is an error.",
    input: [f("id", "number", { required: true }), f("hours", "text", { required: true })],
    output: "{ ok, message, error }",
    writes: true,
    run: async (i) => {
      const { errorMessage } = await import("@/lib/errors");
      const { t } = await import("@/lib/i18n/server");
      try {
        const hours = Number(text(i.hours).trim().replace(",", "."));
        if (!Number.isFinite(hours)) throw new Error(t("Enter hours as a number, e.g. 1.5."));
        const { updateEntry } = await import("@/lib/entries");
        const { formatHours } = await import("@/lib/format");
        const entry = updateEntry(Number(i.id), { hours });
        return { ok: true, message: t("{hours} h", { hours: formatHours(entry.workedHours ?? entry.hours) }) };
      } catch (err) {
        throw new Error(errorMessage(err));
      }
    },
  },
  {
    name: "time.entry-delete",
    group: "time",
    label: "Delete an entry",
    summary: "Deletes one booked entry (input id). Output { ok, error }.",
    input: [f("id", "number", { required: true })],
    output: "{ ok, error }",
    writes: true,
    run: async (i) => {
      const { errorMessage } = await import("@/lib/errors");
      try {
        const { deleteEntry } = await import("@/lib/entries");
        deleteEntry(Number(i.id));
        return { ok: true };
      } catch (err) {
        throw new Error(errorMessage(err));
      }
    },
  },
  {
    name: "time.suggestion",
    group: "time",
    label: "Take over or dismiss an agent's suggested entry",
    summary:
      "An agent's suggested booking (input id): accept: true takes it over with the hours and description you settled on (a real entry, its evidence as context), else it is dismissed and not suggested again. Output { ok, message }; a refusal is an error.",
    input: [f("id", "number", { required: true }), f("accept", "boolean"), f("hours", "text"), f("description", "text")],
    output: "{ ok, message, error }",
    writes: true,
    run: async (i) => {
      const { errorMessage } = await import("@/lib/errors");
      const { t } = await import("@/lib/i18n/server");
      try {
        if (!i.accept) {
          (await import("@/lib/work/suggestions")).skipSuggestion(Number(i.id));
          return { ok: true, message: t("Suggestion dismissed.") };
        }
        const { acceptSuggestion } = await import("@/lib/work/suggestions");
        const { formatHours } = await import("@/lib/format");
        const { parallelSaid } = await import("@/lib/entry-parallel");
        const hoursText = text(i.hours).trim();
        const r = acceptSuggestion(
          Number(i.id),
          { hours: hoursText ? Number(hoursText.replace(",", ".")) : undefined, description: i.description === undefined ? undefined : text(i.description) },
          { context: false },
        );
        void attachContextLater(r.entryId, r.ticket, r.todoIds);
        const said = r.ticket ? t("Booked {hours} h on {ticket}.", { hours: formatHours(r.hours), ticket: r.ticket }) : t("Booked {hours} h.", { hours: formatHours(r.hours) });
        return { ok: true, message: r.parallel ? `${said} ${parallelSaid(r.parallel)}` : said };
      } catch (err) {
        throw new Error(errorMessage(err));
      }
    },
  },
  {
    name: "time.done-today",
    group: "time",
    label: "Book the todos done today (or skip them)",
    summary:
      "A ticket's todos done today (input ticket, todoIds), booked as one entry with the hours and description you settled on — or, with skip: true, not suggested any more. Output { ok, message }; a refusal is an error.",
    input: [f("ticket", "text", { required: true }), f("todoIds", "list"), f("hours", "text"), f("description", "text"), f("skip", "boolean")],
    output: "{ ok, message, error }",
    writes: true,
    run: async (i) => {
      const { errorMessage } = await import("@/lib/errors");
      const { t } = await import("@/lib/i18n/server");
      try {
        const { bookDoneToday } = await import("@/lib/work/booking");
        const { formatHours } = await import("@/lib/format");
        const ticket = text(i.ticket);
        const raw = text(i.todoIds).trim();
        const todoIds = (Array.isArray(i.todoIds) ? i.todoIds : raw.startsWith("[") ? (JSON.parse(raw) as unknown[]) : raw.split(",")).map(Number).filter(Number.isInteger);
        const r = bookDoneToday({ ticket, todoIds, hours: Number(text(i.hours).replace(",", ".")), description: text(i.description), skip: !!i.skip, context: false });
        if (r.entryId) void attachContextLater(r.entryId, ticket, r.todoIds);
        return { ok: true, message: i.skip ? t("{ticket}: not suggested any more.", { ticket }) : t("Booked {hours} h on {ticket}.", { hours: formatHours(r.hours), ticket }) };
      } catch (err) {
        throw new Error(errorMessage(err));
      }
    },
  },
];

/** A booked entry's context from its todos — after the answer (the Jira read takes a while). */
async function attachContextLater(entryId: number, ticket: string | null, todoIds: number[]) {
  if (!todoIds.length) return;
  try {
    const { attachTodoContext, commentTickets } = await import("@/lib/work/booking");
    const { refreshTicketComments } = await import("@/lib/runs/collect");
    await refreshTicketComments(commentTickets(todoIds)).catch(() => 0);
    attachTodoContext(entryId, ticket, todoIds);
  } catch (e) {
    console.error("[booking context]", e instanceof Error ? e.message : e);
  }
}

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("zeiterfassung", TIME_FLOW_ACTIONS);
