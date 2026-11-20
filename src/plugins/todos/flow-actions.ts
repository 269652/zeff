import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "../workspace/flows/actions";
import type { FieldSpec } from "../workspace/flows/types";
import { PANEL_ACTIONS } from "./panel-actions";
import { amountIn, ibansIn } from "@/lib/girocode";

/**
 * The kernel's reads and writes of the todos for plugins' lambdas and flows (docs/zeff-kernel.md): the open todos with what an AI step needs
 * to look at them (their ticket, where they come from, their notes), the actions Zeff can run for a todo and the rules that hold them, my
 * appointments, the facts, a conversation's last messages, the contacts the todos name, the prompts. What the Auto actions plugin reads instead of
 * the built-in's code — nothing here knows that plugin. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const text = (v: unknown): string => (v == null ? "" : String(v));
const nums = (v: unknown, max = 200): number[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map(Number).filter((n) => Number.isInteger(n)).slice(0, max);

/** A source's ref, as a todo's refs name it. */
const sourceRef = (s: { source: string } & Record<string, never>): string => {
  const x = s as unknown as Record<string, Record<string, string>> & { source: string };
  return x.source === "teams" ? `teams:${x.teams.key}` : x.source === "mail" ? `mail:${x.mail.key}` : x.source === "jira-comment" ? `jira-comment:${x.comment.id}` : x.source === "gitlab" ? `gitlab:${x.gitlab.key}` : x.source === "fact" ? x.fact.ref : x.source === "document" ? x.doc.ref : x.source === "calendar" ? x.event.ref : x.source;
};

export const TODO_FLOW_ACTIONS: FlowAction[] = [
  ...PANEL_ACTIONS,
  {
    name: "todos.open",
    group: "todos",
    label: "The open todos, for an AI step",
    summary:
      "The open todos with what an AI step looks at: id, ticket, kind, owner, text, source, note, the first plan, the last three notes, how many actions they have and the reason they were proposed, whether they recur, when changed and last reviewed for actions, the project the knowledge picked, the calendar actions' times, and for a todo of review comments the open threads (gapOpen) — ids: only those.",
    input: [f("ids", "list")],
    output: "{ todos: [{ id, ticket, kind, kindLabel, owner, text, source, note, planned, notes, opsCount, autoOpsWhy, recurring, updatedAt, reviewedAt, repo, calendarOps, refs, gapOpen }] }",
    run: async (i) => {
      const { listTodos } = await import("@/lib/todos/store");
      const { TODO_KIND_LABELS } = await import("@/lib/todos/shared");
      const { commentTodos } = await import("@/lib/todos/comment-ops");
      const { getDb, schema } = await import("@/db");
      const { eq } = await import("drizzle-orm");
      const ids = nums(i.ids);
      const reviewedAt = new Map(getDb().select({ id: schema.todos.id, at: schema.todos.actionsReviewedAt }).from(schema.todos).where(eq(schema.todos.status, "open")).all().map((r) => [r.id, r.at ?? ""]));
      const gaps = new Map(commentTodos().map((c) => [c.id, c.open.filter((n) => !c.ops.some((o) => o.type === "gitlab-reply" && (o as { note?: string }).note === n))]));
      const todos = listTodos({ status: "open" })
        .filter((t) => !ids.length || ids.includes(t.id))
        .map((t) => ({
          id: t.id,
          ticket: t.ticket,
          kind: t.kind,
          kindLabel: TODO_KIND_LABELS[t.kind],
          owner: t.owner,
          text: t.text,
          source: t.source,
          note: t.note,
          planned: t.planned[0]?.steps.map((s) => s.text) ?? [],
          notes: t.userNotes.slice(-3).map((n) => ({ by: n.by ?? "", kind: n.kind, at: n.at, text: n.text })),
          allNoteTimes: t.userNotes.map((n) => n.at),
          opsCount: t.ops.length,
          autoOpsWhy: (t as { autoOpsWhy?: string }).autoOpsWhy ?? "",
          recurring: !!t.recurrence,
          updatedAt: (t as { updatedAt?: string }).updatedAt ?? "",
          reviewedAt: reviewedAt.get(t.id) ?? "",
          repo: t.knowledge?.repo ? { name: t.knowledge.repo.name, summary: t.knowledge.repo.summary } : null,
          calendarOps: t.ops.flatMap((o) => (o.type === "calendar-event" || o.type === "calendar-entry" || o.type === "gcal-event" ? [{ start: (o as { start: string }).start, minutes: (o as { minutes: number }).minutes }] : [])),
          refs: t.refs,
          gapOpen: gaps.get(t.id) ?? [],
        }));
      return { todos };
    },
  },
  {
    name: "todos.rows",
    group: "todos",
    label: "The todos, ready for a screen",
    summary:
      "The todos as the Todos page shows them (scope open: yours and what you wait on, with the group each is in; done: done and dismissed, the latest first; worker: the workers' own), each with what a row needs — ref, ticket (and linked ones), kind, owner, text, source, note, due and days to it, whether it is flagged / set aside / back on top and why, repeats, a worker's done report, an agent's question, the last error, the number of actions and notes — plus the counts of every scope and the tickets' summaries and links.",
    input: [f("scope", "text", { options: ["open", "done", "worker"] }), f("limit", "number")],
    output: "{ rows: [{ id, ref, ticket, alsoTickets, text, kind, kindLabel, owner, status, source, note, due, dueDays, group, flagged, deferred, bubbledUp, repeats, workerDone, needsInput, lastError, opsCount, notesCount, byWorker, createdAt, doneAt }], counts: { open, waiting, done, worker }, tickets: { [key]: { summary, status, url } }, briefing: boolean }",
    run: async (i) => {
      const store = await import("@/lib/todos/store");
      const { TODO_KIND_LABELS, opTitle } = await import("@/lib/todos/shared");
      const { translator } = await import("@/lib/i18n/shared");
      const { groupOf } = await import("@/lib/todos/groups");
      const { daysUntil } = await import("@/lib/todos/due-shared");
      const { deferral } = await import("@/lib/todos/deferral");
      const { lastGoodRun, latestRun } = await import("@/lib/runs/store");
      const { getTicketCards } = await import("@/lib/jira/store");
      const scope = i.scope === "done" || i.scope === "worker" ? i.scope : "open";
      const limit = Math.max(1, Math.min(1000, Number(i.limit) || 300));
      // The briefing's own order of tickets: what the page ranks the todos by.
      const latest = latestRun();
      const run = latest?.status === "ok" ? latest : lastGoodRun();
      const keys = run?.tickets.map((x) => x.key) ?? [];
      const analysed = new Set((run?.result?.tickets ?? []).map((x) => x.key));
      const order = [...(run?.result?.tickets ?? []).map((x) => x.key), ...(run?.tickets ?? []).filter((x) => x.analyzed && !analysed.has(x.key)).map((x) => x.key)].filter((k) => keys.includes(k));
      const rank = new Map(order.map((k, n) => [k, n]));
      // (Without a briefing run there are no tickets to restrict to: all the open todos.)
      const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
      const open = (run ? store.boardTodos([...keys, ""]) : store.listTodos({ status: "all", openOrDoneSince: since }).filter((t) => !t.byWorker && !t.mergedInto)).filter((t) => t.status === "open");
      const worker = store.workerTodos();
      const done = scope === "done" ? store.doneTodos(limit) : [];
      const list = scope === "open" ? open : scope === "worker" ? worker : done;
      const deferred = deferral(list);
      const down = (t: { flaggedAt: string | null; workerDone: unknown; status: string; id: number }) => (t.flaggedAt ? -2 : t.workerDone && t.status === "open" ? -1 : deferred[t.id]?.deferred ? 1 : 0);
      const sorted = scope === "open" ? [...list].sort((x, y) => down(x) - down(y) || (rank.get(x.ticket) ?? 99) - (rank.get(y.ticket) ?? 99) || x.id - y.id) : list;
      const shown = sorted.slice(0, limit);
      // What the row shows beside its words: the time reported, the worker on it, who is away, where it came from.
      const { withAlternatives } = await import("@/lib/todos/alternatives");
      const { workingRuns } = await import("@/lib/work/live-driver");
      const rich = new Map(withAlternatives(shown).map((x) => [x.id, x]));
      const busy = workingRuns();
      const seenAt = (await import("@/lib/prefs")).getPref<string | null>("todos:seen-at", null);
      const rows = shown.map((t0) => {
        const t = rich.get(t0.id) ?? t0;
        // (No ticket: where it came from — an appointment, else a message: what the built-in page said too.)
        const origin = !t.ticket ? (t.refs.some((r) => r.startsWith("event:")) ? "Calendar" : "Mail") : "";
        const d = deferred[t.id];
        const isDeferred = !!d?.deferred;
        return {
          id: t.id,
          ref: t.ref,
          ticket: t.ticket,
          alsoTickets: t.alsoTickets,
          text: t.text,
          kind: t.kind,
          kindLabel: TODO_KIND_LABELS[t.kind],
          owner: t.owner,
          status: t.status,
          source: t.source ?? "",
          note: t.note ?? "",
          due: t.due ? t.due.slice(0, 10) : "",
          dueDays: t.due ? daysUntil(t.due.slice(0, 10)) : null,
          group: t.status === "open" ? groupOf({ due: t.due, flaggedAt: t.flaggedAt, deferred: isDeferred }) : "",
          flagged: !!t.flaggedAt,
          deferred: isDeferred,
          bubbledUp: d?.bubbledUp ?? "",
          repeats: t.recurrence ? t.recurrence.freq : "",
          workerDone: t.workerDone ? { by: t.workerDone.by, note: t.workerDone.note ?? "", suggested: !!t.workerDone.suggested } : null,
          needsInput: t.needsInput ?? "",
          lastError: (t as { lastError?: string }).lastError ?? "",
          opsCount: t.ops.length,
          notesCount: t.userNotes.length,
          byWorker: t.byWorker,
          createdAt: t.createdAt,
          doneAt: t.doneAt ?? "",
          opsTitles: t.ops.map((o) => opTitle(o, translator("en"))),
          opsWhy: t.autoOpsWhy ?? "",
          origin,
          away: (t.away ?? []).map((a) => ({ name: a.name, until: a.until })),
          workRun: busy[t.id] ?? 0,
          timeMinutes: (t.time ?? []).reduce((a, r) => a + r.minutes, 0),
          mrs: (t.links?.mrs ?? []).map((m) => ({ ref: m.ref, url: m.url, title: m.title, state: m.state ?? "" })),
          merged: !!t.mergedAt && !!seenAt && t.mergedAt > seenAt,
          // (What its quick buttons offer: a reply to the message it is about, a payment it names.)
          canReply: t.owner === "me" && [...t.refs, ...t.mailRefs].some((r) => r.startsWith("mail:") || r.startsWith("teams:")),
          canPay: !t.ops.some((o) => o.type === "bank-transfer" || o.type === "revolut-pay") && (amountIn(t.text) != null || ibansIn(`${t.text} ${t.note ?? ""}`).length > 0),
          isNew: t.status === "open" && !t.byWorker && !!seenAt && Math.max(Date.parse(t.createdAt), t.mergedAt ? Date.parse(t.mergedAt) : 0) > Date.parse(seenAt),
        };
      });
      const cards = getTicketCards(shown.map((t) => t.ticket).concat(shown.flatMap((t) => t.alsoTickets)));
      return {
        rows,
        counts: { open: open.filter((t) => t.owner === "me").length, waiting: open.filter((t) => t.owner === "other").length, done: store.doneTodoTickets().count, worker: worker.filter((t) => t.status === "open").length },
        tickets: Object.fromEntries(Object.entries(cards).map(([k, c]) => [k, { summary: c.summary, status: c.status, url: c.url ?? "" }])),
        briefing: !!run,
      };
    },
  },
  {
    name: "todos.set-status",
    group: "todos",
    label: "Tick a todo off, dismiss it, open it again",
    summary:
      "A todo's status, set by you, as ticking it on the Todos page does (what hangs on it follows: the settle hooks, a delivery's next step). A todo that comes back, ticked off more than a week before its day, is not done: the answer is { ok: false, confirm } and asks — send it again with early. Needs the flow's todos permission.",
    input: [f("id", "number", { required: true }), f("status", "text", { required: true, options: ["open", "done", "dismissed"] }), f("early", "boolean")],
    output: "{ ok, confirm?, error? }",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not change todos — grant it under the flow's permissions (todos).");
      if (ctx.dryRun) return { ok: true };
      const r = await (await import("./engine")).setStatusAsYou(Number(i.id), String(i.status) as "open", { early: i.early === true || i.early === "true" });
      return { ok: r.ok, ...(r.confirm ? { confirm: r.confirm } : {}), ...(r.error ? { error: r.error } : {}) };
    },
  },
  {
    name: "todos.flag",
    group: "todos",
    label: "Flag a todo as important",
    summary: "A todo flagged important (it goes to the top of the list) or not. Needs the flow's todos permission.",
    input: [f("id", "number", { required: true }), f("flagged", "boolean", { required: true })],
    output: "{}",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not change todos — grant it under the flow's permissions (todos).");
      if (!ctx.dryRun) (await import("@/lib/todos/store")).setTodoFlagged(Number(i.id), i.flagged === true || i.flagged === "true");
      return {};
    },
  },
  {
    name: "todos.defer",
    group: "todos",
    label: "Put a todo to the bottom — or back up",
    summary: "A todo set aside for now (it comes back up when something new happens on it, in 3 days at the latest) or taken back up. Needs the flow's todos permission.",
    input: [f("id", "number", { required: true }), f("deferred", "boolean", { required: true })],
    output: "{}",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not change todos — grant it under the flow's permissions (todos).");
      if (!ctx.dryRun) (await import("@/lib/todos/store")).setTodoDeferred(Number(i.id), i.deferred === true || i.deferred === "true");
      return {};
    },
  },
  {
    name: "todos.set-due",
    group: "todos",
    label: "A todo's due day",
    summary: "A todo's due day (YYYY-MM-DD; empty: none), set by you — what takes its date from it follows (a debt of your own). Needs the flow's todos permission.",
    input: [f("id", "number", { required: true }), f("due", "text")],
    output: "{}",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not change todos — grant it under the flow's permissions (todos).");
      const raw = typeof i.due === "string" ? i.due.trim() : "";
      const due = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
      if (raw && !due) throw new Error("A due day is written YYYY-MM-DD.");
      if (!ctx.dryRun) await (await import("./engine")).setDueAsYou(Number(i.id), due);
      return {};
    },
  },
  {
    name: "todos.set-text",
    group: "todos",
    label: "A todo's words",
    summary: "A todo's text changed (as in the todo block). Needs the flow's todos permission.",
    input: [f("id", "number", { required: true }), f("text", "text", { required: true })],
    output: "{}",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not change todos — grant it under the flow's permissions (todos).");
      if (!ctx.dryRun) (await import("@/lib/todos/store")).setTodoText(Number(i.id), String(i.text ?? ""));
      return {};
    },
  },
  {
    name: "todos.add-note",
    group: "todos",
    label: "A note on a todo",
    summary: "Your note on a todo (context for the briefing, workers and agents): saved, its pictures made the todo's files, the todo brought up to date with it in the background. Needs the flow's todos permission.",
    input: [f("id", "number", { required: true }), f("text", "text", { required: true })],
    output: "{ ok, message?, error? }",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not change todos — grant it under the flow's permissions (todos).");
      if (ctx.dryRun) return { ok: true };
      return (await import("./engine")).addNoteAsYou(Number(i.id), String(i.text ?? "").trim());
    },
  },
  {
    name: "todos.detail",
    group: "todos",
    label: "One todo whole, for its panel",
    summary:
      "One todo with what its panel shows: its words, kind, owner, ticket, due day, source and note; your notes and the runs' reports (each with its author and link); its actions (each in words — the title, what exactly, the text it would send — and whether Zeff can run it here or it only links somewhere) and why they were proposed; the time reported on it; its merge requests; the steps planned after it; where it comes from (the comments, messages and mails it cites).",
    input: [f("id", "number", { required: true })],
    output: "{ found, id, ref, text, kind, kindLabel, owner, status, ticket, due, source, note, notes: [{ at, by, text, url, urlLabel, instruction, own }], ops: [{ index, type, title, heading, detail, body, runnable }], opsWhy, blockedBy, time: [{ id, ref, minutes, note, by, at }], totalMinutes, mrs: [{ ref, url, title, state }], planned: [{ path, steps: [{ text, kind, owner }] }], sources: [{ ref, label, at, author, headline, text, convId, subject }] }",
    run: async (i) => {
      const store = await import("@/lib/todos/store");
      const { withAlternatives } = await import("@/lib/todos/alternatives");
      const { TODO_KIND_LABELS, opTitle, opNote, sourcesOf, noteSyncState } = await import("@/lib/todos/shared");
      const { translator } = await import("@/lib/i18n/shared");
      const { actionHref } = await import("@/plugins/actions/catalog");
      const base = store.getTodo(Number(i.id));
      if (!base) return { found: false };
      const t = withAlternatives([base])[0];
      const en = translator("en");
      const { todoSources } = await import("@/lib/todos/sources");
      const { lastGoodRun } = await import("@/lib/runs/store");
      const { entityHeadline, entitySourceLabel, entityText, entityWhoWhen } = await import("@/lib/entities-shared");
      // Settings → Todos: what a todo shows under its text (context, the actions the AI proposed, knowledge — and which kinds of knowledge).
      const { getTodoDisplayOff } = await import("@/lib/todo-display-store");
      const { kindOfPage } = await import("@/lib/todo-display");
      const off = getTodoDisplayOff();
      const cited = off.includes("context") ? [] : sourcesOf(t.refs, todoSources([t], lastGoodRun()?.tickets ?? []));
      return {
        found: true,
        id: t.id,
        ref: t.ref,
        text: t.text,
        kind: t.kind,
        kindLabel: TODO_KIND_LABELS[t.kind],
        owner: t.owner,
        status: t.status,
        ticket: t.ticket,
        due: t.due ? t.due.slice(0, 10) : "",
        source: t.source ?? "",
        note: t.note ?? "",
        notes: [...(t.relatedNotes ?? []), ...t.userNotes].map((n) => ({ at: n.at, by: n.by ?? "", text: n.text, url: n.url ?? "", urlLabel: n.urlLabel ?? "", instruction: n.kind === "instruction", own: !n.by && n.kind !== "instruction" && n.from === undefined, from: n.from ?? 0, jira: noteSyncState(n) })),
        ops: t.ops.filter(() => !(off.includes("actions") && t.autoOpsWhy)).map((op, index) => {
          const note = opNote(op, en);
          const href = actionHref(op);
          const o = op as unknown as Record<string, unknown>;
          return { index, type: op.type, title: opTitle(op, en), heading: note.heading, detail: note.detail ?? "", body: note.body ?? "", runnable: !href, href: href ?? "", hasText: "body" in op, transfer: op.type === "bank-transfer" ? { name: String(o.name ?? ""), iban: String(o.iban ?? ""), bic: String(o.bic ?? ""), amount: String(o.amount ?? ""), purpose: String(o.purpose ?? "") } : null };
        }),
        attachments: (await import("@/plugins/documents/attachments")).todoAttachments(t.refs).map((d) => ({ id: d.id, ref: d.ref, name: d.name, image: d.kind === "image" })),
        opsWhy: t.autoOpsWhy ?? "",
        alternatives: t.alternatives ?? [],
        payment: await (async () => {
          const people = (await import("@/plugins/state")).isInstalled("people") ? (await import("@/plugins/people/details")).payees() : [];
          const p = (await import("@/lib/girocode-todo")).paymentForTodo(t, people);
          return p ? { name: p.name, iban: p.iban, bic: p.bic ?? "", amount: p.amount ?? 0, purpose: p.purpose, via: p.via } : null;
        })(),
        knowledge: t.knowledge && !off.includes("knowledge") ? { pages: t.knowledge.pages.filter((x) => !off.includes(kindOfPage(x))).map((x) => ({ title: x.title, url: x.url, snippet: (x.summary ?? x.snippet ?? "").slice(0, 300) })), entities: t.knowledge.entities.map((x) => ({ name: x.name, type: x.type, summary: x.summary.slice(0, 300) })), links: t.knowledge.links ?? [], repo: t.knowledge.repo ?? null } : null,
        draft: t.draft ?? "",
        recurrence: t.recurrence ? t.recurrence.freq : "",
        away: (t.away ?? []).map((a) => ({ name: a.name, until: a.until })),
        blockedBy: t.blockedBy ?? "",
        time: (t.time ?? []).map((r) => ({ id: r.id, ref: r.ref, minutes: r.minutes, note: r.note, by: r.by, at: r.at })),
        totalMinutes: (t.time ?? []).reduce((a, r) => a + r.minutes, 0),
        mrs: t.links?.mrs ?? [],
        planned: t.planned.map((p) => ({ path: p.path ?? "", steps: p.steps.map((s) => ({ text: s.text, kind: TODO_KIND_LABELS[s.kind], owner: s.owner })) })),
        sources: cited.map((s) => {
          const w = entityWhoWhen(s);
          const mail = s.source === "mail" ? (s as unknown as { mail: { convId: string; subject: string } }).mail : null;
          return { ref: sourceRef(s as never), label: entitySourceLabel(s), at: w.at ?? "", author: w.author ?? "", headline: entityHeadline(s), text: entityText(s).slice(0, 1500), convId: mail?.convId ?? "", subject: mail?.subject ?? "" };
        }),
      };
    },
  },
  {
    name: "todos.run-ops",
    group: "todos",
    label: "Run a todo's actions now",
    summary: "A todo's actions run by you, right now, no worker and no AI (a Jira change, a reply, a push …) — all of them, or just these (only: their places). What was done is said in { message }. Needs the flow's permissions todos and api.",
    input: [f("id", "number", { required: true }), f("only", "list")],
    output: "{ message }",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos || !ctx.perms.api) throw new Error("This flow may not run a todo's actions — grant it the permissions “todos” and “api”.");
      if (ctx.dryRun) return { message: "" };
      return (await import("./engine")).runOpsAsYou(Number(i.id), i.only === undefined || i.only === "" ? undefined : nums(i.only, 50));
    },
  },
  {
    name: "todos.remove-op",
    group: "todos",
    label: "Take an action off a todo",
    summary: "One of a todo's actions taken off it (its place in the list). Needs the flow's todos permission.",
    input: [f("id", "number", { required: true }), f("index", "number", { required: true })],
    output: "{ ok, message?, error? }",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not change todos — grant it under the flow's permissions (todos).");
      if (ctx.dryRun) return { ok: true };
      return (await import("./engine")).removeOpAsYou(Number(i.id), Number(i.index));
    },
  },
  {
    name: "todos.add-time",
    group: "todos",
    label: "Time spent on a todo",
    summary: "Time you spent on a todo, by hand: minutes and one line — a record like the agents' (an agent's records show beside it). Needs the flow's todos permission.",
    input: [f("id", "number", { required: true }), f("minutes", "number", { required: true }), f("note", "text")],
    output: "{ id }",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not change todos — grant it under the flow's permissions (todos).");
      if (ctx.dryRun) return { id: null };
      const { addTodoTime } = await import("@/lib/work/todo-time");
      return { id: addTodoTime({ todoId: Number(i.id), minutes: Number(i.minutes), note: String(i.note ?? ""), by: "Du", source: "hand" }).id };
    },
  },
  {
    name: "todos.remove-note",
    group: "todos",
    label: "Take a note off a todo",
    summary: "Your note on a todo taken away (by its time). Needs the flow's todos permission.",
    input: [f("id", "number", { required: true }), f("at", "text", { required: true })],
    output: "{}",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not change todos — grant it under the flow's permissions (todos).");
      if (!ctx.dryRun) (await import("@/lib/todos/store")).removeTodoUserNote(Number(i.id), String(i.at));
      return {};
    },
  },
  {
    name: "todos.activity",
    group: "todos",
    label: "What happened to the todos",
    summary:
      "What happened to the todos in the last days (default 14), newest first: each made, done, dismissed, reopened or merged — the todo's words then, its ticket, the note (why, or where it came from), who did it in words (you, the briefing, a worker, an agent, Jira …) with where to look, whether it was your own click, whether the todo is open now. Plus the ids of the events that are news (not your clicks), the newest event's id, and the newest one you have seen (null: never looked).",
    input: [f("days", "number")],
    output: "{ events: [{ id, todoId, ref, event, ticket, text, note, by: { label, href, title, run }, mine, openNow, at }], newsIds, max, seen }",
    run: async (i) => {
      const { todoActivity, activityNewsIds } = await import("@/lib/todos/activity");
      const { getPref } = await import("@/lib/prefs");
      const days = Math.max(1, Math.min(60, Number(i.days) || 14));
      const events = todoActivity({ days }).map((e) => ({ ...e, ref: `T-${e.todoId}`, by: { label: e.by.label, href: e.by.href ?? "", title: e.by.title ?? "", run: e.by.run ?? 0 } }));
      const seen = getPref<number | null>("todos:activity-seen", null);
      return { events, newsIds: activityNewsIds(days), max: events.length ? Math.max(...events.map((e) => e.id)) : 0, seen: typeof seen === "number" ? seen : null };
    },
  },
  {
    name: "todos.activity-seen",
    group: "todos",
    label: "The activity you have looked at",
    summary: "The newest event of the todos' activity you have seen is kept (never lowered): what is newer counts as new. Needs the flow's todos permission.",
    input: [f("id", "number", { required: true })],
    output: "{}",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not change todos — grant it under the flow's permissions (todos).");
      if (ctx.dryRun) return {};
      const { getPref, setPref } = await import("@/lib/prefs");
      const now = getPref<number | null>("todos:activity-seen", null);
      const id = Number(i.id) || 0;
      if (now === null || id > now) setPref("todos:activity-seen", id);
      return {};
    },
  },
  {
    name: "todos.undo-run",
    group: "todos",
    label: "Take back a briefing run's todos",
    summary: "The todos a briefing run made that you haven't touched are dismissed (those you worked on stay): { dismissed, kept, claims }. Needs the flow's todos permission.",
    input: [f("run", "number", { required: true })],
    output: "{ dismissed, kept, claims, message }",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not change todos — grant it under the flow's permissions (todos).");
      if (ctx.dryRun) return { dismissed: 0, kept: 0, claims: 0 };
      const r = (await import("@/lib/runs/run-undo")).undoLageRun(Number(i.run));
      const { t } = await import("@/lib/i18n/server");
      return { ...r, message: `${t("{n} todos of the run dismissed, {kept} kept (you worked on them).", { n: r.dismissed, kept: r.kept })}${r.claims ? ` ${t("{n} promises and facts it read removed.", { n: r.claims })}` : ""}` };
    },
  },
  {
    name: "todos.omni",
    group: "todos",
    label: "Search the todos and what they are made of",
    summary:
      "What a typed text names — tickets, kinds of todo, people, the todos' own words and notes, mails, messages, Jira and GitLab comments, notes, documents, facts — each with the todos it belongs to (never a hit nothing refers to); the first hit is everything with the words together. Closed todos count, dismissed ones don't.",
    input: [f("q", "text", { required: true })],
    output: "{ hits: [{ key, kind, title, sub, todoIds }] }",
    run: async (i) => {
      const q = String(i.q ?? "").slice(0, 200);
      const { listTodos } = await import("@/lib/todos/store");
      const { omniSearch } = await import("@/lib/todos/omnibar");
      const { isInstalled } = await import("@/plugins/state");
      const todos = listTodos({ status: "all" }).filter((todo) => todo.status !== "dismissed");
      const people = isInstalled("people") ? (await import("@/plugins/people/store")).listPeople().map((p) => ({ id: p.id, name: p.name, aliases: p.aliases })) : [];
      return { hits: await omniSearch(q, todos, { people }) };
    },
  },
  {
    name: "todos.board",
    group: "todos",
    label: "The briefing: its run and its tickets",
    summary:
      "The Ticket-Lage the Todos page rests on: whether a run goes on (its step, since when, the AI it uses), the run shown (when, model, duration, cost, how many tickets analyzed), the last failed run's error, the lede and the sources that weren't well, the followed tickets and — per ticket — Jira's facts (summary, status, link), what the run made of it (attention, lead, summary, what happened, flags, suggested ticket changes with what was done, questions), the tickets that left the list and those only listed; the count per attention; the steps run first.",
    input: [],
    output: "{ running, phase, since, provider, shown: { id, at, model, durationMs, costUsd, analyzed }, failed: { at, error }, lede, gaps, counts: [{ attention, n }], tickets: [{ key, summary, status, url, followed, analyzed, attention, lead, text, happened, flags, actions: [{ idx, type, label, why, comment, done }], questions }], left: [{ key, summary, status, note }], listed: [{ key, summary, status, updatedAt }], presync: [key] }",
    run: async () => {
      const { latestRun, lastGoodRun } = await import("@/lib/runs/store");
      const { boardRunState } = await import("@/lib/runs/run");
      const { actionsDone } = await import("@/lib/runs/actions");
      const { aiChoice } = await import("@/lib/ai");
      const { AI_PROVIDER_INFO } = await import("@/lib/ai/shared");
      const { ATTENTIONS } = await import("@/lib/runs/shared");
      const { getContextPrefs } = await import("@/lib/runs/context-prefs");
      const { PRESYNC_ORDER } = await import("@/lib/runs/context-prefs-shared");
      const { stepAvailable } = await import("@/plugins/state");
      const latest = latestRun();
      const live = boardRunState();
      const running = !!live && (latest?.status === "running" || (["mailtodos", "mails", "notetodos", "notes", "calendarmatch", "calendartodos", "documents", "docrelations", "knowledge", "briefingdb", "autoactions"].includes(live.phase) && live.id === latest?.id));
      const shown = latest?.status === "ok" ? latest : lastGoodRun();
      const failed = latest?.status === "error" ? latest : null;
      const ai = aiChoice();
      const result = shown?.result ?? null;
      const analysis = new Map((result?.tickets ?? []).map((x) => [x.key, x]));
      const facts = new Map((shown?.tickets ?? []).map((x) => [x.key, x]));
      const order = [...(result?.tickets ?? []).map((x) => x.key), ...(shown?.tickets ?? []).filter((x) => x.analyzed && !analysis.has(x.key)).map((x) => x.key)].filter((k) => facts.has(k));
      const done = shown ? actionsDone(shown.id) : {};
      const tickets = order.map((key) => {
        const fct = facts.get(key)!;
        const a = analysis.get(key);
        return {
          key,
          summary: fct.summary,
          status: fct.status,
          url: fct.url ?? "",
          followed: fct.followed ?? "",
          analyzed: !!a,
          attention: a?.attention ?? "ready",
          lead: a?.lead ?? "",
          text: a?.summary ?? "",
          happened: a?.happened ?? [],
          flags: a?.flags ?? [],
          actions: (a?.actions ?? []).map((x, idx) => ({ idx, type: x.type, label: x.label, why: x.why, comment: x.comment ?? "", done: done[`${key}#${idx}`] ? { status: done[`${key}#${idx}`].status, detail: done[`${key}#${idx}`].detail, at: done[`${key}#${idx}`].at } : null })),
          questions: (a?.questions ?? []).map((x) => ({ q: x.q, a: x.a ?? "" })),
        };
      });
      // What the ticket row shows beside the Lage: its comments (done ones marked), GitLab's, the mails naming it, its chat, its facts.
      const keysShown = tickets.map((x) => x.key);
      const { resolvedCommentIds } = await import("@/lib/resolved");
      const { gitlabCommentsByTicket } = await import("@/lib/gitlab/store");
      const { gitlabDone } = await import("@/lib/gitlab/shared");
      const { mailsForTickets } = await import("@/lib/mail/store");
      const { ticketChats } = await import("@/lib/runs/ticket-chat");
      const doneIds = resolvedCommentIds((shown?.tickets ?? []).flatMap((x) => (x.recent ?? []).map((c) => c.id)));
      const gl = gitlabCommentsByTicket(shown?.tickets.filter((x) => x.analyzed).map((x) => x.key) ?? []);
      const mails = mailsForTickets(keysShown);
      const chats = ticketChats(keysShown);
      const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
      for (const x of tickets as Record<string, unknown>[]) {
        const key = String(x.key);
        const fct = facts.get(key)!;
        x.facts = { issueType: fct.issueType ?? "", priority: fct.priority ?? "", comments: fct.comments, parent: fct.parent ?? "", updatedAt: fct.updatedAt ?? "" };
        x.recent = (fct.recent ?? []).map((c) => ({ id: c.id, author: c.author, at: c.at, text: oneLine(c.text).slice(0, 400), done: doneIds.has(c.id) }));
        x.gitlab = (gl[key] ?? []).map((c) => ({ key: c.key, ref: c.ref, title: c.title, url: c.url, author: c.author ?? "?", at: c.createdAt ?? "", body: oneLine(c.body).slice(0, 400), done: gitlabDone(c), resolvable: /^note:\d+$/.test(c.key) }));
        x.mails = (mails[key] ?? []).map((m) => ({ key: m.key, from: m.fromName ?? m.fromEmail ?? "", subject: m.subject, preview: m.preview, at: m.receivedAt, unread: m.unread }));
        x.chat = (chats.get(key) ?? []).map((c) => ({ id: c.id, q: c.q, a: c.a, sources: c.sources, at: c.at }));
        x.questionSources = Object.fromEntries((analysis.get(key)?.questions ?? []).map((q) => [q.q, q.sources ?? []]));
      }
      const leftNote = new Map((result?.left ?? []).map((l) => [l.key, l.note]));
      const pre = getContextPrefs().presync.sources;
      return {
        running,
        phase: live?.phase ?? "",
        since: live?.since ?? 0,
        provider: live?.provider ?? `${AI_PROVIDER_INFO[ai.provider].label}${ai.model ? ` · ${ai.model}` : ""}`,
        shown: shown ? { id: shown.id, at: shown.finishedAt ?? shown.startedAt, model: shown.model ?? "", durationMs: shown.durationMs ?? 0, costUsd: shown.costUsd ?? null, analyzed: shown.tickets.filter((x) => x.analyzed).length } : null,
        failed: failed ? { at: failed.startedAt, error: failed.error ?? "" } : null,
        jql: (await import("@/lib/runs/store")).getBoardSettings().jql ?? "",
        lede: result?.lede ?? "",
        gaps: result?.gaps ?? [],
        counts: ATTENTIONS.map((attention) => ({ attention, n: tickets.filter((x) => x.attention === attention).length })).filter((x) => x.n > 0),
        tickets,
        left: (shown?.tickets ?? []).filter((x) => x.left).map((x) => ({ key: x.key, summary: x.summary, status: x.status, note: leftNote.get(x.key) ?? x.summary })),
        listed: (shown?.tickets ?? []).filter((x) => !x.analyzed && !x.left).map((x) => ({ key: x.key, summary: x.summary, status: x.status, updatedAt: x.updatedAt ?? "" })),
        presync: PRESYNC_ORDER.filter((k) => pre[k] && stepAvailable(k)),
      };
    },
  },
  {
    name: "todos.board-run",
    group: "todos",
    label: "Run the briefing now — or stop it",
    summary: "Starts the Ticket-Lage's run (Jira synced first, then the analysis; it runs in the background) or, with stop, stops the run that goes on. { ok, message }. Needs the flow's permissions todos and api.",
    input: [f("stop", "boolean")],
    output: "{ ok, message }",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos || !ctx.perms.api) throw new Error("This flow may not run the briefing — grant it the permissions “todos” and “api”.");
      if (ctx.dryRun) return { ok: true, message: "" };
      const host = await import("@/lib/host/commands");
      if (i.stop === true || i.stop === "true") return (await host.stopBoardRunAnywhere()) ? { ok: true, message: "The analysis is being stopped." } : { ok: false, message: "No analysis is running." };
      const r = await host.startBoardRunAnywhere({ syncJira: true });
      return { ok: r.ok, message: r.message };
    },
  },
  {
    name: "todos.ticket-action",
    group: "todos",
    label: "Do a change the briefing suggests on a ticket",
    summary: "One of a briefing run's suggested ticket changes (a transition, an assignee, a comment) done in Jira through Zeff's Jira connection: { ok, message, error }. Needs the flow's permissions todos and api.",
    input: [f("run", "number", { required: true }), f("ticket", "text", { required: true }), f("idx", "number", { required: true })],
    output: "{ ok, message, error }",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos || !ctx.perms.api) throw new Error("This flow may not change tickets — grant it the permissions “todos” and “api”.");
      if (ctx.dryRun) return { ok: true, message: "", error: "" };
      try {
        const r = await (await import("@/lib/runs/actions")).runTicketAction(Number(i.run), String(i.ticket), Number(i.idx));
        return { ok: true, message: `${i.ticket}: ${r.detail}.`, error: "" };
      } catch (e) {
        return { ok: false, message: "", error: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    name: "todos.follow",
    group: "todos",
    label: "Follow a ticket — or stop following it",
    summary: "A ticket followed from the next run (1), no longer followed (-1) or as it comes (0). Needs the flow's todos permission.",
    input: [f("key", "text", { required: true }), f("value", "number", { required: true })],
    output: "{}",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not change todos — grant it under the flow's permissions (todos).");
      const v = Number(i.value);
      if (!ctx.dryRun) (await import("@/lib/todos/followed")).setFollowed(String(i.key), v === 1 || v === -1 ? v : 0);
      return {};
    },
  },
  {
    name: "todos.recap",
    group: "todos",
    label: "What you did on a day",
    summary:
      "The recap of a day (default: the last workday): whether it is being written (its step, since when), the newest that worked (when, model, duration, cost, the AI's summary, per ticket its lead and what was done with what was gathered — bookings, todos, workers, Jira, commits, GitLab —, the work on no ticket), the newest one's error when it failed, the days before and after.",
    input: [f("day", "text")],
    output: "{ day, before, after, today, running, phase, since, provider, shown, failed, summary, booked, tickets: [{ key, summary, status, url, lead, done, hours, facts: [{ kind, at, text, hours }] }], other: { done, hours, facts } }",
    run: async (i) => {
      const { recapsOf, recapState } = await import("@/lib/runs/recap");
      const { previousWorkday, shiftWorkday, todayIso } = await import("@/lib/runs/recap-shared");
      const { aiChoice } = await import("@/lib/ai");
      const { AI_PROVIDER_INFO } = await import("@/lib/ai/shared");
      const day = typeof i.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(i.day) ? i.day : previousWorkday();
      const { latest, good } = recapsOf(day);
      const live = recapState();
      const running = !!live && live.day === day && latest?.status === "running";
      const ai = aiChoice();
      const hours = (facts: { hours?: number }[]) => facts.reduce((s, x) => s + (x.hours ?? 0), 0);
      const written = new Map((good?.result?.tickets ?? []).map((x) => [x.key, x]));
      const { entityHeadline, entitySourceLabel, entityText, entityWhoWhen } = await import("@/lib/entities-shared");
      const ents = good ? (await import("@/lib/runs/recap")).recapEntities(good) : {};
      const badges = (key: string) => (ents[key] ?? []).map((e) => ({ label: entitySourceLabel(e), headline: entityHeadline(e), text: entityText(e).slice(0, 1200), who: entityWhoWhen(e).author ?? "", at: entityWhoWhen(e).at ?? "" }));
      const tickets = (good?.facts.tickets ?? []).map((tk) => ({ key: tk.key, badges: badges(tk.key), summary: tk.summary, status: tk.status ?? "", url: tk.url ?? "", lead: written.get(tk.key)?.lead ?? "", done: written.get(tk.key)?.done ?? [], hours: hours(tk.facts), facts: tk.facts.map((x) => ({ kind: x.kind, at: x.at ?? "", text: x.text, hours: x.hours ?? 0 })) }));
      const other = good ? { done: good.result?.other ?? [], hours: hours(good.facts.other), facts: good.facts.other.map((x) => ({ kind: x.kind, at: x.at ?? "", text: x.text, hours: x.hours ?? 0 })) } : { done: [], hours: 0, facts: [] };
      const later = shiftWorkday(day, 1);
      return {
        day,
        before: shiftWorkday(day, -1),
        after: later <= todayIso() ? later : "",
        today: todayIso(),
        running,
        phase: running ? (live?.phase ?? "") : "",
        since: running ? (live?.since ?? 0) : 0,
        provider: `${AI_PROVIDER_INFO[ai.provider].label}${ai.model ? ` · ${ai.model}` : ""}`,
        shown: good ? { at: good.finishedAt ?? good.startedAt, model: good.model ?? "", durationMs: good.durationMs ?? 0, costUsd: good.costUsd } : null,
        failed: latest?.status === "error" ? { error: latest.error ?? "" } : null,
        summary: good?.result?.summary ?? "",
        booked: tickets.reduce((s, x) => s + x.hours, 0) + other.hours,
        tickets,
        other,
      };
    },
  },
  {
    name: "todos.recap-start",
    group: "todos",
    label: "Write the recap of a day",
    summary: "Gathers what you did that day (entries, todos, workers, Jira, commits, GitLab) and has the AI from the settings summarize it, in the background: { ok, message }. Needs the flow's permissions todos and api.",
    input: [f("day", "text", { required: true })],
    output: "{ ok, message }",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos || !ctx.perms.api) throw new Error("This flow may not write the recap — grant it the permissions “todos” and “api”.");
      if (ctx.dryRun) return { ok: true, message: "" };
      const r = await (await import("@/lib/host/commands")).startRecapAnywhere(String(i.day));
      return { ok: r.ok, message: r.message };
    },
  },
  {
    name: "todos.today",
    group: "todos",
    label: "The todos' parts of Today",
    summary: "What Today shows of the todos: yours due today or before (oldest first), what you wait on for three days or more (oldest first), what agents ask you, what workers and agents report done — each with ref, words, ticket, due day and days to it, how long it has been there.",
    input: [],
    output: "{ due: [{ id, ref, text, ticket, due, dueDays, ageDays }], waiting: [...], asking: [{ ..., question }], reported: [{ ..., by, note }] }",
    run: async () => {
      const { listTodos } = await import("@/lib/todos/store");
      const { daysUntil } = await import("@/lib/todos/due-shared");
      const now = Date.now();
      const open = listTodos({ status: "open" });
      const iso = (() => { const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
      const row = (x: (typeof open)[number]) => ({ id: x.id, ref: x.ref, text: x.text, ticket: x.ticket, due: x.due ? x.due.slice(0, 10) : "", dueDays: x.due ? daysUntil(x.due.slice(0, 10)) : null, ageDays: Math.floor((now - new Date(x.createdAt).getTime()) / 864e5) });
      return {
        due: open.filter((x) => x.owner === "me" && !x.byWorker && x.due && x.due.slice(0, 10) <= iso).sort((a, b) => a.due!.localeCompare(b.due!)).map(row),
        waiting: open.filter((x) => x.owner === "other" && now - new Date(x.createdAt).getTime() >= 3 * 864e5).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(row),
        asking: open.filter((x) => x.needsInput).map((x) => ({ ...row(x), question: x.needsInput })),
        reported: open.filter((x) => x.workerDone && !x.needsInput).map((x) => ({ ...row(x), by: x.workerDone!.by, note: x.workerDone!.note ?? "" })),
      };
    },
  },
  {
    name: "todos.sources",
    group: "todos",
    label: "Where the todos come from",
    summary: "For each todo (ids): the comments, messages and mails it comes from — ref, label, when, who, headline, text, and for a mail its conversation id and subject.",
    input: [f("ids", "list", { required: true })],
    output: "{ sources: { [todoId]: [{ ref, label, at, author, headline, text, convId, subject }] } }",
    run: async (i) => {
      const { listTodos } = await import("@/lib/todos/store");
      const { todoSources } = await import("@/lib/todos/sources");
      const { lastGoodRun } = await import("@/lib/runs/store");
      const { sourcesOf } = await import("@/lib/todos/shared");
      const { entityHeadline, entitySourceLabel, entityText, entityWhoWhen } = await import("@/lib/entities-shared");
      const ids = nums(i.ids);
      const list = listTodos({ status: "open" }).filter((t) => ids.includes(t.id));
      const sources = todoSources(list, lastGoodRun()?.tickets ?? []);
      const out: Record<string, unknown[]> = {};
      for (const t of list)
        out[t.id] = sourcesOf(t.refs, sources).map((s) => {
          const w = entityWhoWhen(s);
          const mail = s.source === "mail" ? (s as unknown as { mail: { convId: string; subject: string } }).mail : null;
          return { ref: sourceRef(s as never), label: entitySourceLabel(s), at: w.at ?? "", author: w.author ?? "", headline: entityHeadline(s), text: entityText(s), convId: mail?.convId ?? "", subject: mail?.subject ?? "" };
        });
      return { sources: out };
    },
  },
  {
    name: "todos.tickets",
    group: "todos",
    label: "What the board and Jira say of tickets",
    summary: "For ticket keys: summary, status, assignee, the people, the possible transitions (the last good board run) and the description (Jira's, up to 3500 characters).",
    input: [f("keys", "list", { required: true })],
    output: "{ tickets: { [key]: { summary, status, assignee, people, transitions, description } } }",
    run: async (i) => {
      const { lastGoodRun } = await import("@/lib/runs/store");
      const { getJiraTicket } = await import("@/lib/jira/store");
      const board = lastGoodRun();
      const keys = (Array.isArray(i.keys) ? i.keys : []).map(String).filter(Boolean).slice(0, 200);
      return {
        tickets: Object.fromEntries(
          keys.map((k) => {
            const tk = board?.tickets.find((x) => x.key === k);
            const j = getJiraTicket(k);
            return [k, { summary: tk?.summary ?? j?.summary ?? "", status: tk?.status ?? j?.status ?? "", assignee: tk?.assignee ?? j?.assignee ?? "", people: tk?.people ?? [], transitions: tk?.transitions ?? [], description: (j?.description ?? "").slice(0, 3500) }];
          }),
        ),
      };
    },
  },
  {
    name: "todos.ops-rules",
    group: "todos",
    label: "The actions Zeff can run for a todo",
    summary: "The dictionary of actions the installed plugins offer (what each is for, its fields), the types available now, and what each needs of a todo's context ({ type, match, context }).",
    input: [],
    output: "{ dictionary, available: [type], needs: [{ type, match, context }] }",
    run: async () => {
      await import("@/plugins/actions/server");
      const { opAvailable } = await import("@/plugins/ops");
      const { opsDictionary, TODO_OP_TYPES } = await import("@/lib/todos/shared");
      const { OFFERED_ACTIONS } = await import("@/plugins/actions/catalog");
      return {
        dictionary: opsDictionary(opAvailable),
        available: TODO_OP_TYPES.filter((t) => opAvailable(t)).sort(),
        needs: OFFERED_ACTIONS.flatMap((a) => (a.offer?.needs && opAvailable(a.type) ? [{ type: a.type, match: a.offer.needs.match, context: a.offer.needs.context }] : [])),
      };
    },
  },
  {
    name: "todos.clean-ops",
    group: "todos",
    label: "Hold proposed actions to Zeff's rules",
    summary: "Actions as an AI hands them over, cleaned: the complete ones in Zeff's own shapes, of installed plugins, none to yourself (me: your Jira name), no appointment when noAppointments.",
    input: [f("ops", "json", { required: true }), f("ticket", "text"), f("noAppointments", "boolean"), f("me", "text")],
    output: "{ ops }",
    run: async (i) => {
      await import("@/plugins/actions/server");
      const { opAvailable } = await import("@/plugins/ops");
      const { cleanOps } = await import("@/lib/todos/shared");
      const { withoutAppointments } = await import("@/lib/todos/recurring");
      const me = text(i.me).toLowerCase();
      return { ops: withoutAppointments(cleanOps(i.ops ?? [], text(i.ticket)), i.noAppointments === true).filter((o) => opAvailable(o.type) && !(o.type === "teams-message" && me && String((o as { to?: string }).to ?? "").toLowerCase() === me)) };
    },
  },
  {
    name: "todos.set-actions",
    group: "todos",
    label: "Put proposed actions on a todo",
    summary:
      "The actions an AI step proposed for a todo — set only when it has none yet (or replace: true, its own earlier proposal); its replies added in front of their thread's Resolve (mode gap: a todo of review comments); the day it was gone through noted either way. why: one sentence.",
    input: [f("id", "number", { required: true }), f("ops", "json"), f("why", "text"), f("mode", "text", { help: "set | gap" }), f("replace", "boolean"), f("reviewedAt", "text")],
    output: "{ changed }",
    writes: true,
    run: async (i) => {
      const { getDb, schema } = await import("@/db");
      const { eq } = await import("drizzle-orm");
      const { emitChange } = await import("@/lib/events");
      const { commentTodos, dropObsoleteInstructs, withCommentOps } = await import("@/lib/todos/comment-ops");
      const { listTodos } = await import("@/lib/todos/store");
      const id = Number(i.id);
      const ops = (Array.isArray(i.ops) ? i.ops : []) as { type: string }[];
      const { todos } = schema;
      const set: Partial<typeof todos.$inferInsert> = { actionsReviewedAt: text(i.reviewedAt) || new Date().toISOString() };
      const still = getDb().select({ ops: todos.ops, why: todos.autoOpsWhy }).from(todos).where(eq(todos.id, id)).get();
      let changed = false;
      if (still) {
        const had = JSON.parse(still.ops) as { type: string }[];
        if (i.mode === "gap") {
          const gap = commentTodos().find((c) => c.id === id);
          const replies = ops.filter((o) => o.type === "gitlab-reply");
          if (gap && replies.length && listTodos({ status: "open" }).some((t) => t.id === id)) {
            set.ops = JSON.stringify(dropObsoleteInstructs(withCommentOps(had as never, gap.open, replies as never), gap.open));
            changed = true;
          }
        } else if (ops.length && (had.length === 0 || (i.replace === true && !!still.why))) {
          set.ops = JSON.stringify(ops);
          set.autoOpsWhy = text(i.why).trim().slice(0, 500) || "Vorgeschlagen aus dem Kontext.";
          changed = true;
        }
      }
      getDb().update(todos).set(set).where(eq(todos.id, id)).run();
      if (changed) emitChange("todos");
      return { changed };
    },
  },
  {
    name: "calendar.busy",
    group: "calendar",
    label: "My busy times",
    summary: "My appointments of the next days (days, up to 60) — every calendar that blocks time: start and end as local stamps, the title.",
    input: [f("days", "number", { default: 14 })],
    output: "{ busy: [{ start, end, title }] }",
    run: async (i) => {
      const { busyBetween } = await import("@/lib/calendar/ir");
      const { localStamp } = await import("@/lib/dates");
      const from = new Date();
      const days = Math.min(60, Math.max(1, Number(i.days) || 14));
      return { busy: busyBetween(from, new Date(from.getTime() + days * 864e5)).map((b) => ({ start: localStamp(b.start), end: localStamp(b.end), title: b.title })) };
    },
  },
  {
    name: "facts.list",
    group: "data",
    label: "The facts Zeff knows",
    summary: "The facts found in your messages (a birthday, the language someone writes in): subject, text, updatedAt — the newest first.",
    input: [f("limit", "number", { default: 500 })],
    output: "{ facts: [{ subject, text, updatedAt }] }",
    run: async (i) => {
      const { listFacts } = await import("@/lib/facts");
      return { facts: listFacts(Math.min(2000, Math.max(1, Number(i.limit) || 500))).map((x) => ({ subject: x.subject, text: x.text, updatedAt: x.updatedAt })) };
    },
  },
  {
    name: "mail.conversation",
    group: "mail",
    label: "A conversation's last messages",
    summary: "The last messages of a mail or chat conversation, the oldest first: folder, whether it is a chat, subject, when, from, preview.",
    input: [f("convId", "text", { required: true }), f("limit", "number", { default: 8 })],
    output: "{ messages: [{ chat, subject, receivedAt, fromName, fromEmail, preview }] }",
    run: async (i) => {
      const { conversationOf } = await import("@/lib/mail/store");
      const { isChatFolder } = await import("@/lib/mail/shared");
      return { messages: conversationOf(text(i.convId), Math.min(50, Math.max(1, Number(i.limit) || 8))).map((m) => ({ chat: isChatFolder(m.folder), subject: m.subject, receivedAt: m.receivedAt, fromName: m.fromName, fromEmail: m.fromEmail, preview: m.preview })) };
    },
  },
  {
    name: "mail.senders",
    group: "mail",
    label: "The people who write to you, with their mail address",
    summary: "Name and address of those whose mails were read (the last 2000), without the systems' (GitLab, Jira, no-reply …) and without an address under several names: [{ name, email }], the newest first.",
    input: [],
    output: "{ senders: [{ name, email }] }",
    run: async () => {
      const { getDb, schema } = await import("@/db");
      const { and, desc, isNotNull } = await import("drizzle-orm");
      const { emails } = schema;
      const rows = getDb().select({ name: emails.fromName, email: emails.fromEmail }).from(emails).where(and(isNotNull(emails.fromName), isNotNull(emails.fromEmail))).orderBy(desc(emails.receivedAt)).limit(2000).all();
      const seen = new Map<string, string>();
      const namesOf = new Map<string, Set<string>>();
      for (const r of rows) {
        const name = (r.name ?? "").replace(/\s*\(.*\)\s*$/, "").trim();
        const email = (r.email ?? "").trim().toLowerCase();
        if (!name.includes(" ") || !/@/.test(email) || /^(git|gitlab|jira|no-?reply|notifications?|mailer|postmaster|support|info|service|system)[@.+-]/i.test(email)) continue;
        namesOf.set(email, (namesOf.get(email) ?? new Set()).add(name));
        if (!seen.has(name)) seen.set(name, email);
      }
      for (const [name, email] of [...seen]) if ((namesOf.get(email)?.size ?? 0) > 1) seen.delete(name);
      return { senders: [...seen].map(([name, email]) => ({ name, email })) };
    },
  },
  {
    name: "people.named-in",
    group: "people",
    label: "The contacts a text names, with their accounts",
    summary: "The contacts whose name (or alias) the text names: id, name, IBAN, BIC, RevTag, the day the IBAN was confirmed, and when an account of theirs became known.",
    input: [f("text", "text", { required: true })],
    output: "{ people: [{ id, name, iban, bic, revtag, ibanConfirmedAt, accountAt }] }",
    run: async (i) => {
      const { isInstalled } = await import("@/plugins/state");
      if (!isInstalled("people")) return { people: [] };
      const { getSqlite } = await import("@/db");
      const { detailsOf } = await import("@/plugins/people/details");
      const { listPeople, namesThem } = await import("@/plugins/people/store");
      let at = new Map<number, string>();
      try {
        at = new Map((getSqlite().prepare("select person_id, max(created_at) as at from people_details where key in ('iban', 'revtag') and removed = 0 group by person_id").all() as { person_id: number; at: string }[]).map((r) => [r.person_id, r.at]));
      } catch {
        // none yet
      }
      const t = text(i.text);
      return {
        people: listPeople()
          .filter((p) => namesThem(p, t))
          .map((p) => {
            const d = detailsOf(p.id);
            return { id: p.id, name: p.name, iban: d.find((x) => x.key === "iban")?.value ?? "", bic: d.find((x) => x.key === "bic")?.value ?? "", revtag: d.find((x) => x.key === "revtag")?.value ?? "", ibanConfirmedAt: d.find((x) => x.key === "iban")?.confirmedAt?.slice(0, 10) ?? "", accountAt: at.get(p.id) ?? "" };
          }),
      };
    },
  },
  {
    name: "actions.offer-context",
    group: "todos",
    label: "What exists that an action may adjust",
    summary: "For a todo (its ticket and text): what exists in Zeff that the offered actions can change (the instructions of an AI step, the boards, what the knowledge says) — lines to show the AI.",
    input: [f("ticket", "text"), f("text", "text")],
    output: "{ lines: [text] }",
    run: async (i) => {
      const { offerContext } = await import("@/plugins/actions/server");
      return { lines: await offerContext({ ticket: text(i.ticket), text: text(i.text) }) };
    },
  },
  {
    name: "prompts.fill",
    group: "ai",
    label: "A prompt as you wrote it (System → Prompts)",
    summary: "The prompt of this key as the page System → Prompts has it (your changes win), else the template given; {{name}} filled from vars. Also the extra instructions for an AI step (step: its name in Settings → Context), and the room a prompt has (reserve characters kept free).",
    input: [f("key", "text", { required: true }), f("template", "text", { required: true }), f("vars", "json"), f("step", "text"), f("reserve", "number")],
    output: "{ text, raw, extra, room }",
    run: async (i) => {
      const { fillPrompt, promptText } = await import("@/lib/prompts");
      const { extraBlock } = await import("@/lib/runs/context-prefs");
      const { promptRoom } = await import("@/lib/ai/batch-job");
      const { COPILOT_MAX_PROMPT } = await import("@/plugins/copilot-cli/cli");
      const vars = i.vars && typeof i.vars === "object" ? Object.fromEntries(Object.entries(i.vars as Record<string, unknown>).map(([k, v]) => [k, text(v)])) : {};
      return {
        text: fillPrompt(text(i.key), text(i.template), vars),
        raw: promptText(text(i.key), text(i.template)),
        extra: text(i.step) ? extraBlock(text(i.step) as never) : "",
        room: promptRoom(COPILOT_MAX_PROMPT - (Number(i.reserve) || 9000)),
      };
    },
  },
  {
    name: "jira.tickets-open",
    group: "jira",
    label: "My open Jira tickets",
    summary: "The Jira tickets read that are not done (key, summary) — at most limit (default 60, 200 at most).",
    input: [f("limit", "number", { default: 60 })],
    output: "{ tickets: [{ key, summary }] }",
    run: async (i) => {
      const { getDb, schema } = await import("@/db");
      const { ne } = await import("drizzle-orm");
      try {
        return { tickets: getDb().select({ key: schema.jiraTickets.key, summary: schema.jiraTickets.summary }).from(schema.jiraTickets).where(ne(schema.jiraTickets.statusCategory, "done")).limit(Math.min(200, Math.max(1, Number(i.limit) || 60))).all() };
      } catch {
        return { tickets: [] };
      }
    },
  },
  {
    name: "jira.my-name",
    group: "jira",
    label: "My name in Jira",
    summary: "The name Jira knows me by (the assignee of my tickets): { name } — empty when not known.",
    input: [],
    output: "{ name }",
    run: async () => ({ name: (await import("@/lib/jira/store")).myJiraName() ?? "" }),
  },
  {
    name: "todos.followed",
    group: "todos",
    label: "The tickets I follow",
    summary: "The keys of the tickets followed — by you (marked), by what you work on (a todo, a booking) — less those you switched off: { keys }.",
    input: [],
    output: "{ keys }",
    run: async () => ({ keys: [...(await import("@/lib/todos/followed")).followedTickets().keys()] }),
  },
  {
    name: "runs.analyzed-tickets",
    group: "runs",
    label: "The tickets the last board run analyzed",
    summary: "The keys of the tickets the last good board (briefing) run read through and assessed — not only listed: { keys }.",
    input: [],
    output: "{ keys }",
    run: async () => ({ keys: [...(await import("@/lib/runs/ticket-lage")).analyzedByTicketLage()] }),
  },
  {
    name: "jira.read-issues",
    group: "jira",
    label: "Read Jira tickets fresh",
    summary:
      "The tickets with these keys (up to 200) read fresh from Jira, with their comments and history (in one session of the Jira connection, the plugin's or Zeff's own): { read, comments: [{ id, ticket, author, at, body }] } — the comments as Zeff keeps them (jira_comments). Nothing is written; empty while Jira isn't set up.",
    input: [f("keys", "list", { required: true })],
    output: "{ read, comments }",
    run: async (i) => {
      const keys = (Array.isArray(i.keys) ? i.keys : typeof i.keys === "string" ? i.keys.split(",") : []).map((k) => String(k).trim()).filter(Boolean).slice(0, 200);
      const { getJiraSyncConfig } = await import("@/lib/jira/sync");
      const { runJiraSession, jiraPortOn } = await import("@/lib/jira/port-ops");
      const cfg = getJiraSyncConfig();
      if (!keys.length || ((!cfg.configured || !cfg.command) && !(await jiraPortOn()))) return { read: 0, comments: [] };
      const { FIELDS, dateOf, plain, who } = await import("@/lib/runs/collect");
      type Issue = import("@/lib/runs/collect").Issue;
      const { resultToPayload } = await import("@/lib/mcp/stdio");
      const issues: Issue[] = await runJiraSession(
        "Jira (read tickets)",
        async (call) => {
          const out: Issue[] = [];
          for (let n = 0; n < keys.length; n += 50) {
            const chunk = keys.slice(n, n + 50);
            const p = resultToPayload(await call("jira_search", { jql: `key in (${chunk.join(",")})`, limit: chunk.length, fields: FIELDS, expand: "changelog" })) as { issues?: Issue[] };
            out.push(...(p.issues ?? []).filter((x) => x?.key));
          }
          return out;
        },
        240000,
      );
      return { read: issues.length, comments: issues.flatMap((x) => (x.comments ?? []).flatMap((c) => (c.id ? [{ id: c.id, ticket: x.key.toUpperCase(), author: who(c.author), at: dateOf(c.created)?.toISOString() ?? "", body: plain(c.body, 4000) }] : []))) };
    },
  },
];

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("todos", TODO_FLOW_ACTIONS);
