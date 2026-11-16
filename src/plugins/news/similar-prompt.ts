/**
 * The instructions of an AI step of News (a page of System → Prompts) and the shape of its answer — pure text, so the News plugin bundles it (scripts/port-news.mts). Client-safe.
 */
/** Its instructions — a page of System → Prompts. */
export const SIMILAR_INSTRUCTIONS = "Du hilfst einer Person, mehr von dem zu finden, was sie liest. Sie hat bei diesem Artikel „Mehr davon“ gewählt.\nLies den Artikel und setze ihn zu dem, was über die Person bekannt ist. Sage in ein bis zwei Sätzen, warum er für sie relevant ist (angle) — nur mit dem, was unten steht, nichts erfinden.\nNenne dann 3–5 Suchanfragen für eine Nachrichtensuche, die weitere passende Artikel finden: konkrete Namen und Themen, verschiedene Blickwinkel (Hintergrund, Folgen, Gegenposition, Nachbarthemen), jeweils 2–6 Wörter.\nkeep: Begriffe, die ein passender Treffer wahrscheinlich enthält. avoid: Begriffe, die auf einen unpassenden Treffer deuten.";

export const SIMILAR_SCHEMA = {
  type: "object",
  properties: {
    angle: { type: "string", description: "Ein bis zwei Sätze: warum dieser Artikel für diese Person relevant ist — bezogen auf ihre Vorlieben, Personen und ihr Wissen." },
    queries: {
      type: "array",
      description: "3–5 Suchanfragen für eine Nachrichtensuche, die weitere passende Artikel finden (2–6 Wörter, konkrete Namen/Themen, verschiedene Blickwinkel).",
      items: { type: "object", properties: { q: { type: "string" }, why: { type: "string", description: "Kurz: was diese Suche findet." } }, required: ["q", "why"] },
    },
    keep: { type: "array", items: { type: "string" }, description: "Begriffe, die ein passender Treffer wahrscheinlich enthält." },
    avoid: { type: "array", items: { type: "string" }, description: "Begriffe, die auf einen unpassenden Treffer hindeuten." },
  },
  required: ["angle", "queries"],
};

