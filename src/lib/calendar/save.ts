/**
 * What changes appointments and calendars, as plain functions (no pages, no request): the model's writes with their checks and the words they answer with.
 * The flow actions `appointments.*` (plugins/calendar/flow-actions.ts) call them for the Calendar plugin's flows. Server only.
 */
import { t } from "@/lib/i18n/server";
import type { SeriesScope } from "./ir-shared";

export type SaveInput = {
  id?: number;
  calendarId?: number;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  location?: string;
  description?: string;
  /** The series' rule — null: not (any more) a series; left out: as it was. */
  recurrence?: unknown;
  occurrence?: string | null;
  scope?: SeriesScope;
  /** A Google calendar's event: its guests (mail addresses). */
  attendees?: string[];
};

/** The Google calendar's id of Zeff's calendar ("google:<id>"), and an event's id from Zeff's key for it. */
async function googleIds(calendarKey: string, eventKey: string | null): Promise<{ calendarId: string; eventId: string | null }> {
  const calendarId = calendarKey.replace(/^google:/, "");
  if (!eventKey) return { calendarId, eventId: null };
  const ids = (await import("@/lib/google/calendar-write")).gcalIdsOf(eventKey);
  if (!ids) throw new Error(t("Zeff doesn't know this event's id in Google — change it in Google Calendar."));
  return { calendarId, eventId: ids.eventId };
}

async function saveGoogleEvent(calendarKey: string, eventKey: string | null, e: { title: string; start: string; end: string; allDay: boolean; location: string; description: string; attendees?: string[] }): Promise<string> {
  const gw = await import("@/lib/google/calendar-write");
  const { journalGoogleWrite } = await import("@/lib/google/journal");
  const { calendarId, eventId } = await googleIds(calendarKey, eventKey);
  const fields = { title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, description: e.description, ...(e.attendees ? { attendees: e.attendees } : {}) };
  if (eventId) {
    await gw.patchGcalEvent(calendarId, eventId, fields);
    journalGoogleWrite({ kind: "calendar.changed", source: "gcalendar", sourceRef: `${eventId}:${Date.now()}`, title: e.title, summary: `${e.start} – ${e.end}` });
    return t('"{title}" saved in Google Calendar.', { title: e.title });
  }
  const r = await gw.insertGcalEvent(calendarId, fields);
  journalGoogleWrite({ kind: "calendar.created", source: "gcalendar", sourceRef: r.id, title: e.title, summary: `${e.start} – ${e.end}`, url: r.htmlLink });
  return t('"{title}" added to Google Calendar.', { title: e.title });
}

/** An appointment in one of Zeff's own calendars — new (no id) or changed (a series' occurrence alone, with the following ones or all), or in a Google calendar you may write to. What it says. */
export async function saveEvent(v: SaveInput): Promise<string> {
  const ir = await import("./ir");
  const { parseRecurrence, addDays } = await import("./recurrence");
  // (a day alone, or a day with a time — "2026-11-16T09:30"; an all-day one takes the day; a form's empty time after the day is no time)
  const stamp = (s: unknown) => {
    const x = typeof s === "string" ? s.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}/.test(x)) return "";
    return !v.allDay && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x) ? x.slice(0, 16) : x.slice(0, 10);
  };
  const e = {
    title: String(v.title ?? "").trim(),
    start: stamp(v.start),
    end: stamp(v.end),
    allDay: !!v.allDay,
    location: String(v.location ?? ""),
    description: String(v.description ?? ""),
    ...(v.recurrence === undefined ? {} : { recurrence: parseRecurrence(v.recurrence) }),
  };
  if (!e.title) throw new Error(t("A title, please."));
  if (!e.start || !e.end || e.end < e.start || (!e.allDay && e.end === e.start)) throw new Error(t("A start and an end after it, please."));
  if (e.allDay && e.end === e.start) e.end = addDays(e.start, 1);
  const before = v.id ? ir.eventById(Number(v.id)) : null;
  if (v.id && !before) throw new Error(t("This event isn't there any more — reload the calendar."));
  const cal = before?.calendar ?? (v.calendarId ? ir.listCalendars().find((c) => c.id === Number(v.calendarId)) : undefined);
  // (a proposed one is Zeff's alone: never written to Google)
  if (cal?.source === "google" && !before?.proposed) return saveGoogleEvent(cal.key, before?.key ?? null, { ...e, attendees: Array.isArray(v.attendees) ? v.attendees.map(String) : undefined });
  const occurrence = typeof v.occurrence === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.occurrence) ? v.occurrence : null;
  if (v.id && occurrence) {
    const scope: SeriesScope = v.scope === "one" || v.scope === "following" ? v.scope : "all";
    ir.updateOccurrence(Number(v.id), occurrence, e, scope);
    return scope === "one" ? t('"{title}" saved (this event).', { title: e.title }) : scope === "following" ? t('"{title}" saved (this and following events).', { title: e.title }) : t('"{title}" saved (all events).', { title: e.title });
  }
  if (v.id) {
    ir.updateEvent(Number(v.id), e);
    return t('"{title}" saved.', { title: e.title });
  }
  const calendarId = Number(v.calendarId) || ir.zeffCalendar().id;
  ir.addEvent(calendarId, e);
  return t('"{title}" added.', { title: e.title });
}

/** A new appointment as a proposal (dashed) — with several times, options for the same thing: accepting one dismisses the others. */
export async function proposeEvent(v: { calendarId?: number; title: string; allDay?: boolean; location?: string; description?: string; times: { start: string; end: string }[] }): Promise<string> {
  const ir = await import("./ir");
  const { addDays } = await import("./recurrence");
  const title = String(v.title ?? "").trim();
  if (!title) throw new Error(t("A title, please."));
  const allDay = !!v.allDay;
  const stamp = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s.slice(0, 16)) ? s.slice(0, allDay ? 10 : 16) : "");
  const times = (Array.isArray(v.times) ? v.times : []).slice(0, 26).map((x) => {
    const start = stamp(x?.start);
    let end = stamp(x?.end);
    if (allDay && start && end === start) end = addDays(start, 1);
    if (!start || !end || end < start || (!allDay && end === start)) throw new Error(t("A start and an end after it, please."));
    return { start, end };
  });
  if (!times.length) throw new Error(t("A start and an end after it, please."));
  const calendarId = Number(v.calendarId) || ir.zeffCalendar().id;
  const { optionKey } = await import("./ir-shared");
  const group = times.length > 1 ? (await import("node:crypto")).randomUUID().slice(0, 8) : "";
  const made = ir.proposeEvents(calendarId, times.map((x, i) => ({ ...(group ? { key: optionKey(group, i) } : {}), title, start: x.start, end: x.end, allDay, location: String(v.location ?? ""), description: String(v.description ?? "") })));
  return made.length > 1 ? t("{n} options proposed — accepting one dismisses the others.", { n: made.length }) : t('"{title}" proposed.', { title });
}

/** An appointment deleted — a series' occurrence alone, with the following ones, or the whole series (Zeff never deletes in Google). */
export async function removeEvent(id: number, series?: { occurrence: string; scope: SeriesScope }): Promise<string> {
  const ir = await import("./ir");
  const ev = ir.eventById(Number(id));
  if (ev?.calendar.source === "google" && !ev.proposed) throw new Error(t("Zeff never deletes events in Google Calendar — delete it there if you must."));
  if (series && /^\d{4}-\d{2}-\d{2}$/.test(series.occurrence)) {
    const scope: SeriesScope = series.scope === "one" || series.scope === "following" ? series.scope : "all";
    ir.deleteOccurrence(Number(id), series.occurrence, scope);
    return scope === "one" ? t("Event deleted.") : scope === "following" ? t("This and following events deleted.") : t("Series deleted.");
  }
  ir.deleteEvent(Number(id));
  return t("Event deleted.");
}

/** Your answer to an invitation in a Google calendar. */
export async function respondToEvent(id: number, response: string): Promise<string> {
  const ir = await import("./ir");
  const ev = ir.eventById(Number(id));
  if (!ev || ev.calendar.source !== "google") throw new Error(t("Only invitations in a Google calendar can be answered here."));
  const { calendarId, eventId } = await googleIds(ev.calendar.key, ev.key);
  const answer = response === "accepted" || response === "declined" || response === "tentative" ? response : null;
  if (!answer) throw new Error(t("An answer is accepted, declined or tentative."));
  await (await import("@/lib/google/calendar-write")).respondGcalEvent(calendarId, eventId!, answer);
  const { journalGoogleWrite } = await import("@/lib/google/journal");
  journalGoogleWrite({ kind: "calendar.response", source: "gcalendar", sourceRef: `${eventId}:${answer}:${Date.now()}`, title: ev.title, summary: answer });
  return answer === "accepted" ? t("Accepted — “{title}”.", { title: ev.title }) : answer === "declined" ? t("Declined — “{title}”.", { title: ev.title }) : t("Answered maybe — “{title}”.", { title: ev.title });
}

/** A calendar's proposed appointment accepted (an appointment like any other) or dismissed (taken out, not proposed again). */
export async function decideEventProposal(id: number, verdict: "accepted" | "dismissed"): Promise<string> {
  const ir = await import("./ir");
  const e = ir.eventById(Number(id));
  if (!e) throw new Error(t("That appointment is gone."));
  if (!e.proposed) throw new Error(t("It isn't a proposal — it is in the calendar already."));
  const p = (await import("./proposed")).proposalOfEvent(e.id);
  if (!p) throw new Error(t("That appointment is gone."));
  return (await (await import("@/lib/proposals")).decide(p.id, verdict)).message ?? "";
}

/** An appointment a todo proposes accepted: entered (Zeff's own calendar, or Google's with its write access), taken off the todo with a note. */
export async function acceptTodoProposal(todoId: number, index: number, title: string): Promise<string> {
  const { getTodo, addTodoUserNote } = await import("@/lib/todos/store");
  const todo = getTodo(Number(todoId));
  const op = todo?.ops[Number(index)];
  if (todo && op?.type === "gcal-event" && op.title === String(title)) return (await import("@/plugins/google-calendar/run")).runGcalEventOnTodo(todo.id, Number(index)).then((r) => r.what);
  if (!todo || !op || op.type !== "calendar-entry" || op.title !== String(title)) throw new Error(t("This proposal isn't on the todo any more — reload the calendar."));
  const { runCalendarEntry } = await import("@/plugins/calendar/run");
  const r = await runCalendarEntry(op, { todo, note: () => {} });
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  getDb().update(schema.todos).set({ ops: JSON.stringify(todo.ops.filter((_, i) => i !== Number(index))) }).where(eq(schema.todos.id, todo.id)).run();
  if (r.todoNote) addTodoUserNote(todo.id, `✓ ${r.todoNote}`);
  return r.what;
}

/** A calendar shown or hidden, recoloured, renamed, counted as busy, offered for booking, set to make todos — or made, or deleted; or how many days ahead the todos look. */
export async function changeCalendar(v: { op: "update" | "create" | "delete" | "todos-days"; id?: number; name?: string; color?: string; visible?: boolean; busy?: boolean; book?: boolean; todos?: boolean; days?: number }): Promise<string> {
  const ir = await import("./ir");
  if (v.op === "create") return t("“{name}” created.", { name: ir.createCalendar(String(v.name ?? ""), v.color ? String(v.color) : undefined).name });
  if (v.op === "delete") {
    ir.deleteCalendar(Number(v.id));
    return t("Calendar deleted.");
  }
  if (v.op === "todos-days") {
    const n = (await import("./todos")).setTodosDaysAhead(Number(v.days));
    return t("Saved: appointments are looked at {n} days ahead.", { n });
  }
  const c = ir.updateCalendar(Number(v.id), {
    name: typeof v.name === "string" ? v.name : undefined,
    color: typeof v.color === "string" ? v.color : undefined,
    visible: typeof v.visible === "boolean" ? v.visible : undefined,
    busy: typeof v.busy === "boolean" ? v.busy : undefined,
    book: typeof v.book === "boolean" ? v.book : undefined,
    todos: typeof v.todos === "boolean" ? v.todos : undefined,
  });
  return t("“{name}” saved.", { name: c.name });
}
