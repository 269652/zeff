/**
 * The instructions of an AI step of News (a page of System → Prompts) and the shape of its answer — pure text, so the News plugin bundles it (scripts/port-news.mts). Client-safe.
 */
/** Its instructions — a page of System → Prompts. */
export const PLAN_INSTRUCTIONS = "Du planst die Suche nach neuen Nachrichten für eine Person. Unten steht eine Beschreibung ihres Nachrichten-Geschmacks.\nGib 10–12 konkrete Suchanfragen (2–5 Wörter, gern englisch, wenn sie englische Quellen mag) für eine Nachrichtensuche — nach Forschung und Berichten, nie nach Produkten, Shopping oder Werbung: die Hauptthemen aus verschiedenen Blickwinkeln und 2–3 Nachbarthemen, die sie überraschen und trotzdem interessieren könnten. Keine Anfragen, die schon zu den letzten gehörten.";

export const PLAN_SCHEMA = { type: "object", properties: { queries: { type: "array", items: { type: "string" }, description: "10–12 Suchanfragen (2–5 Wörter, deutsch und englisch gemischt) für eine Nachrichtensuche: die Hauptthemen und 2–3 Nachbarthemen, die überraschen dürfen." } }, required: ["queries"] };

