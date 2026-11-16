import { contextsForEntry } from "@/lib/contexts";
import { contextHeadline, contextKindLabels } from "@/lib/contexts-shared";
import { entryTodoContext } from "@/lib/entry-todo-context";
import { summarizeContext } from "@/lib/context-summary";
import { entityHeadline, entityText } from "@/lib/entities-shared";
import { formatDate } from "@/lib/format";
import { getEntry } from "@/lib/entries";
import { t } from "@/lib/i18n/server";

/**
 * What stands behind a booked entry, as plain data: its own context items (messages, comments, notes with their links) and what its todos bring along —
 * where they came from and their notes — as the entry's page and the entries list's toggle show them. Read only.
 */

/** How much todo context each entry has (the list's toggle shows the count). */
export function todoContextCounts(entryIds: number[]): Record<number, number> {
  const all = entryTodoContext(entryIds);
  return Object.fromEntries(Object.entries(all).map(([id, c]) => [Number(id), summarizeContext(c.sources, c.notes).n]));
}

export function entryDetail(input: { id?: unknown }) {
  const id = Number(input.id);
  const entry = Number.isInteger(id) ? getEntry(id) : undefined;
  if (!entry) return { found: false };
  const kinds = contextKindLabels(t);
  const todo = entryTodoContext([id])[id];
  return {
    found: true,
    id,
    title: t("Entry #{id} · {hours}h on {target}", { id, hours: String(entry.hours), target: entry.project ? entry.project.title : entry.job.number }),
    created: t("Reported by {who} via {source} · created {at} UTC", { who: entry.reportedBy, source: entry.source, at: entry.createdAt }),
    contexts: contextsForEntry(id).map((c) => ({
      id: c.id,
      kind: kinds[c.kind],
      headline: contextHeadline(c, t),
      author: c.author ?? "",
      date: c.date ? formatDate(c.date) : "",
      body: c.body,
      links: c.links.map((l) => ({ url: l.url, label: l.label ?? l.url })),
    })),
    todos: (todo?.todos ?? []).map((x) => x.text),
    sources: (todo?.sources ?? []).map((s) => `${entityHeadline(s)} — ${entityText(s)}`.slice(0, 400)),
    notes: (todo?.notes ?? []).map((n) => `${n.by ? `${n.by}: ` : ""}${n.text}`),
    kindOptions: (Object.keys(kinds) as (keyof typeof kinds)[]).map((k) => [k, kinds[k]] as [string, string]),
  };
}
