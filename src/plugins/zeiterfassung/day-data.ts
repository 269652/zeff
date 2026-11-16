import { proposeDay, proposeWeek, bookDay, undoBooking, type DayBooking, type DayProposal, type DayRow, type BookedStamp } from "@/lib/feierabend";
import { formatHours, formatLongDay } from "@/lib/format";
import { t } from "@/lib/i18n/server";

/**
 * End of day (Feierabend) as plain data and as one write: the day — or the week — drafted for booking, each line with the names of the view states its
 * edits live in (hours, job, words, ticked, itemized, "spread the rest"), the sums as the lines stand in that state, and the booking that takes the
 * lines over as they stand. What src/app/feierabend/page.tsx, FeierabendForm and bookDayAction do, with the same functions and sentences.
 */

const h = formatHours;
const r2 = (n: number) => Math.round(n * 100) / 100;
/** A line's name in the view's state: the day and the line's id, as letters and digits. */
export const rowKey = (date: string, id: string) => `${date.replace(/\D/g, "")}_${id.replace(/\W/g, "_")}`;
/** The name of a day's "spread the rest" switch. */
export const spreadKey = (date: string) => `fsp${date.replace(/\D/g, "")}`;

const kindLabel = (k: DayRow["kind"]) => (k === "meeting" ? t("Meeting") : k === "suggestion" ? t("Suggestion") : t("Ticket"));

/** A line as the state has it: what the form would hold — hours, job, words, ticked, itemized — over what is proposed. */
type Line = { row: DayRow; k: string; include: boolean; hours: number | null; jobNumber: string; description: string; standalone: boolean };

/** The lines of a day as the view's state has them, and — when "spread the rest" is on — the missing hours spread over the ticked ticket lines in quarters. */
function effective(p: DayProposal, state: Record<string, unknown>): { lines: Line[]; groupName: string; sum: number; itemized: number; missing: number; spread: boolean } {
  const get = (name: string, k: string) => (state[`${name}${k}`] === undefined || state[`${name}${k}`] === null ? "" : String(state[`${name}${k}`]));
  const lines: Line[] = p.rows.map((r) => {
    const k = rowKey(p.date, r.id);
    return {
      row: r,
      k,
      include: get("fi", k) ? get("fi", k) === "1" : r.include,
      hours: get("fh", k) !== "" ? Number(get("fh", k).replace(",", ".")) || null : r.hours,
      jobNumber: get("fj", k) || r.jobNumber,
      description: get("fd", k) !== "" ? get("fd", k) : r.description,
      standalone: get("fs", k) ? get("fs", k) === "1" : !!r.standalone,
    };
  });
  const totals = () => {
    const chosen = lines.filter((l) => l.include);
    const groupName = chosen.find((l) => l.row.kind === "meeting" && l.row.group)?.description ?? p.group ?? "";
    const under = (l: Line) => !!groupName && l.row.kind !== "meeting" && !l.standalone;
    const sum = r2(chosen.filter((l) => !under(l)).reduce((s, l) => s + (l.hours ?? 0), 0));
    const itemized = r2(chosen.filter(under).reduce((s, l) => s + (l.hours ?? 0), 0));
    return { groupName, sum, itemized, missing: Math.max(0, r2(p.target - p.booked - sum)) };
  };
  let tot = totals();
  const spread = String(state[spreadKey(p.date)] ?? "") === "1";
  if (spread && tot.missing) {
    // What's missing to the target, on the ticked ticket lines without hours — in quarter hours.
    const open = lines.filter((l) => l.include && l.row.kind === "ticket" && !l.hours);
    const pool = open.length ? open : lines.filter((l) => l.include && l.row.kind === "ticket");
    if (pool.length) {
      const each = Math.max(0.25, Math.round((tot.missing / pool.length) * 4) / 4);
      for (const l of pool) l.hours = r2((open.length ? 0 : (l.hours ?? 0)) + each);
      tot = totals();
    }
  }
  return { lines, ...tot, spread };
}

const plain = (s: string) => s.replace(/<\/?b>/g, "");

function dayView(p: DayProposal, state: Record<string, unknown>) {
  const e = effective(p, state);
  const chosen = e.lines.filter((l) => l.include);
  const reached = r2(p.booked + e.sum);
  const whyNot = !chosen.length ? t("Nothing ticked to book.") : chosen.some((l) => !l.hours) ? t("Every ticked row needs hours.") : chosen.some((l) => l.row.kind !== "suggestion" && !l.jobNumber) ? t("Every ticked row needs a job.") : "";
  return {
    date: p.date,
    head: formatLongDay(p.date),
    booked: h(p.booked),
    target: h(p.target),
    sub: t("{booked} of {target} h booked", { booked: p.booked, target: p.target }),
    group: p.group ?? "",
    groupName: e.groupName,
    sums: {
      booked: plain(t("Booked <b>{hours}</b> h", { hours: h(p.booked) })),
      selected: plain(t("+ selected <b>{hours}</b> h", { hours: h(e.sum) })),
      itemized: e.itemized > 0 && e.groupName ? t("{hours} h itemized under “{group}” (not on top)", { hours: h(e.itemized), group: e.groupName }) : "",
      result: plain(
        e.missing
          ? t("= <b>{hours}</b> of {target} h — {missing} h missing", { hours: h(reached), target: h(p.target), missing: h(e.missing) })
          : t("= <b>{hours}</b> of {target} h", { hours: h(reached), target: h(p.target) }),
      ),
      tone: reached >= p.target ? "good" : "warn",
    },
    spreadKey: spreadKey(p.date),
    spreadOn: e.spread ? "1" : "",
    canSpread: (!!e.missing || e.spread) && chosen.some((l) => l.row.kind === "ticket"),
    whyNot,
    bookLabel: chosen.length === 1 ? t("Book 1 row") : t("Book {n} rows", { n: chosen.length }),
    empty: t("Nothing to suggest — no open meetings, suggestions or tickets worked on today."),
    lines: e.lines.map((l) => {
      const r = l.row;
      const jobs = [...(r.jobNumber ? p.jobs.filter((j) => j.number === r.jobNumber) : []), ...p.jobs.filter((j) => j.number !== r.jobNumber)];
      return {
        k: l.k,
        kh: `fh${l.k}`,
        kj: `fj${l.k}`,
        kd: `fd${l.k}`,
        ki: `fi${l.k}`,
        ks: `fs${l.k}`,
        kind: r.kind,
        kindLabel: kindLabel(r.kind),
        include: r.include ? "1" : "0",
        hours: l.hours ?? "",
        description: r.description,
        ticket: r.ticket ?? "",
        from: r.from,
        isGroup: r.kind === "meeting" && !!r.group,
        jobText: r.jobNumber || t("The suggestion's job"),
        jobOptions: [["", t("Pick a job…")], ...jobs.map((j) => [j.number, `${j.number} · ${j.name}`])],
        standalone: r.standalone ? "1" : "",
        itemize: r.kind !== "meeting" && e.groupName ? t("Itemize under “{group}”", { group: e.groupName }) : "",
      };
    }),
    count: p.rows.length,
  };
}

export async function dayScreen(input: { date?: string; week?: string; state?: string } = {}) {
  const week = String(input.week ?? "").trim();
  const date = String(input.date ?? "").trim();
  let state: Record<string, unknown> = {};
  try {
    state = input.state ? (JSON.parse(String(input.state)) as Record<string, unknown>) : {};
  } catch {
    state = {};
  }
  const days = week
    ? (await proposeWeek(week === "current" ? null : week)).days
    : [await proposeDay(/^\d{4}-\d{2}-\d{2}$/.test(date) && date < new Date().toISOString().slice(0, 10) ? new Date(`${date}T23:59:00`) : new Date())];
  return {
    mode: week ? "week" : "day",
    title: week ? t("The week to book") : t("End of day"),
    intro: week
      ? t("{week} — each day as a booking suggestion: its meetings, the agents' suggestions, the tickets you worked on (todos done, worker runs, your commits — an estimate from their span where no time was taken, said so). Check each day, book it with its button — nothing is booked before.", { week: week === "current" ? t("This week") : week })
      : t("{day} — the day as a booking suggestion: today's meetings, the agents' suggestions and the tickets you worked on (todos done, worker runs with their time). Check, adjust, book with one click — nothing is booked before.", { day: days[0] ? formatLongDay(days[0].date) : "" }),
    days: days.map((p) => dayView(p, state)),
  };
}

/** The lines of a day as the view's state has them (hours, job, words, ticked, itemized, spread — by the line's name), over what the proposal says. */
export async function bookFromState(date: string, state: Record<string, unknown>) {
  // (As the page drafts it: an earlier day as at its end, today as now.)
  const proposal = await proposeDay(date < new Date().toISOString().slice(0, 10) ? new Date(`${date}T23:59:00`) : new Date());
  const rows: DayBooking[] = effective(proposal, state)
    .lines.filter((l) => l.include)
    .map((l) => ({
      kind: l.row.kind,
      hours: l.hours ?? 0,
      jobNumber: l.jobNumber,
      description: l.description,
      ticket: l.row.ticket,
      externalId: l.row.externalId,
      suggestionId: l.row.suggestionId,
      group: l.row.group,
      start: l.row.start,
      standalone: l.standalone,
    }));
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
