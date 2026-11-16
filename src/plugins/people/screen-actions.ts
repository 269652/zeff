import type { FlowAction } from "../workspace/flows/actions";
import type { FieldSpec } from "../workspace/flows/types";

/**
 * What the People port's screens read and do through the kernel (the people model stays Zeff's — the shared graph every app reads; the screens are the port's
 * view language): the overview of the people database (the people, what waits, the circles, the settings) with its rows, a person's bundle and what the
 * knowledge knows of them, and the tools and operations the built-in's screen runs (`peopleTool`, `personOp`) — the same functions, after which the people database
 * reads the profiles again. Nothing here knows the port: the built-in's own screens use the same functions. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const set = (v: unknown) => v !== undefined && v !== null && v !== "";
const yes = (v: unknown): boolean => v === true || v === "true";
const num = (v: unknown): number => Number(v) || 0;

/** The people database's profiles read again after something changed (the built-in's screen does the same). */
async function refreshPeopleDatabase(): Promise<void> {
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("workspace")) return;
  const db = (await import("@/plugins/workspace/people-database")).peopleDatabase();
  if (db) (await import("@/plugins/workspace/pipeline")).startPipeline(db, { ai: false });
}


const configOf = (v: unknown): Record<string, string | number | boolean> => {
  const o = typeof v === "string" ? (() => { try { return JSON.parse(v) as unknown; } catch { return {}; } })() : v;
  return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, string | number | boolean>) : {};
};

/** One of People's widgets by its id (its data and buttons are the same functions the widget host calls). */
async function widgetOf(id: string) {
  const [{ PEOPLE_WIDGETS }, { PERSON_WIDGETS }, { PERSON_DETAIL_WIDGETS }] = await Promise.all([import("./widgets"), import("./widgets-person"), import("./widgets-person-more")]);
  const w = [...PEOPLE_WIDGETS, ...PERSON_WIDGETS, ...PERSON_DETAIL_WIDGETS].find((x) => x.id === id);
  if (!w) throw new Error(`No People widget “${id}”.`);
  return w;
}

/** One of People's review sources by its id. */
async function reviewSourceOf(id: string) {
  const { PEOPLE_REVIEW_OWN } = await import("./review");
  const s = PEOPLE_REVIEW_OWN.find((x) => x.id === id);
  if (!s) throw new Error(`No People review source “${id}”.`);
  return s;
}

export const SCREEN_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "people.screen-data",
    group: "people",
    label: "What the people overview shows",
    summary:
      "The people overview: the people with what their cards show (last contact, circle, role, what is open, how to reach or pay them), who to get in touch with, the appointments of the next 24 hours with a brief each, dates coming up, what waits to be checked (names that may be one person, what the AI read, dates found), the suggestions to take over, what runs in the background and the settings — and the rows of the people database (the fixed fields: star, next date, context, todos, tickets).",
    input: [],
    output: "{ overview, rows: [{ id, title, cells }] }",
    run: async () => {
      const { peopleOverview } = await import("./tools");
      const overview = await peopleOverview();
      const { peopleDatabase } = await import("@/plugins/workspace/people-database");
      const { rawRows } = await import("@/plugins/workspace/store");
      const db = peopleDatabase();
      return { overview, rows: db ? rawRows(db).map((r) => ({ id: r.id, title: r.title, cells: r.cells })) : [] };
    },
  },
  {
    name: "people.page-data",
    group: "people",
    label: "What a person's page shows",
    summary: "Everything Zeff knows of the person a row of the people database stands for: their profile, dates, details, what was read from messages, relations, the latest messages, todos, appointments, cases, documents, pages, tickets, the rhythm — person null: this row is not a person.",
    input: [f("row", "number", { required: true })],
    output: "{ person: PersonBundle | null }",
    run: async (i) => {
      const { personBundle, personOfRow } = await import("./blocks");
      const id = personOfRow(num(i.row));
      return { person: id ? await personBundle(id) : null };
    },
  },
  {
    name: "people.wiki-of",
    group: "people",
    label: "What the knowledge knows of a person",
    summary: "What the knowledge server knows of the person a row stands for: its summary, related entries, pages, the link to its graph, a merge proposal — null without the Knowledge plugin.",
    input: [f("row", "number", { required: true })],
    output: "{ wiki: { summary, related, pages, graph, error, merge } | null }",
    run: async (i) => {
      const { personOfRow } = await import("./blocks");
      const id = personOfRow(num(i.row));
      if (!id) return { wiki: null };
      const { personWiki } = await import("./wiki");
      return {
        wiki: await Promise.race([
          personWiki(id),
          new Promise((resolve) => setTimeout(() => resolve({ summary: "", related: [], pages: [], graph: null, error: "The knowledge server did not answer in time." }), 4000)),
        ]),
      };
    },
  },
  {
    name: "people.run-tool",
    group: "people",
    label: "A tool of the people overview",
    summary:
      "What a button of the people overview runs: add a person (name, whatsapp, entityId), import from context, find dates for everyone, match names, read new messages (days), place contacts, link Jira accounts, compile summaries (force), take the claims and links the AI is sure of, snooze a nudge (id, days), the verdicts (suggestion, claim, link, dateConfirm, dateDelete), a circle, a todo, a greeting's draft, the settings. What came of it, in words.",
    input: [
      f("tool", "text", { required: true }),
      f("id", "number"),
      f("name", "text"),
      f("whatsapp", "text"),
      f("entityId", "number"),
      f("aliases", "list"),
      f("days", "number"),
      f("force", "boolean"),
      f("accept", "boolean"),
      f("action", "text"),
      f("circle", "text"),
      f("text", "text"),
      f("weeks", "number"),
      f("myName", "text"),
      f("aboutMe", "text"),
    ],
    output: "{ message, draft }",
    writes: true,
    run: async (i, ctx) => {
      const tool = String(i.tool ?? "");
      if (ctx.dryRun) return { message: "", draft: "" };
      const o: Record<string, unknown> = { tool };
      for (const k of ["name", "whatsapp", "action", "circle", "text"]) if (set(i[k])) o[k] = String(i[k]);
      if (Array.isArray(i.aliases) && i.aliases.length) o.aliases = i.aliases.map(String);
      for (const k of ["id", "entityId", "days", "weeks"]) if (set(i[k])) o[k] = num(i[k]);
      // (settings: a line left empty is still a change — only a line not sent stays)
      for (const k of ["myName", "aboutMe"]) if (i[k] !== undefined && i[k] !== null) o[k] = String(i[k]);
      if (tool === "circle") o.circle = String(i.circle ?? "");
      if (tool === "compile" || tool === "classify") o.force = yes(i.force);
      if (tool === "suggestion") o.accept = yes(i.accept);
      const r = await (await import("./tools")).peopleTool(o as never);
      if (tool !== "greeting") await refreshPeopleDatabase();
      return { message: r.message ?? "", draft: r.draft ?? "" };
    },
  },
  {
    name: "people.run-op",
    group: "people",
    label: "An operation on a person's profile",
    summary:
      "What a button of a person's page runs: the profile's lines (name, aliases, emails, whatsapp, jira), the note, the star, a date added, confirmed, removed or its reminder, finding dates, compiling the summary, a claim or link confirmed, rejected, done or checked again, a detail added or removed, a relation added or removed, a merge into another profile, deleting the profile, the knowledge's entries of them made one (knowledgeMerge) or not (knowledgeDismiss). gone: the profile is no more (the page goes to href).",
    input: [
      f("row", "number", { required: true }),
      f("op", "text", { required: true }),
      f("name", "text"),
      f("aliases", "text"),
      f("emails", "text"),
      f("whatsapp", "text"),
      f("jira", "text"),
      f("note", "text"),
      f("on", "boolean"),
      f("kind", "text"),
      f("date", "text"),
      f("label", "text"),
      f("id", "number"),
      f("days", "number"),
      f("what", "text"),
      f("action", "text"),
      f("key", "text"),
      f("value", "text"),
      f("rel", "text"),
      f("other", "number"),
      f("keep", "number"),
    ],
    output: "{ gone, href, message }",
    writes: true,
    run: async (i, ctx) => {
      if (ctx.dryRun) return { gone: false, href: "", message: "" };
      const { personOfRow, personOp } = await import("./blocks");
      const id = personOfRow(num(i.row));
      if (!id) throw new Error("This row is not a person.");
      // The knowledge's entries of them made one, or the proposal dismissed (the person's page, "What the knowledge knows").
      if (i.op === "knowledgeMerge" || i.op === "knowledgeDismiss") {
        const { acceptKnowledgeMerge, knowledgeMergeOf, rejectKnowledgeMerge } = await import("./knowledge-sync");
        if (knowledgeMergeOf(id)?.id !== num(i.id)) throw new Error("This proposal is no longer open.");
        if (i.op === "knowledgeDismiss") rejectKnowledgeMerge(num(i.id));
        else await acceptKnowledgeMerge(num(i.id));
        return { gone: false, href: "", message: "" };
      }
      const o: Record<string, unknown> = { op: String(i.op ?? "") };
      // (a profile line or a note saved empty is still a change: only a line not sent stays)
      for (const k of ["name", "aliases", "emails", "whatsapp", "jira", "note", "label", "value"]) if (i[k] !== undefined && i[k] !== null) o[k] = String(i[k]);
      for (const k of ["kind", "date", "what", "action", "key", "rel"]) if (set(i[k])) o[k] = String(i[k]);
      if (i.on !== undefined) o.on = yes(i.on);
      for (const k of ["id", "days", "other", "keep"]) if (set(i[k])) o[k] = num(i[k]);
      const r = await personOp(id, o as never);
      await refreshPeopleDatabase();
      let href = "";
      if (r.gone) {
        const { peopleDatabase, personHref } = await import("@/plugins/workspace/people-database");
        const db = peopleDatabase();
        href = r.keep ? personHref(r.keep) : db ? `/workspace/${db}` : "/workspace";
      }
      return { gone: !!r.gone, href, message: r.message ?? "" };
    },
  },
  {
    name: "people.widget",
    group: "people",
    label: "What a People widget shows",
    summary: "The data of one of People's widgets by its id (people.list, people.upcoming, people.owed, people.briefs, people.drifting, people.todos, people.overview, people.promises, people.facts, people.funfacts, people.news, people.rhythm, people.coming) for the settings given: a list, figures or one figure, as the widget host draws it.",
    input: [f("id", "text", { required: true }), f("config", "json")],
    output: "the widget's data { kind: list | stats | figure, … }",
    run: async (i) => {
      const w = await widgetOf(String(i.id ?? ""));
      return (await w.data(configOf(i.config))) as unknown as Record<string, unknown>;
    },
  },
  {
    name: "people.widget-act",
    group: "people",
    label: "A button of a People widget",
    summary: "What a button of one of People's widgets does (a date thought of, a promise kept, a todo ticked or dismissed) — by the widget's id, the action, its payload and the widget's settings. The widget's data after it, where the widget gives it.",
    input: [f("id", "text", { required: true }), f("action", "text", { required: true }), f("payload", "json"), f("config", "json")],
    output: "the widget's data after it, or {}",
    writes: true,
    run: async (i, ctx) => {
      if (ctx.dryRun) return {};
      const w = await widgetOf(String(i.id ?? ""));
      if (!w.act) throw new Error("This widget has no buttons.");
      const payload = Object.fromEntries(Object.entries(configOf(i.payload)).map(([k, v]) => [k, String(v)]));
      return ((await w.act(String(i.action ?? ""), payload, configOf(i.config))) ?? {}) as unknown as Record<string, unknown>;
    },
  },
  {
    name: "people.review-list",
    group: "people",
    label: "What People has you confirm",
    summary: "What waits for your word in the review queue from People — source: people-claim (what the AI read), people-link (who is connected to what), people-stale (still true?), people-date (dates found), people-followup (follow up?): [{ id, title, detail?, confidence?, href?, actions: [{ id, label, primary? }] }].",
    input: [f("source", "text", { required: true })],
    output: "{ entries }",
    run: async (i) => {
      const s = await reviewSourceOf(String(i.source ?? ""));
      return { entries: await s.list() };
    },
  },
  {
    name: "people.review-act",
    group: "people",
    label: "A word on what People has you confirm",
    summary: "A button of the review queue's People entries: source (people-claim, people-link, people-stale, people-date, people-followup), item (its id) and action (yes or no) — what came of it, in words.",
    input: [f("source", "text", { required: true }), f("item", "text", { required: true }), f("action", "text", { required: true })],
    output: "{ message }",
    writes: true,
    run: async (i, ctx) => {
      if (ctx.dryRun) return { message: "" };
      const s = await reviewSourceOf(String(i.source ?? ""));
      const message = await s.act(String(i.item ?? ""), String(i.action ?? ""));
      await refreshPeopleDatabase();
      return { message: message ?? "" };
    },
  },
];
