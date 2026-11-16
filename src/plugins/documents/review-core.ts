/**
 * The Dokument-Durchsicht's prompt and what it asks for — pure text and shapes, no Zeff code: the instructions (a page of System → Prompts), the shape of the
 * answer, the part of a document the AI reads, the batch as the AI sees it, and the todos an answer is cleaned to. Kept apart so the Documents plugin's port
 * bundles it (scripts/port-documents.mts). Client-safe.
 */
import { plain } from "@/lib/plain-text";
import { TODO_KINDS } from "@/lib/todos/kinds";

/** How much of a document the AI reads: its beginning and — where reports and letters put what's asked — its end. */
export const HEAD = 4500;
export const TAIL = 3000;
/** What the prompt leaves room for besides the documents (the built-in's batch size is the Copilot limit less this). */
export const REVIEW_RESERVE = 6000;

export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    todos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          kind: { type: "string", enum: [...TODO_KINDS] },
          owner: { type: "string", enum: ["me", "other"] },
          ticket: { type: "string" },
          due: { type: "string", description: "Frist als JJJJ-MM-TT, wenn das Dokument eine nennt — sonst weglassen." },
          refs: { type: "array", items: { type: "string" } },
          repeat: { type: "string", enum: ["daily", "weekly", "monthly", "yearly"], description: "Nur wenn die Aufgabe regelmäßig wiederkehrt (z. B. eine Rate jeden Monat am 15.) — sonst weglassen." },
          repeatFrom: { type: "string", description: "Der erste Tag der Wiederholungen (JJJJ-MM-TT), wenn er nicht die Frist (due) ist — z. B. heute fällig und danach jeden 15., ab 15.11." },
          repeatUntil: { type: "string", description: "Der letzte Tag der Wiederholungen (JJJJ-MM-TT), wenn das Dokument ein Ende nennt." },
        },
        required: ["text", "refs"],
      },
    },
  },
  required: ["todos"],
};
export type Answer = { todos?: { text?: string; kind?: string; owner?: string; ticket?: string; due?: string; refs?: string[]; repeat?: string; repeatFrom?: string; repeatUntil?: string }[] };

export const REVIEW_INSTRUCTIONS = `Du gehst meine abgelegten Dokumente durch (Briefe, Rechnungen, Verträge, Berichte, Protokolle, Formulare, Notizen, Scans) und findest, was ICH zu tun habe. Unten stehen die Dokumente (Kennung in eckigen Klammern, z. B. [doc:12], dann Name, Art, Ablagedatum, Kurzfassung und Text — bei langen Dokumenten Anfang und Ende), meine Tickets und die Todos, die schon offen sind.

Lege für jede Aufgabe, die ein Dokument an mich stellt, ein Todo an: ein Satz, Verb zuerst, prüfbar, mit Frist, wenn das Dokument eine nennt (die Frist auch als Datum unter due, JJJJ-MM-TT) — z. B. „Rechnung 4711 über 186,83 € bis 16.10. bezahlen“, „Mietvertrag bis zum 3. Werktag kündigen, falls nicht verlängert werden soll“, „Offene Frage zur Spalte ‚Anmerkung‘ im Migrationsbericht klären“, „Formular unterschreiben und zurücksenden“. Kehrt eine Aufgabe regelmäßig wieder (eine Rate jeden Monat am 15., eine Gebühr jedes Jahr), ist es EIN Todo mit repeat (daily, weekly, monthly, yearly): unter due die Frist der ersten Fälligkeit (auch wenn sie eine einmalige ist — „heute 300 € überweisen, danach jeden 15.“), unter repeatFrom der erste Tag der Wiederholungen, wenn er ein anderer ist (15.11.), unter repeatUntil der letzte Tag, wenn das Dokument ein Ende nennt — die folgenden legt Zeff selbst an. Gehören mehrere Punkte zusammen, ist es EIN Todo — auch die Schritte desselben Vorgangs (erst einen Termin vereinbaren, dann den Ausweis abholen; erst das Formular ausfüllen, dann einreichen): das Ziel als Text, die Schritte darin, die Frist die des Ziels („Personalausweis vor dem 20.01. abholen — vorher den Abholtermin vereinbaren“). Verschiedene Aufgaben desselben Absenders (eine Rechnung bezahlen UND ein Formular zurücksenden) bleiben getrennte Todos. Zu jedem Todo unter refs die Kennungen der Dokumente, aus denen es folgt. Gehört es zu einem meiner Tickets, gib dessen Schlüssel unter ticket an, sonst lass ticket leer. owner = other nur, wenn ich auf jemand anderen warte (eine Antwort, eine Lieferung).

KEINE Todos für: reine Information und Nachschlagewerke, Berichte über Vergangenes ohne offene Punkte oder Fragen, Werbung, Zugangsdaten, Erledigtes (schon bezahlt, schon abgegeben, laut Dokument abgeschlossen) — und nichts, was ein schon offenes Todo abdeckt. Ein Dokument ohne Aufgabe ergibt kein Todo; gibt es insgesamt nichts zu tun, ist die Liste leer.`;


/** A document as the review reads it: what the store holds of it. */
export type ReadableDoc = { id: number; ref: string; name: string; kind: string; createdAt: string; version: string; abstract: string; concepts: string; text: string };

/** The part of a document's text the AI reads. */
export function excerpt(text: string): string {
  const s = text.trim();
  return s.length <= HEAD + TAIL + 200 ? s : `${s.slice(0, HEAD)}\n[… ${s.length - HEAD - TAIL} Zeichen ausgelassen …]\n${s.slice(-TAIL)}`;
}

/** A document for the prompt. */
export const reviewLine = (d: ReadableDoc): string =>
  `- [${d.ref}] „${plain(d.name, 120)}“ (${d.kind}, abgelegt ${d.createdAt.slice(0, 10)})${d.abstract ? `\n  Kurzfassung: ${plain(d.abstract, 600)}` : ""}\n  Text:\n${excerpt(d.text)
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n")}`;

/** One batch's prompt: the instructions (as the prompt page has them), today, the tickets, the todos that are open, the documents. */
export function reviewPrompt(o: { instructions: string; todayLong: string; today: string; tickets: string[]; open: { id: number; ticket?: string; text: string }[]; batch: ReadableDoc[] }): string {
  return [
    o.instructions,
    "",
    `Heute ist ${o.todayLong} (${o.today}).`,
    "",
    "# Meine Tickets",
    ...(o.tickets.length ? o.tickets : ["(keine)"]),
    "",
    "# Schon offene Todos",
    ...o.open.slice(0, 60).map((x) => `- [${x.id}]${x.ticket ? ` ${x.ticket}` : ""}: ${plain(x.text, 160)}`),
    "",
    "# Dokumente",
    ...o.batch.map(reviewLine),
  ].join("\n");
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export type ProposedTodo = { text: string; refs: string[]; ticket: string; kind: string; owner: "me" | "other"; due: string | null; repeat: { freq: string; until?: string; start?: string } | null };

/** What an answer holds as todos: each with its text and the documents of the batch it follows from (the ones without are dropped), the rest cleaned. */
export function proposedTodos(answer: Answer | null | undefined, known: Set<string>, tickets: string[]): ProposedTodo[] {
  const out: ProposedTodo[] = [];
  for (const td of answer?.todos ?? []) {
    const text = td.text?.trim();
    const refs = (td.refs ?? []).map((r) => String(r).trim().replace(/^\[|\]$/g, "")).map((r) => (r.startsWith("doc:") ? r : `doc:${r}`)).filter((r) => known.has(r));
    if (!text || !refs.length) continue;
    const ticket = td.ticket?.trim().toUpperCase() ?? "";
    const repeat = td.repeat && ["daily", "weekly", "monthly", "yearly"].includes(td.repeat) ? { freq: td.repeat, ...(DAY.test(td.repeatUntil ?? "") ? { until: td.repeatUntil } : {}), ...(DAY.test(td.repeatFrom ?? "") ? { start: td.repeatFrom } : {}) } : null;
    out.push({ text, refs, ticket: tickets.includes(ticket) ? ticket : "", kind: (TODO_KINDS as readonly string[]).includes(td.kind ?? "") ? td.kind! : "other", owner: td.owner === "other" ? "other" : "me", due: td.due ?? null, repeat });
  }
  return out;
}
