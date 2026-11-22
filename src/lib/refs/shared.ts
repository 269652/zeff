/**
 * References named inline in a text — a ticket key, a person, another todo, a page, a merge request — and the small card their hover
 * shows. One shape for every kind, so one card draws them all (ui: components/RefLink.tsx); what fills it comes from the kind's
 * provider (refs/point.ts). Client-safe: types and the text splitter only.
 */

export type RefTone = "plain" | "good" | "warn" | "bad" | "info" | "muted";

export type RefCard = {
  kind: string;
  id: string;
  /** The first line: a ticket's summary, a person's name, a todo's text. */
  title: string;
  /** Small, above the title: "PROJ-12 · Bug", "T-37", "Page". */
  eyebrow?: string;
  /** Under the title: a role, a page's path. */
  subtitle?: string;
  /** An emoji (a page's icon) or initials (a person) in a round badge before the title. */
  icon?: string;
  avatar?: string;
  badges?: { label: string; tone?: RefTone }[];
  /** A few facts: label → value ("Assignee" → "Anna"). */
  facts?: { label: string; value: string }[];
  /** A few lines of text: a description, the last comment, a note. */
  excerpt?: string;
  /** Who/when the excerpt is from ("Last comment · Anna · 2026-11-20"). */
  excerptLabel?: string;
  /** A short list under it (a person's open todos, their promises). */
  items?: { label: string; href?: string; tone?: RefTone }[];
  itemsLabel?: string;
  /** Where it opens ("Open in Jira ↗"), first is the main one. */
  links?: { label: string; href: string; external?: boolean }[];
  /** Said instead of the rest: "Not synced from Jira yet". */
  note?: string;
};

/** A reference as a text names it: what kind, which, the words. */
export type RefPart = { text: string; kind?: string; id?: string; href?: string };

const TICKET = /\b[A-Z][A-Z0-9]+-\d+\b/;
const TODO = /(?<![\w-])T-\d+\b/;
const MR = /(?<![\w/])!\d+\b/;
const PATTERN = new RegExp(`(${TICKET.source})|(${TODO.source})|(${MR.source})`, "g");

/**
 * A text cut into its words and the references in it: ticket keys (PROJ-12), other todos (T-37), merge requests (!168). A todo's
 * "T-37" goes to /t/37; the rest get their link from their card (or the `hrefs` given: a ticket's browse URL by key).
 */
export function splitRefs(text: string, opts: { tickets?: boolean; todos?: boolean; mrs?: boolean; hrefs?: Record<string, string> } = {}): RefPart[] {
  const { tickets = true, todos = true, mrs = true, hrefs = {} } = opts;
  const out: RefPart[] = [];
  let last = 0;
  const s = String(text ?? "");
  for (const m of s.matchAll(PATTERN)) {
    const [whole, ticket, todo, mr] = m;
    const kind = ticket && tickets ? "ticket" : todo && todos ? "todo" : mr && mrs ? "mr" : "";
    if (!kind) continue;
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ text: whole, kind, id: kind === "todo" ? whole.slice(2) : whole, href: hrefs[whole] ?? (kind === "todo" ? `/t/${whole.slice(2)}` : undefined) });
    last = m.index + whole.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}
