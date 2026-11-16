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
/** Given: a flow passes what its button left out as nothing or an empty text. */
const has = (v: unknown): boolean => v !== undefined && v !== null && v !== "";

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
    name: "time.analysis",
    group: "time",
    label: "The analysis of the booked time",
    summary:
      "The analysis page's figures and words (input weeks: 4, 8, 12, 26 or 0 for all time, default 8; tickets: \"mine\" for the Jira metrics of the tickets you booked on; split: \"tag\" or \"type\"): the cards, the split by type, hours by job, the weeks per type, the Jira metrics (reaction, resolution, parallel tickets) where tickets are synced, hours by tag or type, the top tickets.",
    input: [f("weeks", "text"), f("tickets", "text"), f("split", "text")],
    output: "{ intro, hasData, cards, jiraCards, ticketCards, typeSplit, jobItems, weekRows, performance, parallel, splitItems, ticketItems, … }",
    run: async (i) => {
      const { analysisScreen } = await import("./analysis-data");
      return analysisScreen({ weeks: i.weeks, tickets: text(i.tickets), split: text(i.split) });
    },
  },
  {
    name: "time.jobs",
    group: "time",
    label: "The jobs and the projects",
    summary: "The jobs (number, name, customer, hours, entries, default tags, active) and the projects (title, its job, hours, entries, the days booked, active) as the Jobs and Projects pages list them, and the job options of a form.",
    input: [],
    output: "{ jobs, projects, jobOptions, jobsHead, projectsHead }",
    run: async () => {
      const { jobsScreen } = await import("./jobs-data");
      return jobsScreen();
    },
  },
  {
    name: "time.job-save",
    group: "time",
    label: "Create or change a job",
    summary: "A job: without id it is created (number, name, customer, description, defaultTags comma separated), with id the given fields change (and active). Output { ok, message }; a refusal is an error.",
    input: [f("id", "number"), f("number", "text"), f("name", "text"), f("customer", "text"), f("description", "text"), f("defaultTags", "text"), f("active", "boolean")],
    output: "{ ok, message, id }",
    writes: true,
    run: async (i) => {
      const { t } = await import("@/lib/i18n/server");
      const { createJob, updateJob } = await import("@/lib/jobs");
      const { setDefaultTags } = await import("@/lib/default-tags");
      const tags = text(i.defaultTags).split(",").map((x) => x.trim().replace(/^#/, "")).filter(Boolean);
      if (!has(i.id)) {
        const job = createJob({ number: text(i.number).trim(), name: text(i.name).trim(), customer: text(i.customer).trim() || undefined, description: text(i.description).trim() || undefined });
        if (tags.length) setDefaultTags({ job: job.id }, tags);
        return { ok: true, id: job.id, message: t("Created job {number} — {name}.", { number: job.number, name: job.name }) };
      }
      const patch: Record<string, unknown> = {};
      for (const k of ["number", "name", "customer", "description"] as const) if (has(i[k])) patch[k] = text(i[k]).trim();
      if (has(i.active)) patch.active = i.active === true || i.active === "true";
      const job = updateJob(Number(i.id), patch);
      if (has(i.defaultTags)) setDefaultTags({ job: job.id }, tags);
      return { ok: true, id: job.id, message: t("Saved job {number}.", { number: job.number }) };
    },
  },
  {
    name: "time.project-save",
    group: "time",
    label: "Create or change a project",
    summary: "A project: without id it is created (title, description, customer, jobNumber, startDate, endDate, defaultTags), with id the given fields change (and active) — a changed job moves its entries. Output { ok, message }; a refusal is an error.",
    input: [f("id", "number"), f("title", "text"), f("description", "text"), f("customer", "text"), f("jobNumber", "text"), f("startDate", "text"), f("endDate", "text"), f("defaultTags", "text"), f("active", "boolean")],
    output: "{ ok, message, id }",
    writes: true,
    run: async (i) => {
      const { t } = await import("@/lib/i18n/server");
      const { createProject, updateProject } = await import("@/lib/projects");
      const { setDefaultTags } = await import("@/lib/default-tags");
      const tags = text(i.defaultTags).split(",").map((x) => x.trim().replace(/^#/, "")).filter(Boolean);
      const fields = { title: text(i.title).trim(), description: text(i.description).trim(), customer: text(i.customer).trim(), jobNumber: text(i.jobNumber).trim(), startDate: text(i.startDate).trim(), endDate: text(i.endDate).trim() };
      if (!has(i.id)) {
        const project = createProject(fields);
        if (tags.length) setDefaultTags({ project: project.id }, tags);
        return { ok: true, id: project.id, message: project.job ? t("Created project {title} on {job}.", { title: project.title, job: project.job.number }) : t("Created project {title} (no job yet).", { title: project.title }) };
      }
      const patch: Record<string, unknown> = {};
      for (const k of Object.keys(fields) as (keyof typeof fields)[]) if (has(i[k])) patch[k] = fields[k];
      if (has(i.active)) patch.active = i.active === true || i.active === "true";
      const { project, moved } = updateProject(Number(i.id), patch);
      if (has(i.defaultTags)) setDefaultTags({ project: project.id }, tags);
      const where = project.job ? `${project.job.number} — ${project.job.name}` : t("No job yet");
      return { ok: true, id: project.id, message: t("Saved project {title}.", { title: project.title }) + (moved ? ` ${moved === 1 ? t("Moved 1 entry to {where}.", { where }) : t("Moved {n} entries to {where}.", { n: moved, where })}` : "") };
    },
  },
  {
    name: "time.schedule",
    group: "time",
    label: "The working schedule, the break, flex time and absences",
    summary: "What Settings → Time tracking shows for the schedule: the weekly hours per weekday, the default break, the flex-time job and comment, the absences and their types.",
    input: [],
    output: "{ days, defaultPauses, flexJob, flexComment, flexJobOptions, absenceTypes, absences, hoursHead }",
    run: async () => {
      const { scheduleScreen } = await import("./schedule-data");
      return scheduleScreen();
    },
  },
  {
    name: "time.schedule-save",
    group: "time",
    label: "Save the schedule, the default break or the flex-time job",
    summary: "Input what: \"hours\" (mon … sun: hours per weekday), \"pauses\" (text: the default break, empty = none) or \"flex\" (jobNumber, empty = off; comment). Output { ok, message }; a refusal is an error.",
    input: [f("what", "text", { required: true }), f("mon", "text"), f("tue", "text"), f("wed", "text"), f("thu", "text"), f("fri", "text"), f("sat", "text"), f("sun", "text"), f("text", "text"), f("jobNumber", "text"), f("comment", "text")],
    output: "{ ok, message }",
    writes: true,
    run: async (i) => {
      const { t } = await import("@/lib/i18n/server");
      const sch = await import("@/lib/schedule");
      const what = text(i.what);
      if (what === "hours") {
        const hours = Object.fromEntries(sch.WEEKDAY_KEYS.map((k) => [k, Number(text(i[k]).replace(",", ".")) || 0])) as Record<(typeof sch.WEEKDAY_KEYS)[number], number>;
        sch.updateWorkSchedule(hours);
        return { ok: true, message: t("Working hours saved.") };
      }
      if (what === "pauses") {
        const s = sch.updateDefaultPauses(text(i.text).trim(), sch.getWorkSchedule().punchDefaultPauses);
        return { ok: true, message: s.defaultPauses ? t("Default break saved: {pauses}.", { pauses: s.defaultPauses }) : t("Default break removed.") };
      }
      if (what === "flex") {
        const jobNumber = text(i.jobNumber).trim() || null;
        const { getJobByNumber } = await import("@/lib/jobs");
        const job = jobNumber ? getJobByNumber(jobNumber) : undefined;
        if (jobNumber && !job) throw new Error(t("There's no job {job}.", { job: jobNumber }));
        const flex = sch.getFlexTime(sch.updateFlexTime({ jobNumber: job?.number ?? null, comment: text(i.comment).trim() }));
        return { ok: true, message: job ? t("Flex time goes to {job} as “{comment}”.", { job: job.number, comment: flex.comment }) : t("Flex time is off.") };
      }
      throw new Error("what: hours, pauses or flex");
    },
  },
  {
    name: "time.flex-book",
    group: "time",
    label: "Book the missing hours of days on the flex-time job",
    summary: "The days' missing hours (input dates: comma separated YYYY-MM-DD) booked on the flex-time job with its comment, as the weekly table's flex row does. Output { ok, message }; nothing to book is an error.",
    input: [f("dates", "text", { required: true })],
    output: "{ ok, message }",
    writes: true,
    run: async (i) => {
      const { t } = await import("@/lib/i18n/server");
      const { formatHours } = await import("@/lib/format");
      const { bookFlexTime } = await import("@/lib/flex-time");
      const r = bookFlexTime(text(i.dates).split(",").map((x) => x.trim()).filter(Boolean));
      if (!r.booked.length) {
        const why = r.skipped.map((s) => `${s.label} ${s.reason}`).join(", ");
        throw new Error(why ? t("Nothing to book — {why}.", { why }) : t("Nothing to book."));
      }
      const hours = r.booked.reduce((a, b) => a + b.hours, 0);
      return { ok: true, message: t("Booked {hours} h “{comment}” on {job}: {days}.", { hours: formatHours(hours), comment: r.comment, job: r.jobNumber, days: r.booked.map((b) => `${b.label} ${t("{hours} h", { hours: formatHours(b.hours) })}`).join(", ") }) };
    },
  },
  {
    name: "time.absence",
    group: "time",
    label: "Add or delete an absence",
    summary: "Input delete (an id): the absence is removed. Else one is added (startDate, endDate default the start, type vacation|sick|holiday|other, hours for a partial day, note, repeatUntil for every week up to a day). Output { ok, message }; a refusal is an error.",
    input: [f("delete", "number"), f("startDate", "text"), f("endDate", "text"), f("type", "text"), f("hours", "text"), f("note", "text"), f("repeatUntil", "text")],
    output: "{ ok, message }",
    writes: true,
    run: async (i) => {
      const { t } = await import("@/lib/i18n/server");
      const sch = await import("@/lib/schedule");
      if (has(i.delete)) {
        sch.deleteAbsence(Number(i.delete));
        return { ok: true, message: "" };
      }
      const start = text(i.startDate).trim();
      const end = text(i.endDate).trim() || start;
      const type = (text(i.type).trim() || "vacation") as "vacation" | "sick" | "holiday" | "other";
      const hoursText = text(i.hours).trim();
      const hours = hoursText ? Number(hoursText.replace(",", ".")) : null;
      const until = text(i.repeatUntil).trim();
      const label = { vacation: t("vacation"), sick: t("sick"), holiday: t("holiday"), other: t("other") }[type] ?? type;
      if (until) {
        const all = sch.createWeeklyAbsences({ startDate: start, endDate: end, type, hours, note: text(i.note).trim() || null, until });
        return { ok: true, message: t("Added {type} every week: {n} times, up to {until}.", { type: label, n: all.length, until: all[all.length - 1]?.startDate ?? until }) };
      }
      const a = sch.createAbsence({ startDate: start, endDate: end, type, hours, note: text(i.note).trim() || null });
      return { ok: true, message: t("Added {type} {dates}.", { type: label, dates: `${a.startDate}${a.endDate !== a.startDate ? `–${a.endDate}` : ""}` }) };
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
