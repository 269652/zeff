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
    name: "time.job-detail",
    group: "time",
    label: "One job's or project's page",
    summary: "What a job's or a project's own page shows (input kind job|project, id): its title, what it has booked, its entries (a job's 200 newest, a project's 500), for a project the job it is on and the types and today's date for booking days.",
    input: [f("kind", "text"), f("id", "number", { required: true })],
    output: "{ found, kind, title, sub, entries, … }",
    run: async (i) => {
      const { jobDetail } = await import("./jobs-data");
      return jobDetail({ kind: text(i.kind), id: i.id });
    },
  },
  {
    name: "time.job-delete",
    group: "time",
    label: "Delete a job or a project",
    summary: "Deletes a job or a project (input kind job|project, id) — a job with entries is refused, a project's entries stay without a project. Output { ok }; a refusal is an error.",
    input: [f("kind", "text", { required: true }), f("id", "number", { required: true })],
    output: "{ ok }",
    writes: true,
    run: async (i) => {
      if (text(i.kind) === "project") (await import("@/lib/projects")).deleteProject(Number(i.id));
      else (await import("@/lib/jobs")).deleteJob(Number(i.id));
      return { ok: true };
    },
  },
  {
    name: "time.book-days",
    group: "time",
    label: "Book the working days of a range on a project",
    summary: "One entry per working day from from to to on a project (input id, from, to, hours, fillUp: only what the day lacks, description, type), as the project's page does it. Output { ok, message }; nothing to book is an error.",
    input: [f("id", "number", { required: true }), f("from", "text"), f("to", "text"), f("hours", "text"), f("fillUp", "boolean"), f("description", "text"), f("type", "text")],
    output: "{ ok, message }",
    writes: true,
    run: async (i) => {
      const { t } = await import("@/lib/i18n/server");
      const { formatHours } = await import("@/lib/format");
      const { bookProjectDays } = await import("@/lib/project-days");
      const hoursText = text(i.hours).trim();
      const { booked, skipped } = bookProjectDays({
        projectId: Number(i.id),
        from: text(i.from),
        to: text(i.to),
        hours: hoursText ? Number(hoursText.replace(",", ".")) : undefined,
        fillUp: i.fillUp === true || i.fillUp === "true",
        description: text(i.description),
        type: text(i.type) || undefined,
      });
      const total = booked.reduce((a, b) => a + b.hours, 0);
      const skippedText = skipped.length ? ` ${t("Skipped {days}.", { days: skipped.map((s) => `${s.date} (${s.reason})`).join(", ") })}` : "";
      if (booked.length === 0) throw new Error(`${t("Nothing to book.")}${skippedText}`);
      return { ok: true, message: (booked.length === 1 ? t("Booked {hours} h on 1 day.", { hours: formatHours(total) }) : t("Booked {hours} h on {n} days.", { hours: formatHours(total), n: booked.length })) + skippedText };
    },
  },
  {
    name: "time.job-save",
    group: "time",
    label: "Create or change a job",
    summary: "A job: without id it is created (number, name, customer, description, defaultTags comma separated), with id the given fields change (and active). Output { ok, message }; a refusal is an error.",
    input: [f("id", "number"), f("number", "text"), f("name", "text"), f("customer", "text"), f("description", "text"), f("defaultTags", "text"), f("active", "boolean"), f("full", "boolean")],
    output: "{ ok, message, id }",
    writes: true,
    run: async (i) => {
      const { t } = await import("@/lib/i18n/server");
      const { createJob, updateJob } = await import("@/lib/jobs");
      const { setDefaultTags } = await import("@/lib/default-tags");
      const tags = text(i.defaultTags).split(",").map((x) => x.trim().replace(/^#/, "")).filter(Boolean);
      const full = i.full === true || i.full === "true";
      if (!has(i.id)) {
        const job = createJob({ number: text(i.number).trim(), name: text(i.name).trim(), customer: text(i.customer).trim() || undefined, description: text(i.description).trim() || undefined });
        if (tags.length) setDefaultTags({ job: job.id }, tags);
        return { ok: true, id: job.id, message: t("Created job {number} — {name}.", { number: job.number, name: job.name }) };
      }
      const patch: Record<string, unknown> = {};
      for (const k of ["number", "name", "customer", "description"] as const) if (has(i[k]) || (full && (k === "customer" || k === "description") && i[k] !== undefined)) patch[k] = text(i[k]).trim() === "~" ? "" : text(i[k]).trim();
      if (has(i.active)) patch.active = i.active === true || i.active === "true";
      const job = updateJob(Number(i.id), patch);
      if (has(i.defaultTags) || full) setDefaultTags({ job: job.id }, tags);
      return { ok: true, id: job.id, message: t("Saved job {number}.", { number: job.number }) };
    },
  },
  {
    name: "time.project-save",
    group: "time",
    label: "Create or change a project",
    summary: "A project: without id it is created (title, description, customer, jobNumber, startDate, endDate, defaultTags), with id the given fields change (and active) — a changed job moves its entries. Output { ok, message }; a refusal is an error.",
    input: [f("id", "number"), f("title", "text"), f("description", "text"), f("customer", "text"), f("jobNumber", "text"), f("startDate", "text"), f("endDate", "text"), f("defaultTags", "text"), f("active", "boolean"), f("full", "boolean")],
    output: "{ ok, message, id }",
    writes: true,
    run: async (i) => {
      const { t } = await import("@/lib/i18n/server");
      const { createProject, updateProject } = await import("@/lib/projects");
      const { setDefaultTags } = await import("@/lib/default-tags");
      const tags = text(i.defaultTags).split(",").map((x) => x.trim().replace(/^#/, "")).filter(Boolean);
      const full = i.full === true || i.full === "true";
      const fields = { title: text(i.title).trim(), description: text(i.description).trim(), customer: text(i.customer).trim(), jobNumber: text(i.jobNumber).trim(), startDate: text(i.startDate).trim(), endDate: text(i.endDate).trim() };
      if (!has(i.id)) {
        const project = createProject(fields);
        if (tags.length) setDefaultTags({ project: project.id }, tags);
        return { ok: true, id: project.id, message: project.job ? t("Created project {title} on {job}.", { title: project.title, job: project.job.number }) : t("Created project {title} (no job yet).", { title: project.title }) };
      }
      const patch: Record<string, unknown> = {};
      for (const k of Object.keys(fields) as (keyof typeof fields)[]) if (has(i[k]) || (full && k !== "title" && i[k] !== undefined)) patch[k] = fields[k] === "~" ? "" : fields[k];
      if (has(i.active)) patch.active = i.active === true || i.active === "true";
      const { project, moved } = updateProject(Number(i.id), patch);
      if (has(i.defaultTags) || full) setDefaultTags({ project: project.id }, tags);
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
    input: [f("what", "text", { required: true }), f("mon", "text"), f("tue", "text"), f("wed", "text"), f("thu", "text"), f("fri", "text"), f("sat", "text"), f("sun", "text"), f("text", "text"), f("jobNumber", "text"), f("comment", "text"), f("punch", "text")],
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
        const s = sch.updateDefaultPauses(text(i.text).trim(), has(i.punch) ? i.punch === true || i.punch === "true" || i.punch === "1" : sch.getWorkSchedule().punchDefaultPauses);
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
    name: "time.day",
    group: "time",
    label: "The day (or the week) drafted for booking",
    summary: "End of day: the day's finished meetings not booked yet, the agents' open suggestions and the tickets worked on, as lines to take over (input date: an earlier day, default today; week: a week key or \"current\" for the whole week, day by day; state: the view's state as JSON — the sums, \"spread the rest\" and the lines' hours follow the edits in it). Each line names the view states its edits live in (kh hours, kj job, kd words, ki ticked, ks separate).",
    input: [f("date", "text"), f("week", "text"), f("state", "text")],
    output: "{ mode, title, intro, days: [{ date, head, sub, rows: [{ k, kh, kj, kd, ki, ks, kind, include, hours, description, from, jobOptions … }] }] }",
    run: async (i) => {
      const { dayScreen } = await import("./day-data");
      return dayScreen({ date: text(i.date), week: text(i.week), state: text(i.state) });
    },
  },
  {
    name: "time.day-book",
    group: "time",
    label: "Book the day as the lines stand",
    summary: "Books a day's lines as you took them over (input date; state: the view's state as JSON — the lines' edits by their names, a line without an edit as proposed): meetings as calendar entries (each once), suggestions accepted, tickets as entries, parallel work grouped. Output { message, created } — created can be taken back with time.day-undo; a line that fails is named in the error.",
    input: [f("date", "date", { required: true }), f("state", "text")],
    output: "{ ok, message, created }",
    writes: true,
    run: async (i) => {
      const { bookFromState } = await import("./day-data");
      const raw = text(i.state).trim();
      const r = await bookFromState(text(i.date), raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      return { ok: true, message: r.message, created: JSON.stringify(r.created) };
    },
  },
  {
    name: "time.day-undo",
    group: "time",
    label: "Take a day's booking back",
    summary: "Deletes the entries a time.day-book created (input created: its answer), only those still as booked. Output { ok, message }.",
    input: [f("created", "text", { required: true })],
    output: "{ ok, message }",
    writes: true,
    run: async (i) => {
      const { undoFromText } = await import("./day-data");
      return { ok: true, ...(await undoFromText(text(i.created))) };
    },
  },
  {
    name: "time.rules",
    group: "time",
    label: "The rules of time tracking",
    summary: "The entry type rules, the report rewriting rules (when → label, tags), the meeting → job rules with their default job, the meeting exclude rules and the entry types (with their use), as Settings → Time tracking edits them — and the options of the forms.",
    input: [],
    output: "{ typeRules, reportRules, meetingRules, meetingDefaultJob, excludeRules, entryTypes, jobOptions, typeOptions, fieldOptions, meetings }",
    run: async () => {
      const { rulesScreen } = await import("./rules-data");
      return rulesScreen();
    },
  },
  {
    name: "time.rule-op",
    group: "time",
    label: "Change a list of rules, one step",
    summary:
      "One change of a list: what types | report | meetings | exclude | entry-type | tag (op add: name, color — rename: id, name — remove: id) | parallel (mode combine|divide|sequential: how parallel work is booked by default), op add | remove | up | down (| default for the meeting default job | update for an entry type), index of the rule. add: types (jobNumber, description, type), report (f1,v1 … f3,v3 conditions as field/value, template, tags), meetings (match, jobNumber, group), exclude (value), entry-type (label, color); update/remove entry-type take key. apply: also re-type / re-tag / re-book existing entries. Output { ok, message }; a refusal is an error.",
    input: [f("what", "text", { required: true }), f("op", "text", { required: true }), f("index", "number"), f("apply", "boolean"), f("jobNumber", "text"), f("description", "text"), f("type", "text"), f("f1", "text"), f("v1", "text"), f("f2", "text"), f("v2", "text"), f("f3", "text"), f("v3", "text"), f("template", "text"), f("tags", "text"), f("match", "text"), f("group", "boolean"), f("value", "text"), f("label", "text"), f("color", "text"), f("key", "text"), f("name", "text"), f("id", "number"), f("mode", "text")],
    output: "{ ok, message }",
    writes: true,
    run: async (i) => {
      const { ruleOp } = await import("./rules-data");
      return { ok: true, ...ruleOp(i) };
    },
  },
  {
    name: "time.entry-op",
    group: "time",
    label: "Edit an entry, its group or a day's break",
    summary:
      "One edit, as the weekly report's own actions do it. op: update (id, date, bookOn, hours, description, ticket, type, tags, comment, start, isGroup), copy (id, date), link (id, spanId), unlink (id), collect (id of a collecting entry), start (id, start), span-mode (spanId, mode), ungroup (spanId), parallel (ids, mode combine|divide|sequential) or pauses (dates comma separated, text: the break, \"none\" for no break, empty to remove). Output { ok, message }; a refusal is an error.",
    input: [f("op", "text", { required: true }), f("id", "number"), f("date", "text"), f("bookOn", "text"), f("hours", "text"), f("description", "text"), f("ticket", "text"), f("type", "text"), f("tags", "text"), f("comment", "text"), f("start", "text"), f("isGroup", "text"), f("spanId", "text"), f("mode", "text"), f("ids", "text"), f("dates", "text"), f("text", "text"), f("state", "text"), f("contextId", "number"), f("ctxKind", "text"), f("ctxTitle", "text"), f("ctxAuthor", "text"), f("ctxBody", "text"), f("ctxLink", "text"), f("ctxLinks", "text"), f("ctxDate", "text"), f("ctxTicket", "text"), f("token", "text"), f("name", "text"), f("mime", "text"), f("fileId", "number"), f("dir", "text"), f("url", "text"), f("ticket", "text")],
    output: "{ ok, message }",
    writes: true,
    run: async (i) => {
      const { entryOp } = await import("./entry-ops");
      return { ok: true, ...(await entryOp(i)) };
    },
  },
  {
    name: "time.entry-add",
    group: "time",
    label: "Book time",
    summary:
      'Books an entry as the weekly report\'s form does (input date, hours, description, bookOn: "j:<job number>" or "p:<project id>" — none: the job the ticket was last booked on —, ticket, type, tags (comma separated), comment): the default tags are the form\'s, work running parallel to a collecting entry is grouped with it. Output { ok, message }; a refusal is an error.',
    input: [f("date", "date", { required: true }), f("hours", "text", { required: true }), f("description", "text"), f("bookOn", "text"), f("ticket", "text"), f("type", "text"), f("tags", "text"), f("comment", "text"), f("start", "text"), f("isGroup", "text"), f("separate", "text"), f("reportedBy", "text"), f("ctxKind", "text"), f("ctxTitle", "text"), f("ctxAuthor", "text"), f("ctxBody", "text"), f("ctxLink", "text"), f("ctxDate", "text"), f("ctxTicket", "text")],
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
            isGroup: i.isGroup === true || i.isGroup === "true",
            start: text(i.start).trim() || undefined,
            reportedBy: text(i.reportedBy).trim() || undefined,
          },
          "web",
        );
        // "+ Add context": written with the entry (checked first, so a bad one leaves nothing half booked).
        const { contextOf } = await import("./entry-ops");
        const context = contextOf(i);
        if (context) {
          try {
            await (await import("@/lib/contexts")).createContext(context, [], entry.id);
          } catch (err) {
            (await import("@/lib/entries")).deleteEntry(entry.id);
            throw new Error(t("Context: {error}", { error: errorMessage(err) }));
          }
        }
        const { autoGroup, collectIntoHead, parallelSaid } = await import("@/lib/entry-parallel");
        // A new collecting entry takes in what that day has; other work is grouped with what it runs parallel to unless "Separate entry".
        let grouped = "";
        if (entry.isGroup) {
          const n = collectIntoHead(entry.id);
          if (n) grouped = n === 1 ? t("1 parallel entry of that day was grouped under it.") : t("{n} parallel entries of that day were grouped under it.", { n });
        }
        const g = entry.isGroup || i.separate === true || i.separate === "true" ? null : autoGroup(entry.id);
        const v = { hours: formatHours(hours), project: entry.project?.title, job: entry.job.name, number: entry.job.number, date: entry.date };
        const base = entry.project ? t("Booked {hours}h on {project} ({job}) for {date}.", v) : t("Booked {hours}h on {number} for {date}.", v);
        return { ok: true, id: entry.id, message: grouped ? `${base} ${grouped}` : g ? `${base} ${parallelSaid(g)}` : base };
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
    name: "time.entry-detail",
    group: "time",
    label: "What stands behind an entry",
    summary: "An entry's context items (kind, headline, author, date, text, links) and what its todos bring (the todos, where they came from, their notes) — what the entry's page shows (input id).",
    input: [f("id", "number", { required: true })],
    output: "{ found, title, contexts, todos, sources, notes, kindOptions }",
    run: async (i) => {
      const { entryDetail } = await import("./entry-context");
      return entryDetail({ id: i.id });
    },
  },
  {
    name: "time.source-search",
    group: "time",
    label: "Search the messages and items that can be added to an entry as a source",
    summary: "Teams messages, GitLab items, todos and mails by words — or what a pasted link points at — each with the link that adds it (input q): { hits: [{ url, section, meta, text }] }.",
    input: [f("q", "text", { required: true })],
    output: "{ hits }",
    run: async (i) => {
      const { sourceSearch } = await import("./entry-context");
      return sourceSearch({ q: i.q });
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

// (Time tracking's core is the kernel's: these reads and writes are there whether or not the built-in screens are installed — the plugin that replaces them needs them.)
extensionPoint<FlowAction[]>("workspace.flowActions").contribute("core:time", TIME_FLOW_ACTIONS);
