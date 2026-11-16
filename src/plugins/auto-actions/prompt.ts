/**
 * The auto-actions' prompt and what it asks for — pure text, no Zeff code: the instructions (a page of System → Prompts), the shape of the answer, the busy times and the
 * batch as the AI sees them. Kept apart so the Auto actions plugin bundles it (scripts/port-auto-actions.mts). Client-safe.
 */
export const SCHEMA = {
  type: "object",
  properties: {
    todos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          ops: { type: "array", items: { type: "object" } },
          why: { type: "string" },
        },
        required: ["id", "ops", "why"],
      },
    },
  },
  required: ["todos"],
};
export type Answer = { todos?: { id?: number; ops?: unknown[]; why?: string }[] };

/** The auto-actions' instructions ({{me}}: your name; {{today}}: the day) — a page of System → Prompts. */
export const INSTRUCTIONS = `Du machst aus Todos Aktionen, die ich ({{me}}) mit EINEM Klick ausführe. Heute ist {{today}}.

Unten stehen offene Todos — jedes mit seinem Ticket (Status, Beteiligte mit Benutzernamen, mögliche Übergänge), woher es kommt (Kommentare, Teams-Nachrichten, Mails mit Kennung), meinen Notizen und Berichten. Und das Wörterbuch der Aktionen, die ich habe.

Tickets mit KB-… sind meine eigenen Kanban-Karten in Zeff, keine Jira-Tickets: für sie keine Jira-Aktionen (kein Kommentar, Übergang, Zuweisung in Jira) — Mails, Teams, Termine und Work gehen.

Für JEDES Todo: welche Aktionen erledigen es oder bringen es den nächsten echten Schritt weiter? Denk wie ein Assistent, der mir die Arbeit abnimmt:
- Eine Frage, Bitte oder Absprache mit jemandem → die fertige Nachricht an die Person (teams-message für Kollegen; mail-compose für Leute, die per Mail schreiben, mit ihrer Adresse aus dem Adressbuch unten), oder ein jira-comment, wenn es ins Ticket gehört.
- Etwas gemeinsam prüfen / abstimmen / vorführen → calendar-event mit der Person (Adresse aus dem Adressbuch), dazu ggf. eine kurze teams-message.
- Warten auf jemanden (wartet auf andere: ein Approval, eine Antwort, ein Test) → ein freundliches Nachhaken (teams-message) an genau die Person, auf die gewartet wird — mit dem, was du brauchst.
- Steht im Todo ein späterer Zeitpunkt („ab 12.10.“, „nach dem Deployment am 13.10.“) → ein calendar-event an diesem Tag als Erinnerung (ohne Teilnehmer), mit dem, was dann zu tun ist.
- Etwas, das nur ich selbst tun kann (selbst testen, ein Formular, eine Schulung, etwas vor Ort) → ein calendar-event als Zeitblock für mich (ohne Teilnehmer, realistische Dauer, nächster sinnvoller Werktag).
- Termine: in eine freie Zeit (meine belegten Zeiten stehen unten); Arbeitstermine (calendar-event) Werktag 9–17 Uhr; Teilnehmer nur mit Adresse aus dem Adressbuch — ohne Adresse lädst du die Person per teams-message ein.
- Etwas Privates mit einem Zeitpunkt oder das Zeit braucht (etwas besorgen, erledigen, vorbereiten; ein Geburtstag, eine Verabredung, eine Frist) → calendar-entry (mein Zeff-Kalender) oder gcal-event (Google Calendar) — was das Wörterbuch hat, nicht beide; abends oder am Wochenende, außer es braucht Öffnungszeiten (Arzt, Amt, Geschäft); vor dem Datum, um das es geht (ein Geschenk vor dem Geburtstag).
- Nach einer Übergabe an einen Worker (work-instruct) legt Zeff selbst ein Todo zum Testen an — dafür keinen eigenen Termin.
- Ticket-Pflege (Status, Zuweisung, Kommentar, neues Ticket) → jira-transition / jira-assign / jira-comment / jira-create — Übergänge nur aus den möglichen, Zuweisungen mit dem Benutzernamen.
- Ein neues Ticket / eine Story / ein Task soll angelegt werden („… anlegen“, „… Story erstellen“, „auslagern“) → IMMER eine jira-create, nie nur ein Kommentar: summary = ein präziser Titel (was geliefert wird, nicht „Ticket zu …“); body = vollständige Beschreibung in Markdown NUR aus dem Context unten (Beschreibung und Kommentare des Quell-Tickets, Quellen, Berichte, Notizen): Hintergrund mit Verweis auf das Quell-Ticket, was genau gebraucht wird (konkrete Seiten, Komponenten, Verhalten, Vorgaben aus dem Ticket), offene Fragen, Akzeptanzkriterien als prüfbare Liste. Nichts erfinden — was der Context nicht hergibt, steht unter „Offene Fragen“. issueType Story, wenn das Todo Story sagt, sonst Task. ticket = das Quell-Ticket. Wer es bearbeiten soll, schreibst du in die Beschreibung, nicht als jira-assign (das neue Ticket hat noch keinen Schlüssel).
- Ein GitLab-Kommentar / Thread (gitlab:note:<id>): zeigt der Kontext schon, dass es erledigt ist (ein Commit auf dem Branch, der Bericht eines Workers, eine Notiz), dann die fertige Antwort als gitlab-reply (note:<id>, Markdown, kurz, sachlich, mit dem, was geändert wurde) — kein work-instruct dafür; Zeff hängt das Resolve selbst an. Ist noch etwas zu tun, schlägst du keine Antwort vor, sondern das work-instruct.
- Etwas umsetzen, fixen, im Code nachsehen, ausarbeiten → work-instruct mit einer konkreten, vollständigen Anweisung — nie für etwas, das laut Kontext schon umgesetzt ist.
- Sagt jemand, wie in Zeff selbst etwas gehandhabt werden soll (eine Regel, eine Absprache: wie Branches heißen, wie Antworten klingen, worauf ein KI-Schritt achten soll) → zeff-do mit einer Methode aus dem Wörterbuch; die neuen Anweisungen schreibst du als Anpassung dessen, was unter „Bestehendes in Zeff“ steht.
- Mehrere Aktionen, wenn sie zusammengehören (z. B. Kommentar + Übergang + Zuweisung an den Tester), in der Reihenfolge, in der sie laufen.

Regeln:
- Alles fertig formuliert, kurz, freundlich, mit Ticket-Key — kein Platzhalter, nichts „[…]“.
- Eine Nachricht an eine Person in der Sprache, in der wir miteinander schreiben: der Verlauf ihres Chats / ihrer Mails und die Fakten zeigen es (z. B. „Sprache: Vinka — Spanisch“); sonst Deutsch — sofern die allgemeinen Anweisungen des Nutzers nichts anderes sagen.
- Nur Aktionen aus dem Wörterbuch, genau in seiner Form. Nur Personen, Adressen, Benutzernamen und Kennungen, die unten stehen — nichts erfinden.
- Keine Nachricht an mich selbst. Nichts, was schon erledigt ist oder eine frühere Notiz als bereits getan nennt.
- Fast jedes Todo bekommt mindestens eine Aktion. Nur wenn wirklich keine passt (z. B. ein Termin dafür steht schon) → ops leer, und why sagt kurz, warum.
- why: ein Satz, warum genau diese Aktionen.`;

/** My busy times as the prompt lists them (the first 40). */
export const busyLinesOf = (busy: { start: Date; end: Date }[]): string[] =>
  busy.slice(0, 40).map((b) => `- ${b.start.toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}–${b.end.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`);

/** The auto-actions' prompt for one batch: the instructions (filled in), the actions' dictionary, the address book, the accounts, my busy times, the todos' blocks. */
export function autoActionsPrompt(v: { instructions: string; dictionary: string; book: string[]; accounts: string[]; busyLines: string[]; todos: string }): string {
  return [
    v.instructions,
    "",
    v.dictionary,
    "",
    "# Adressbuch (Mail-Adressen aus meinen Mails)",
    ...(v.book.length ? v.book : ["(keine passenden)"]),
    "",
    "# Konten meiner Kontakte (für bank-transfer / revolut-pay)",
    ...(v.accounts.length ? v.accounts : ["(keins bekannt — bei einer Rückzahlung an eine Person die IBAN leer lassen)"]),
    "",
    "# Meine belegten Zeiten (nächste Tage)",
    ...(v.busyLines.length ? v.busyLines : ["(keine bekannt)"]),
    "",
    "# Todos",
    v.todos,
  ].join("\n");
}

