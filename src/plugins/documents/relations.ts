/**
 * The Dokument-Zuordnung (the Documents plugin's extension for Todos, a step after the Ticket-Lage):
 * each open todo gets the documents it's about. Too many documents to show them all: per todo the
 * likeliest few by shared words (its text, its ticket's title ↔ a document's name, abstract,
 * concepts and the beginning of its text), then the AI picks by content. They become the todo's
 * related documents (with its related mails and notes): shown at it, in its context and its
 * agents'. Documents you attached by hand stay as they are. Server only.
 */
import { promptText } from "@/lib/prompts";
import type { TodoView } from "@/lib/todos/shared";
import { listTodos, setTodoDocRefs } from "@/lib/todos/store";
import { getJiraTicket } from "@/lib/jira/store";
import { COPILOT_MAX_PROMPT } from "@/plugins/copilot-cli/cli";
import { readableDocuments, type ReadableDoc } from "./store";
import { RELATE_INSTRUCTIONS, RELATE_RESERVE, RELATE_SCHEMA, candidates as candidatesOf, docWords, pickedRefs, relateBlock, words } from "./relations-core";
import { promptRoom, relateInBatches, relateJob } from "@/lib/ai/batch-job";

const BATCH_CHARS = COPILOT_MAX_PROMPT - RELATE_RESERVE;
export { RELATE_INSTRUCTIONS as INSTRUCTIONS, words, candidates as candidatesOf };

export type DocRelationResult = { ok: boolean; todos: number; changed: number; batches: number; error?: string };

/** The documents likeliest to be about a todo (the core's, with its ticket's title from Jira). */
export function candidates(todo: TodoView, docs: { d: ReadableDoc; w: Set<string> }[]): ReadableDoc[] {
  const summary = todo.ticket ? (getJiraTicket(todo.ticket)?.summary ?? "") : "";
  return candidatesOf(todo, summary, docs as never) as ReadableDoc[];
}

export function relateDocuments(): Promise<DocRelationResult> {
  return relateJob("__zeffDocRelations", "doc-relations", async () => {
    const open = listTodos({ status: "open" });
    const docs = readableDocuments().map((d) => ({ d, w: docWords(d) }));
    const picks = new Map<number, string[]>();
    const groups: { todo: TodoView; list: ReadableDoc[] }[] = [];
    for (const todo of open) {
      const list = candidates(todo, docs);
      if (list.length) groups.push({ todo, list });
      else picks.set(todo.id, []); // nothing likely: no documents
    }
    // A batch that fails: its todos keep the documents they have.
    const { batches, failed } = await relateInBatches({
      task: "doc-relations",
      groups,
      block: (g) => relateBlock(g.todo, g.list),
      room: promptRoom(BATCH_CHARS),
      prompt: (blocks) => `${promptText("doc-relations", RELATE_INSTRUCTIONS)}

${blocks}`,
      schema: RELATE_SCHEMA,
      field: "docs",
      take: (g, said) => {
        picks.set(g.todo.id, pickedRefs(said.get(g.todo.id), g.list));
      },
    });
    const changed = setTodoDocRefs(picks);
    return { todos: picks.size, changed, batches, failed };
  });
}
