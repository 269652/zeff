"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { revalidateAll, str, type ActionState } from "@/app/action-helpers";

/** Boards (your tickets gone through the Claude CLI: what happened, what's to do) — its server actions (each answers an ActionState unless it says otherwise). */

/** Which tickets on the chosen boards (a JQL filter) — how often a run goes by itself: the Sync settings page. */
export async function saveBoardSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const jql = (str(fd, "jql") ?? "").trim();
  if (jql.length < 5) return { ok: false, error: t("A JQL filter, e.g.: {example}", { example: "assignee = currentUser() AND resolution = Unresolved" }) };
  const { updateBoardSettings } = await import("@/lib/runs/store");
  updateBoardSettings({ jql: jql.slice(0, 1000) });
  revalidatePath("/todos");
  return { ok: true, message: t("Saved.") };
}

/** A todo done, dismissed, or open again. */
/** A todo you add to a ticket yourself — a Kanban card's checklist. */
export async function addCardTodoAction(ticket: string, text: string): Promise<ActionState> {
  try {
    const body = String(text ?? "").trim();
    const k = String(ticket ?? "").trim();
    if (!body) return { ok: false, error: t("What's to be done?") };
    if (!k) return { ok: false, error: t("No card.") };
    const { addManualTodo } = await import("@/lib/todos/store");
    const todo = addManualTodo({ ticket: k, text: body });
    revalidateAll();
    return { ok: true, message: todo.outcome === "merged" ? t("{ref} says the same already - merged into it.", { ref: todo.ref }) : t("{ref} created.", { ref: todo.ref }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A todo's text changed in the todo block. */
export async function setTodoTextAction(id: number, text: string): Promise<ActionState> {
  try {
    const { setTodoText } = await import("@/lib/todos/store");
    setTodoText(Number(id), String(text ?? ""));
    revalidateAll();
    return { ok: true, message: t("Saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * A todo's status, set by you. A repeat (the next rate) ticked off more than a week before its day is not done at once: the answer asks
 * (`confirm`) — the caller asks you and sends it again with `early` (setTodoStatusConfirmed does both).
 */
export async function setTodoStatusAction(id: number, status: "open" | "done" | "dismissed", opts: { early?: boolean } = {}): Promise<ActionState & { confirm?: string }> {
  try {
    const { setStatusAsYou } = await import("./engine");
    const r = await setStatusAsYou(id, status, { ...opts, afterOps: revalidateAll });
    if (r.ok) revalidateAll();
    return r;
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The context search's todos: done ones first (work that backs an entry), then open ones. */
export async function searchTodosAction(q: string): Promise<import("@/lib/todos/shared").TodoView[]> {
  const { searchTodos } = await import("@/lib/todos/store");
  return searchTodos(String(q ?? "").slice(0, 200));
}

/** A todo's operations, run now by Zeff itself (a WhatsApp message, a note, a comment) — not through Work. */
export async function runTodoOpsAction(todoId: number, only?: number[]): Promise<ActionState> {
  try {
    const r = await (await import("./engine")).runOpsAsYou(todoId, only);
    revalidateAll();
    return { ok: true, message: r.message };
  } catch (err) {
    revalidateAll();
    return { ok: false, error: errorMessage(err) };
  }
}

/** The Auswerten page: one step's context settings (sources, numbers, its own instructions). */
export async function saveContextPrefsAction(step: string, patch: { sources?: Record<string, boolean>; numbers?: Record<string, number>; extra?: string }): Promise<ActionState> {
  try {
    const { CONTEXT_STEP_IDS } = await import("@/lib/runs/context-prefs-shared");
    if (!(CONTEXT_STEP_IDS as readonly string[]).includes(step)) return { ok: false, error: t("Unknown step.") };
    const { setStepPrefs } = await import("@/lib/runs/context-prefs");
    setStepPrefs(step as (typeof CONTEXT_STEP_IDS)[number], patch ?? {});
    revalidatePath("/settings/ai");
    return { ok: true, message: t("Saved — applies from the next run on.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A todo's deadline (YYYY-MM-DD) — or none. */
export async function setTodoDueAction(todoId: number, due: string | null): Promise<ActionState> {
  try {
    await (await import("./engine")).setDueAsYou(todoId, due);
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Time you spent on a todo, by hand: minutes and one line (a record like the agents'). The record saved — shown at once, before the page's refresh comes. */
export async function addTodoTimeAction(todoId: number, minutes: number, note: string): Promise<ActionState & { record?: import("@/lib/work/shared").TimeRecord }> {
  try {
    const { addTodoTime } = await import("@/lib/work/todo-time");
    const record = addTodoTime({ todoId: Number(todoId), minutes: Number(minutes), note: String(note ?? ""), by: "Du", source: "hand" });
    revalidateAll();
    return { ok: true, record };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Your note on a todo changed. */
export async function updateTodoNoteAction(todoId: number, at: string, text: string): Promise<ActionState> {
  try {
    const { updateTodoUserNote } = await import("@/lib/todos/store");
    updateTodoUserNote(Number(todoId), String(at), String(text ?? ""));
    await (await import("@/plugins/documents/attachments")).linkNoteImages(Number(todoId), String(text ?? "")).catch(() => 0);
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Your note put on the todo's Jira ticket as a comment (edited there when the note changed since); tagged people become Jira mentions. */
export async function syncNoteToJiraAction(todoId: number, at: string): Promise<ActionState> {
  try {
    const { syncNoteToJira } = await import("@/lib/jira/note-sync");
    const r = await syncNoteToJira(Number(todoId), String(at));
    revalidateAll();
    const hint = r.noAccount.length ? ` ${t("No Jira account linked for {names} — written out, not mentioned.", { names: r.noAccount.join(", ") })}` : "";
    const what =
      r.state === "posted"
        ? t("Note put on Jira as a comment.")
        : r.state === "updated"
          ? t("The comment on Jira is updated.")
          : r.state === "reposted"
            ? t("The comment was gone from Jira — the note is posted again.")
            : t("The comment on Jira is as the note is.");
    return { ok: true, message: `${what}${hint}` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** (Moved to the People plugin: kept here for older imports.) */
export async function searchPeopleAction(q: string): Promise<{ id: number; name: string; jira: string | null }[]> {
  return (await import("@/plugins/people/server-actions")).searchPeopleAction(q);
}

/** A context item taken out of a todo by hand — it stays out. */
export async function dismissTodoContextAction(todoId: number, ref: string): Promise<ActionState> {
  try {
    const { dismissTodoContext } = await import("@/lib/todos/store");
    dismissTodoContext(Number(todoId), String(ref ?? ""));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A question to a ticket: answered from what Zeff has on it, kept as the ticket's context (until dismissed). */
export async function askTicketAction(ticket: string, question: string): Promise<{ ok: boolean; item?: import("@/lib/runs/ticket-chat").ChatItem; error?: string }> {
  try {
    const { askTicket } = await import("@/lib/runs/ticket-chat");
    const item = await askTicket(String(ticket ?? ""), String(question ?? ""));
    revalidateAll();
    return { ok: true, item };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** An answer of a ticket's chat taken out of its context. */
export async function dismissChatItemAction(id: number): Promise<ActionState> {
  try {
    const { dismissChatItem } = await import("@/lib/runs/ticket-chat");
    dismissChatItem(Number(id));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function removeTodoNoteAction(todoId: number, at: string): Promise<ActionState> {
  try {
    const { removeTodoUserNote } = await import("@/lib/todos/store");
    removeTodoUserNote(Number(todoId), String(at));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A transfer's fields changed on its card (recipient, account, amount, purpose) — checked like the action itself. */
export async function saveTransferAction(todoId: number, index: number, fields: { name: string; iban: string; bic: string; amount: string; purpose: string }): Promise<ActionState & { kept?: string }> {
  try {
    const { getTodo, setTodoOps } = await import("@/lib/todos/store");
    const todo = getTodo(Number(todoId));
    if (!todo || todo.status !== "open") return { ok: false, error: t("That todo isn't open.") };
    const op = todo.ops[Number(index)];
    if (!op || op.type !== "bank-transfer") return { ok: false, error: t("That action isn't on the todo (any more).") };
    const { CASES_ACTIONS } = await import("@/plugins/cases/actions");
    const next = CASES_ACTIONS[0].clean({ ...fields }, { ticket: todo.ticket });
    if (!next) return { ok: false, error: t("Not a valid IBAN.") };
    setTodoOps(todo.id, todo.ops.map((o, i) => (i === Number(index) ? next : o)) as typeof todo.ops);
    // The account entered for a contact (the one person the recipient names): kept with them — the next transfer has it.
    const kept = next.type === "bank-transfer" && next.iban ? await (await import("@/plugins/people/details")).rememberAccount(next.name, next.iban, next.bic) : null;
    revalidateAll();
    return { ok: true, message: kept ? t("Saved — the account is kept with {name}.", { name: kept }) : t("Saved."), ...(kept ? { kept } : {}) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * An action you did in your browser (the appointment saved in Outlook, the mail draft sent):
 * taken off the todo and noted on it — so the Lage and everyone know. A mail that is the todo
 * (a reply, a question) ticks it off.
 */
export async function doneBrowserOpAction(todoId: number, index: number): Promise<ActionState> {
  try {
    const r = await (await import("./engine")).doneBrowserOpAsYou(todoId, index);
    revalidateAll();
    return r;
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** An action taken off a todo, without a trace (not wanted) — the auto-actions don't propose it again till the todo changes. */
export async function removeTodoOpAction(todoId: number, index: number): Promise<ActionState> {
  try {
    const r = await (await import("./engine")).removeOpAsYou(todoId, index);
    if (r.ok) revalidateAll();
    return r;
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Settings → Todos: which toggles a todo shows and which kinds of knowledge go into it (what's unticked is off). */
export async function saveTodoDisplayFormAction(fd: FormData): Promise<void> {
  const { AREAS, KNOWLEDGE_KINDS } = await import("@/lib/todo-display");
  const { setTodoDisplayOff } = await import("@/lib/todo-display-store");
  const ids = [...AREAS.map((a) => `area:${a}`), ...KNOWLEDGE_KINDS.map((k) => `kind:${k}`), "entities", "links", "mergeGate"];
  setTodoDisplayOff(ids.filter((id) => fd.get(id) !== "on"));
  // The rules of the knowledge's picking stage (only on the form when the Knowledge plugin is installed): unchanged = the built-in ones.
  const rules = fd.get("repoPrompt");
  if (typeof rules === "string") {
    const { DEFAULT_PICK_PROMPT } = await import("@/plugins/knowledge/repo-prompt");
    const { setPickPrompt } = await import("@/plugins/knowledge/repo-systems-store");
    const text = rules.replace(/\r\n/g, "\n").trim();
    setPickPrompt(fd.get("resetRepoPrompt") || text === DEFAULT_PICK_PROMPT ? "" : text);
  }
  revalidateAll();
}

/** Today → "Plan my day": the AI's proposal of time blocks for today's todos (lib/heute-plan.ts) — nothing is written yet. */
export async function planDayAction(): Promise<{ ok: true; plan: import("@/lib/heute-plan").DayPlan } | { ok: false; error: string }> {
  try {
    return { ok: true, plan: await (await import("@/lib/heute-plan")).planDay() };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Today → the day's plan applied: its blocks proposed appointments in the Zeff calendar (the day's replaced when applied again). */
export async function applyDayPlanAction(day: string, blocks: import("@/lib/heute-plan").PlanBlock[]): Promise<ActionState & { calendarId?: number }> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(blocks)) return { ok: false, error: t("Nothing to apply.") };
    const clean = blocks
      .filter((b) => typeof b?.title === "string" && typeof b.start === "string" && typeof b.end === "string" && b.start.startsWith(day) && b.end.startsWith(day))
      .map((b) => ({ title: b.title.slice(0, 200), start: b.start.slice(0, 16), end: b.end.slice(0, 16), todoId: Number.isInteger(b.todoId) ? b.todoId : null }));
    const r = (await import("@/lib/heute-plan")).applyDayPlan(day, clean);
    revalidateAll();
    return { ok: true, calendarId: r.calendarId, message: r.count === 1 ? t("1 block in the calendar, as a suggestion.") : t("{n} blocks in the calendar, as suggestions.", { n: r.count }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The Todos tab's badge: which numbers, in which order and colours (Settings → Badges). Saved as you change it. */
export async function saveTodoBadgeAction(config: unknown): Promise<ActionState> {
  const { setTodoBadge } = await import("@/lib/todos/badge-store");
  setTodoBadge(config);
  revalidateAll();
  return { ok: true, message: t("Saved.") };
}
