import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("a token in Zeff Secrets: Jira's sessions and its sign-in check go over the REST API (mocked fetch)", async (t) => {
  const seen: { url: string; auth?: string }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
    seen.push({ url: String(url), auth: init?.headers?.Authorization });
    const path = new URL(String(url)).pathname;
    const body = path.endsWith("/myself") ? { name: "jdoe", displayName: "Jane Doe" } : { total: 0, issues: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  t.after(() => void (globalThis.fetch = real));

  const { setSecret } = await import("@/lib/secrets/store");
  const { getJiraSyncConfig } = await import("@/lib/jira/sync");
  setSecret("JIRA_URL", "https://jira.example.invalid/");
  setSecret("JIRA_PERSONAL_TOKEN", "PAT-1");
  const cfg = getJiraSyncConfig();
  assert.equal(cfg.source, "secrets");
  assert.equal(cfg.baseUrl, "https://jira.example.invalid");

  const { runJiraSession, jiraReachable } = await import("@/lib/jira/port-ops");
  assert.equal(await jiraReachable(), true);
  const { resultToPayload } = await import("@/lib/mcp/stdio");
  const out = await runJiraSession("Jira", async (call) => resultToPayload(await call("jira_search", { jql: "assignee = currentUser()", limit: 5 })));
  assert.deepEqual((out as { issues: unknown[] }).issues, []);
  assert.equal(seen[0].auth, "Bearer PAT-1");
  assert.match(seen[0].url, /^https:\/\/jira\.example\.invalid\/rest\/api\/2\/search\?/);

  const { checkLogin } = await import("@/lib/logins");
  const r = await checkLogin("jira");
  assert.equal(r.state, "ok");
  assert.match(r.detail, /Jane Doe/);
});
