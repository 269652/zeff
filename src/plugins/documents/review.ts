/**
 * The Dokument-Durchsicht (the Documents plugin's extension for Todos, a step after the Ticket-Lage):
 * the AI reads the documents new or changed since it last read them and makes todos of what they
 * ask of you — a deadline, a form to submit, a bill to pay, a question to answer, a task in a
 * report — the document as the todo's source. A document is read again only once its text changes.
 * In batches, each its own prompt; one at a time. Server only.
 */
import { memoAll, memoMigrate, memoSetMany } from "@/lib/ai/memo";
import { promptText } from "@/lib/prompts";
import { runAi } from "@/lib/ai";
import { attributed } from "@/lib/todos/activity";
import { plain } from "@/lib/runs/collect";
import { duplicateTodo } from "@/lib/todos/similar";
import { addDocTodo, droppedByYou, listTodos } from "@/lib/todos/store";
import { lastGoodRun } from "@/lib/runs/store";
import { errorMessage } from "@/lib/errors";
import { emitChange } from "@/lib/events";
import { t } from "@/lib/i18n/server";
import { getJiraTicket } from "@/lib/jira/store";
import { isoDate } from "@/lib/week";
import { COPILOT_MAX_PROMPT } from "@/plugins/copilot-cli/cli";
import { readableDocuments } from "./store";
import { REVIEW_INSTRUCTIONS, REVIEW_RESERVE, REVIEW_SCHEMA, excerpt, proposedTodos, reviewLine, reviewPrompt, type Answer, type ReadableDoc } from "./review-core";
import { accountFlag, setAccountFlag } from "@/lib/sync/account-flags";
import { batchByChars, promptRoom } from "@/lib/ai/batch-job";

const BATCH_CHARS = COPILOT_MAX_PROMPT - REVIEW_RESERVE;
export { REVIEW_INSTRUCTIONS as INSTRUCTIONS, excerpt };

/** Which document was read at which version: in the AI memo (lib/ai/memo; the old table doc_reviewed moved in once). */
const SCOPE = "doc-reviewed";
function readAt(): Map<string, { hash: string }> {
  memoMigrate(SCOPE, "doc_reviewed", "select 'doc-reviewed' as scope, cast(id as text) as ref, version as hash, 'true' as value, reviewed_at as at from doc_reviewed");
  return memoAll<boolean>(SCOPE);
}

export type DocTodosResult = { ok: boolean; reviewed: number; added: number; /** New todos that repeated an open one and were merged into it. */ merged?: number; batches: number; error?: string };

/** The documents to read now: not read at this version of their text. */
function unread(): ReadableDoc[] {
  const seen = readAt();
  return readableDocuments().filter((d) => seen.get(String(d.id))?.hash !== d.version);
}

export function reviewDocumentsForTodos(runId: number | null = null): Promise<DocTodosResult> {
  const running = accountFlag<Promise<DocTodosResult>>("__zeffDocTodos");
  if (running) return running;
  const run = (async (): Promise<DocTodosResult> => {
    const docs = unread();
    const mark = (list: ReadableDoc[]) => memoSetMany(SCOPE, list.map((x) => ({ ref: String(x.id), hash: x.version, value: true })));
    // Those a todo already has as its source: gone through (a document you attached to a todo by hand is that todo's context).
    const cited = new Set(listTodos({ status: "all" }).flatMap((x) => x.refs.filter((r) => r.startsWith("doc:"))));
    const theirs = docs.filter((d) => cited.has(d.ref));
    mark(theirs);
    const todo = docs.filter((d) => !cited.has(d.ref)).sort((a, b) => a.version.localeCompare(b.version));
    if (!todo.length) return { ok: true, reviewed: theirs.length, added: 0, batches: 0 };

    const tickets = lastGoodRun()?.tickets.map((x) => x.key) ?? [];
    const ticketLines = tickets.map((k) => `- ${k}${getJiraTicket(k)?.summary ? ` — ${plain(getJiraTicket(k)!.summary, 120)}` : ""}`);
    const limit = promptRoom(BATCH_CHARS);
    const batches = batchByChars(todo, (d) => reviewLine(d).length + 1, limit);

    let added = 0;
    let merged = 0;
    let failed = 0;
    let reviewed = theirs.length;
    for (const batch of batches) {
      const open = listTodos({ status: "open" });
      // What you dropped isn't proposed again.
      const dropped = droppedByYou();
      const prompt = reviewPrompt({
        instructions: promptText("doc-review", REVIEW_INSTRUCTIONS),
        todayLong: new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
        today: isoDate(new Date()),
        tickets: ticketLines,
        open,
        batch,
      });
      const answer = await runAi<Answer>(prompt, REVIEW_SCHEMA, { task: "doc-todos", timeoutMs: 10 * 60000, maxBudgetUsd: 1 }).catch((e) => {
        console.error("[doc-todos]", errorMessage(e));
        failed++;
        return null;
      });
      // A batch that fails: its documents are read next time.
      if (!answer) continue;
      const known = new Set(batch.map((d) => d.ref));
      for (const td of proposedTodos(answer.output, known, tickets)) {
        // One you dropped isn't made again; one that repeats an open todo is merged into it (the gate).
        if (!duplicateTodo({ text: td.text, ops: [] }, open) && duplicateTodo({ text: td.text, ops: [] }, dropped)) continue;
        const made = attributed(runId ? `lage:${runId}` : "documents", () =>
          addDocTodo({ ticket: td.ticket, text: td.text, kind: td.kind, owner: td.owner, refs: td.refs, runId, due: td.due }),
        );
        // A todo that comes back (a rate every month): its rule is kept on it — the calendar shows the series, done it comes again.
        if (td.repeat && made.outcome !== "known") (await import("@/lib/todos/recurring")).setRecurrence(made.id, { freq: td.repeat.freq as "monthly", interval: 1, ...(td.repeat.until ? { until: td.repeat.until } : {}), ...(td.repeat.start ? { start: td.repeat.start } : {}) });
        if (made.outcome === "merged") merged++;
        else if (!made.outcome) {
          open.push(made);
          added++;
        }
      }
      mark(batch);
      reviewed += batch.length;
    }
    if (added || merged) emitChange("todos");
    return { ok: failed < batches.length, reviewed, added, merged, batches: batches.length, ...(failed ? { error: t("{failed} of {n} parts failed", { failed, n: batches.length }) } : {}) };
  })()
    .catch((e): DocTodosResult => {
      console.error("[doc-todos]", errorMessage(e));
      return { ok: false, reviewed: 0, added: 0, batches: 0, error: errorMessage(e) };
    })
    .finally(() => {
      setAccountFlag("__zeffDocTodos", null);
    });
  setAccountFlag("__zeffDocTodos", run);
  return run;
}
