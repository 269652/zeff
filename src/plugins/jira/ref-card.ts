import type { RefCardProvider } from "@/lib/refs/point";
import type { RefTone } from "@/lib/refs/shared";

const TONE: Record<string, RefTone> = { todo: "muted", inprogress: "info", done: "good", unknown: "muted" };
const day = (s: string | null | undefined) => (/^\d{4}-\d{2}-\d{2}/.test(s ?? "") ? s!.slice(0, 10) : "");

/** Jira wiki markup to readable text: code/quote blocks, headings, [label|url] links, *bold*. */
const plain = (text: string) =>
  text
    .replace(/\{(?:code|noformat|quote|panel|color)(?::[^}]*)?\}/g, "")
    .replace(/^h[1-6]\.\s*/gm, "")
    .replace(/\[([^|\]]+)\|[^\]]+\]/g, "$1")
    .replace(/\[~[^\]]+\]/g, "@…")
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[.,:;!?])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();

/** A ticket key's card: its summary, status, assignee, priority, when it changed, the last comment — as the Jira sync kept it. */
export const TICKET_REF_CARD: RefCardProvider = {
  kind: "ticket",
  card: async (id, { t }) => {
    const key = id.toUpperCase();
    const { getTicketCards, getJiraTicket } = await import("@/lib/jira/store");
    const c = getTicketCards([key])[key];
    if (!c) return null;
    const link = c.url ? [{ label: t("Open in Jira ↗"), href: c.url, external: true }] : [];
    if (!c.synced) return { kind: "ticket", id: key, eyebrow: key, title: key, note: t("Not synced from Jira yet — sync on the Jira tab for its title and details."), links: link };
    const updated = day(getJiraTicket(key)?.updatedAt);
    const { commentsOfTickets } = await import("@/lib/jira/comments");
    const last = commentsOfTickets([key], 1).get(key)?.[0];
    return {
      kind: "ticket",
      id: key,
      eyebrow: [key, c.issueType].filter(Boolean).join(" · "),
      title: c.summary || t("No title"),
      badges: c.status ? [{ label: c.status, tone: TONE[c.statusCategory] ?? "muted" }] : [],
      facts: [
        ...(c.assignee ? [{ label: t("Assignee"), value: c.assignee }] : []),
        ...(c.priority ? [{ label: t("Priority"), value: c.priority }] : []),
        ...(updated ? [{ label: t("Updated"), value: updated }] : day(c.openedAt) ? [{ label: t("Opened"), value: day(c.openedAt) }] : []),
        ...(day(c.resolvedAt) ? [{ label: t("Resolved"), value: day(c.resolvedAt) }] : []),
        ...(c.jobNumber ? [{ label: t("Zeff job"), value: c.jobNumber }] : []),
      ],
      ...(last?.body
        ? { excerpt: plain(last.body).slice(0, 320), excerptLabel: [t("Last comment"), last.author, day(last.at)].filter(Boolean).join(" · ") }
        : c.description
          ? { excerpt: plain(c.description).slice(0, 320) }
          : {}),
      links: link,
    };
  },
};
