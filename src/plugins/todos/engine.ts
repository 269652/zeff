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
