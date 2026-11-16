/**
 * Extraction (the People plugin): what new messages say about people — roles, who owns what, preferences,
 * commitments, who reports to whom — read continuously, not only when you press Compile. After each
 * briefing the messages that came in since the last run (mail, chats, Teams, Jira comments) that name or
 * come from someone you keep a profile of go to the AI, which answers with claims and links, each with a
 * quote, a source and how sure it is. They land as proposals; your reviews teach the next run (what you
 * rejected is told to the AI, what is known already isn't asked again). Server only.
 */
import { getSqlite } from "@/db";
import { promptText } from "@/lib/prompts";
import { isInstalled } from "@/plugins/state";
import { runAi } from "@/lib/ai";
import { errorMessage } from "@/lib/errors";
import { askWithRetrieval, withRagInstructions } from "@/lib/rag";
import { addClaim, addLink, claimsOf, deriveLinks, rejectedExamples } from "./graph";
import { INSTRUCTIONS, MAX_BATCHES, PER_BATCH, SCHEMA, extractBatch, withLoopsAddendum, type Answer, type ExtractItem, type ExtractProfile, type Item } from "./extract-core";

export * from "./extract-core";
import { buildPeopleIndex, mentionMatcher, splitMentions } from "./mentions";
import { getPerson, listPeople, namesOf } from "./store";
import type { Person } from "./shared";
import { flatSlice } from "@/lib/text";

const FIRST_RUN_DAYS = 14;
function stateDb() {
  const d = getSqlite();
  d.exec("create table if not exists people_extract_state (source text primary key, mark text not null)");
  return d;
}
const markOfSaved = (source: string, fallback: string): string => (stateDb().prepare("select mark from people_extract_state where source = ?").get(source) as { mark: string } | undefined)?.mark ?? fallback;
const setMark = (source: string, mark: string) => stateDb().prepare("insert into people_extract_state (source, mark) values (?, ?) on conflict(source) do update set mark = excluded.mark").run(source, mark);

const flag = globalThis as { __zeffPeopleExtract?: boolean };

/** How much of a letter is read: its summary and the start of its text, where the sender's details stand (account, file number). */
const DOC_CHARS = 1800;

/**
 * Messages since the marks of each source, in time order, with the people they concern; others are skipped.
 * `only`: just what concerns these profiles (a new one read back for), the people of an item narrowed to them.
 */
export function newItems(people: Person[], sinceDays?: number, only?: number[]): { items: Item[]; marks: Record<string, string> } {
  const d = getSqlite();
  const first = new Date(Date.now() - (sinceDays ?? FIRST_RUN_DAYS) * 864e5).toISOString();
  // A look back asked for reads from there, whatever was read before; else from where the last run stopped.
  const markOf = (source: string) => (sinceDays ? first : markOfSaved(source, first));
  const matcher = mentionMatcher(buildPeopleIndex(people));
  const chatOwner = new Map<string, number>();
  for (const p of people) for (const n of [p.whatsapp, p.name, ...p.aliases].filter(Boolean)) chatOwner.set(n.toLowerCase(), p.id);
  const bySender = new Map<string, number>();
  for (const p of people) for (const n of [...namesOf(p), ...p.emails]) bySender.set(n.toLowerCase(), p.id);
  const addresses = people.flatMap((p) => p.emails.map((e) => [e.toLowerCase(), p.id] as const));
  const concern = (text: string, ...senders: (string | null | undefined)[]): number[] => {
    const ids = new Set<number>();
    for (const m of splitMentions(text, matcher)) if (m.person) ids.add(m.person.id);
    // Their address in the text (a letter's letterhead).
    const lower = text.toLowerCase();
    for (const [e, id] of addresses) if (lower.includes(e)) ids.add(id);
    for (const s of senders) {
      const id = bySender.get((s ?? "").toLowerCase());
      if (id) ids.add(id);
    }
    return only ? [...ids].filter((id) => only.includes(id)) : [...ids];
  };
  // Reading back for one profile goes further: the messages are many, the ones about them few.
  const limit = only ? 4000 : 400;
  const items: Item[] = [];
  const marks: Record<string, string> = {};
  const all = <T>(sql: string, ...args: unknown[]): T[] => {
    try {
      return d.prepare(sql).all(...args) as T[];
    } catch {
      return [];
    }
  };
  const take = (source: string, rows: { at: string }[]) => {
    for (const r of rows) if (r.at > (marks[source] ?? "")) marks[source] = r.at;
  };
  const mailMark = markOf("mail");
  const mails = all<{ key: string; conv_id: string; folder: string; from_name: string | null; from_email: string | null; subject: string; preview: string; at: string }>(`select key, conv_id, folder, from_name, from_email, subject, preview, received_at at from emails where received_at > ? order by received_at limit ${limit}`, mailMark);
  take("mail", mails);
  for (const m of mails) {
    const chat = /^(wa|sg):/.test(m.conv_id) ? m.conv_id.slice(3).toLowerCase() : "";
    const ids = new Set(concern(`${m.subject} ${m.preview}`, m.from_name, m.from_email));
    const owner = chat ? chatOwner.get(chat) : undefined;
    if (owner && (!only || only.includes(owner))) ids.add(owner);
    const text = chat ? m.preview : `${m.subject} — ${m.preview}`;
    if (ids.size && text.trim().length >= 25) items.push({ id: "", ref: `mail:${m.key}`, at: m.at, where: chat ? `${m.folder}-Chat „${chat}“` : "Mail", who: m.from_name === "Ich" ? "ich" : (m.from_name ?? "?"), text, people: [...ids] });
  }
  const teamsMark = markOf("teams");
  const teams = all<{ key: string; sender_name: string | null; place: string | null; at: string; text: string }>(`select key, sender_name, place, sent_at at, text from teams_messages where sent_at > ? order by sent_at limit ${limit}`, teamsMark);
  take("teams", teams);
  for (const m of teams) {
    const ids = concern(m.text, m.sender_name);
    if (ids.length && m.text.trim().length >= 25) items.push({ id: "", ref: `teams:${m.key}`, at: m.at, where: `Teams${m.place ? ` · ${m.place}` : ""}`, who: m.sender_name ?? "?", text: m.text, people: ids });
  }
  const jiraMark = markOf("jira");
  const comments = all<{ id: string; ticket: string; author: string; at: string; body: string }>(`select id, ticket, author, at, body from jira_comments where at > ? order by at limit ${limit}`, jiraMark);
  take("jira", comments);
  for (const c of comments) {
    const ids = concern(c.body, c.author);
    if (ids.length && c.body.trim().length >= 25) items.push({ id: "", ref: `jira-comment:${c.id}`, at: c.at, where: `Jira ${c.ticket}`, who: c.author, text: c.body, people: ids });
  }
  // Letters and other documents: who wrote them and what they say about them (bank account, file numbers, absence).
  const docMark = markOf("doc");
  const docs = all<{ id: number; name: string; summary: string; text: string; at: string }>(`select id, name, summary, text, created_at at from documents where status = 'ready' and created_at > ? order by created_at limit ${limit}`, docMark);
  take("doc", docs);
  for (const doc of docs) {
    const text = `${doc.summary}
${doc.text}`.slice(0, DOC_CHARS * 2);
    const ids = concern(text);
    if (ids.length && text.trim().length >= 25) items.push({ id: "", ref: `doc:${doc.id}`, at: doc.at, where: `Dokument „${doc.name}“`, who: "?", text, people: ids, max: DOC_CHARS });
  }
  items.sort((a, b) => a.at.localeCompare(b.at));
  return { items, marks };
}


/** The extraction's instructions: yours (System → Prompts) or the built-in ones, and the open-loops addendum while that plugin is on. */
export function extractInstructions(): string {
  const base = promptText("people-extract", INSTRUCTIONS);
  return isInstalled("loops") ? withLoopsAddendum(base) : base;
}

export type ExtractResult ={ ok: boolean; items: number; claims: number; links: number; derived: number; error?: string };
export type ExtractDeps = { ask: (prompt: string, schema: object) => Promise<Answer> };

const realAsk = (): ExtractDeps["ask"] => async (prompt, schema) => (await runAi<Answer>(prompt, schema, { task: "people-extract", timeoutMs: 6 * 60000, maxBudgetUsd: 0.5 })).output ?? {};

/**
 * Read what came in since last time. `derived`: links read off the sources by rule (no AI). With no new
 * messages about anyone, or without an AI, only that is done. The marks move only once a batch was
 * answered — a failed run reads the same messages again.
 */
export async function extractKnowledge(opts: { ask?: ExtractDeps["ask"]; sinceDays?: number; only?: number[]; retrieve?: (needs: { query: string; where?: string[] }[]) => Promise<{ text: string }> } = {}): Promise<ExtractResult> {
  if (flag.__zeffPeopleExtract) return { ok: false, items: 0, claims: 0, links: 0, derived: 0, error: "already running" };
  flag.__zeffPeopleExtract = true;
  const out: ExtractResult = { ok: true, items: 0, claims: 0, links: 0, derived: 0 };
  try {
    out.derived = deriveLinks();
    const people = listPeople();
    if (!people.length) return out;
    const { items, marks } = newItems(people, opts.sinceDays, opts.only);
    // A read back for some profiles leaves the marks where the regular runs are.
    const moveMarks = !opts.only;
    if (!items.length) {
      if (moveMarks) for (const [k, v] of Object.entries(marks)) setMark(k, v);
      return out;
    }
    const ask = opts.ask ?? realAsk();
    const rejected = rejectedExamples();
    const batches: Item[][] = [];
    for (let i = 0; i < items.length && batches.length < MAX_BATCHES; i += PER_BATCH) batches.push(items.slice(i, i + PER_BATCH));
    let upTo = "";
    for (const batch of batches) {
      batch.forEach((it, i) => (it.id = `m${i + 1}`));
      const involved = [...new Set(batch.flatMap((i) => i.people))].map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p);
      const profiles = involved.map((p) => ({ id: p.id, name: p.name, aliases: p.aliases, known: claimsOf(p.id, { status: ["proposed", "confirmed"] }).slice(0, 6).map((x) => x.text) }));
      // Every pair of a message and a person judged; the ones left open asked about again (extractBatch).
      const found = await extractBatch({
        ask: (prompt, schema) => askWithRetrieval<Answer>({ prompt: withRagInstructions(prompt), schema, ask: (p, s) => ask(p, s), retrieve: opts.retrieve, rounds: 2 }),
        instructions: extractInstructions(),
        profiles,
        rejected,
        items: batch,
        allowed: new Set(involved.map((p) => p.id)),
        personExists: (id) => !!getPerson(id),
      });
      if (found.open.length) console.warn(`[people] extraction: ${found.open.length} pair(s) still without a verdict after the follow-up`);
      for (const c of found.claims) if (addClaim(c)) out.claims++;
      for (const l of found.links) if (addLink(l)) out.links++;
      out.items += batch.length;
      upTo = batch[batch.length - 1].at;
    }
    // Marks move to where the batches got to (all of it, when every message was read).
    const all = out.items >= items.length;
    if (moveMarks) for (const [k, v] of Object.entries(marks)) setMark(k, all ? v : v < upTo ? v : upTo);
    return out;
  } catch (e) {
    return { ...out, ok: false, error: errorMessage(e) };
  } finally {
    flag.__zeffPeopleExtract = false;
  }
}

/**
 * What the AI is asked in the extraction, for the port's lambda to ask (it only reads): the messages since the marks (in time order, with the people they concern), the
 * profiles of those a run reads (what is known of each already), what you rejected, every profile's id (a link to a person must exist) — and whether the marks move
 * after a run (a read back for some profiles leaves them where the regular runs are).
 */
export function extractInput(opts: { sinceDays?: number; only?: number[] } = {}): { items: ExtractItem[]; marks: Record<string, string>; profiles: ExtractProfile[]; rejected: { claims: string[]; links: string[] }; personIds: number[]; moveMarks: boolean } {
  const people = listPeople();
  const moveMarks = !opts.only;
  if (!people.length) return { items: [], marks: {}, profiles: [], rejected: { claims: [], links: [] }, personIds: [], moveMarks };
  const { items, marks } = newItems(people, opts.sinceDays, opts.only);
  const read = new Set(items.slice(0, PER_BATCH * MAX_BATCHES).flatMap((i) => i.people));
  const profiles = people.filter((p) => read.has(p.id)).map((p) => ({ id: p.id, name: p.name, aliases: p.aliases, known: claimsOf(p.id, { status: ["proposed", "confirmed"] }).slice(0, 6).map((x) => x.text) }));
  return { items, marks, profiles, rejected: rejectedExamples(), personIds: people.map((p) => p.id), moveMarks };
}

/** What a run read, kept: the claims and links that hold (as proposals) and the marks where each source got to. How many are new. */
export function saveExtracted(v: { claims?: Parameters<typeof addClaim>[0][]; links?: Parameters<typeof addLink>[0][]; marks?: Record<string, string> }): { claims: number; links: number } {
  let claims = 0;
  let links = 0;
  for (const c of v.claims ?? []) if (addClaim(c)) claims++;
  for (const l of v.links ?? []) if (addLink(l)) links++;
  for (const [k, m] of Object.entries(v.marks ?? {})) setMark(k, m);
  return { claims, links };
}
