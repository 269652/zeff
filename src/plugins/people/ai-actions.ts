import type { FlowAction } from "../workspace/flows/actions";
import type { FieldSpec } from "../workspace/flows/types";

/**
 * What the People port's AI steps read and write through the kernel (the people model — contacts, claims, links, details, circles — stays Zeff's, the shared
 * graph every app reads; the steps themselves are the port's lambdas and flows): the new messages that name someone, what Zeff has on a person, the contacts
 * to place, the names to match — and the keeping of what the AI found. Nothing here knows the port: the built-in's own steps use the same functions. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const nums = (v: unknown, max = 5000): number[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, max);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const yes = (v: unknown): boolean => v === true || v === "true";

export const AI_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "people.extract-input",
    group: "people",
    label: "New messages that name someone",
    summary: "What came in since the last read (mail, chats, Teams, Jira comments, letters) that names or comes from someone you keep a profile of — the messages (ref, at, where, who, text, people), the marks each source got to, the profiles read (id, name, aliases, what is known of them) and what you rejected. sinceDays: look back that far instead; only: just these profiles (the marks then stay).",
    input: [f("sinceDays", "number"), f("only", "list")],
    output: "{ items, marks, profiles, rejected, personIds, moveMarks }",
    run: async (i) => {
      const { extractInput } = await import("./extract");
      const only = nums(i.only);
      return extractInput({ sinceDays: Number(i.sinceDays) > 0 ? Number(i.sinceDays) : undefined, only: only.length ? only : undefined });
    },
  },
  {
    name: "people.derive-links",
    group: "people",
    label: "Links read off the sources by rule",
    summary: "The links between people and tickets, repos and the like that the sources show, kept by rule (no AI). How many.",
    input: [],
    output: "{ derived }",
    writes: true,
    run: async () => ({ derived: (await import("./graph")).deriveLinks() }),
  },
  {
    name: "people.extract-save",
    group: "people",
    label: "What the AI read about people, kept",
    summary: "The claims and links an extraction found, kept as proposals for you to confirm (each with its quote, source and how sure it is), and the marks where each source got to. How many are new.",
    input: [f("claims", "json"), f("links", "json"), f("marks", "json")],
    output: "{ claims, links }",
    writes: true,
    run: async (i) => {
      const { saveExtracted } = await import("./extract");
      return saveExtracted({ claims: (Array.isArray(i.claims) ? i.claims : []) as never[], links: (Array.isArray(i.links) ? i.links : []) as never[], marks: obj(i.marks) as Record<string, string> });
    },
  },
  {
    name: "people.compile-input",
    group: "people",
    label: "What Zeff has on a person",
    summary: "The prompt for a person's summary — their messages, mails, Teams, Jira, GitLab, facts, todos, relations, dates — or why none: state fresh (compiled lately, unless force) or nothing-known.",
    input: [f("id", "number", { required: true }), f("force", "boolean"), f("instructions", "text")],
    output: "{ state, summary, prompt, count }",
    run: async (i) => (await import("./compile")).compileInput(Number(i.id), { force: yes(i.force), instructions: String(i.instructions ?? "") || undefined }),
  },
  {
    name: "people.compile-save",
    group: "people",
    label: "A person's summary, kept",
    summary: "The AI's summary of a person kept on their profile (what connects you, key facts, fun facts) — and the circle and kind it read for them (what you chose stays).",
    input: [f("id", "number", { required: true }), f("answer", "json", { required: true }), f("count", "number")],
    output: "{ summary }",
    writes: true,
    run: async (i) => ({ summary: (await import("./compile")).keepCompiled(Number(i.id), obj(i.answer), Number(i.count) || 0) }),
  },
  {
    name: "people.stale",
    group: "people",
    label: "The people whose summary is out of date",
    summary: "The contacts whose summary is missing or out of date after the briefing (the ones in touch lately first).",
    input: [],
    output: "{ ids }",
    run: async () => {
      const { staleForCompile, lastContactsAll } = await import("./pulse");
      const { listPeople } = await import("./store");
      const now = new Date();
      return { ids: staleForCompile(now, await lastContactsAll(listPeople(), now)) };
    },
  },
  {
    name: "people.classify-input",
    group: "people",
    label: "The contacts to place",
    summary: "The contacts not placed yet (a person or an organisation, their circle) — force: all, ids: these — in batches, each with what Zeff knows of them; and your name.",
    input: [f("ids", "list"), f("force", "boolean")],
    output: "{ batches: [{ ids, blocks }], asked, myName }",
    run: async (i) => {
      const { classifyInput } = await import("./classify");
      const { myName } = await import("./pulse");
      const ids = nums(i.ids);
      return { ...classifyInput({ ids: ids.length ? ids : undefined, force: yes(i.force) }), myName: myName() || null };
    },
  },
  {
    name: "people.classify-save",
    group: "people",
    label: "What the AI placed, kept",
    summary: "The kind (person, organisation) and circle the AI gave a batch of contacts, kept — what you chose stays. How many changed.",
    input: [f("ids", "list", { required: true }), f("answer", "json", { required: true })],
    output: "{ changed }",
    writes: true,
    run: async (i) => ({ changed: (await import("./classify")).applyClassified(nums(i.ids), obj(i.answer) as never) }),
  },
  {
    name: "people.maintain",
    group: "people",
    label: "People kept up by rule",
    summary: "What the names matching does without an AI: Jira accounts tied to profiles, the names the sources write queued for review, the entities, Zeff's facts on the profiles, their details.",
    input: [],
    output: "{ ok }",
    writes: true,
    run: async () => {
      await (await import("./normalize")).maintainPeople();
      return { ok: true };
    },
  },
  {
    name: "people.normalize-input",
    group: "people",
    label: "The names to match",
    summary: "What the AI is asked to match names with: your profiles, your contacts (chats, mail senders) and your todos, as lines — and the chats and addresses an answer may name. empty: no todos, nothing to do.",
    input: [],
    output: "{ empty, profiles, contacts, todos, chatNames, addresses }",
    run: async () => {
      const r = (await import("./normalize")).normalizeInput();
      return r ?? { empty: true, profiles: [], contacts: [], todos: [], chatNames: [], addresses: [] };
    },
  },
  {
    name: "people.normalize-apply",
    group: "people",
    label: "Matched names, kept",
    summary: "What the AI matched: duplicates merged, aliases added (only where they name no one else), profiles for contacts (ten at most), relations with their evidence. How many of each.",
    input: [f("answer", "json", { required: true }), f("chatNames", "list"), f("addresses", "list")],
    output: "{ aliases, created, merged, relations }",
    writes: true,
    run: async (i) => (await import("./normalize")).applyNormalized(obj(i.answer) as never, { chatNames: (Array.isArray(i.chatNames) ? i.chatNames : []).map(String), addresses: (Array.isArray(i.addresses) ? i.addresses : []).map(String) }),
  },
  {
    name: "people.after-extraction",
    group: "people",
    label: "After the promises were read",
    summary: "The promises kept since — closed by their threads, or proposed closed by the AI — by whoever keeps the open loops (a failure there is logged, not raised).",
    input: [],
    output: "{ ok }",
    writes: true,
    run: async () => {
      await (await import("./normalize")).afterExtraction().catch((e) => console.error("[people] after the extraction:", e));
      return { ok: true };
    },
  },
  {
    name: "people.after-briefing",
    group: "people",
    label: "Dates and the briefs before meetings",
    summary: "After the briefing: the dates the facts or the knowledge know go in by themselves, and the few points before the meetings of the next hours are made (by whoever keeps What you should know). Failures are logged, not raised.",
    input: [],
    output: "{ ok }",
    writes: true,
    run: async () => {
      await (await import("./dates")).datesAfterBriefing().catch((e) => console.error("[people] dates after the briefing:", e));
      const { onlyThroughPort } = await import("@/plugins/state");
      if (onlyThroughPort("know")) await (await import("@/lib/cases/there")).casesPortFlows(["know.prepare"]);
      else await (await import("@/plugins/know/summary")).prepareMeetingBriefs().catch((e) => console.error("[know] before meetings:", e));
      return { ok: true };
    },
  },
  {
    name: "rag.retrieve",
    group: "data",
    label: "Look something up in what Zeff keeps",
    summary: "What an AI step asked for when it missed context: search words (query), in all the sources Zeff keeps — knowledge, mails, Teams, GitLab, Jira, notes, facts, todos, documents, pages, people — or only in some (where). Gives the finds as text.",
    input: [f("needs", "json", { required: true })],
    output: "{ text }",
    run: async (i) => {
      const { retrieve } = await import("@/lib/rag");
      const needs = (Array.isArray(i.needs) ? i.needs : []).slice(0, 6) as { query: string; where?: string[] }[];
      return { text: (await retrieve(needs)).text };
    },
  },
];
