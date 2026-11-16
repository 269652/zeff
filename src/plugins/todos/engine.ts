import { t } from "@/lib/i18n/server";

/**
 * What a click on a todo does, once — for the built-in's server actions (server-actions.ts) and the kernel's flow actions (flow-actions.ts: what a plugin's screen
 * of the todos calls), so both do the same and a screen made of the view language can't drift from the built-in. Server only.
 */

export type StatusResult = { ok: boolean; error?: string; confirm?: string };

/**
 * A todo's status, set by you. A repeat (the next rate) ticked off more than a week before its day is not done at once: the answer asks
 * (`confirm`) — the caller asks you and sends it again with `early`.
 */
export async function setStatusAsYou(id: number, status: "open" | "done" | "dismissed", opts: { early?: boolean; /** Called once the next step's actions are there (a page refreshes). */ afterOps?: () => void } = {}): Promise<StatusResult> {
  if (!Number.isInteger(id) || !["open", "done", "dismissed"].includes(status)) return { ok: false, error: t("Unknown todo.") };
  const { getTodo, setTodoStatus } = await import("@/lib/todos/store");
  const { attributed } = await import("@/lib/todos/activity");
  const before = getTodo(id);
  if (status === "done" && before?.status === "open" && !opts.early) {
    const { repeatNotYet } = await import("@/lib/todos/due-shared");
    const { formatDate } = await import("@/lib/format");
    const days = repeatNotYet(before);
    if (days !== null) {
      const ask = t("{ref} comes back every time — this one is only due on {date} (in {n} days). Mark it done already?", { ref: `T-${id}`, date: formatDate(before.due!.slice(0, 10)), n: days });
      return { ok: false, error: ask, confirm: ask };
    }
  }
  attributed("you", () => setTodoStatus(id, status, status === "open" ? null : undefined));
  // A "done" someone suggested (a worker, an agent, a review), confirmed by you: a verdict for the ledger.
  if (status === "done" && before?.workerDone && before.status === "open") {
    const { recordFeedback } = await import("@/lib/learning/ledger");
    const { workerDoneFeedback } = await import("@/lib/learning/sources");
    recordFeedback(workerDoneFeedback(before, "accepted"));
  }
  // A step ticked off brings the next one (a delivery): its actions from git, at once — no AI.
  if (status === "done") void import("@/lib/todos/delivery-ops").then((m) => m.attachOpenMrOps()).then(() => opts.afterOps?.()).catch(() => {});
  return { ok: true };
}

/** A todo's due day set by you: the things that take their date from it follow (a debt of your own — todo-settle.ts). */
export async function setDueAsYou(id: number, due: string | null): Promise<void> {
  const { setTodoDue } = await import("@/lib/todos/store");
  setTodoDue(Number(id), due ? String(due) : null);
  (await import("@/lib/todos/settle")).pushTodoDue(Number(id));
}

/**
 * Your note on a todo (context for whoever works on it): saved, its pictures made the todo's files, the todo brought up to date with it in the background
 * (or its actions proposed again). `message` says which.
 */
export async function addNoteAsYou(id: number, text: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  if (!String(text ?? "").trim()) return { ok: false, error: t("The note is empty.") };
  const { addTodoUserNote } = await import("@/lib/todos/store");
  const todo = addTodoUserNote(Number(id), String(text));
  // Pictures the note shows inline are the todo's files (the AI that works on it gets them as attachments).
  if (todo) await (await import("@/plugins/documents/attachments")).linkNoteImages(todo.id, String(text)).catch(() => 0);
  // The todo brought up to date with the note at once (its text, kind, done …, then its actions) — in the background, just this todo: no whole run needed.
  const { canRefreshTodo, refreshTodoSoon } = await import("@/lib/todos/refresh");
  if (todo && canRefreshTodo(todo)) {
    refreshTodoSoon(todo.id);
    return { ok: true, message: t("Note saved — the todo is being updated with it.") };
  }
  // (Can't now — a run under way: its actions proposed by the auto-actions, proposed again with the note.)
  if (todo?.autoOpsWhy && todo.ops.length && (await import("@/plugins/state")).isInstalled("auto-actions")) {
    const { reviewTodosForActions } = await import("@/plugins/auto-actions/review");
    void reviewTodosForActions({ ids: [todo.id] }).catch(() => {}).finally(async () => (await import("@/lib/events")).emitChange("todos"));
    return { ok: true, message: t("Note saved — the actions are proposed again with it.") };
  }
  return { ok: true };
}

/** A todo's operations run by you now (all, or just those at `only`): what was done; throws what went wrong. The auto-actions' proposal run by you is a verdict for the ledger. */
export async function runOpsAsYou(todoId: number, only?: number[]): Promise<{ message: string }> {
  const { runTodoOpsNow } = await import("@/lib/ops");
  const { getTodo } = await import("@/lib/todos/store");
  const proposed = getTodo(Number(todoId));
  const r = await runTodoOpsNow(Number(todoId), { only: Array.isArray(only) ? only.map(Number).filter(Number.isInteger) : undefined });
  if (proposed?.autoOpsWhy) {
    const { recordFeedback } = await import("@/lib/learning/ledger");
    const { autoActionsFeedback } = await import("@/lib/learning/sources");
    recordFeedback(autoActionsFeedback(proposed, "accepted"));
  }
  return { message: `${r.done.join(" · ")}${r.settled ? ` — ${t("done.")}` : ""}` };
}

/** One of a todo's actions taken off it (an action you don't want): its place in the list. */
export async function removeOpAsYou(todoId: number, index: number): Promise<{ ok: boolean; error?: string; message?: string }> {
  const { getTodo } = await import("@/lib/todos/store");
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const todo = getTodo(Number(todoId));
  const op = todo?.ops[Number(index)];
  if (!todo || !op) return { ok: false, error: t("That action isn't on the todo (any more).") };
  const left = todo.ops.filter((_, i) => i !== Number(index));
  getDb()
    .update(schema.todos)
    .set({ ops: JSON.stringify(left), actionsReviewedAt: new Date().toISOString(), ...(left.length ? {} : { autoOpsWhy: null }) })
    .where(eq(schema.todos.id, todo.id))
    .run();
  return { ok: true, message: t("Action removed.") };
}
