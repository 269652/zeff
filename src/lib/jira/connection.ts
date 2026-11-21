import fs from "node:fs";
import path from "node:path";
import { getSecret } from "@/lib/secrets/store";
import { jiraRest, type JiraRestAuth } from "./rest";

/**
 * Zeff's Jira connection over the REST API, from Zeff Secrets (Settings → Secrets → Jira): the address (JIRA_URL) and a Personal Access Token
 * (JIRA_PERSONAL_TOKEN, Server / Data Center) — or, for Jira Cloud, your e-mail (JIRA_USERNAME) and an API token (JIRA_API_TOKEN).
 * Set, it is how Zeff reads and writes Jira; not set, the Jira MCP server (mcp-atlassian, from the environment or .mcp.json) is the fallback.
 * Server only; the token never leaves the server.
 */
export function jiraRestAuth(): JiraRestAuth | null {
  const base = getSecret("JIRA_URL").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) return null;
  const pat = getSecret("JIRA_PERSONAL_TOKEN");
  const api = getSecret("JIRA_API_TOKEN");
  const user = getSecret("JIRA_USERNAME");
  // Cloud: an API token goes with the e-mail (basic auth); a PAT is a Bearer token (Server / Data Center).
  if (api && user.includes("@")) return { base, token: api, email: user };
  if (pat) return { base, token: pat };
  if (api && user) return { base, token: api, email: user };
  return null;
}

/** Whether Jira is reached over the REST API (a token is set in Zeff Secrets). */
export const jiraRestOn = (): boolean => jiraRestAuth() !== null;

const readFile = async (p: string) => ({ name: path.basename(p), data: new Uint8Array(await fs.promises.readFile(/*turbopackIgnore: true*/ p)) });

/** The REST caller (the mcp-atlassian tool names Zeff calls), or null when no token is set. */
export function jiraRestClient(): ReturnType<typeof jiraRest> | null {
  const auth = jiraRestAuth();
  return auth ? jiraRest(auth, { readFile }) : null;
}

export type JiraCheck = { ok: true; user: string } | { ok: false; error: string; status?: number };

/** The connection check: who the token signs in as (GET /rest/api/2/myself). */
export async function checkJiraRest(): Promise<JiraCheck | null> {
  const c = jiraRestClient();
  if (!c) return null;
  try {
    const me = await c.myself();
    return { ok: true, user: String(me?.display_name || me?.name || "?") };
  } catch (e) {
    const status = (e as { status?: number }).status;
    return { ok: false, error: e instanceof Error ? e.message : String(e), ...(status ? { status } : {}) };
  }
}

/** A REST session bounded like the MCP sessions were: it fails after `ms` (the requests already sent just finish unseen). */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms.`)), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}
