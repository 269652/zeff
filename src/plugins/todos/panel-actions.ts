import type { FlowAction } from "../workspace/flows/actions";
import type { FieldSpec } from "../workspace/flows/types";
import { t } from "@/lib/i18n/server";

/**
 * What a todo's panel and row do beyond ticking it off — the same calls the built-in's server actions make (server-actions.ts), as the kernel's flow actions for plugins' screens:
 * a note changed or put on Jira, an instruction to Copilot, a reply drafted by the AI, the AI's actions proposed again, another way to do it, a repeat's rule, a time record taken
 * away, an action's text or a transfer's fields changed, "worked on it", a browser action done, a context taken off. Nothing here knows which plugin calls it. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
type Ctx = Parameters<FlowAction["run"]>[1];
const need = (ctx: Ctx, ...perms: ("todos" | "api")[]) => {
  for (const p of perms) if (!ctx.perms[p]) throw new Error(`This flow may not change todos — grant it the permission “${p}”.`);
};
const fail = (error: string) => ({ ok: false, message: "", error });
const done = (message = "") => ({ ok: true, message, error: "" });
const OUT = "{ ok, message, error }";

export const PANEL_ACTIONS: FlowAction[] = [
  {
    name: "todos.update-note",
    group: "todos",
    label: "Change a note",
    summary: "Your note on a todo (found by its time) changed; the pictures it shows become the todo's files. Needs the flow's todos permission.",
    input: [f("id", "number", { required: true }), f("at", "text", { required: true }), f("text", "text", { required: true })],
    output: OUT,
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos");
      if (ctx.dryRun) return done();
      (await import("@/lib/todos/store")).updateTodoUserNote(Number(i.id), String(i.at), String(i.text ?? ""));
      await (await import("@/plugins/documents/attachments")).linkNoteImages(Number(i.id), String(i.text ?? "")).catch(() => 0);
      return done();
    },
  },
  {
    name: "todos.sync-note",
    group: "todos",
    label: "Put a note on Jira",
    summary: "Your note on a todo posted on its ticket in Jira as a comment — or the comment there updated (or posted again when it is gone). Needs the flow's permissions todos and api.",
    input: [f("id", "number", { required: true }), f("at", "text", { required: true })],
    output: OUT,
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos", "api");
      if (ctx.dryRun) return done();
      try {
        const r = await (await import("@/lib/jira/note-sync")).syncNoteToJira(Number(i.id), String(i.at));
        const hint = r.noAccount.length ? ` ${t("No Jira account linked for {names} — written out, not mentioned.", { names: r.noAccount.join(", ") })}` : "";
        const what = r.state === "posted" ? t("Note put on Jira as a comment.") : r.state === "updated" ? t("The comment on Jira is updated.") : r.state === "reposted" ? t("The comment was gone from Jira — the note is posted again.") : t("The comment on Jira is as the note is.");
        return done(`${what}${hint}`);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: "todos.instruct",
    group: "todos",
    label: "An instruction to Copilot",
    summary: "Your instruction on a todo done by the Copilot CLI — a run on the Code tab: { ok, message }. Needs the flow's permissions todos and api.",
    input: [f("id", "number", { required: true }), f("text", "text", { required: true })],
    output: OUT,
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos", "api");
      const text = String(i.text ?? "").trim();
      if (!text) return fail(t("What should Copilot do?"));
      if (ctx.dryRun) return done();
      try {
        const run = (await import("@/lib/work/runner")).dispatchTodo(Number(i.id), { provider: "copilot", instruction: text.slice(0, 8000) });
        return done(run.status === "running" ? t("{run} (Copilot) is running.", { run: run.ref }) : t("{run} (Copilot) is waiting for a free worker.", { run: run.ref }));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: "todos.draft-reply",
    group: "todos",
    label: "Draft a reply",
    summary: "A reply to the message a todo is about, written by the AI from the conversation (mail, Teams, WhatsApp, Signal) — never sent: { ok, text, channel, to, openUrl, error }. Needs the flow's permissions todos, ai and api.",
    input: [f("id", "number", { required: true })],
    output: "{ ok, text, channel, to, openUrl, error }",
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos", "api");
      if (!ctx.perms.ai) throw new Error("This flow may not use the AI — grant it the permission “ai”.");
      if (ctx.dryRun) return { ok: true, text: "", channel: "", to: "", openUrl: "", error: "" };
      const r = await (await import("@/lib/todos/reply-draft")).draftReply(Number(i.id)).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
      return r.ok ? { ok: true, text: r.text, channel: r.target.channel, to: r.target.to, openUrl: r.target.openUrl, error: "" } : { ok: false, text: "", channel: "", to: "", openUrl: "", error: r.error };
    },
  },
  {
    name: "todos.open-reply",
    group: "todos",
    label: "Bring a reply's page to the front",
    summary: "The page a reply goes to (WhatsApp Web, Gmail, Outlook, Teams) brought to the front in the automation Chrome, where you are signed in: { ok, message, error }. Needs the flow's permissions todos and api.",
    input: [f("url", "text", { required: true })],
    output: OUT,
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos", "api");
      if (ctx.dryRun) return done();
      const { REPLY_HOSTS } = await import("@/lib/todos/reply-draft");
      if (!REPLY_HOSTS.test(String(i.url))) return fail(t("Zeff doesn't open this address."));
      const r = await (await import("@/lib/attention")).openInAutomationChrome(String(i.url), new URL(String(i.url)).host);
      return r.ok ? done(t("In front in the automation Chrome — paste the draft and send it.")) : fail(r.message);
    },
  },
  {
    name: "todos.suggest-actions",
    group: "todos",
    label: "The AI proposes actions for a todo",
    summary: "The AI proposes the actions for this todo now, with everything it knows (a message, a comment, a mail, a meeting …): { ok, message, error }. Needs the flow's permissions todos and api, and the Auto actions plugin.",
    input: [f("id", "number", { required: true })],
    output: OUT,
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos", "api");
      if (ctx.dryRun) return done();
      const { isInstalled } = await import("@/plugins/state");
      if (!isInstalled("auto-actions")) return fail(t("Auto actions are not installed (Menu → Plugins)."));
      const r = await (await import("@/plugins/auto-actions/review")).reviewTodosForActions({ ids: [Number(i.id)] });
      if (!r.ok) return fail(r.error ?? t("The AI didn't answer."));
      if (!r.reviewed) return fail(t("The todo already has actions (from the briefing) — they stay."));
      return done(r.withActions ? t("Actions suggested — on the todo.") : t("No fitting action found."));
    },
  },
  {
    name: "todos.run-alternative",
    group: "todos",
    label: "Do a todo another way",
    summary: "One of a todo's other ways to be done (by its label): its actions replaced and run — or, for one done on its own, a todo of its own under this one, run at once: { ok, message, error }. Needs the flow's permissions todos and api.",
    input: [f("id", "number", { required: true }), f("label", "text", { required: true })],
    output: OUT,
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos", "api");
      if (ctx.dryRun) return done();
      const { getTodo, setTodoOps, addFollowUp } = await import("@/lib/todos/store");
      const { todoAlternatives } = await import("@/lib/todos/alternatives");
      const todo = getTodo(Number(i.id));
      if (!todo || todo.status !== "open") return fail(t("That todo isn't open."));
      const alt = (todoAlternatives([todo])[todo.id] ?? []).find((a) => a.label === String(i.label));
      if (!alt) return fail(t("That option isn't there any more."));
      const { dispatchTodo } = await import("@/lib/work/runner");
      try {
        if (alt.also) {
          const { attributed } = await import("@/lib/todos/activity");
          const child = attributed("you", () => addFollowUp({ ticket: todo.ticket, text: alt.title, kind: "update", parentId: todo.id, workRunId: null, source: `Option for ${todo.ref}`, ops: alt.ops }));
          return done(`${dispatchTodo(child.id).ref}: ${alt.title}.`);
        }
        setTodoOps(todo.id, alt.ops, alt.text);
        return done(`${dispatchTodo(todo.id).ref}: ${alt.label}.`);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: "todos.set-recurrence",
    group: "todos",
    label: "Make a todo come back",
    summary: "A todo that comes back every day, week, month or year (its due day is the day) — or not (empty); the words of its repeats are written in the background. Needs the flow's todos permission.",
    input: [f("id", "number", { required: true }), f("freq", "text", { options: ["", "daily", "weekly", "monthly", "yearly"] })],
    output: OUT,
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos");
      if (ctx.dryRun) return done();
      const freq = ["daily", "weekly", "monthly", "yearly"].includes(String(i.freq)) ? (String(i.freq) as "daily" | "weekly" | "monthly" | "yearly") : null;
      (await import("@/lib/todos/recurring")).setRecurrence(Number(i.id), freq ? { freq, interval: 1 } : null);
      if (freq) void import("@/lib/todos/repeat-text-ai").then((m) => m.writeRepeatTexts([Number(i.id)])).catch(() => undefined);
      (await import("@/lib/events")).emitChange("todos");
      return done();
    },
  },
  {
    name: "todos.regenerate-series",
    group: "todos",
    label: "Make a repeat's appointments and actions again",
    summary: "A recurring todo's calendar appointments and its actions made again (the AI's proposals; yours stay): { ok, message }. Needs the flow's permissions todos and api.",
    input: [f("id", "number", { required: true })],
    output: OUT,
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos", "api");
      if (ctx.dryRun) return done();
      (await import("@/lib/todos/recurring")).regenerateSeries(Number(i.id));
      let actions = "";
      const { isInstalled } = await import("@/plugins/state");
      if (isInstalled("auto-actions")) {
        const r = await (await import("@/plugins/auto-actions/review")).reviewTodosForActions({ ids: [Number(i.id)] });
        actions = r.ok ? ` ${r.withActions ? t("Actions suggested — on the todo.") : t("No fitting action found.")}` : ` ${r.error ?? ""}`;
      }
      (await import("@/lib/events")).emitChange("todos");
      return done(`${t("Calendar appointments made again.")}${actions}`.trim());
    },
  },
  {
    name: "todos.delete-time",
    group: "todos",
    label: "Take a time record off a todo",
    summary: "A time record (its id) taken away. Needs the flow's todos permission.",
    input: [f("id", "number", { required: true })],
    output: "{}",
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos");
      if (!ctx.dryRun) (await import("@/lib/work/todo-time")).deleteTodoTime(Number(i.id));
      return {};
    },
  },
  {
    name: "todos.worked-on",
    group: "todos",
    label: "Worked on it",
    summary: "A booking suggestion for the todo (its ticket, its recorded time) — the todo stays open: { ok, message }. Needs the flow's todos permission.",
    input: [f("id", "number", { required: true })],
    output: OUT,
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos");
      if (ctx.dryRun) return done();
      const { suggestWorkedOn, suggestionRef } = await import("@/lib/work/suggestions");
      const made = suggestWorkedOn([Number(i.id)], { reportedBy: "Du" });
      return done(made.length ? t("{ref} suggested — in the Weekly report you can take it over.", { ref: suggestionRef(made[0].id) }) : t("There is a booking suggestion for it today already — or it has no ticket."));
    },
  },
  {
    name: "todos.dismiss-context",
    group: "todos",
    label: "Take a context off a todo",
    summary: "What a todo is shown to come from (a mail, a note, a document: its ref) taken off it. Needs the flow's todos permission.",
    input: [f("id", "number", { required: true }), f("ref", "text", { required: true })],
    output: "{}",
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos");
      if (!ctx.dryRun) (await import("@/lib/todos/store")).dismissTodoContext(Number(i.id), String(i.ref ?? ""));
      return {};
    },
  },
  {
    name: "todos.save-op-text",
    group: "todos",
    label: "Change the text an action would send",
    summary: "The text of one of a todo's actions (a comment, a reply, a message) changed before it is sent (its place, the text): { ok, message, error }. Needs the flow's todos permission.",
    input: [f("id", "number", { required: true }), f("index", "number", { required: true }), f("text", "text", { required: true })],
    output: OUT,
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos");
      if (ctx.dryRun) return done();
      const { getTodo, setTodoOps } = await import("@/lib/todos/store");
      const todo = getTodo(Number(i.id));
      if (!todo || todo.status !== "open") return fail(t("That todo isn't open."));
      const op = todo.ops[Number(i.index)];
      const body = String(i.text ?? "").trim();
      if (!op || !("body" in op)) return fail(t("That operation has no text."));
      if (!body) return fail(t("Empty text."));
      setTodoOps(todo.id, todo.ops.map((o, n) => (n === Number(i.index) ? { ...o, body: body.slice(0, 8000) } : o)) as typeof todo.ops);
      return done(t("Saved."));
    },
  },
  {
    name: "todos.save-transfer",
    group: "todos",
    label: "Change a transfer's fields",
    summary: "A transfer on a todo changed (its place, name, iban, bic, amount, purpose) — checked as an action is; the account entered for a contact is kept with them: { ok, message, error }. Needs the flow's todos permission.",
    input: [f("id", "number", { required: true }), f("index", "number", { required: true }), f("name", "text"), f("iban", "text"), f("bic", "text"), f("amount", "text"), f("purpose", "text")],
    output: OUT,
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos");
      if (ctx.dryRun) return done();
      const { getTodo, setTodoOps } = await import("@/lib/todos/store");
      const todo = getTodo(Number(i.id));
      if (!todo || todo.status !== "open") return fail(t("That todo isn't open."));
      const op = todo.ops[Number(i.index)];
      if (!op || op.type !== "bank-transfer") return fail(t("That action isn't on the todo (any more)."));
      const { CASES_ACTIONS } = await import("@/plugins/cases/actions");
      const fields = { name: String(i.name ?? ""), iban: String(i.iban ?? ""), bic: String(i.bic ?? ""), amount: String(i.amount ?? ""), purpose: String(i.purpose ?? "") };
      const next = CASES_ACTIONS[0].clean({ ...fields }, { ticket: todo.ticket });
      if (!next) return fail(t("Not a valid IBAN."));
      setTodoOps(todo.id, todo.ops.map((o, n) => (n === Number(i.index) ? next : o)) as typeof todo.ops);
      const kept = next.type === "bank-transfer" && next.iban ? await (await import("@/plugins/people/details")).rememberAccount(next.name, next.iban, next.bic) : null;
      return done(kept ? t("Saved — the account is kept with {name}.", { name: kept }) : t("Saved."));
    },
  },
  {
    name: "todos.done-browser-op",
    group: "todos",
    label: "An action done in your browser",
    summary: "An action you did yourself in the browser (the appointment saved in Outlook, the mail sent) taken off the todo and noted on it; a mail that answers or a payment is the todo done: { ok, message, error }. Needs the flow's todos permission.",
    input: [f("id", "number", { required: true }), f("index", "number", { required: true })],
    output: OUT,
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos");
      if (ctx.dryRun) return done();
      const r = await (await import("./engine")).doneBrowserOpAsYou(Number(i.id), Number(i.index));
      return r.ok ? done(r.message) : fail(r.error ?? "");
    },
  },
  {
    name: "todos.ask-ticket",
    group: "todos",
    label: "Ask about a ticket",
    summary: "A question about a ticket answered from what Zeff knows (its Lage, todos, comments, mails, the knowledge base): { ok, answer, sources, id, error }. Needs the flow's permissions todos, ai and api.",
    input: [f("ticket", "text", { required: true }), f("question", "text", { required: true })],
    output: "{ ok, answer, sources, id, error }",
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos", "api");
      if (!ctx.perms.ai) throw new Error("This flow may not use the AI — grant it the permission “ai”.");
      if (ctx.dryRun) return { ok: true, answer: "", sources: [], id: 0, error: "" };
      try {
        const item = await (await import("@/lib/runs/ticket-chat")).askTicket(String(i.ticket ?? ""), String(i.question ?? ""));
        return { ok: true, answer: item.a, sources: item.sources, id: item.id, error: "" };
      } catch (e) {
        return { ok: false, answer: "", sources: [], id: 0, error: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    name: "todos.dismiss-chat",
    group: "todos",
    label: "Take an answer out of a ticket's chat",
    summary: "An answer of a ticket's chat taken out of its context (its id). Needs the flow's todos permission.",
    input: [f("id", "number", { required: true })],
    output: "{}",
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos");
      if (!ctx.dryRun) (await import("@/lib/runs/ticket-chat")).dismissChatItem(Number(i.id));
      return {};
    },
  },
  {
    name: "todos.resolve-comment",
    group: "todos",
    label: "A comment done — or not",
    summary: "A Jira comment (kind jira, key: its id, ticket) or a GitLab comment (kind gitlab, key: \"note:<id>\") marked done here — done ones don't feed new todos — or taken back (resolved): { ok, error }. Needs the flow's permissions todos and api.",
    input: [f("kind", "text", { required: true, options: ["jira", "gitlab"] }), f("key", "text", { required: true }), f("ticket", "text"), f("resolved", "boolean", { required: true })],
    output: "{ ok, error }",
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos", "api");
      if (ctx.dryRun) return { ok: true, error: "" };
      const resolved = i.resolved === true || i.resolved === "true";
      if (i.kind === "jira") {
        if (!/^\d+$/.test(String(i.key)) || !/^[A-Z][A-Z0-9]+-\d+$/i.test(String(i.ticket))) return { ok: false, error: t("Unknown comment.") };
        (await import("@/lib/resolved")).setJiraCommentResolved(String(i.key), String(i.ticket), resolved);
        return { ok: true, error: "" };
      }
      if (!/^note:\d+$/.test(String(i.key))) return { ok: false, error: t("Only GitLab comments can be marked done.") };
      const { gitlabItemsByKeys, setGitlabState } = await import("@/lib/gitlab/store");
      const item = gitlabItemsByKeys([String(i.key)]).get(String(i.key));
      if (item && (item.state === "resolved" || item.state === "unresolved")) {
        const r = await (await import("@/lib/gitlab/reply")).resolveGitlabThread(item.url, resolved);
        if (r.resolvable) setGitlabState(String(i.key), resolved ? "resolved" : "unresolved");
      }
      (await import("@/lib/resolved")).setGitlabResolved(String(i.key), resolved);
      return { ok: true, error: "" };
    },
  },
  {
    name: "todos.board-settings",
    group: "todos",
    label: "Which tickets the briefing reads",
    summary: "The JQL filter of the briefing (which tickets on your boards), at least five characters: { ok, message, error }. Needs the flow's todos permission.",
    input: [f("jql", "text", { required: true })],
    output: OUT,
    writes: true,
    run: async (i, ctx) => {
      need(ctx, "todos");
      const jql = String(i.jql ?? "").trim();
      if (jql.length < 5) return fail(t("A JQL filter, e.g.: {example}", { example: "assignee = currentUser() AND resolution = Unresolved" }));
      if (ctx.dryRun) return done();
      (await import("@/lib/runs/store")).updateBoardSettings({ jql: jql.slice(0, 1000) });
      return done(t("Saved."));
    },
  },
  {
    name: "todos.rows-seen",
    group: "todos",
    label: "The todos you have looked at",
    summary: "Now is kept as the time up to which you have seen the todos: what was made (or took a duplicate in) after it shows as new. The first call only starts the count. Needs the flow's todos permission.",
    input: [],
    output: "{}",
    writes: true,
    run: async (_i, ctx) => {
      need(ctx, "todos");
      if (!ctx.dryRun) (await import("@/lib/prefs")).setPref("todos:seen-at", new Date().toISOString());
      return {};
    },
  },
];
