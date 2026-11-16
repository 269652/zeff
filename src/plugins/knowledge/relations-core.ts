/* eslint-disable @typescript-eslint/no-explicit-any */
export const SCHEMA = {
  type: "object",
  properties: {
    todos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          pages: {
            type: "array",
            items: { type: "object", properties: { id: { type: "string" }, why: { type: "string" } }, required: ["id", "why"] },
          },
          entities: { type: "array", items: { type: "integer" } },
          links: { type: "array", items: { type: "integer" } },
        },
        required: ["id", "pages", "entities", "links"],
      },
    },
  },
  required: ["todos"],
};
export type Answer = { todos?: { id?: number; pages?: ({ id?: string; why?: string } | string)[]; entities?: number[]; links?: number[] }[] };

export const INSTRUCTIONS = `Du ordnest meinen offenen Todos Wissen zu. Zu jedem Todo (Nummer in eckigen Klammern, sein Text, ggf. sein Ticket) stehen Kandidaten aus der Wissensbasis — Seiten [p:…] mit Titel, Bereich und der gefundenen Stelle, Begriffe [e:…] mit ihrer Erklärung —, gefunden über eine Volltextsuche nach den Wörtern des Todos. Viele davon passen nur zufällig (ein gleiches Wort).

Wähle je Todo NUR die Kandidaten, die mir beim Erledigen dieses Todos wirklich helfen: es geht um dieselbe Sache, dasselbe System, denselben Ablauf, dieselbe Person — nicht bloß ein gemeinsames Wort. Lieber keine als eine unpassende. Für persönliche Dinge (Freunde, Termine, Behörden, Einkäufe) passt Firmenwissen fast nie. Gib zu jedem Todo die gewählten Seiten-Kennungen (ohne „p:“) und Begriff-Nummern (ohne „e:“) an — leere Listen, wenn nichts passt. Dazu stehen je Todo Adressen der Systeme [l:…] (Prod, Test, Dev …) aus den Seiten: wähle unter links die Nummern (ohne „l:“) der Adressen der Systeme, um die es im Todo geht (Kunde/Projekt/Website laut Todo und Ticket) — von jedem System die Adressen der Umgebungen, die das Todo braucht: ein Test-, Abnahme- oder Fehler-Todo braucht die Test-/Staging-Adresse und die Prod-Adresse zum Vergleich, ein Live-Todo Prod und Test. Nichts wählen, was zu einem anderen Projekt gehört; leer, wenn keine passt. Zu jeder gewählten Seite ein „why“: EIN kurzer Satz (höchstens 90 Zeichen), was mir diese Seite für das Todo bringt — konkret, z. B. „Checkliste der Unterlagen für den Ersttermin“ oder „Wie der Login auf CMS 11 eingerichtet wird“; nicht „passt zum Thema“ und keine Wiederholung des Titels.`;



export const LANGUAGE_NAMES = { de: "Deutsch", en: "Englisch", es: "Spanisch" } as const;

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\s+/g, " ");

/**
 * What the Wissens-Zuordnung (relations.ts) and the Knowledge plugin's port (knowledge.match) share, pure: the AI's instructions and the shape of its answer,
 * which todos are due, the block a todo makes in the prompt and what the answer makes of its candidates.
 */
export type Todo = { id: number; text: string; ticket: string | null; ticketSummary: string; updatedAt: string };
type Stored = { at?: string; pages?: { why?: string }[]; entities?: unknown[]; links?: unknown[] } | null;

/** Whether a todo needs (another) assignment: none yet, changed since, picked before pages came with a "why" or before links. */
export const isDue = (t: Todo, k: Stored): boolean => !k || !Array.isArray(k.pages) || !Array.isArray(k.entities) || (k.at ?? "") < t.updatedAt || k.pages.some((p) => p.why === undefined) || k.links === undefined;

export type Candidates = { pages: import("./shared").KnowledgePage[]; entities: import("./shared").KnowledgeEntity[]; links: import("./shared").TodoLink[] };

export const blockOf = (t: Todo, c: Candidates): string =>
  [
    `## [${t.id}] ${t.text}${t.ticket ? ` (Ticket ${t.ticket}${t.ticketSummary ? ` — ${clip(t.ticketSummary, 120)}` : ""})` : ""}`,
    ...c.pages.map((p) => `- [p:${p.id}] „${clip(p.title, 120)}“ (${p.space}): ${clip(p.summary || p.snippet, 300)}`),
    ...c.entities.map((e) => `- [e:${e.id}] ${e.name} (${e.type}): ${clip(e.summary, 200)}`),
    ...c.links.map((l, i) => `- [l:${i}] ${l.env === "other" ? "System" : l.env.toUpperCase()} ${l.label ? `„${clip(l.label, 40)}“ ` : ""}${l.url} (Seite „${clip(l.page, 60)}“)`),
  ].join("\n");

/** What the AI picked for a todo, kept from its candidates. */
export function pickedOf(c: Candidates, p: Answer["todos"] extends (infer E)[] | undefined ? E | undefined : never) {
  const why = new Map((p?.pages ?? []).map((x) => (typeof x === "string" ? [x, ""] : [String(x.id ?? ""), String(x.why ?? "").trim()])));
  const pages = c.pages.filter((x) => why.has(String(x.id))).map((x) => ({ ...x, why: why.get(String(x.id)) ?? "" }));
  const entities = c.entities.filter((x) => (p?.entities ?? []).map(Number).includes(x.id));
  const chosen = new Set((p?.links ?? []).map(Number));
  const links = c.links.filter((_, i) => chosen.has(i));
  return { pages, entities, links };
}
