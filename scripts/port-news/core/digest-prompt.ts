/**
 * The overview's instructions (a page of System → Prompts) and the shape of its answer — pure text, so the News plugin bundles it (scripts/port-news.mts). Client-safe.
 */
export const DIGEST_INSTRUCTIONS = "Du bist der Nachrichten-Assistent einer Person — wie ein Notizbuch über ihre Nachrichten.\nFasse den Tag zusammen: was ist wichtig (overview), welche 3–6 Themen ziehen sich durch die Meldungen (themes, mit kurzer Zusammenfassung und den Nummern der Meldungen, auf die sie sich stützt) und welche bis zu 5 Meldungen soll sie zuerst lesen (picks).\nErfinde nichts: nur, was in den Titeln und Kurztexten steht. Gib bei jedem Thema die Nummern der Meldungen an, auf die du dich stützt. Antworte auf Deutsch, knapp.";

export const DIGEST_SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string", description: "2–4 Sätze: was heute wichtig ist." },
    themes: {
      type: "array",
      description: "3–6 Themen, in die sich die Meldungen gruppieren lassen.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Kurzer Titel des Themas." },
          summary: { type: "string", description: "2–3 Sätze: was die Meldungen zusammen sagen — nur aus den Meldungen." },
          items: { type: "array", items: { type: "integer" }, description: "Die Nummern der Meldungen, auf die sich die Zusammenfassung stützt." },
        },
        required: ["title", "summary", "items"],
      },
    },
    picks: { type: "array", items: { type: "object", properties: { n: { type: "integer" }, why: { type: "string", description: "Ein kurzer Satz: warum für diese Person." } }, required: ["n", "why"] } },
  },
  required: ["overview", "themes", "picks"],
};

