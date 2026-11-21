import { getPlugin } from "@/lib/ext/registry";
import { errorMessage } from "@/lib/errors";

/**
 * Changing Jira through the Jira plugin (zeff-plugins/plugins/jira-ext) while it is on: its driver lambda jira.driver does the changes in
 * one session of the Jira MCP server — each as the built-in said it — and reads the tickets anew. What changes and what Zeff keeps of it
 * stays here (the todos, the runs, Meine Lage ask this; the built-in\'s own sessions answer when the plugin is off). Server only.
 */
export type PortOp =
  | { type: "transition"; ticket: string; to: string }
  | { type: "assign"; ticket: string; assignee: string }
  | { type: "assign-as-jira-names"; ticket: string; assignee: string }
  | { type: "comment"; ticket: string; body: string }
  | { type: "create"; ticket: string; summary: string; body: string; assignee?: string; issueTypes: string[]; browseUrl?: string };

/**
 * Whether the plugin does the changes now: it is on and its driver is there — and no token is set in Zeff Secrets (with one, Zeff talks to
 * Jira's REST API itself: lib/jira/connection.ts).
 */
export async function jiraPortOn(): Promise<boolean> {
  if (!getPlugin("jira-ext")?.enabled) return false;
  if ((await import("./connection")).jiraRestOn()) return false;
  const { getLambda } = await import("@/plugins/workspace/lambdas/store");
  return getLambda("jira.driver")?.manifest.kind === "driver";
}

/**
 * The changes done by the plugin, in a row, in one session: what each did. On a failure the error carries what was done before it (`done`).
 * `plain`: the short wording a board\'s suggestions use. The tickets as Jira has them now are kept (upserted).
 */
export async function runJiraPortOps(ops: PortOp[], opts: { plain?: boolean } = {}): Promise<string[]> {
  const { invokeLambda } = await import("@/plugins/workspace/lambdas/run");
  const r = await invokeLambda("jira.driver", { tool: "ops", ops, plain: opts.plain === true, reread: true }, { asDriver: true });
  if (!r.ok) throw new Error(r.error);
  const out = r.result as { results?: string[]; error?: string | null; fresh?: unknown[] } | null;
  const results = Array.isArray(out?.results) ? out!.results.map(String) : [];
  if (out?.fresh?.length) {
    try {
      const { upsertTickets } = await import("./store");
      // (already normalized by the plugin with the built-in's own core)
      upsertTickets(out.fresh as never[]);
    } catch (e) {
      console.error("[jira] keeping the changed tickets failed", errorMessage(e));
    }
  }
  if (out?.error) throw Object.assign(new Error(out.error), { done: results });
  return results;
}

/** Comments and attachments the plugin does in ONE session of the Jira MCP server (each call answers for itself). */
export type PortCall =
  | { type: "attach"; ticket: string; paths: string[] }
  | { type: "post"; ticket: string; body: string }
  | { type: "edit"; ticket: string; commentId: string; body: string }
  /** edited when it is there, made again when it was deleted on Jira, posted the first time */
  | { type: "upsert"; ticket: string; commentId?: string | null; body: string };
export type PortCallResult = { ok: boolean; commentId?: string | null; state?: "posted" | "edited" | "reposted"; error?: string };

export async function runJiraPortCalls(calls: PortCall[]): Promise<PortCallResult[]> {
  if (!calls.length) return [];
  const { invokeLambda } = await import("@/plugins/workspace/lambdas/run");
  const r = await invokeLambda("jira.driver", { tool: "calls", calls }, { asDriver: true });
  if (!r.ok) throw new Error(r.error);
  const out = r.result as { results?: PortCallResult[] } | null;
  return Array.isArray(out?.results) ? out!.results : [];
}

/** A reading the plugin does in one session (a tool of its driver: boards …); what it answers. */
export async function runJiraPortTool(tool: string, event: Record<string, unknown>): Promise<unknown> {
  const { invokeLambda } = await import("@/plugins/workspace/lambdas/run");
  const r = await invokeLambda("jira.driver", { tool, ...event }, { asDriver: true });
  if (!r.ok) throw new Error(r.error);
  return r.result;
}

/**
 * One session with Jira, for code that reads and writes in a row: the Jira plugin's driver while it is on (the MCP server started once, in
 * the plugin — lambdas/session.ts), else the built-in's own session (the server config from the environment or .mcp.json). `body` gets
 * `call(tool, args)` as the MCP client gives it — resultToPayload reads the answer.
 */
export async function runJiraSession<T>(label: string, body: (call: (tool: string, args: Record<string, unknown>) => Promise<unknown>) => Promise<T>, timeoutMs = 150000): Promise<T> {
  // A token in Zeff Secrets: Jira's REST API, answered as the MCP server's tools (lib/jira/rest.ts) — no program started.
  const rest = (await import("./connection")).jiraRestClient();
  if (rest) {
    const { withTimeout } = await import("./connection");
    return withTimeout(body(rest.call), timeoutMs, label);
  }
  if (await jiraPortOn()) {
    const { openLambdaSession } = await import("@/plugins/workspace/lambdas/session");
    return openLambdaSession("jira.driver", {}, body, timeoutMs);
  }
  const { getJiraSyncConfig } = await import("./sync");
  const { jiraNotFoundHint } = await import("./mcp-client");
  const { runStdioSession } = await import("@/lib/mcp/stdio");
  const cfg = getJiraSyncConfig();
  if (!cfg.command) throw new Error("Jira isn't set up — enter its address and token on Settings → Secrets.");
  return runStdioSession({ command: cfg.command, args: cfg.args, env: cfg.env, label, notFoundHint: jiraNotFoundHint }, body, timeoutMs);
}

/** Whether Zeff can reach Jira at all: a token in Zeff Secrets, the Jira MCP server named, or the plugin's driver. */
export async function jiraReachable(): Promise<boolean> {
  if ((await import("./connection")).jiraRestOn()) return true;
  const { getJiraSyncConfig } = await import("./sync");
  const cfg = getJiraSyncConfig();
  return (cfg.configured && !!cfg.command) || (await jiraPortOn());
}
