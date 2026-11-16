/**
 * One identity per person, pure (People normalize): the instructions, the answer's shape and the prompt — no database, so the People port bundles it into its
 * lambda as it is. Server and lambda.
 */
export const SCHEMA = {
  type: "object",
  properties: {
    aliases: { type: "array", items: { type: "object", properties: { person: { type: "integer" }, mention: { type: "string" } }, required: ["person", "mention"] } },
    people: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, aliases: { type: "array", items: { type: "string" } }, whatsapp: { type: "string" }, email: { type: "string" } },
        required: ["name"],
      },
    },
    merges: { type: "array", items: { type: "object", properties: { keep: { type: "integer" }, drop: { type: "integer" } }, required: ["keep", "drop"] } },
    relations: {
      type: "array",
      items: { type: "object", properties: { person: { type: "integer" }, rel: { type: "string" }, other: { type: "integer" }, evidence: { type: "string" } }, required: ["person", "rel", "other", "evidence"] },
    },
  },
  required: ["aliases", "people", "merges", "relations"],
};
export type NormalizeAnswer = {
  aliases?: { person?: number; mention?: string }[];
  people?: { name?: string; aliases?: string[]; whatsapp?: string; email?: string }[];
  merges?: { keep?: number; drop?: number }[];
  relations?: { person?: number; rel?: string; other?: number; evidence?: string }[];
};

export const INSTRUCTIONS = `Du pflegst meine Personen-Profile, damit jede Person EINE Identität hat — egal, wie sie in meinen Todos genannt wird (Vorname, Nachname, „Herr X“, Spitzname, voller Name).

Unten stehen meine Profile (id, Name, Aliasse, WhatsApp-Chat, Mail-Adressen), meine Kontakte (WhatsApp-Chats, Mail-Absender) und meine Todos.

1. aliases: Eine Person, die in einem Todo anders genannt wird als in ihrem Profil (z. B. „Herr Meier“, wo das Profil „Thomas Meier“ heißt; ein Spitzname) → {person: ihre id, mention: die Nennung genau wie im Todo, ohne Genitiv-s und ohne „Herr“/„Frau“}. Nur, wenn eindeutig dieselbe Person (gleicher Nachname und es gibt keine zweite passende; derselbe Chat; dieselbe Adresse).
2. people: Eine Person, die in einem Todo vorkommt, kein Profil hat, aber ein Kontakt von mir ist (ein WhatsApp-Chat oder ein Mail-Absender unten) → {name: ihr voller Name (wie beim Kontakt), aliases: wie sie in den Todos genannt wird, whatsapp: der Chat-Name genau wie unten (oder leer), email: ihre Adresse (oder leer)}.
3. merges: Zwei Profile, die dieselbe Person sind (gleicher Chat, gleiche Adresse, ein Name ist eindeutig die Kurzform des anderen — oder ein Rollen- bzw. Verwandtschaftsname wie „Mama“, „Papa“, „Schwester“, „Chef“ gegen einen echten Namen, wenn die Hinweise es zeigen: schreibe ich in einem Chat „Hey Mama“, ist die Person dieses Chats „Mama“; stammen die Todos über „Mama“ aus Nachrichten eines Chats, ist es dessen Person — mehrere Hinweise auf denselben Chat sind ein klarer Beleg) → {keep: die id des vollständigeren (der echte Name), drop: die andere}. Die Hinweise stehen bei den Profilen, die Chat-Auszüge bei Profilen und Kontakten: „ich:“ sind meine Nachrichten, sonst die der Person.
4. relations: Wer ist wer für wen — jede Bezugnahme und jeder Querverweis, den meine Kontexte (Todos, Nachrichten, Erwähnungen unten) tragen, als strukturierte Beziehung: {person: die id des Profils, rel: was die Person ist, kurz und aus MEINER Sicht, wenn other 0 ist („Mutter“, „Schwester“, „Vermieter“, „Zahnärztin“, „Kollege“, „Ehefrau“), other: 0 = zu mir, sonst die id eines anderen Profils, zu dem die Beziehung besteht (dann aus Sicht von person als blankes Substantiv, ohne „von“: „Ehemann“, „Tochter“, „Chef“ — z. B. person Lotte, rel „Schwester“, other 0; person Max, rel „Sohn“, other Paula), evidence: der Beleg in einem Satz (was im Kontext steht)}. Eine „Mama“, die zu einer Person gehört, ist ein merge bzw. alias — und wird zusätzlich als Beziehung „Mutter“ (other 0) festgehalten. Schon bekannte Beziehungen (bei den Profilen) nicht wiederholen.

Regeln: Nichts raten — im Zweifel weglassen. Keine Firmen, Teams, Rollen, Gruppenchats, Dienste. Nicht mich selbst („Ich“). Nichts doppelt: was schon Name oder Alias des Profils ist, nicht noch einmal. Beziehungen nur, wenn ein Kontext sie klar sagt oder nahelegt (z. B. „Hey Mama“, „meine Schwester Lotte“, „Paulas Mann“). Leere Listen, wenn nichts zu tun ist.`;


/** The prompt: the instructions, my profiles (one line each), my contacts and my todos. */
export const normalizePrompt = (instructions: string, v: { profiles: string[]; contacts: string[]; todos: string[] }): string =>
  [instructions, "", "# Meine Profile", ...(v.profiles.length ? v.profiles : ["(noch keine)"]), "", "# Meine Kontakte", ...v.contacts, "", "# Meine Todos", ...v.todos].join("\n");
