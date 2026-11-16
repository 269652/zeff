import { contextsForEntry, listContexts } from "@/lib/contexts";
import { contextHeadline, contextKindLabels, type ContextItem } from "@/lib/contexts-shared";
import { entryTodoContext } from "@/lib/entry-todo-context";
import { summarizeContext } from "@/lib/context-summary";
import { entityHeadline, entityText } from "@/lib/entities-shared";
import { formatDate } from "@/lib/format";
import { getEntry } from "@/lib/entries";
import { t } from "@/lib/i18n/server";

/**
 * What stands behind a booked entry, as plain data: its own context items (messages, comments, notes with their links and files, their way to Jira) and
 * what its todos bring along — where they came from and their notes — as the entry's page and the entries list's toggle show them; the items one could link
 * to it, and the search over the messages and items that can be added as a source. Read only.
 */

/** How much todo context each entry has (the list's toggle shows the count). */
export function todoContextCounts(entryIds: number[]): Record<number, number> {
  const all = entryTodoContext(entryIds);
  return Object.fromEntries(Object.entries(all).map(([id, c]) => [Number(id), summarizeContext(c.sources, c.notes).n]));
}

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const itemView = (c: ContextItem, kinds: Record<string, string>) => ({
  id: c.id,
  kindKey: c.kind,
  kind: kinds[c.kind],
  headline: contextHeadline(c, t),
  title: c.title ?? "",
  author: c.author ?? "",
  dateRaw: c.date ?? "",
  date: c.date ? formatDate(c.date) : "",
  ticket: c.ticket ?? "",
  body: c.body,
  linksText: c.links.map((l) => l.url).join("\n"),
  links: c.links.map((l) => ({ url: l.url, label: l.label ?? l.url })),
  files: c.files.map((f) => ({ id: f.id, name: f.name, size: kb(f.size), url: `/api/contexts/files/${f.id}`, synced: !!f.jiraSyncedAt })),
  jira: c.jiraSyncedAt ? t("Jira: {summary}", { summary: formatDate(c.jiraSyncedAt) }) : c.ticket ? "" : "",
  canSync: !!c.ticket,
});

export function entryDetail(input: { id?: unknown }) {
  const id = Number(input.id);
  const entry = Number.isInteger(id) ? getEntry(id) : undefined;
  if (!entry) return { found: false };
  const kinds = contextKindLabels(t) as Record<string, string>;
  const todo = entryTodoContext([id])[id];
  const mine = contextsForEntry(id);
  const have = new Set(mine.map((c) => c.id));
  return {
    found: true,
    id,
    title: t("Entry #{id} · {hours}h on {target}", { id, hours: String(entry.hours), target: entry.project ? entry.project.title : entry.job.number }),
    created: t("Reported by {who} via {source} · created {at} UTC", { who: entry.reportedBy, source: entry.source, at: entry.createdAt }),
    ticket: entry.ticket ?? "",
    date: entry.date,
    contexts: mine.map((c) => itemView(c, kinds)),
    linkable: [["", t("Pick a context item to link.")], ...listContexts({ limit: 80 }).filter((c) => !have.has(c.id)).map((c) => [String(c.id), `${kinds[c.kind]} · ${contextHeadline(c, t)}`.slice(0, 120)])] as [string, string][],
    todos: (todo?.todos ?? []).map((x) => x.text),
    sources: (todo?.sources ?? []).map((s) => `${entityHeadline(s)} — ${entityText(s)}`.slice(0, 400)),
    notes: (todo?.notes ?? []).map((n) => `${n.by ? `${n.by}: ` : ""}${n.text}`),
    kindOptions: (Object.keys(kinds) as string[]).map((k) => [k, kinds[k]] as [string, string]),
  };
}

/** A pasted link rather than words. */
const isLink = (q: string) => /^(https?:|msteams:)/i.test(q.trim());

/** The search of "add a source": Teams messages, GitLab items, todos and mails by words — or what a pasted link points at — each with the link that adds it. */
export async function sourceSearch(input: { q?: unknown }) {
  const q = String(input.q ?? "").trim();
  if (!q) return { hits: [] as { url: string; section: string; meta: string; text: string }[] };
  const ask = async <T,>(f: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await f();
    } catch {
      return [];
    }
  };
  const { todoLink } = await import("@/lib/entities-shared");
  const { mailLink, mailSender } = await import("@/lib/mail/shared");
  const [teams, gitlab, todos, mails] = await Promise.all([
    ask(async () => (await import("@/plugins/teams/server-actions")).searchTeamsMessagesAction(q)),
    ask(async () => (await import("@/plugins/gitlab/server-actions")).searchGitlabItemsAction(q)),
    isLink(q) ? [] : ask(async () => (await import("@/plugins/todos/server-actions")).searchTodosAction(q)),
    isLink(q) ? [] : ask(async () => (await import("@/app/actions/mail")).searchMailsAction(q)),
  ]);
  const hits = [
    ...todos.map((x) => ({ url: todoLink(x.id), section: t("Todos"), meta: [t("Todo {ref}", { ref: x.ref }), x.ticket].filter(Boolean).join(" · "), text: x.text })),
    ...teams.map((m) => ({ url: m.link, section: "Teams", meta: [m.senderName ?? t("Someone"), m.place].filter(Boolean).join(" · "), text: [m.subject, m.text].filter(Boolean).join(" — ") })),
    ...mails.map((m) => ({ url: mailLink(m.key), section: t("Mails"), meta: mailSender(m), text: `${m.subject} — ${m.preview}` })),
    ...gitlab.map((g) => ({ url: g.url, section: "GitLab", meta: [g.project.split("/").pop(), g.author].filter(Boolean).join(" · "), text: g.kind === "branch" ? g.ref : `${g.ref} ${g.title}` })),
  ];
  return { hits: hits.map((h) => ({ ...h, text: h.text.replace(/\s+/g, " ").slice(0, 220) })).slice(0, 40) };
}
