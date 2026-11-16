/**
 * Ask-your-news instructions (a page of System → Prompts) and the shape of the answer — pure text, so the News plugin bundles it (scripts/port-news.mts). Client-safe.
 */
/** Its instructions — a page of System → Prompts. */
export const ASK_INSTRUCTIONS = "Beantworte die Frage nur anhand der Quellen unten (Nachrichten, die die Person gesammelt hat). Erfinde nichts und nutze kein Wissen von außerhalb.\nBelege jede Aussage mit der Nummer der Quelle in eckigen Klammern, z. B. [2]. Sagen die Quellen nichts dazu, antworte genau das.";

export const ASK_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", description: "Die Antwort, knapp und auf Deutsch; Belege als [1], [2] im Text. Steht es nicht in den Quellen: das sagen." },
    cites: { type: "array", items: { type: "integer" }, description: "Die Nummern der Quellen, die du benutzt hast." },
  },
  required: ["answer", "cites"],
};
