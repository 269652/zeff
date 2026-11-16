/**
 * The Dokument-Zuordnung's prompt and what it asks for — pure text and shapes, no Zeff code: the instructions (a page of System → Prompts), the shape of the
 * answer, the words a todo and a document share, the few documents likeliest to be about a todo, the block of a todo for the prompt. Kept apart so the
 * Documents plugin's port bundles it (scripts/port-documents.mts). Client-safe.
 */
import { plain } from "@/lib/plain-text";

export const PER_TODO = 6;
/** What the prompt leaves room for besides the blocks (the built-in's batch size is the Copilot limit less this). */
export const RELATE_RESERVE = 4000;

export const RELATE_SCHEMA = {
  type: "object",
  properties: {
    todos: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, docs: { type: "array", items: { type: "string" } } }, required: ["id", "docs"] } },
  },
  required: ["todos"],
};

export const RELATE_INSTRUCTIONS = `Du ordnest Dokumente meinen offenen Todos zu. Unten steht je Todo (Nummer in eckigen Klammern) eine Auswahl meiner abgelegten Dokumente (Kennung in eckigen Klammern, z. B. [doc:12], dann Name, Art, Kurzfassung und der Textanfang).

Gib für JEDES Todo die Kennungen der Dokumente an, die für genau dieses Todo relevant sind: aus denen es folgt, die etwas dazu festhalten (Verträge, Rechnungen, Absprachen, Berichte, Fristen, Zahlen) oder die man kennen muss, um es zu erledigen (bis zu 4). Nach Inhalt, nicht nach einzelnen gleichen Wörtern. Passt keines, ist die Liste leer.`;

const STOP = new Set("aber alle allem also auch dann dass dein deine denn diese dieser dies doch durch eine einem einen einer eines etwas für habe haben hast hier ihre ihren immer jetzt kann kein keine machen mehr mein meine mich mit nach nicht noch oder sehr sich sind soll über und uns unter vom von wann warum was weil wenn werden wie wird wieder will wir zum zur zwischen bitte danke from that this with have your will".split(" "));
export const words = (text: string) => new Set((text.toLowerCase().match(/[a-zäöüß0-9]{4,}/g) ?? []).filter((w) => !STOP.has(w)));


export type RelatableDoc = { id: number; ref: string; name: string; kind: string; createdAt: string; abstract: string; concepts: string; text: string };
export type RelatableTodo = { id: number; text: string; ticket: string; note?: string | null };

/** The words of a document the matching looks at: its name, abstract, concepts and the beginning of its text. */
export const docWords = (d: RelatableDoc): Set<string> => words(`${d.name} ${d.abstract} ${d.concepts} ${d.text.slice(0, 4000)}`);

/** The documents likeliest to be about a todo: most shared words (at least two), the best few. `ticketSummary`: what its ticket is called. */
export function candidates(todo: RelatableTodo, ticketSummary: string, docs: { d: RelatableDoc; w: Set<string> }[]): RelatableDoc[] {
  const tw = words(`${todo.text} ${ticketSummary} ${todo.note ?? ""}`);
  if (!tw.size) return [];
  return docs
    .map(({ d, w }) => ({ d, score: [...tw].filter((x) => w.has(x)).length }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || b.d.createdAt.localeCompare(a.d.createdAt))
    .slice(0, PER_TODO)
    .map((x) => x.d);
}

const docLine = (d: RelatableDoc) => `  - [${d.ref}] „${plain(d.name, 120)}“ (${d.kind})${d.abstract ? ` — ${plain(d.abstract, 400)}` : ""}\n    ${plain(d.text, 500)}`;
/** A todo with its candidates, for the prompt. */
export const relateBlock = (todo: RelatableTodo, list: RelatableDoc[]): string => [`## [${todo.id}] ${plain(todo.text, 300)}${todo.ticket ? ` (${todo.ticket})` : ""}`, ...list.map(docLine)].join("\n");

/** The documents an answer picked for a todo: only its candidates, at most four. */
export function pickedRefs(said: string[] | undefined, list: RelatableDoc[]): string[] {
  const known = new Set(list.map((d) => d.ref));
  return (said ?? []).map((r) => String(r).trim().replace(/^\[|\]$/g, "")).map((r) => (r.startsWith("doc:") ? r : `doc:${r}`)).filter((r) => known.has(r)).slice(0, 4);
}
