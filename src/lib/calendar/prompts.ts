/**
 * What the AI steps of the calendar are told and the shape they answer in — pure texts, shared by the built-in steps (todos.ts, relations.ts) and bundled into the
 * Calendar plugin's lambdas (scripts/port-calendar.mts). Client-safe.
 */

/** Appointments to todos: which appointments give you something to do. */
export const TODOS_INSTRUCTIONS = `Du gehst Termine aus meinem Kalender durch und entscheidest für jeden, ob er mir etwas zu tun gibt — nur dann wird er ein Todo an seinem Tag.

- Ein Todo, wenn ich etwas TUN muss: etwas erledigen, vorbereiten, mitbringen, besorgen, anrufen, schicken, bezahlen, hingehen und dort etwas abgeben oder klären („Kleider waschen“, „Müll rausbringen“, „Geschenk für Anna besorgen“, „Steuererklärung abgeben“, „Arzttermin — Überweisung mitnehmen“).
- KEIN Todo für: Zeitblocker und Routinen, die nur Zeit freihalten („Pause“, „Mittag“, „Fokuszeit“, „Blocker“, „Gym“, „Pendeln“, „Feierabend“, „Standup“, „Daily“), Erinnerungen ohne Aufgabe („Geburtstag Nadine“ — außer es steht dabei, dass ich etwas tun soll), Feiertage, Urlaub, Abwesenheiten, und Besprechungen, zu denen ich nur erscheine.
- Lies die Beschreibung (notes) des Termins genau: sie sagt oft, was zu tun, mitzubringen, vorzubereiten oder abzugeben ist („bitte Formular ausgefüllt mitbringen“, „Unterlagen bis Montag schicken“). Ein Todo gibt es NUR, wenn sich aus Titel + Beschreibung eine konkrete Aufgabe für mich ergibt — nicht schon deshalb, weil ein Termin existiert. Ein Termin ohne Beschreibung, der nur Zeit belegt (Unterricht, Betreuung, Konferenz, Treffen, Training), ist kein Todo. Fällig ist das Todo am Tag des Termins.
- Im Zweifel bei einem Termin, dessen Beschreibung nach einer Aufgabe klingt: ein Todo.
- \`text\`: die Aufgabe, kurz, in der Sprache des Termins (meist einfach sein Titel; ohne Uhrzeit, die kommt dazu).`;

export const TODOS_SCHEMA = {
  type: "object",
  properties: {
    appointments: {
      type: "array",
      items: { type: "object", properties: { id: { type: "string" }, todo: { type: "boolean" }, text: { type: "string" } }, required: ["id", "todo"] },
    },
  },
  required: ["appointments"],
};

/** Calendar matching: which appointments each open todo is about. */
export const RELATIONS_INSTRUCTIONS = `Du ordnest Termine meinen offenen Todos zu. Unten steht je Todo (Nummer in eckigen Klammern) eine Auswahl von Terminen aus meinem Kalender (Kennung in eckigen Klammern, z. B. [cal:12], dazu Datum, Titel, Ort und Beschreibung).

Gib für JEDES Todo die Kennungen der Termine an, die für genau dieses Todo relevant sind: zu denen es gehört (es ist die Vor- oder Nachbereitung, etwas, das dort mitzubringen, abzugeben oder zu klären ist), die seinen Zeitpunkt festlegen oder die man kennen muss, um es zu erledigen. Nicht schon deshalb, weil ein Termin am selben Tag liegt oder ähnlich klingt. Gehört kein Termin dazu, gib eine leere Liste an.`;

export const RELATIONS_SCHEMA = {
  type: "object",
  properties: {
    todos: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, appointments: { type: "array", items: { type: "string" } } }, required: ["id", "appointments"] } },
  },
  required: ["todos"],
};
