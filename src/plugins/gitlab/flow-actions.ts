import type { FlowAction } from "@/plugins/workspace/flows/actions";

/**
 * What flows can do in GitLab — through Zeff's GitLab connection (GitLab settings): answer a comment, mark its thread resolved, merge a
 * merge request, sync. What an app built in the Workspace (GitLab's own view, one the AI makes) does with a button. Changing GitLab is
 * sending out: a flow needs "send", and a dry run only says what it would do.
 */

const noteOf = (v: unknown) => {
  const m = /(\d+)\s*$/.exec(String(v ?? ""));
  if (!m) throw new Error(`“${String(v ?? "")}” is not a GitLab comment (note:123 or its number).`);
  return `note:${m[1]}`;
};

type Ctx = Parameters<FlowAction["run"]>[1];
/** What GitLab's run said it did (it throws when it couldn't). */
const done = (r: { what: string }) => ({ done: r.what });
/** Changing GitLab: allowed to send? A dry run: what it would do. */
const guard = (ctx: Ctx, would: unknown) => {
  ctx.may("send");
  return ctx.dryRun ? { dryRun: true, would } : null;
};

export const GITLAB_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "gitlab.reply",
    group: "gitlab",
    label: "Answer a GitLab comment",
    summary: "Writes an answer in a comment's thread in GitLab. Changes GitLab: the flow needs “send”.",
    input: [
      { name: "note", type: "text", required: true, help: "The comment: note:123 (an item's key) or its number" },
      { name: "body", type: "text", required: true, help: "The answer (Markdown)" },
    ],
    output: "{ done }",
    needs: ["send"],
    writes: true,
    run: async (i, ctx) => {
      const op = { type: "gitlab-reply" as const, note: noteOf(i.note), body: String(i.body ?? "").trim().slice(0, 8000) };
      if (!op.body) throw new Error("The answer is empty.");
      return guard(ctx, op) ?? done(await (await import("./run")).runGitlabNote(op));
    },
  },
  {
    name: "gitlab.resolve",
    group: "gitlab",
    label: "Resolve a GitLab thread",
    summary: "Marks a comment's thread resolved in GitLab. Changes GitLab: the flow needs “send”.",
    input: [{ name: "note", type: "text", required: true, help: "The comment: note:123 or its number" }],
    output: "{ done }",
    needs: ["send"],
    writes: true,
    run: async (i, ctx) => {
      const op = { type: "gitlab-resolve" as const, note: noteOf(i.note) };
      return guard(ctx, op) ?? done(await (await import("./run")).runGitlabNote(op));
    },
  },
  {
    name: "gitlab.merge",
    group: "gitlab",
    label: "Merge a merge request",
    summary: "Merges a merge request in GitLab (its project path, its number). Changes GitLab: the flow needs “send”.",
    input: [
      { name: "project", type: "text", required: true, help: "The project's path, e.g. group/app" },
      { name: "iid", type: "number", required: true, help: "The merge request's number (!167 → 167)" },
      { name: "source", type: "text", help: "Its branch (when known)" },
    ],
    output: "{ done }",
    needs: ["send"],
    writes: true,
    run: async (i, ctx) => {
      const iid = Number(String(i.iid ?? "").replace(/^!/, ""));
      if (!(iid > 0)) throw new Error("The merge request's number is missing.");
      const op = { type: "gitlab-merge" as const, project: String(i.project ?? "").trim(), iid, source: String(i.source ?? "") };
      return guard(ctx, op) ?? done(await (await import("./run")).runGitlabMerge(op));
    },
  },
  {
    name: "gitlab.settings",
    group: "gitlab",
    label: "How GitLab is set up for reading",
    summary: "Where your GitLab is (its address), how it is read (api: a token or sign-in — cdp: the automation Chrome), and from when to read again (a day before the last good sync; none: everything).",
    input: [],
    output: "{ baseUrl, via, sinceIso }",
    run: async () => {
      const { getGitlabSettings } = await import("@/lib/gitlab/store");
      const { driverOf } = await import("@/lib/connectors/store");
      const s = getGitlabSettings();
      return { baseUrl: s.baseUrl.replace(/\/+$/, ""), via: driverOf("gitlab"), sinceIso: s.lastOk && s.lastSyncAt ? new Date(new Date(s.lastSyncAt).getTime() - 864e5).toISOString() : "" };
    },
  },
  {
    name: "gitlab.keep",
    group: "gitlab",
    label: "Keep what was read from GitLab",
    summary: "Merge requests, comments and branches a reader brought, kept — and what the todos and the work do with them (merges waiting for an approval, the buttons on todos, the branches as context); how the sync went is noted for the GitLab page. Needs the flow's sync permission for gitlab.",
    input: [{ name: "items", type: "json", required: true }, { name: "ok", type: "boolean" }, { name: "message", type: "text" }],
    output: "{ ok, message }",
    writes: true,
    run: async (i, ctx) => {
      if (!(ctx.perms.sync ?? []).includes("gitlab")) throw new Error("This flow may not keep GitLab's items — grant “gitlab” under the flow's permissions (sync).");
      if (ctx.dryRun) return { ok: true, message: "dry run" };
      const sync = await import("@/lib/gitlab/sync");
      const { clearAttention, needsSignIn, raiseLogin } = await import("@/lib/attention");
      const { t } = await import("@/lib/i18n/server");
      // (a failure the reader had: noted — a sign-in it wants asked of you)
      if (i.ok === false || i.ok === "false") {
        const message = String(i.message ?? "").slice(0, 300);
        if (needsSignIn(message) && !/reachable/i.test(message)) raiseLogin("gitlab", message);
        return sync.recordGitlabSync(false, message);
      }
      const r = await sync.keepGitlabItems(Array.isArray(i.items) ? (i.items as never[]) : []);
      clearAttention("login:gitlab");
      return sync.recordGitlabSync(true, t("{added} new · {total} in all", { added: r.added, total: r.total }));
    },
  },
  {
    name: "gitlab.sync",
    group: "gitlab",
    label: "Sync GitLab",
    summary: "Reads the merge requests, comments and branches from GitLab now — what GitLab's app shows.",
    input: [],
    output: "{ done }",
    writes: true,
    run: async (_i, ctx) => {
      if (ctx.dryRun) return { dryRun: true, would: "sync" };
      const r = await (await import("@/lib/sync/registry")).syncAndWait("gitlab");
      if (!r.lastOk) throw new Error(r.lastMessage ?? "The sync failed.");
      return { done: r.lastMessage ?? "" };
    },
  },
];
