/**
 * The asking of an AI step that may miss context (pure: no database — the People port bundles it into its lambdas, lib/rag.ts adds Zeff's own search).
 */

export const RAG_SOURCES = ["knowledge", "mails", "teams", "gitlab", "jira", "notes", "facts", "todos", "documents", "pages", "people"] as const;
export type RagSource = (typeof RAG_SOURCES)[number];


/** What an AI step asks for when it misses context: search words, in all sources or only in some. */
export type Need = { query: string; where?: string[] };
export type RagHit = { source: RagSource; ref: string; title: string; text: string; when?: string };


/** What a step adds to its prompt so the AI knows it can ask — and how. */
export const RAG_INSTRUCTIONS = `Fehlt dir Kontext, um sicher zu antworten (ein Name, ein Beschluss, was in einer Rückfrage steht, wie etwas funktioniert), rate nicht: lass die Antwort leer und nenne unter needs bis zu 3 Suchanfragen — query: 2–5 Suchwörter, die in den gesuchten Texten stehen dürften; where (optional): knowledge (Dokumentation), mails, teams, gitlab, jira, notes, facts, todos, documents (Dokumente und Bilder, die ich an Todos gehängt habe: was darin steht oder zu sehen ist), pages (meine Workspace-Seiten: Notizen, Wiki, Beschlüsse, Meeting-Protokolle), people (was Zeff über Personen weiß: Rollen, Fakten, Bankverbindung, Adressen, Telefon). Zeff sucht dort und fragt dich mit den Fundstellen noch einmal. Ist der Kontext unten schon ausreichend, antworte gleich und lass needs weg.`;


/** The optional `needs` field added to a step's answer schema. */
const NEEDS_PROPERTY = {
  type: "array",
  description: "Nur wenn dir Kontext fehlt und die Antwort leer bleibt: was Zeff für dich nachschlagen soll.",
  items: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string", description: "2–5 Suchwörter." },
      where: { type: "array", items: { type: "string", enum: [...RAG_SOURCES] }, description: "Nur in diesen Quellen suchen (sonst in allen)." },
    },
  },
};

type WithNeeds = { needs?: Need[] };


/**
 * Ask the AI, and while it says it misses context (`needs`) look it up and ask again with the
 * finds — at most `rounds` asks (default 2); the last one has no `needs` and must answer. A need
 * already looked up isn't looked up twice. `ask` gets the prompt and the schema of the round.
 */
export async function askWithRetrievalWith<T extends object>(o: {
  prompt: string;
  schema: object;
  ask: (prompt: string, schema: object) => Promise<T & WithNeeds>;
  retrieve: (needs: Need[]) => Promise<{ text: string }>;
  rounds?: number;
}): Promise<T & WithNeeds> {
  const rounds = Math.max(1, o.rounds ?? 2);
  const fetch = o.retrieve;
  const done = new Set<string>();
  let extra = "";
  for (let round = 1; ; round++) {
    const last = round >= rounds;
    const base = o.schema as { properties?: Record<string, unknown> };
    const schema = last ? o.schema : { ...base, properties: { ...base.properties, needs: NEEDS_PROPERTY } };
    const res = await o.ask(`${o.prompt}${extra}${last && round > 1 ? "\n\nDas ist die letzte Runde: antworte jetzt mit dem, was da ist." : ""}`, schema);
    const asked = (res.needs ?? []).filter((n) => String(n?.query ?? "").trim());
    if (last || !asked.length) return res;
    const needs = asked.filter((n) => !done.has(String(n.query).trim().toLowerCase()));
    // Asked again for what was looked up already: nothing more to find — it has to answer now.
    if (!needs.length) return o.ask(`${o.prompt}${extra}

Dazu wurde schon gesucht, mehr gibt es nicht: antworte jetzt mit dem, was da ist.`, o.schema);
    for (const n of needs) done.add(String(n.query).trim().toLowerCase());
    const found = await fetch(needs);
    extra += `\n\n# Nachgeholter Kontext (Runde ${round}; gesucht: ${needs.map((n) => `„${n.query}“`).join(", ")})\n${found.text || "(nichts gefunden)"}`;
  }
}
