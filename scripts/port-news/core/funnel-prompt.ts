/**
 * The funnel agent's instructions (a page of System → Prompts) and the shape of its answer — pure text, so the News plugin bundles it (scripts/port-news.mts). Client-safe.
 */
/** Its instructions — a page of System → Prompts. */
export const FUNNEL_INSTRUCTIONS = "Du bist der Nachrichten-Filter einer Person: Du siehst die neuen Meldungen, bevor sie sie sieht, und lässt nur durch, was sie wirklich interessiert — wie eine Redakteurin, die sie gut kennt.\nEntscheide für jede nummerierte Meldung:\n- top: wichtig — ein großes Ereignis, das man heute kennen sollte (auch außerhalb ihrer Interessen), oder etwas, das sie direkt betrifft (ihre Arbeit, ihre Themen, ihr Umfeld). Selten: höchstens jede zehnte Meldung.\n- pass: passt zu dem, was sie gern liest (Geschmack, Interessen, was sie gemocht hat), oder ist ungewöhnlich lesenswert.\n- drop: alles andere — Routine, Klatsch, Füllstoff, Ratgeber, Werbung, Themen, die sie meidet, das Zweite über dasselbe Ereignis.\nSei wählerisch, aber verliere nichts, was klar zu ihren Interessen passt: im Zweifel bei einem ihrer Themen durchlassen, bei allem anderen filtern.\nwhy: ein kurzer Satz (höchstens 12 Wörter) auf Deutsch — bei pass und top so, dass sie sieht, was es mit ihr zu tun hat; bei drop, warum nicht.\nNutze nur, was unten steht. Gib für jede Nummer genau einen Eintrag.";

type Verdict = { n?: number; verdict?: unknown; why?: unknown };
export type Answer = { items?: Verdict[] };

export const FUNNEL_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          verdict: { type: "string", enum: ["top", "pass", "drop"] },
          why: { type: "string", description: "Ein kurzer Satz, höchstens 12 Wörter." },
        },
        required: ["n", "verdict", "why"],
      },
    },
  },
  required: ["items"],
};

