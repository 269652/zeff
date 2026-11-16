import type { FlowAction } from "../workspace/flows/actions";
import type { FieldSpec } from "../workspace/flows/types";

/**
 * The kernel's reads and writes of what Zeff keeps about the people and what they said, for plugins' lambdas and flows: the messages of the last days
 * (mail, chat, Teams, Jira comments), who a name or address is, the promises read from the messages (the commitment claims) and your word on them, where
 * a promise was said and what came after it, the timeline's events of a person, the learning ledger. What the Open loops plugin reads and writes instead of
 * the built-in's code; nothing here knows it. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const text = (v: unknown): string => (v == null ? "" : String(v));
const strs = (v: unknown, max = 500): string[] => (Array.isArray(v) ? v : []).map(text).filter(Boolean).slice(0, max);

const all = async <T>(sql: string, ...args: unknown[]): Promise<T[]> => {
  const { getSqlite } = await import("@/db");
  try {
    return getSqlite().prepare(sql).all(...args) as T[];
  } catch {
    return [];
  }
};

export const GRAPH_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "messages.recent",
    group: "mail",
    label: "The messages of the last days",
    summary: "What was said since a time (ISO): the mails and chats (key, conv_id, folder, from, subject, preview, received, group, to me, resolved), the Teams messages and the Jira comments with their tickets — raw rows, the oldest first. For code that reads who asked what of you.",
    input: [f("since", "text", { required: true })],
    output: "{ mails, teams, jira }",
    run: async (i) => {
      const since = text(i.since);
      return {
        mails: await all("select key, conv_id, folder, from_name, from_email, subject, preview, received_at at, is_group, to_me, resolved_at from emails where received_at >= ? and folder != 'Notifications' order by received_at, key", since),
        teams: await all("select key, kind, mention_type, conversation_id, reply_chain_id, place, sender_name, sender_id, sent_at at, text, link, resolved_at from teams_messages where sent_at >= ? order by sent_at, key", since),
        jira: await all("select c.id, c.ticket, c.author, c.body, c.at, t.mine, t.status_category category, t.url from jira_comments c left join jira_tickets t on t.key = c.ticket where c.at >= ? order by c.at, c.id", since),
      };
    },
  },
  {
    name: "people.resolve",
    group: "people",
    label: "Who is this",
    summary: "The contact each name or mail address is (a name, an alias, an address, a part of a name only they have): { ids: { <text>: id | null } } — and you: your names and handles (lower case) and the names of every contact, for words that say nothing about a topic.",
    input: [f("queries", "list")],
    output: "{ ids, me: { names, handles }, allNames }",
    run: async (i) => {
      const { makeResolver } = await import("@/plugins/timeline/refs");
      const { myNames } = await import("./pulse");
      const { listPeople, namesOf } = await import("./store");
      const r = makeResolver();
      const people = listPeople();
      const names = myNames();
      const set = new Set(names);
      const handles = people.filter((p) => set.has(p.name.toLowerCase())).flatMap((p) => p.accounts.map((a) => a.value.toLowerCase()));
      return { ids: Object.fromEntries(strs(i.queries, 5000).map((q) => [q, r.person(q) ?? null])), me: { names, handles }, allNames: people.flatMap((p) => namesOf(p)), names: Object.fromEntries(people.map((p) => [p.id, p.name])) };
    },
  },
  {
    name: "people.claims",
    group: "people",
    label: "The promises read from the messages",
    summary: "The commitment claims (what someone promised): id, person (id, name), text, the words it was read from (evidence), the source ref, confidence, status, direction (mine: you promised, theirs: they did), due day, when done, when made — those not done (done: false) or done since a time (doneSince, ISO). Not the rejected or superseded, and not below confidence 0.5.",
    input: [f("done", "boolean"), f("doneSince", "text")],
    output: "{ claims }",
    run: async (i) => {
      const where = i.done === true ? "c.done_at is not null and c.done_at >= ?" : "c.done_at is null";
      const rows = await all<Record<string, unknown>>(
        `select c.id, c.person_id, p.name person_name, c.text, c.evidence, c.source_ref, c.confidence, c.status, c.direction, c.due, c.done_at, c.created_at from people_claims c left join people p on p.id = c.person_id where c.kind = 'commitment' and c.status in ('proposed', 'confirmed') and c.confidence >= 0.5 and c.direction in ('mine', 'theirs') and ${where}`,
        ...(i.done === true ? [text(i.doneSince) || "0000"] : []),
      );
      return { claims: rows };
    },
  },
  {
    name: "people.known-in",
    group: "people",
    label: "The people a text is about, and those closest to you",
    summary: "The contacts whose name or alias (4 letters or more) a text names: name, note, how they are connected to you — at most 6; and the names of the people you starred that it doesn't name (at most 5). For AI steps that need to know who is who.",
    input: [f("text", "text")],
    output: "{ named: [{ name, note, connection }], close: [name] }",
    run: async (i) => {
      const { isInstalled } = await import("@/plugins/state");
      if (!isInstalled("people")) return { named: [], close: [] };
      const { listPeople } = await import("./store");
      const low = text(i.text).toLowerCase();
      const people = listPeople();
      const named = people.filter((p) => [p.name, ...p.aliases].some((n) => n.length >= 4 && low.includes(n.toLowerCase())));
      return { named: named.slice(0, 6).map((p) => ({ name: p.name, note: (p.note ?? "").slice(0, 100), connection: (p.compiled?.connection ?? "").slice(0, 160) })), close: people.filter((p) => p.starred && !named.includes(p)).slice(0, 5).map((p) => p.name) };
    },
  },
  {
    name: "messages.of-ref",
    group: "mail",
    label: "Where a message was said",
    summary: "For source refs (mail:<key>, teams:<key>, jira-comment:<id>, doc:<id>): its kind (mail, teams, jira, other), when, the link in Zeff, the thread (a conversation, a ticket), whether it is a group, and its boundary source.",
    input: [f("refs", "list", { required: true })],
    output: "{ sources: { <ref>: { kind, at, href, thread, group, source } } }",
    run: async (i) => {
      const { sourceMessage, sourceOf } = await import("@/plugins/loops/source");
      return { sources: Object.fromEntries(strs(i.refs, 2000).map((r) => [r, { ...sourceMessage(r), source: sourceOf(r) }])) };
    },
  },
  {
    name: "messages.later",
    group: "mail",
    label: "What came after a message in its thread",
    summary: "The messages of a source ref's thread after a time (ISO), the oldest first — ref, when, from, whether it is yours (me: your names, lower case), text, attachment — who else wrote there (senders) and, for a Jira thread, the status when its ticket was done after that time (doneStatus).",
    input: [f("ref", "text", { required: true }), f("at", "text", { required: true }), f("me", "list")],
    output: "{ src, later, senders, doneStatus }",
    run: async (i) => {
      const { laterMessages, sourceMessage, threadSenders, ticketDoneSince } = await import("@/plugins/loops/source");
      const me = new Set(strs(i.me).map((x) => x.toLowerCase()));
      const src = sourceMessage(text(i.ref));
      return { src, later: laterMessages(src, text(i.at), me), senders: [...threadSenders(src, me)], doneStatus: src.kind === "jira" ? ticketDoneSince(src.thread, text(i.at)) : null };
    },
  },
  {
    name: "timeline.events-for",
    group: "data",
    label: "The timeline's events of a person or thing",
    summary: "The events on the timeline of a ref (person:<id> …) since a time, of the kinds given, newest first: id, at, kind, source, sourceRef, title, summary, url.",
    input: [f("ref", "text", { required: true }), f("since", "text"), f("kinds", "list"), f("limit", "number", { default: 16 })],
    output: "{ events }",
    run: async (i) => {
      const { isInstalled } = await import("@/plugins/state");
      if (!isInstalled("timeline")) return { events: [] };
      const { eventsFor } = await import("@/plugins/timeline/store");
      return { events: eventsFor(text(i.ref), { since: text(i.since) || undefined, kinds: strs(i.kinds) as never, limit: Math.min(100, Math.max(1, Number(i.limit) || 16)) }).map((e) => ({ id: e.id, at: e.at, kind: e.kind, source: e.source, sourceRef: e.sourceRef, title: e.title, summary: e.summary, url: e.url })) };
    },
  },
  {
    name: "people.claim-review",
    group: "people",
    label: "Your word on a promise",
    summary: "A promise confirmed, rejected, ticked off (done) or opened again (reopen) — as you do it on a person's page; the learning ledger notes it.",
    input: [f("id", "number", { required: true }), f("op", "text", { required: true, help: "confirm | reject | done | reopen" })],
    output: "{ ok }",
    writes: true,
    run: async (i) => {
      const op = text(i.op);
      if (!["confirm", "reject", "done", "reopen"].includes(op)) throw new Error("op: confirm, reject, done or reopen.");
      const { reviewClaim } = await import("./graph");
      reviewClaim(Number(i.id), op as "confirm");
      return { ok: true };
    },
  },
  {
    name: "people.claim-close",
    group: "people",
    label: "A promise kept, shown by a message",
    summary: "A promise ticked off because a message shows it kept: when it was made done, and an event \"loop closed\" on the person's timeline (by: rule | ai, the closing message's ref, a quote, its link). Not your own word — that is people.claim-review.",
    input: [f("id", "number", { required: true }), f("by", "text"), f("closeRef", "text"), f("quote", "text"), f("href", "text")],
    output: "{ ok }",
    writes: true,
    run: async (i) => {
      const { getSqlite } = await import("@/db");
      const { emitChange } = await import("@/lib/events");
      const { flatSlice } = await import("@/lib/text");
      const id = Number(i.id);
      const at = new Date().toISOString();
      const d = getSqlite();
      const c = d.prepare("select person_id, text from people_claims where id = ?").get(id) as { person_id: number; text: string } | undefined;
      if (!c) return { ok: false };
      d.prepare("update people_claims set done_at = ? where id = ? and done_at is null").run(at, id);
      emitChange("todos");
      const { isInstalled } = await import("@/plugins/state");
      if (isInstalled("timeline")) {
        const { recordEvent } = await import("@/plugins/timeline/store");
        recordEvent({ at, kind: "loop.closed", source: "loops", sourceRef: `claim:${id}:${at}`, title: c.text, summary: flatSlice(text(i.quote), 400), url: text(i.href), data: { by: text(i.by) === "ai" ? "ai" : "rule" }, refs: [`person:${c.person_id}`] });
      }
      return { ok: true, at };
    },
  },
  {
    name: "learning.feedback",
    group: "data",
    label: "Your verdict, in the learning ledger",
    summary: "A verdict on what an AI step or a rule proposed (accepted | rejected) noted in the ledger the quality page reads: { step, itemRef, verdict, sourceRef, sender, kind, detail, key }.",
    input: [f("feedback", "json", { required: true })],
    output: "{ recorded }",
    writes: true,
    run: async (i) => {
      const { recordFeedback } = await import("@/lib/learning/ledger");
      const fb = (i.feedback && typeof i.feedback === "object" ? i.feedback : {}) as Record<string, unknown>;
      return { recorded: recordFeedback(fb as never) };
    },
  },
];

