import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "../workspace/flows/actions";
import type { FieldSpec } from "../workspace/flows/types";

/**
 * The kernel's reads and writes of the appointment model (the calendars and their appointments — one model for Zeff's own, Google's and Outlook's) for
 * plugins' lambdas and flows (docs/zeff-kernel.md): the calendars with their appointments between two days (a series as its occurrences, the todos'
 * proposals too), one appointment with its calendar, an appointment made, changed, proposed, answered, accepted or deleted, a calendar changed — and what
 * the AI steps of an appointments app write to todos (a todo once per ref, one taken away, the related appointments). The writes need the flow's
 * permission "api". What the Calendar plugin's flows use; nothing here knows that plugin. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const text = (v: unknown): string => (v == null ? "" : String(v));
const need = (ctx: { perms: { api?: boolean } }) => {
  if (!ctx.perms.api) throw new Error("This flow may not change appointments — grant it the permission “api”.");
};
const day = (v: unknown): string => (/^\d{4}-\d{2}-\d{2}/.test(text(v)) ? text(v).slice(0, 10) : "");

export const CALENDAR_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "appointments.window",
    group: "calendar",
    label: "The calendars and their appointments between two days",
    summary:
      "The calendars (id, key, source zeff|google|outlook, name, colour, visible, busy, book, todos, writable) and their appointments between two days ([from, to), local days) — a series as its occurrences, the proposed ones too — and the appointments the open todos propose (their actions), now, and whether Google Calendar is there.",
    input: [f("from", "text", { required: true }), f("to", "text", { required: true })],
    output: "{ calendars, events: [{ id, calendarId, key, title, start, end, allDay, location, description, showAs, cancelled, response, private, online, organizer, attendees, url, todoId, recurrence, occurrence, seriesId, proposed }], proposed: [{ todoId, todoRef, todoText, index, type, title, start, end, target, href }], now, canSync }",
    run: async (i) => {
      const from = day(i.from);
      const to = day(i.to);
      if (!from || !to || to <= from) throw new Error("from and to: days (YYYY-MM-DD), to after from.");
      if ((Date.parse(to) - Date.parse(from)) / 864e5 > 400) throw new Error("at most 400 days at once.");
      const { calendarWindow } = await import("./view-data");
      return JSON.parse(JSON.stringify(await calendarWindow(from, to)));
    },
  },
  {
    name: "appointments.event",
    group: "calendar",
    label: "One appointment",
    summary: "An appointment by its id (a series' occurrence by its day), with its calendar and the todo it was made for: { found, event, calendar, todo: { id, ref, text, status } }.",
    input: [f("id", "number", { required: true }), f("occurrence", "text")],
    output: "{ found, event, calendar, todo }",
    run: async (i) => {
      const { eventById } = await import("@/lib/calendar/ir");
      const e = eventById(Number(i.id), day(i.occurrence) || undefined);
      if (!e) return { found: false, event: null, calendar: null, todo: null };
      const { calendar, ...event } = e;
      const todo = event.todoId ? (await import("@/lib/todos/store")).getTodo(event.todoId) : null;
      return JSON.parse(JSON.stringify({ found: true, event, calendar, todo: todo ? { id: todo.id, ref: todo.ref, text: todo.text, status: todo.status } : null }));
    },
  },
  {
    name: "appointments.save",
    group: "calendar",
    label: "Make or change an appointment",
    summary:
      "An appointment in one of Zeff's own calendars — new (no id) or changed; a series' occurrence (occurrence: its day) alone, with the following ones or all (scope one|following|all); times as local \"YYYY-MM-DDTHH:MM\" (all day: \"YYYY-MM-DD\"). In a Google calendar you may write to: written there, guests (attendees) invited. Answers what it did.",
    input: [f("id", "number"), f("calendarId", "number"), f("title", "text", { required: true }), f("start", "text", { required: true }), f("end", "text", { required: true }), f("allDay", "boolean"), f("location", "text"), f("description", "text"), f("recurrence", "json"), f("occurrence", "text"), f("scope", "text"), f("attendees", "list")],
    output: "{ ok, message }",
    writes: true,
    run: async (i, ctx) => {
      need(ctx);
      if (ctx.dryRun) return { ok: true, message: "(dry run)" };
      const { saveEvent } = await import("@/lib/calendar/save");
      const message = await saveEvent({
        id: Number(i.id) > 0 ? Number(i.id) : undefined,
        calendarId: Number(i.calendarId) > 0 ? Number(i.calendarId) : undefined,
        title: text(i.title),
        start: text(i.start),
        end: text(i.end),
        allDay: i.allDay === true || i.allDay === "true",
        location: text(i.location),
        description: text(i.description),
        ...(i.recurrence === undefined || i.recurrence === "" ? {} : { recurrence: i.recurrence }),
        occurrence: day(i.occurrence) || null,
        scope: i.scope === "one" || i.scope === "following" ? i.scope : "all",
        attendees: Array.isArray(i.attendees) ? i.attendees.map(text).filter(Boolean) : undefined,
      });
      return { ok: true, message };
    },
  },
  {
    name: "appointments.propose",
    group: "calendar",
    label: "Propose an appointment",
    summary: "A new appointment as a proposal (dashed, blocks no time) — with several times (times: [{ start, end }]) options for the same thing: accepting one dismisses the others. Never written to Google.",
    input: [f("calendarId", "number"), f("title", "text", { required: true }), f("allDay", "boolean"), f("location", "text"), f("description", "text"), f("times", "json", { required: true })],
    output: "{ ok, message }",
    writes: true,
    run: async (i, ctx) => {
      need(ctx);
      if (ctx.dryRun) return { ok: true, message: "(dry run)" };
      const { proposeEvent } = await import("@/lib/calendar/save");
      const message = await proposeEvent({ calendarId: Number(i.calendarId) > 0 ? Number(i.calendarId) : undefined, title: text(i.title), allDay: i.allDay === true || i.allDay === "true", location: text(i.location), description: text(i.description), times: (Array.isArray(i.times) ? i.times : []) as { start: string; end: string }[] });
      return { ok: true, message };
    },
  },
  {
    name: "appointments.delete",
    group: "calendar",
    label: "Delete an appointment",
    summary: "An appointment of Zeff's own calendars deleted (Google's never) — a series' occurrence alone (occurrence: its day, scope one), with the following ones, or the whole series.",
    input: [f("id", "number", { required: true }), f("occurrence", "text"), f("scope", "text")],
    output: "{ ok, message }",
    writes: true,
    run: async (i, ctx) => {
      need(ctx);
      if (ctx.dryRun) return { ok: true, message: "(dry run)" };
      const { removeEvent } = await import("@/lib/calendar/save");
      const message = await removeEvent(Number(i.id), day(i.occurrence) ? { occurrence: day(i.occurrence), scope: i.scope === "one" || i.scope === "following" ? i.scope : "all" } : undefined);
      return { ok: true, message };
    },
  },
  {
    name: "appointments.respond",
    group: "calendar",
    label: "Answer an invitation",
    summary: "Your answer to an invitation in a Google calendar you may write to: accepted, tentative or declined — sent to its organiser through Google's API.",
    input: [f("id", "number", { required: true }), f("response", "text", { required: true })],
    output: "{ ok, message }",
    writes: true,
    run: async (i, ctx) => {
      need(ctx);
      if (ctx.dryRun) return { ok: true, message: "(dry run)" };
      return { ok: true, message: await (await import("@/lib/calendar/save")).respondToEvent(Number(i.id), text(i.response)) };
    },
  },
  {
    name: "appointments.decide",
    group: "calendar",
    label: "Accept or dismiss a proposed appointment",
    summary: "A calendar's proposed appointment (id) accepted — an appointment like any other — or dismissed (taken out, not proposed again).",
    input: [f("id", "number", { required: true }), f("verdict", "text", { required: true, options: ["accepted", "dismissed"] })],
    output: "{ ok, message }",
    writes: true,
    run: async (i, ctx) => {
      need(ctx);
      if (ctx.dryRun) return { ok: true, message: "(dry run)" };
      return { ok: true, message: await (await import("@/lib/calendar/save")).decideEventProposal(Number(i.id), i.verdict === "dismissed" ? "dismissed" : "accepted") };
    },
  },
  {
    name: "appointments.accept-todo-proposal",
    group: "calendar",
    label: "Accept the appointment a todo proposes",
    summary: "The appointment among a todo's actions (todo, index = its place, title = the one shown) entered — Zeff's own calendar, or Google's with its write access — and taken off the todo, noted on it.",
    input: [f("todo", "number", { required: true }), f("index", "number", { required: true }), f("title", "text", { required: true })],
    output: "{ ok, message }",
    writes: true,
    run: async (i, ctx) => {
      need(ctx);
      if (ctx.dryRun) return { ok: true, message: "(dry run)" };
      return { ok: true, message: await (await import("@/lib/calendar/save")).acceptTodoProposal(Number(i.todo), Number(i.index), text(i.title)) };
    },
  },
  {
    name: "appointments.move-todo-proposal",
    group: "calendar",
    label: "Move the appointment a todo proposes",
    summary: "A todo's appointment action (todo, index) given a new start (local \"YYYY-MM-DDTHH:MM\") and length (minutes, from start and end) — nothing is entered in a calendar by it.",
    input: [f("todo", "number", { required: true }), f("index", "number", { required: true }), f("start", "text", { required: true }), f("end", "text", { required: true })],
    output: "{ ok, message }",
    writes: true,
    run: async (i, ctx) => {
      need(ctx);
      if (ctx.dryRun) return { ok: true, message: "(dry run)" };
      const start = text(i.start).slice(0, 16);
      const minutes = Math.round((Date.parse(`${text(i.end).slice(0, 16)}:00`) - Date.parse(`${start}:00`)) / 60000);
      if (!(minutes > 0)) throw new Error("The end has to be after the start.");
      (await import("@/lib/todos/store")).moveCalendarOp(Number(i.todo), Number(i.index), start, minutes);
      return { ok: true, message: "Appointment moved — it is entered when you run the todo's action." };
    },
  },
  {
    name: "appointments.calendar",
    group: "calendar",
    label: "Change the calendars",
    summary: "op update: a calendar (id) shown or hidden, recoloured, renamed (Zeff's own), counted as busy, offered for booking, set to make todos (name, color, visible, busy, book, todos); create: one of Zeff's own (name, color); delete: one of Zeff's own with its appointments (id); todos-days: how many days ahead appointments are read for todos (days, 1 to 30).",
    input: [f("op", "text", { required: true, options: ["update", "create", "delete", "todos-days"] }), f("id", "number"), f("name", "text"), f("color", "text"), f("visible", "boolean"), f("busy", "boolean"), f("book", "boolean"), f("todos", "boolean"), f("days", "number")],
    output: "{ ok, message }",
    writes: true,
    run: async (i, ctx) => {
      need(ctx);
      if (ctx.dryRun) return { ok: true, message: "(dry run)" };
      const op = i.op === "create" || i.op === "delete" || i.op === "todos-days" ? i.op : "update";
      const flag = (v: unknown) => (v === true || v === "true" ? true : v === false || v === "false" ? false : undefined);
      const { changeCalendar } = await import("@/lib/calendar/save");
      const message = await changeCalendar({ op, id: Number(i.id) || undefined, name: i.name === undefined ? undefined : text(i.name), color: i.color ? text(i.color) : undefined, visible: flag(i.visible), busy: flag(i.busy), book: flag(i.book), todos: flag(i.todos), days: Number(i.days) || undefined });
      // (the Workspace's database of the appointments follows)
      void import("../workspace/calendar-database").then((m) => m.refreshCalendarDatabase()).catch(() => undefined);
      return { ok: true, message };
    },
  },
  {
    name: "todos.add-by-ref",
    group: "todos",
    label: "Todos for things with a ref, once each",
    summary: "Per item (items: [{ text, due, ref, source }]) a todo that carries the ref (\"event:12@2026-11-16\"): made once — when a todo has that ref already, none is made. { added: how many }",
    input: [f("items", "json", { required: true })],
    output: "{ added }",
    writes: true,
    run: async (i, ctx) => {
      need(ctx);
      if (ctx.dryRun) return { added: 0 };
      const { addCalendarTodo } = await import("@/lib/todos/store");
      let added = 0;
      for (const x of (Array.isArray(i.items) ? i.items : []).slice(0, 200) as Record<string, unknown>[]) {
        if (!text(x?.text).trim() || !text(x?.ref)) continue;
        if (addCalendarTodo({ text: text(x.text), due: day(x.due), ref: text(x.ref).slice(0, 200), source: text(x.source) || "Plugin" })) added++;
      }
      return { added };
    },
  },
  {
    name: "todos.dismiss-by-ref",
    group: "todos",
    label: "Take away the todos made for refs",
    summary: "Per item (items: [{ ref }]) the todo that carries the ref, while it is open and its source line starts with `source` (a todo you made or worked on stays): dismissed. { dismissed: how many }",
    input: [f("items", "json", { required: true }), f("source", "text", { required: true })],
    output: "{ dismissed }",
    writes: true,
    run: async (i, ctx) => {
      need(ctx);
      if (ctx.dryRun) return { dismissed: 0 };
      const { todoByRef, setTodoStatus } = await import("@/lib/todos/store");
      let dismissed = 0;
      for (const x of (Array.isArray(i.items) ? i.items : []).slice(0, 200) as Record<string, unknown>[]) {
        const made = text(x?.ref) ? todoByRef(text(x.ref)) : undefined;
        if (made && made.status === "open" && text(i.source) && made.source?.startsWith(text(i.source))) {
          setTodoStatus(made.id, "dismissed");
          dismissed++;
        }
      }
      return { dismissed };
    },
  },
  {
    name: "todos.ensure-due",
    group: "todos",
    label: "Give open todos without a due day their day",
    summary: "Per item (items: [{ id, day }]) an open todo that has no due day is due on that day from now on. { changed: how many }",
    input: [f("items", "json", { required: true })],
    output: "{ changed }",
    writes: true,
    run: async (i, ctx) => {
      need(ctx);
      if (ctx.dryRun) return { changed: 0 };
      const { getTodo, setTodoDue } = await import("@/lib/todos/store");
      let changed = 0;
      for (const x of (Array.isArray(i.items) ? i.items : []).slice(0, 200) as Record<string, unknown>[]) {
        const t = getTodo(Number(x?.id));
        if (!t || t.status !== "open" || t.due || !day(x?.day)) continue;
        setTodoDue(t.id, day(x.day));
        changed++;
      }
      return { changed };
    },
  },
  {
    name: "todos.set-related",
    group: "todos",
    label: "What a todo is about: the related appointments, mails, notes or documents",
    summary: "Per todo, the things it is about by kind (kind calendar → refs \"cal:<id>\"; mail, note, doc), added to what it is related to already: picks: { \"<todoId>\": [refs] }. { changed }",
    input: [f("kind", "text", { required: true, options: ["calendar", "mail", "note", "doc"] }), f("picks", "json", { required: true })],
    output: "{ changed }",
    writes: true,
    run: async (i, ctx) => {
      need(ctx);
      if (ctx.dryRun) return { changed: 0 };
      const store = await import("@/lib/todos/store");
      const picks = new Map<number, string[]>(Object.entries((i.picks ?? {}) as Record<string, unknown>).flatMap(([k, v]) => (Number.isInteger(Number(k)) && Array.isArray(v) ? [[Number(k), v.map(text)] as [number, string[]]] : [])));
      const set = i.kind === "mail" ? store.setTodoMailRefs : i.kind === "note" ? store.setTodoNoteRefs : i.kind === "doc" ? store.setTodoDocRefs : store.setTodoCalendarRefs;
      return { changed: set(picks) };
    },
  },
];

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("calendar", CALENDAR_FLOW_ACTIONS);
