import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "../workspace/flows/actions";
import type { FieldSpec } from "../workspace/flows/types";

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
