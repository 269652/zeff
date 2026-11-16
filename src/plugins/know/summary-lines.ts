/**
 * "What you should know": the AI summary's pure parts — the instructions, the answer's shape, the brief as numbered lines and how points are held to them,
 * a meeting's key. No Zeff code, so the Know plugin bundles it (scripts/port-know.mts); summary.ts uses it too. Client-safe.
 */
import { type Brief, type BriefLink } from "./shared";

export const SCHEMA = {
  type: "object",
  properties: { points: { type: "array", items: { type: "object", properties: { text: { type: "string" }, sources: { type: "array", items: { type: "integer" } } }, required: ["text", "sources"] } } },
  required: ["points"],
};

/** How the summary is asked for ({{what}}: the meeting or the thing) — a page of System → Prompts. */
export const KNOW_SUMMARY_INSTRUCTIONS =
  "Du bereitest mich auf {{what}} vor. Unten steht nummeriert, was Zeff darüber weiß: die Personen (Rolle, Fakten, Abwesenheit, Geburtstag, Geld), offene Zusagen (was ich schulde, was man mir schuldet), die letzten Kontakte und Ereignisse, verwandte Tickets, Vorgänge und Projekte. Schreib 2 bis 5 kurze Punkte auf Deutsch, was ich jetzt wissen sollte — Offenes und Überfälliges zuerst, dann was sich zuletzt getan hat, dann Persönliches (ein Geburtstag, eine Abwesenheit, offenes Geld), wenn es dasteht. Lieber ein Punkt zu viel als etwas Wichtiges weglassen. Jeder Punkt nennt in sources die Nummern der Zeilen, auf die er sich stützt; nichts, was nicht in den Zeilen steht. Nur JSON nach diesem Schema:";

export const day = (iso: string) => iso.slice(0, 16).replace("T", " ");
const euro = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

/** The brief as numbered lines for the AI, each with what it links to. Line n is `lines[n - 1]`. */
export function summaryLines(b: Brief): { text: string; link: BriefLink }[] {
  const out: { text: string; link: BriefLink }[] = [];
  const add = (text: string, link: BriefLink) => out.push({ text: text.replace(/\s+/g, " ").trim().slice(0, 400), link });
  if (b.meeting) add(`Termin „${b.meeting.title}“ am ${day(b.meeting.start)}${b.meeting.location ? ` in ${b.meeting.location}` : ""}${b.meeting.attendees.length ? `, mit ${b.meeting.attendees.join(", ")}` : ""}`, { ref: `event:${b.meeting.id}`, label: b.meeting.title, href: b.meeting.href });
  for (const p of b.people) {
    const link = { ref: p.ref, label: p.name, href: p.href };
    const bits = [p.role ? `Rolle: ${p.role}` : "", p.away ? `abwesend bis ${p.away.until}` : "", p.birthday ? `${p.birthday.label} am ${p.birthday.on} (in ${p.birthday.inDays} Tagen${p.birthday.turns ? `, wird ${p.birthday.turns}` : ""})` : "", p.money?.owe ? `ich schulde ${euro(p.money.owe)}` : "", p.money?.owed ? `schuldet mir ${euro(p.money.owed)}` : "", p.lastContact ? `letzter Kontakt ${day(p.lastContact.at)} (${p.lastContact.title})` : ""].filter(Boolean);
    add(`Person ${p.name}${bits.length ? `: ${bits.join("; ")}` : ""}`, link);
    for (const f of p.facts) add(`${p.name} — ${f.text}`, link);
  }
  for (const l of b.loops) {
    const who = l.direction === "mine" ? `Ich schulde ${l.personName}` : l.direction === "theirs" ? `${l.personName} schuldet mir` : `Offen mit ${l.personName}`;
    add(`${who}: ${l.text}${l.due ? ` (fällig ${l.due}${l.overdue ? ", überfällig" : ""})` : ""}`, { ref: `person:${l.personId}`, label: l.personName, href: b.people.find((p) => p.id === l.personId)?.href ?? "" });
  }
  for (const e of b.recent) add(`${day(e.at)} ${e.kind}: ${e.title}${e.summary && e.summary !== e.title ? ` — ${e.summary.slice(0, 200)}` : ""}`, { ref: `tl:${e.id}`, label: e.title, href: e.href });
  for (const r of b.related) add(`Verwandt: ${r.label}`, r);
  return out;
}

/** A meeting's key for its summary (a series' occurrence by its day). */
export const meetingKey = (id: number, occurrence?: string | null) => `event:${id}${occurrence ? `:${occurrence.slice(0, 10)}` : ""}`;

