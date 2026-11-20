import { and, desc, eq, gte, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Absence, WorkSchedule } from "@/db/schema";
import { ValidationError } from "./errors";
import { round2 } from "./format";
import { t } from "@/lib/i18n/server";
import { formatPauses, parsePauses, type PauseRange } from "./pauses-shared";
import {
  ABSENCE_TYPES,
  DEFAULT_FLEX_COMMENT,
  WEEKDAY_KEYS,
  type AbsenceType,
  type FlexTime,
  type WeekdayKey,
} from "./schedule-shared";
import { isoDate, type WeekInfo } from "./week";
import { getPref, setPref } from "./prefs";

const { workSchedule, absences } = schema;

export { ABSENCE_LABELS, ABSENCE_TYPES, absenceLabels, DEFAULT_FLEX_COMMENT, WEEKDAY_KEYS, WEEKDAY_LABELS } from "./schedule-shared";
export type { AbsenceType, FlexTime, WeekdayKey } from "./schedule-shared";

// ---------------------------------------------------------------------------
// Weekly working pattern (part-time)
// ---------------------------------------------------------------------------

export function getWorkSchedule(): WorkSchedule {
  const db = getDb();
  const existing = db.select().from(workSchedule).limit(1).get();
  if (existing) return existing;
  return db.insert(workSchedule).values({ id: 1 }).returning().get();
}

/** Expected hours by weekday index (0 = Monday … 6 = Sunday). */
export function scheduleHours(s: WorkSchedule): number[] {
  return WEEKDAY_KEYS.map((k) => s[k]);
}

export function updateWorkSchedule(hours: Record<WeekdayKey, number>): WorkSchedule {
  for (const k of WEEKDAY_KEYS) {
    const v = hours[k];
    if (!Number.isFinite(v) || v < 0 || v > 24) {
      throw new ValidationError(t("Hours for {day} must be between 0 and 24.", { day: k }));
    }
  }
  getWorkSchedule(); // ensure the row exists
  return getDb()
    .update(workSchedule)
    .set({
      mon: round2(hours.mon),
      tue: round2(hours.tue),
      wed: round2(hours.wed),
      thu: round2(hours.thu),
      fri: round2(hours.fri),
      sat: round2(hours.sat),
      sun: round2(hours.sun),
      updatedAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

/** The default break window(s) on workdays (e.g. 12:00–13:00); empty when none is set. */
export function getDefaultPauses(s: WorkSchedule = getWorkSchedule()): PauseRange[] {
  if (!s.defaultPauses) return [];
  const parsed = parsePauses(s.defaultPauses);
  return parsed.ok ? parsed.pauses : [];
}

/** Set the default break ("12:00-13:00", "12 30m", …; empty = none) and whether Punch records it. */
export function updateDefaultPauses(text: string, exportToPunch: boolean): WorkSchedule {
  const parsed = parsePauses(text, undefined, t);
  if (!parsed.ok) throw new ValidationError(parsed.error);
  getWorkSchedule(); // ensure the row exists
  return getDb()
    .update(workSchedule)
    .set({
      defaultPauses: parsed.pauses.length ? formatPauses(parsed.pauses) : null,
      punchDefaultPauses: exportToPunch,
      updatedAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

/** The flex-time (Gleitzeit) job and comment: where a day's missing hours can be booked in one click. */
export function getFlexTime(s: WorkSchedule = getWorkSchedule()): FlexTime {
  return { jobNumber: s.flexJobNumber?.trim() || null, comment: s.flexComment?.trim() || DEFAULT_FLEX_COMMENT };
}

/** Set the flex-time job (null = off) and the comment its bookings get (empty = the default). */
export function updateFlexTime(input: { jobNumber: string | null; comment: string }): WorkSchedule {
  getWorkSchedule(); // ensure the row exists
  const comment = input.comment.trim().slice(0, 200);
  return getDb()
    .update(workSchedule)
    .set({
      flexJobNumber: input.jobNumber?.trim() || null,
      flexComment: comment && comment !== DEFAULT_FLEX_COMMENT ? comment : null,
      updatedAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

// ---------------------------------------------------------------------------
// One-off absences
// ---------------------------------------------------------------------------

export function listAbsences(opts: { from?: string; to?: string } = {}): Absence[] {
  const conditions = [];
  // Overlap test: absence.start <= range.to AND absence.end >= range.from
  if (opts.to) conditions.push(lte(absences.startDate, opts.to));
  if (opts.from) conditions.push(gte(absences.endDate, opts.from));
  return getDb()
    .select()
    .from(absences)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(absences.startDate))
    .all();
}

export function createAbsence(input: {
  startDate: string;
  endDate: string;
  type: AbsenceType;
  hours?: number | null;
  note?: string | null;
}): Absence {
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoRe.test(input.startDate) || !isoRe.test(input.endDate)) {
    throw new ValidationError(t("Absence dates must be YYYY-MM-DD."));
  }
  if (input.endDate < input.startDate) {
    throw new ValidationError(t("The end date cannot be before the start date."));
  }
  if (input.hours != null && (input.hours <= 0 || input.hours > 24)) {
    throw new ValidationError(t("Partial-day hours must be between 0 and 24."));
  }
  if (!ABSENCE_TYPES.includes(input.type)) {
    throw new ValidationError(t("Unknown absence type \"{type}\".", { type: input.type }));
  }
  return getDb()
    .insert(absences)
    .values({
      startDate: input.startDate,
      endDate: input.endDate,
      type: input.type,
      hours: input.hours ?? null,
      note: input.note?.trim() || null,
    })
    .returning()
    .get();
}

/**
 * An absence every week (Fridays off, 8 h of vacation each): the same days of the week, one absence per week from the first
 * up to `until` — each its own, so one of them can be taken back (a Friday worked after all). At most two years.
 */
export function createWeeklyAbsences(input: { startDate: string; endDate: string; type: AbsenceType; hours?: number | null; note?: string | null; until: string }): Absence[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.until) || input.until < input.startDate) {
    throw new ValidationError(t("Repeat until must be a date after the start."));
  }
  const shift = (iso: string, days: number) => {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + days);
    return isoDate(d);
  };
  const out: Absence[] = [];
  for (let w = 0; w < 105; w++) {
    const startDate = shift(input.startDate, 7 * w);
    if (startDate > input.until) break;
    out.push(createAbsence({ ...input, startDate, endDate: shift(input.endDate, 7 * w) }));
  }
  return out;
}

export function deleteAbsence(id: number): void {
  getDb().delete(absences).where(eq(absences.id, id)).run();
}

// ---------------------------------------------------------------------------
// Targets for a week (schedule minus absences)
// ---------------------------------------------------------------------------

export type WeekTargets = {
  /** Target hours per weekday (0 = Monday … 6 = Sunday), after absences. */
  targets: number[];
  /** Base schedule hours per weekday, before absences. */
  base: number[];
  /** The absence covering each weekday, if any. */
  absenceByDay: (Absence | undefined)[];
  /** Sum of `targets`. */
  weekTarget: number;
};

export function getWeekTargets(week: WeekInfo): WeekTargets {
  const days = getDayTargets(week.days);
  const targets = days.map((d) => d.target);
  return {
    targets,
    base: days.map((d) => d.base),
    absenceByDay: days.map((d) => d.absence),
    weekTarget: round2(targets.reduce((a, b) => a + b, 0)),
  };
}

/** A day's target: its weekday's scheduled hours, less any absence covering it. */
export type DayTarget = {
  /** YYYY-MM-DD */
  date: string;
  target: number;
  /** The schedule's hours for the weekday, before absences. */
  base: number;
  /** The absence covering the day, if any. */
  absence: Absence | undefined;
};

/**
 * The jobs absences are booked on (Settings → Time tracking), by absence type: vacation, sick, holiday, other — none: an absence only lowers
 * the day's target. With a job, the weekly table offers the absence's hours as a shadow row on it (book them, as flex time is booked), and what is
 * booked there on the absence's days counts towards the day's target as well, so the day is neither missing nor over.
 */
export type AbsenceJobs = Partial<Record<AbsenceType, string>>;
const ABSENCE_JOBS = "time.absenceJobs";
export function getAbsenceJobs(): AbsenceJobs {
  const v = getPref<AbsenceJobs>(ABSENCE_JOBS, {});
  return v && typeof v === "object" ? v : {};
}
export function setAbsenceJobs(next: AbsenceJobs): AbsenceJobs {
  const clean = Object.fromEntries(Object.entries(next).filter(([k, v]) => ABSENCE_TYPES.includes(k as AbsenceType) && typeof v === "string" && v.trim()).map(([k, v]) => [k, String(v).trim()])) as AbsenceJobs;
  setPref(ABSENCE_JOBS, clean);
  return clean;
}
/** The hours an absence takes off a day: its own (a half day) or the whole of the day's schedule. */
export const absenceHoursOn = (a: Pick<Absence, "hours">, base: number): number => round2(a.hours == null ? base : Math.min(base, a.hours));

/** Hours booked per day on a job (by number) between two days — what an absence's job already holds. */
export function bookedOnJob(jobNumber: string, from: string, to: string): Map<string, number> {
  const db = getDb();
  const job = db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.number, jobNumber)).get();
  const out = new Map<string, number>();
  if (!job) return out;
  const rows = db
    .select({ date: schema.timeEntries.date, hours: schema.timeEntries.hours })
    .from(schema.timeEntries)
    .where(and(eq(schema.timeEntries.jobId, job.id), gte(schema.timeEntries.date, from), lte(schema.timeEntries.date, to)))
    .all();
  for (const r of rows) out.set(r.date, round2((out.get(r.date) ?? 0) + r.hours));
  return out;
}

/** The targets of consecutive days (a week, a month). */
export function getDayTargets(days: Date[]): DayTarget[] {
  if (days.length === 0) return [];
  const base = scheduleHours(getWorkSchedule());
  const isos = days.map(isoDate);
  const covering = listAbsences({ from: isos[0], to: isos[isos.length - 1] });
  const absenceJobs = getAbsenceJobs();
  const onJob = new Map((covering.length ? [...new Set(Object.values(absenceJobs))] : []).map((j) => [j!, bookedOnJob(j!, isos[0], isos[isos.length - 1])]));
  return days.map((day, i) => {
    const iso = isos[i];
    const weekday = (day.getDay() + 6) % 7; // 0 = Monday
    let target = base[weekday];
    let absence: Absence | undefined;
    for (const a of covering) {
      if (iso >= a.startDate && iso <= a.endDate) {
        absence ??= a;
        target = a.hours == null ? 0 : Math.max(0, target - a.hours);
      }
    }
    // (An absence booked on its job — Settings: absence jobs —: those hours are part of the day's target again, up to the absence's hours.)
    const job = absence ? absenceJobs[absence.type as AbsenceType] : undefined;
    if (absence && job) target += Math.min(absenceHoursOn(absence, base[weekday]), (onJob.get(job) ?? new Map<string, number>()).get(iso) ?? 0);
    return { date: iso, target: round2(target), base: base[weekday], absence };
  });
}
