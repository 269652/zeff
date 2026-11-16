/**
 * The AI tagger's instructions (a page of System → Prompts) and the shape of its answer — pure text, so the News plugin bundles it (scripts/port-news.mts). Client-safe.
 */
/** Its instructions — a page of System → Prompts. */
export const TAGGING_INSTRUCTIONS = "Du verschlagwortest Nachrichtenmeldungen für eine Entdecken-Funktion, in der man von Schlagwort zu Schlagwort springt.\nFür jede nummerierte Meldung:\n- tags: 2–4 Schlagworte. Personen, Organisationen, Orte und Unternehmen in kanonischer Schreibweise („Donald Trump“, „Deutsche Bahn“, „Bärbel Bas“), dazu 1–2 Themen als kurze Substantive („Cyberangriff“, „Klimaschutz“). Keine allgemeinen Wörter wie Nachrichten, Politik, Studie, Meldung, Update.\n- story: ein kurzes Label für das konkrete Ereignis, um das es geht („Energie-Waffenruhe Ukraine“, „Rücktritt Bärbel Bas“). Bei mehreren Meldungen über dasselbe Ereignis genau dasselbe Label benutzen. Leer lassen, wenn es kein einzelnes Ereignis ist (Ratgeber, Kolumne, Feature).\nNutze nur, was in Titel und Kurztext steht. Gib für jede Nummer genau einen Eintrag.";

export const TAGGING_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          tags: { type: "array", items: { type: "string" }, description: "2–4 Schlagworte: Personen, Organisationen, Orte, Unternehmen (kanonisch, deutsche Schreibweise) und 1–2 Themen als kurze Substantive." },
          story: { type: "string", description: "Kurzes Label des konkreten Ereignisses; dasselbe Label bei allen Meldungen über dasselbe Ereignis; leer, wenn es keins ist." },
        },
        required: ["n", "tags", "story"],
      },
    },
  },
  required: ["items"],
};
