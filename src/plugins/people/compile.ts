import { clip } from "@/lib/text";
import { promptText } from "@/lib/prompts";
import { getSqlite } from "@/db";
import { runAi } from "@/lib/ai";
import { listTodos } from "@/lib/todos/store";
import { errorMessage } from "@/lib/errors";
import { emitChange } from "@/lib/events";
import { isCircle, type Person, type PersonSummary } from "./shared";
import { namesPerson } from "./resolve";
import { contactsOf, datesOf, getPerson, listPeople, namesOf, relationsOf, setCircle, setCompiled, setKind } from "./store";

/**
 * Compile (the People plugin): a summary of each person from everything Zeff has on them — what
 * connects you, the key facts, the fun facts. The AI (the LLM layer) writes it from their messages,
 * mails, Teams, Jira, GitLab, your todos, the facts and relations Zeff keeps; nothing is invented, and
 * someone Zeff knows nothing about isn't asked about. Server only.
 */

import { FRESH_MS, INSTRUCTIONS, SCHEMA, compilePrompt, summaryOf, type CompileAnswer } from "./compile-core";

export { INSTRUCTIONS, type CompileAnswer };
export type CompileDeps = { ask: (prompt: string) => Promise<CompileAnswer> };
export type CompileOne = { state: "compiled" | "nothing-known" | "fresh"; summary?: PersonSummary };
export type CompileAllResult = { compiled: number; skipped: number; failed: string[] };

/** Everything Zeff has on a person, as lines — and how many things that is. */
export function compileEvidence(p: Person): { lines: string[]; count: number } {
  const lines: string[] = [];
  let count = 0;
  const names = namesOf(p).filter((n) => n.length >= 3);
  const d = getSqlite();
  const section = (title: string, rows: string[]) => {
    if (!rows.length) return;
    count += rows.length;
    lines.push("", `## ${title}`, ...rows);
  };

  section(
    "Nachrichten und Mails mit ihr",
    contactsOf(p, 10).map((c) => `- ${c.at.slice(0, 10)} ${c.folder} ${c.who}: ${clip(c.text, 200)}`),
  );
  const like = names.map(() => "(sender_name = ? collate nocase or text like ?)").join(" or ");
  if (names.length) {
    const rows = d.prepare(`select sender_name, place, sent_at, text from teams_messages where ${like} order by sent_at desc limit 10`).all(...names.flatMap((n) => [n, `%${n}%`])) as { sender_name: string | null; place: string | null; sent_at: string; text: string }[];
    section("Teams", rows.map((r) => `- ${r.sent_at.slice(0, 10)} ${r.sender_name ?? "?"}${r.place ? ` in ${r.place}` : ""}: ${clip(r.text, 200)}`));
    const comments = d.prepare(`select ticket, author, at, body from jira_comments where ${names.map(() => "author = ? collate nocase").join(" or ")} order by at desc limit 8`).all(...names) as { ticket: string; author: string; at: string; body: string }[];
    section("Jira-Kommentare von ihr", comments.map((c) => `- ${c.at.slice(0, 10)} ${c.ticket}: ${clip(c.body, 200)}`));
    const git = d.prepare(`select ref, title, created_at from gitlab_items where ${names.map(() => "author = ? collate nocase").join(" or ")} order by created_at desc limit 6`).all(...names) as { ref: string; title: string; created_at: string | null }[];
    section("GitLab von ihr", git.map((g) => `- ${(g.created_at ?? "").slice(0, 10)} ${g.ref} ${clip(g.title, 120)}`));
    const facts = d.prepare(`select subject, text from facts where ${names.map(() => "(subject like ? or text like ?)").join(" or ")} order by id desc limit 8`).all(...names.flatMap((n) => [`%${n}%`, `%${n}%`])) as { subject: string; text: string }[];
    section("Fakten, die Zeff gemerkt hat", facts.map((f) => `- ${f.subject}: ${clip(f.text, 200)}`));
  }
  // Tickets she's on, as the briefing lists everyone: "Name (username)".
  const onTickets = new Map<string, string>();
  for (const run of d.prepare("select tickets from board_runs where status = 'ok' order by id desc limit 6").all() as { tickets: string }[]) {
    try {
      for (const t of JSON.parse(run.tickets) as { key: string; summary?: string; people?: string[] }[]) {
        if ((t.people ?? []).some((x) => names.some((n) => x.toLowerCase().startsWith(`${n.toLowerCase()} (`) || x.toLowerCase() === n.toLowerCase()))) onTickets.set(t.key, t.summary ?? "");
      }
    } catch {
      // not readable
    }
  }
  section("Tickets, auf denen sie steht", [...onTickets].slice(0, 10).map(([k, s]) => `- ${k}${s ? ` · ${clip(s, 100)}` : ""}`));
  section(
    "Meine Todos, die sie nennen",
    listTodos({ status: "all" })
      .filter((t) => namesPerson(p.id, `${t.text} ${t.note ?? ""}`))
      .slice(-10)
      .map((t) => `- ${t.ref}${t.ticket ? ` ${t.ticket}` : ""} (${t.status}): ${clip(t.text, 200)}`),
  );
  const rel = relationsOf(p.id);
  section("Beziehungen", [...rel.out.map((r) => `- ${r.rel}${r.otherName ? ` von ${r.otherName}` : ""}`), ...rel.in.map((r) => `- ${r.personName}: ${r.rel}`)]);
  section(
    "Daten",
    datesOf(p.id)
      .filter((x) => x.confirmed)
      .map((x) => `- ${x.kind === "other" ? x.label || "Datum" : x.kind === "birthday" ? "Geburtstag" : "Jahrestag"}: ${x.day}.${x.month}.${x.year ?? ""}`),
  );
  return { lines, count };
}

const realDeps = (): CompileDeps => ({
  ask: async (prompt) => (await runAi<CompileAnswer>(prompt, SCHEMA, { task: "people-compile", timeoutMs: 5 * 60000, maxBudgetUsd: 0.5 })).output,
});

/**
 * What a summary of this person is made from: the prompt (the instructions and what Zeff has on them), or why none: nothing known about them (nothing-known), one
 * compiled lately (fresh, unless `force`). `instructions`: yours (System → Prompts) or the built-in ones.
 */
export async function compileInput(id: number, opts: { force?: boolean; instructions?: string } = {}): Promise<{ state: "fresh" | "nothing-known" | "ready"; summary?: PersonSummary; prompt?: string; count?: number }> {
  const p = getPerson(id);
  if (!p) throw new Error("Unknown person.");
  if (!opts.force && p.compiled && Date.now() - Date.parse(p.compiled.at) < FRESH_MS) return { state: "fresh", summary: p.compiled };
  const { lines, count } = compileEvidence(p);
  if (!count) return { state: "nothing-known" };
  const { myJiraName } = await import("@/lib/jira/store");
  const me = myJiraName();
  const account = p.accounts.find((a) => a.kind === "jira")?.value;
  // Older and less obvious hits for their name (the full-text index), beyond the latest ones above.
  let more = "";
  try {
    const { retrieve } = await import("@/lib/rag");
    const found = await retrieve([{ query: namesOf(p).filter((n) => n.length >= 3).slice(0, 2).join(" "), where: ["mails", "teams"] }], { perSource: 6, maxChars: 2500 });
    more = found.hits.filter((h) => !lines.some((l) => l.includes(h.text.slice(0, 40)))).map((h) => `- ${h.when ?? ""} ${h.title}: ${h.text}`).join("\n");
  } catch {
    // no search then
  }
  const header = `Name: ${p.name}${p.aliases.length ? ` — auch: ${p.aliases.join(", ")}` : ""}${account ? ` — Jira: ${account}` : ""}${p.emails.length ? ` — Mail: ${p.emails.join(", ")}` : ""}${p.whatsapp ? ` — Chat: ${p.whatsapp}` : ""}`;
  return { state: "ready", count, prompt: compilePrompt({ instructions: opts.instructions ?? promptText("people-compile", INSTRUCTIONS), me, header, note: p.note, lines, more }) };
}

/** A summary kept on the profile (and their circle and kind, as the AI read them — what you chose stays). */
export function keepCompiled(id: number, a: CompileAnswer | null | undefined, count: number): PersonSummary {
  const summary = summaryOf(a, count, new Date().toISOString());
  setCompiled(id, summary);
  if (a?.circle && isCircle(a.circle)) setCircle(id, a.circle, "ai");
  if (a?.kind === "person" || a?.kind === "organization") setKind(id, a.kind, "ai");
  return summary;
}

/**
 * Compile one person's summary: what Zeff has on them goes to the AI, its answer is kept on the
 * profile. Someone Zeff knows nothing about isn't compiled (nothing-known); one compiled lately is left
 * (fresh) unless `force`. Throws when the AI fails — what was there stays.
 */
export async function compilePerson(id: number, opts: { ask?: CompileDeps["ask"]; force?: boolean } = {}): Promise<CompileOne> {
  const r = await compileInput(id, { force: opts.force });
  if (r.state !== "ready") return r.state === "fresh" ? { state: "fresh", summary: r.summary } : { state: "nothing-known" };
  const ask = opts.ask ?? realDeps().ask;
  return { state: "compiled", summary: keepCompiled(id, await ask(r.prompt!), r.count!) };
}

/** Compile everyone (or `ids`) one after the other: those that need it. A failing one is reported, the rest go on. */
export async function compileAll(opts: { ask?: CompileDeps["ask"]; force?: boolean; ids?: number[]; onProgress?: (done: number, total: number, name: string) => void } = {}): Promise<CompileAllResult> {
  const people = listPeople().filter((p) => !opts.ids || opts.ids.includes(p.id));
  const out: CompileAllResult = { compiled: 0, skipped: 0, failed: [] };
  let done = 0;
  for (const p of people) {
    opts.onProgress?.(done, people.length, p.name);
    try {
      const r = await compilePerson(p.id, { ask: opts.ask, force: opts.force });
      if (r.state === "compiled") out.compiled++;
      else out.skipped++;
    } catch (e) {
      out.failed.push(`${p.name}: ${errorMessage(e).slice(0, 200)}`);
    }
    done++;
  }
  opts.onProgress?.(done, people.length, "");
  return out;
}

const state = globalThis as { __zeffPeopleCompile?: { done: number; total: number; current: string; result?: CompileAllResult } | null };

/** Where the compile run in the background is (null: none). */
export const compileProgress = () => state.__zeffPeopleCompile ?? null;

/** Start compiling in the background (one run at a time) — the page follows it. */
export function startCompile(opts: { force?: boolean; ids?: number[] } = {}): boolean {
  if (state.__zeffPeopleCompile && !state.__zeffPeopleCompile.result) return false;
  const progress: NonNullable<typeof state.__zeffPeopleCompile> = { done: 0, total: 0, current: "" };
  state.__zeffPeopleCompile = progress;
  void compileAll({
    ...opts,
    onProgress: (done, total, name) => {
      progress.done = done;
      progress.total = total;
      progress.current = name;
      emitChange("todos");
    },
  })
    .then((r) => {
      progress.result = r;
    })
    .catch((e) => {
      progress.result = { compiled: 0, skipped: 0, failed: [errorMessage(e)] };
    })
    .finally(() => emitChange("todos"));
  return true;
}

