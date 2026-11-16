import { createEntry, getEntry, requireEntry, updateEntry } from "@/lib/entries";
import { collectIntoHead, applyParallel, autoGroup, parallelSaid } from "@/lib/entry-parallel";
import { dissolveSpan, linkMember, SPAN_MODES, setSpanMode, unlinkMember } from "@/lib/entry-spans";
import { normalizeStart } from "@/lib/entry-timeline";
import { formatHours } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { setPauses } from "@/lib/pauses";
import { parseBookOn } from "@/lib/projects-shared";
import { spanOfHead } from "@/lib/entry-spans";
import { createContext, deleteContext, deleteContextFile, getContextItem, linkContext, reorderEntryContexts, contextsForEntry, unlinkContext, updateContext, addSource } from "@/lib/contexts";
import { isContextKind, type ContextInput } from "@/lib/contexts-shared";

/**
 * The edits of a booked entry, one step each, with what the built-in's server actions say: the whole entry changed, copied to another day, joined to a
 * group of parallel work or taken out of it, the way a group books, a start time, the breaks of a day. Nothing is moved or rewritten that the built-in's
 * actions would not — a group only changes what its entries book.
 */
const text = (v: unknown) => (v == null ? "" : String(v).trim());
const has = (v: unknown) => v !== undefined && v !== null && v !== "";
const bool = (v: unknown) => v === true || v === "true" || v === "1" || v === "on";

/** A context written in a form (kind, title, author, body, one link, date, ticket) — no files. */
export const contextOf = (i: Record<string, unknown>, p = "ctx"): ContextInput | null => {
  const body = String(i[`${p}Body`] ?? "");
  const links = [...text(i[`${p}Links`]).split(/\s*\n\s*/), text(i[`${p}Link`])].map((x) => x.trim()).filter(Boolean);
  const title = text(i[`${p}Title`]);
  if (!body.trim() && !links.length && !title) return null;
  return {
    kind: (isContextKind(text(i[`${p}Kind`])) ? text(i[`${p}Kind`]) : "note") as ContextInput["kind"],
    title: title || null,
    author: text(i[`${p}Author`]) || null,
    body,
    links: [...new Set(links)].map((url) => ({ url, label: null })),
    date: text(i[`${p}Date`]) || null,
    ticket: text(i[`${p}Ticket`]) || null,
  };
};

export async function entryOp(i: Record<string, unknown>): Promise<{ message: string }> {
  const op = text(i.op);
  const id = Number(i.id);

  if (op === "update") {
    const hours = Number(text(i.hours).replace(",", "."));
    if (!has(i.hours) || !Number.isFinite(hours)) throw new Error(t("Hours is required (e.g. 1.5)."));
    const bookOn = parseBookOn(text(i.bookOn));
    const wasGroup = getEntry(id)?.isGroup ?? false;
    const tags = text(i.tags).split(",").map((x) => x.trim().replace(/^#/, "")).filter(Boolean);
    const entry = updateEntry(id, {
      ...(bookOn && ("projectId" in bookOn ? bookOn : { jobNumber: bookOn.jobNumber, projectId: null })),
      date: text(i.date) || undefined,
      hours,
      description: has(i.description) ? text(i.description) : undefined,
      comment: text(i.comment) || null,
      ticket: text(i.ticket) || null,
      type: text(i.type) || undefined,
      tags,
      isGroup: bool(i.isGroup),
      start: text(i.start) || null,
    });
    // Made a collecting entry now: what that day has and runs parallel to it is grouped under it.
    if (entry.isGroup && !wasGroup) collectIntoHead(entry.id);
    return { message: t("Saved.") };
  }

  if (op === "copy") {
    const date = text(i.date);
    if (!date) throw new Error(t("Pick a day to copy to."));
    const src = requireEntry(id);
    createEntry(
      {
        ...(src.projectId ? { projectId: src.projectId } : { jobNumber: src.job.number }),
        date,
        hours: src.hours,
        description: src.description,
        ticket: src.ticket ?? undefined,
        type: src.type,
        reportedBy: src.reportedBy,
        tags: src.tags.map((tag) => tag.name),
      },
      "web",
      { defaultTags: false }, // a copy keeps the original's tags
    );
    return { message: t("Copied {hours} h to {date}.", { hours: formatHours(src.hours), date }) };
  }

  if (op === "drop") {
    // Dragged onto a collecting entry: the view's state holds the dragged entry under the collecting entry's name (dr<head id>).
    let state: Record<string, unknown> = {};
    try {
      state = JSON.parse(text(i.state) || "{}") as Record<string, unknown>;
    } catch {
      state = {};
    }
    let n = 0;
    for (const [k, v] of Object.entries(state)) {
      const head = /^dr(\d+)$/.exec(k);
      const entryId = Number(v);
      if (!head || !Number.isInteger(entryId) || entryId <= 0) continue;
      const span = spanOfHead(Number(head[1]));
      const e = getEntry(entryId);
      if (!span || !e || e.spanId === span.id) continue;
      linkMember(entryId, span.id);
      n++;
    }
    return { message: n ? t("Grouped: {what}", { what: String(n) }) : "" };
  }
  if (op === "context-add") {
    const input = contextOf(i);
    if (!input) throw new Error(t("Write something first."));
    await createContext(input, [], id);
    return { message: t("Saved.") };
  }
  if (op === "context-edit") {
    const input = contextOf(i);
    const existing = getContextItem(Number(i.contextId));
    if (!existing) throw new Error(t("Context #{id} not found.", { id: Number(i.contextId) }));
    await updateContext(existing.id, input ?? { kind: existing.kind, title: null, author: null, body: "", links: [], date: null, ticket: null }, []);
    return { message: t("Context saved.") };
  }
  if (op === "context-file") {
    // One file the view's upload brought (staged under a token): onto the item, or — with no item picked — as an item of its own on the entry.
    const { stagedPath } = await import("@/plugins/workspace/uploads-staging");
    const fs = await import("node:fs");
    const file = await stagedPath(i.token);
    const bytes = fs.readFileSync(file);
    const blob = new File([bytes], text(i.name) || "file", { type: text(i.mime) || "application/octet-stream" });
    const cid = Number(i.contextId);
    if (cid > 0) {
      const c = getContextItem(cid);
      if (!c) throw new Error(t("Context #{id} not found.", { id: cid }));
      await updateContext(c.id, { kind: c.kind, title: c.title, author: c.author, body: c.body, links: c.links, date: c.date, ticket: c.ticket }, [blob]);
    } else {
      await createContext({ kind: "note", title: blob.name, author: null, body: "", links: [], date: null, ticket: null }, [blob], id);
    }
    fs.rmSync(file, { force: true });
    return { message: t("Context added.") };
  }
  if (op === "context-file-delete") {
    deleteContextFile(Number(i.fileId));
    return { message: t("Saved.") };
  }
  if (op === "context-link") {
    if (!Number(i.contextId)) throw new Error(t("Pick a context item to link."));
    linkContext(id, Number(i.contextId));
    return { message: t("Context linked.") };
  }
  if (op === "context-move") {
    const ids = contextsForEntry(id).map((c) => c.id);
    const at = ids.indexOf(Number(i.contextId));
    const to = at + (text(i.dir) === "up" ? -1 : 1);
    if (at < 0 || to < 0 || to >= ids.length) return { message: "" };
    [ids[at], ids[to]] = [ids[to], ids[at]];
    reorderEntryContexts(id, ids);
    return { message: "" };
  }
  if (op === "context-sync") {
    const { syncContextsToJira } = await import("@/lib/jira/context-sync");
    const r = await syncContextsToJira(contextsForEntry(id).map((c) => c.id));
    const parts = [
      r.posted.length && t("{n} posted", { n: r.posted.length }),
      r.updated.length && t("{n} updated", { n: r.updated.length }),
      r.unchanged.length && t("{n} already up to date", { n: r.unchanged.length }),
      r.files.length && (r.files.length === 1 ? t("1 file attached") : t("{n} files attached", { n: r.files.length })),
      r.skipped.length && t("{n} without a ticket", { n: r.skipped.length }),
    ].filter(Boolean);
    const summary = parts.length ? `${parts.join(", ")}.` : t("Nothing to sync.");
    if (r.errors.length) throw new Error(t("{summary} Failed: {errors}", { summary, errors: r.errors.join("; ") }));
    return { message: t("Jira: {summary}", { summary }) };
  }
  if (op === "source-add") {
    const { resolveLinks } = await import("@/lib/context-links");
    const url = text(i.url);
    const e = resolveLinks([url])[url];
    if (!e) throw new Error(t("That isn't a synced Teams message or GitLab item."));
    addSource(url, e, { entryId: id, ticket: text(i.ticket) || getEntry(id)?.ticket || null });
    return { message: t("Added.") };
  }
  if (op === "context-unlink") {
    unlinkContext(id, Number(i.contextId));
    return { message: t("Saved.") };
  }
  if (op === "context-delete") {
    deleteContext(Number(i.contextId));
    return { message: t("Saved.") };
  }
  if (op === "link") {
    linkMember(id, text(i.spanId));
    return { message: t("Grouped: {what}", { what: (getEntry(id)?.description ?? "").slice(0, 80) }) };
  }
  if (op === "unlink") {
    unlinkMember(id);
    return { message: t("Now a separate entry again — it books what it worked.") };
  }
  if (op === "collect") {
    const n = collectIntoHead(id);
    return { message: n === 0 ? t("Nothing to collect — no parallel entries that day.") : n === 1 ? t("1 entry grouped under it.") : t("{n} entries grouped under it.", { n }) };
  }
  if (op === "start") {
    const raw = text(i.start);
    const value = normalizeStart(raw);
    if (raw && !value) throw new Error(t("A time like 09:30."));
    const before = getEntry(id);
    if (!before) throw new Error(t("Time entry #{id} not found.", { id }));
    updateEntry(before.id, { start: value });
    let grouped = "";
    // Set on an entry that is not grouped yet: it may now run parallel to something.
    if (value && !before.spanId && !before.isGroup) {
      const g = autoGroup(before.id);
      if (g) grouped = ` ${parallelSaid(g)}`;
    }
    return { message: `${value ? t("Start {time}.", { time: value }) : t("Start removed.")}${grouped}` };
  }
  if (op === "span-mode") {
    if (!(SPAN_MODES as string[]).includes(text(i.mode))) throw new Error(t("Unknown way of booking."));
    setSpanMode(text(i.spanId), text(i.mode) as (typeof SPAN_MODES)[number]);
    return { message: t("Saved.") };
  }
  if (op === "ungroup") {
    dissolveSpan(text(i.spanId));
    return { message: t("Ungrouped — every entry books what it worked.") };
  }
  if (op === "parallel") {
    const mode = text(i.mode);
    if (!["combine", "divide", "sequential"].includes(mode)) throw new Error(t("Unknown way of booking."));
    const ids = text(i.ids).replace(/[[\]\s]/g, "").split(",").map(Number).filter(Number.isInteger);
    const r = applyParallel(ids, mode as "combine" | "divide" | "sequential");
    return { message: r.mode === "combine" ? t("Combined into one spanning entry.") : r.mode === "divide" ? t("The stretch's hours are divided between the entries.") : t("Booked one after the other.") };
  }
  if (op === "pauses") {
    const dates = text(i.dates).split(",").map((x) => x.trim()).filter(Boolean);
    const saved = setPauses(dates, text(i.text));
    const n = dates.length;
    return {
      message: saved.none
        ? n === 1 ? t("Marked as no break.") : t("Marked as no break on {n} days.", { n })
        : saved.pauses.length
          ? n === 1 ? t("Saved the break.") : t("Saved the break on {n} days.", { n })
          : n === 1 ? t("Removed the break.") : t("Removed the break on {n} days.", { n }),
    };
  }
  throw new Error("op: update, copy, link, unlink, collect, start, span-mode, ungroup, parallel or pauses");
}
