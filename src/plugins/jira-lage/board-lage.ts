import { runJiraSession, jiraPortOn } from "@/lib/jira/port-ops";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { dateOf, FIELDS, plain, who, type Issue } from "@/lib/runs/collect";
import { relevantKeysOf, type BoardLageResult } from "./core";
import { followedTickets } from "@/lib/todos/followed";
import { analyzedByTicketLage } from "@/lib/runs/ticket-lage";
import { keepComments } from "@/lib/jira/comments";
import { resultToPayload } from "@/lib/mcp/stdio";
import { getJiraSyncConfig } from "@/lib/jira/sync";
import { emitChange } from "@/lib/events";
import { errorMessage } from "@/lib/errors";
import { accountFlag, setAccountFlag } from "@/lib/sync/account-flags";

/**
 * The Board-Lage — the review step of every board, done by the Workspace's AI review: each board database (the Jira
 * boards the sync keeps, your own boards) has the Lage fields (attention, lead, summary — see workspace/lage-fields) and
 * the review fills them for the open cards that changed lately, not those the Ticket-Lage read. Before, the Jira tickets
 * that matter now are read fresh from Jira (comments, history) — the review reads them from what Zeff keeps.
 */

const { jiraTickets, jiraBoards } = schema;

/**
 * The Jira tickets relevant now on the enabled boards — open, moved lately or in progress — but those the Ticket-Lage just
 * read; of them the ones you're in (on you, followed) — or all (`all`). (The rules: core.ts, which the port bundles too.)
 */
export function relevantKeys(all: boolean): string[] {
  const db = getDb();
  const boards = db.select({ id: jiraBoards.id }).from(jiraBoards).where(eq(jiraBoards.enabled, true)).all().map((b) => b.id);
  if (!boards.length) return [];
  const tickets = db
    .select({ key: jiraTickets.key, updatedAt: jiraTickets.updatedAt, category: jiraTickets.statusCategory })
    .from(jiraTickets)
    .where(and(inArray(jiraTickets.boardId, boards), isNull(jiraTickets.resolvedAt), ne(jiraTickets.statusCategory, "done")))
    .all();
  const involved = all ? null : [...followedTickets().keys(), ...db.select({ key: jiraTickets.key }).from(jiraTickets).where(eq(jiraTickets.mine, true)).all().map((r) => r.key)];
  return relevantKeysOf({ tickets, analyzed: analyzedByTicketLage(), involved, now: Date.now() });
}

/** The relevant Jira tickets read fresh from Jira: their comments kept (the review reads them). The number read. */
async function freshFromJira(keys: string[]): Promise<number> {
  const cfg = getJiraSyncConfig();
  if (!keys.length || (!cfg.configured && !(await jiraPortOn()))) return 0;
  const issues: Issue[] = await runJiraSession("Jira (board briefing)",
    async (call) => {
      const out: Issue[] = [];
      for (let i = 0; i < keys.length; i += 50) {
        const chunk = keys.slice(i, i + 50);
        const p = resultToPayload(await call("jira_search", { jql: `key in (${chunk.join(",")})`, limit: chunk.length, fields: FIELDS, expand: "changelog" })) as { issues?: Issue[] };
        out.push(...(p.issues ?? []).filter((x) => x?.key));
      }
      return out;
    },
    240000,
  );
  keepComments(issues.flatMap((i) => (i.comments ?? []).flatMap((c) => (c.id ? [{ id: c.id, ticket: i.key, author: who(c.author), at: dateOf(c.created)?.toISOString() ?? "", body: plain(c.body, 4000) }] : []))));
  return issues.length;
}

export type { BoardLageResult };

/** The next run's scope (set by the button before it starts the step): all Jira tickets read fresh, or the ones you're in. */
export function setBoardLageScope(all: boolean): void {
  setAccountFlag("__zeffBoardLageAll", all);
}

/** The Board-Lage now (one at a time): Jira's relevant tickets read fresh, every board with its Lage fields, the reviews. */
export function runBoardLage(opts: { force?: boolean; all?: boolean } = {}): Promise<BoardLageResult> {
  const running = accountFlag<Promise<BoardLageResult>>("__zeffBoardLage");
  if (running) return running;
  const all = opts.all ?? !!accountFlag<boolean>("__zeffBoardLageAll");
  setAccountFlag("__zeffBoardLageAll", false);
  const run = (async (): Promise<BoardLageResult> => {
    let note: string | undefined;
    await freshFromJira(relevantKeys(all)).catch((e) => void (note = errorMessage(e).slice(0, 300)));
    const { isInstalled } = await import("@/plugins/state");
    if (!isInstalled("workspace")) return { ok: !note, all, relevant: 0, analyzed: 0, unchanged: 0, failed: 0, ...(note ? { error: note } : {}) };
    await (await import("@/plugins/workspace/lage-fields")).ensureBoardReviews();
    const results = await (await import("@/plugins/workspace/review")).reviewDatabases({ force: opts.force });
    const sum = (k: "reviewed" | "unchanged" | "failed") => results.reduce((n, r) => n + r[k], 0);
    const failed = sum("failed");
    const error = note ?? results.find((r) => r.error)?.error;
    return { ok: failed === 0 || sum("reviewed") > 0, all, relevant: sum("reviewed") + sum("unchanged") + failed, analyzed: sum("reviewed"), unchanged: sum("unchanged"), failed, ...(error ? { error } : {}) };
  })()
    .catch((e) => ({ ok: false, all, relevant: 0, analyzed: 0, unchanged: 0, failed: 0, error: errorMessage(e).slice(0, 300) }))
    .finally(() => {
      setAccountFlag("__zeffBoardLage", null);
      emitChange("kanban");
      emitChange("workspace");
    });
  setAccountFlag("__zeffBoardLage", run);
  return run;
}
