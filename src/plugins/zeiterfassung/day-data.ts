import { proposeDay, proposeWeek, bookDay, undoBooking, type DayBooking, type DayProposal, type DayRow, type BookedStamp } from "@/lib/feierabend";
import { formatHours, formatLongDay } from "@/lib/format";
import { t } from "@/lib/i18n/server";

/**
 * End of day (Feierabend) as plain data and as one write: the day — or the week — drafted for booking, each line with the names of the view states its
 * edits live in (hours, job, words, ticked, itemized), and the booking that takes the lines over as they stand in that state. What
 * src/app/feierabend/page.tsx and bookDayAction do, with the same functions and sentences.
 */

const h = formatHours;
/** A line's name in the view's state: the day and the line's id, as letters and digits. */
export const rowKey = (date: string, id: string) => `${date.replace(/\D/g, "")}_${id.replace(/\W/g, "_")}`;

const kindLabel = (k: DayRow["kind"]) => (k === "meeting" ? t("Meeting") : k === "suggestion" ? t("Suggestion") : t("Ticket"));

function dayView(p: DayProposal) {
  const groupName = p.group ?? p.rows.find((r) => r.kind === "meeting" && r.group)?.description ?? "";
  return {
    date: p.date,
    head: formatLongDay(p.date),
    booked: h(p.booked),
    target: h(p.target),
    sub: t("{booked} of {target} h booked", { booked: p.booked, target: p.target }),
    group: p.group ?? "",
    groupName,
    empty: t("Nothing to suggest — no open meetings, suggestions or tickets worked on today."),
    lines: p.rows.map((r) => {
      const k = rowKey(p.date, r.id);
      const jobs = [...(r.jobNumber ? p.jobs.filter((j) => j.number === r.jobNumber) : []), ...p.jobs.filter((j) => j.number !== r.jobNumber)];
      return {
        k,
        kh: `fh${k}`,
        kj: `fj${k}`,
        kd: `fd${k}`,
        ki: `fi${k}`,
        ks: `fs${k}`,
        kind: r.kind,
        kindLabel: kindLabel(r.kind),
        include: r.include ? "1" : "0",
        hours: r.hours ?? "",
        description: r.description,
        ticket: r.ticket ?? "",
        from: r.from,
        isGroup: r.kind === "meeting" && !!r.group,
        jobText: r.jobNumber || t("The suggestion's job"),
        jobOptions: [["", t("Pick a job…")], ...jobs.map((j) => [j.number, `${j.number} · ${j.name}`])],
        standalone: r.standalone ? "1" : "",
        itemize: r.kind !== "meeting" && groupName ? t("Itemize under “{group}”", { group: groupName }) : "",
      };
    }),
    count: p.rows.length,
  };
}

export async function dayScreen(input: { date?: string; week?: string } = {}) {
  const week = String(input.week ?? "").trim();
  const date = String(input.date ?? "").trim();
  const days = week
    ? (await proposeWeek(week === "current" ? null : week)).days
    : [await proposeDay(/^\d{4}-\d{2}-\d{2}$/.test(date) && date < new Date().toISOString().slice(0, 10) ? new Date(`${date}T23:59:00`) : new Date())];
  return {
    mode: week ? "week" : "day",
    title: week ? t("The week to book") : t("End of day"),
    intro: week
      ? t("{week} — each day as a booking suggestion: its meetings, the agents' suggestions, the tickets you worked on (todos done, worker runs, your commits — an estimate from their span when there is no time), with the evidence of each line.", { week: week === "current" ? t("This week") : week })
      : t("{day} — the day as a booking suggestion: today's meetings, the agents' suggestions and the tickets you worked on (todos done, worker runs with their time). Check, adjust, book with one click.", { day: days[0] ? formatLongDay(days[0].date) : "" }),
    days: days.map(dayView),
  };
}

/** The lines of a day as the view's state has them (hours, job, words, ticked, itemized — by the line's name), over what the proposal says. */
export async function bookFromState(date: string, state: Record<string, unknown>) {
  // (As the page drafts it: an earlier day as at its end, today as now.)
  const proposal = await proposeDay(date < new Date().toISOString().slice(0, 10) ? new Date(`${date}T23:59:00`) : new Date());
  const rows: DayBooking[] = [];
  for (const r of proposal.rows) {
    const k = rowKey(proposal.date, r.id);
    const s = (name: string) => (state[`${name}${k}`] === undefined || state[`${name}${k}`] === null ? "" : String(state[`${name}${k}`]));
    const include = s("fi") ? s("fi") === "1" : r.include;
    if (!include) continue;
    const hours = s("fh") !== "" ? Number(s("fh").replace(",", ".")) : (r.hours ?? 0);
    rows.push({
      kind: r.kind,
      hours,
      jobNumber: s("fj") || r.jobNumber,
      description: s("fd") !== "" ? s("fd") : r.description,
      ticket: r.ticket,
      externalId: r.externalId,
      suggestionId: r.suggestionId,
      group: r.group,
      start: r.start,
      standalone: s("fs") ? s("fs") === "1" : r.standalone,
    });
  }
  if (!rows.length) throw new Error(t("Nothing ticked to book."));
  if (rows.some((r) => !r.hours)) throw new Error(t("Every ticked row needs hours."));
  if (rows.some((r) => r.kind !== "suggestion" && !r.jobNumber)) throw new Error(t("Every ticked row needs a job."));
  const r = await bookDay(date, rows);
  const base = r.skipped
    ? t("{booked} booked ({hours} h), {skipped} already booked", { booked: r.booked, hours: h(r.hours), skipped: r.skipped })
    : t("{booked} booked ({hours} h)", { booked: r.booked, hours: h(r.hours) });
  const itemsSaid = r.items ? `${base}, ${r.items === 1 ? t("1 itemized under the group entry") : t("{n} itemized under the group entry", { n: r.items })}` : base;
  const said = r.parallel ? `${itemsSaid}, ${r.parallel === 1 ? t("1 grouped as parallel work") : t("{n} grouped as parallel work", { n: r.parallel })}` : itemsSaid;
  if (r.errors.length) throw new Error(t("{said} — not booked: {errors}", { said, errors: r.errors.join("; ") }));
  return { message: `${said}.`, created: r.created };
}

export async function undoFromText(created: unknown) {
  const raw = typeof created === "string" ? (JSON.parse(created || "[]") as unknown[]) : Array.isArray(created) ? created : [];
  const list = raw.slice(0, 60).map((c) => ({ id: Number((c as BookedStamp)?.id), updatedAt: String((c as BookedStamp)?.updatedAt) })).filter((c) => Number.isInteger(c.id));
  const r = await undoBooking(list);
  return { message: r.kept ? t("{n} taken back, {kept} left (changed since)", { n: r.deleted, kept: r.kept }) : t("{n} taken back", { n: r.deleted }) };
}
