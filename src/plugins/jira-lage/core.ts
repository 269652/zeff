/**
 * The Board-Lage's rules, pure (the built-in's board-lage.ts uses it, and the port jira-lage-ext bundles it — scripts/port-jira-lage.mts —: one source,
 * the same tickets and the same words): which Jira tickets are read fresh from Jira, and what the step says when it is done.
 */
import { dateOf } from "@/lib/jira/dates";

/** Relevant: moved within this many days (or in progress). */
export const RECENT_DAYS = 30;
/** At most this many tickets read from Jira per run (the newest changes first). */
export const MAX_TICKETS = 150;

/** An open ticket of an enabled board, as the tables keep it. */
export type OpenTicket = { key: string; updatedAt: string | null; category: string | null };

/**
 * The Jira tickets relevant now: those of `tickets` (open, on an enabled board) that the Ticket-Lage did not just read (`analyzed`), moved lately or in
 * progress, and — unless `involved` is null (all) — the ones you're in (on you, followed). The newest change first, at most MAX_TICKETS. Keys.
 */
export function relevantKeysOf(input: { tickets: OpenTicket[]; analyzed: Iterable<string>; involved: Iterable<string> | null; now: number }): string[] {
  const since = input.now - RECENT_DAYS * 864e5;
  const analyzed = new Set([...input.analyzed].map((k) => k.toUpperCase()));
  const involved = input.involved ? new Set([...input.involved].map((k) => k.toUpperCase())) : null;
  return input.tickets
    .filter((t) => !analyzed.has(t.key.toUpperCase()) && (!involved || involved.has(t.key.toUpperCase())) && (t.category === "inprogress" || (dateOf(t.updatedAt)?.getTime() ?? 0) >= since))
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, MAX_TICKETS)
    .map((t) => t.key);
}

export type BoardLageResult = { ok: boolean; all: boolean; relevant: number; analyzed: number; unchanged: number; failed: number; error?: string };

/** What the step says in the Sync menu: the counts, or why it failed. `t`: the language's translator. */
export function boardLageMessage(r: BoardLageResult, t: (text: string, vars?: Record<string, string | number>) => string): { ok: boolean; message: string } {
  return r.ok
    ? {
        ok: true,
        message: [r.all ? t("{n} tickets (all)", { n: r.relevant }) : t("{n} tickets (with you)", { n: r.relevant }), t("{n} reassessed", { n: r.analyzed }), t("{n} unchanged", { n: r.unchanged }), ...(r.failed ? [t("{n} failed", { n: r.failed })] : [])].join(" · "),
      }
    : { ok: false, message: r.error ?? t("Failed.") };
}
