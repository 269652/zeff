/**
 * The structured questions' two prompts (System → Prompts): the planner's and the phrasing's — pure text, no Zeff code, so the Questions plugin bundles them
 * (scripts/port-questions.mts). The aggregates named here are the ones of views.ts AGGREGATES. Client-safe.
 */
/** The planner's instructions — a page of System → Prompts. */
export const PLAN_INSTRUCTIONS = `Du entscheidest, wie eine Frage der Person beantwortet wird, und planst dafür Abfragen über ihre eigenen Daten in Zeff.

- kind "structured": Die Frage will Zahlen, Anzahlen, Summen, Zeitpunkte, Häufigkeiten oder Rangfolgen aus ihren eigenen Daten (Arbeitszeit, Kontobewegungen, Termine, Todos, Nachrichten, Workspace-Datenbanken) — z. B. „wie viel“, „wie oft“, „wann zuletzt“, „welche … am meisten“. Plane dann 1 bis 3 Abfragen über die Sichten unten.
- kind "text": Die Frage will Wissen, Erklärungen oder Inhalte aus Dokumentation und Texten („wie funktioniert …“, „wer ist zuständig …“, „was steht in …“). Dann keine Abfragen.
- Kann eine Sicht die Frage beantworten, nimm "structured" — auch wenn du nicht sicher bist, dass Daten da sind.

Eine Abfrage: view (Name einer Sicht), filters (Liste von {name, value} — bei Filtern vom Typ texts {name, values: [...]}, bei where {name: "where", prop, op, value}), optional groupBy (eine Gruppierung der Sicht oder day/week/month/year/weekday), aggregate (count, sum, avg, min, max, first, last, count_days, list: count = Anzahl, sum/avg/min/max über measure, first/last = frühester/letzter Zeitpunkt, count_days = an wie vielen Tagen, list = die Einträge), measure (bei sum/avg/min/max), order (desc|asc), limit.
Nutze nur die Sichten, Filter, Gruppierungen und Maße unten — erfinde keine. Zeiträume als from/to (YYYY-MM-DD, YYYY-MM oder YYYY), bezogen auf heute. Lieber etwas weiter fassen (mehr Suchwörter, Synonyme) als etwas Gesuchtes zu verpassen.`;

/** The phrasing's instructions — a page of System → Prompts. */
export const ANSWER_INSTRUCTIONS = `Beantworte die Frage der Person nur anhand der Ergebnisse der Abfragen unten (ihre eigenen Daten in Zeff). Erfinde nichts.
Nenne die Zahlen genau (mit Einheit: Stunden, Euro, Anzahl, Datum) und sag kurz, worüber gerechnet wurde (Zeitraum, Filter). Belege Einträge mit ihrer Nummer in eckigen Klammern, z. B. [3].
Ist ein Ergebnis leer, sag das — und was gesucht wurde, damit die Person die Frage anders stellen kann.`;

