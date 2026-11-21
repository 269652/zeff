import assert from "node:assert/strict";
import test from "node:test";
import { jiraRest, jiraToMarkdown, markdownToJira } from "@/lib/jira/rest";
import { resultToPayload } from "@/lib/mcp/stdio";
import { extractIssues, normalizeIssue } from "@/lib/jira/normalize";
import { transitionsOf } from "@/lib/jira/transitions";

type Req = { url: string; method: string; headers: Record<string, string>; body?: unknown };

/** A fake Jira: answers by "METHOD path" (query left out), records every request. No network. */
function fakeJira(routes: Record<string, (r: Req) => { status?: number; body: unknown }>) {
  const seen: Req[] = [];
  const fetch = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) => {
    const r: Req = { url, method: init.method ?? "GET", headers: init.headers ?? {}, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body };
    seen.push(r);
    const path = new URL(url).pathname;
    const route = routes[`${r.method} ${path}`];
    const out = route ? route(r) : { status: 404, body: { errorMessages: ["not here"] } };
    const status = out.status ?? 200;
    return { ok: status < 400, status, statusText: "", text: async () => (typeof out.body === "string" ? out.body : JSON.stringify(out.body)) };
  };
  return { fetch, seen };
}

const ISSUE = {
  id: "10001",
  key: "PROJ-7",
  fields: {
    summary: "Fix it",
    description: "h2. Why\n*bold* and {{code}} and [site|https://x.test]",
    status: { name: "In Arbeit", statusCategory: { key: "indeterminate", name: "In Progress", colorName: "yellow" } },
    issuetype: { name: "Aufgabe" },
    priority: { name: "Major" },
    assignee: { name: "jdoe", key: "JIRAUSER1", displayName: "Jane Doe", emailAddress: "j@x.test" },
    created: "2026-11-01T10:00:00.000+0100",
    updated: "2026-11-20T09:30:00.000+0100",
    comment: { comments: [{ id: "55", body: "_see_ PROJ-8", author: { name: "bob", displayName: "Bob" }, created: "2026-11-02T08:00:00.000+0100" }] },
  },
  changelog: { histories: [{ created: "2026-11-03T08:00:00.000+0100", author: { displayName: "Bob" }, items: [{ field: "status", fieldtype: "jira", fromString: "Offen", toString: "In Arbeit" }] }] },
};

test("Server: a PAT goes as Bearer; jira_search answers as mcp-atlassian did (simplified issues, Markdown, changelogs)", async () => {
  const j = fakeJira({ "GET /rest/api/2/search": () => ({ body: { total: 1, startAt: 0, issues: [ISSUE] } }) });
  const { call } = jiraRest({ base: "https://jira.example.com/", token: "PAT123" }, { fetch: j.fetch });
  const p = resultToPayload(await call("jira_search", { jql: "assignee = currentUser()", fields: "summary,description,status,issuetype,priority,assignee,created,updated,comment", limit: 100, expand: "changelog" })) as { total: number; issues: Record<string, unknown>[] };
  assert.equal(j.seen[0].headers.Authorization, "Bearer PAT123");
  const u = new URL(j.seen[0].url);
  assert.equal(u.origin + u.pathname, "https://jira.example.com/rest/api/2/search");
  assert.equal(u.searchParams.get("jql"), "assignee = currentUser()");
  assert.equal(u.searchParams.get("expand"), "changelog");
  assert.equal(p.total, 1);
  const i = p.issues[0] as { key: string; status: { name: string; category: string }; assignee: { display_name: string; name: string }; issue_type: { name: string }; description: string; comments: { id: string; body: string; author: { display_name: string } }[]; changelogs: { items: { field: string; to_string: string }[] }[]; browse_url: string };
  assert.equal(i.key, "PROJ-7");
  assert.deepEqual(i.status, { name: "In Arbeit", category: "In Progress", color: "yellow" });
  assert.equal(i.assignee.display_name, "Jane Doe");
  assert.equal(i.assignee.name, "jdoe");
  assert.equal(i.issue_type.name, "Aufgabe");
  assert.equal(i.description, "## Why\n**bold** and `code` and [site](https://x.test)");
  assert.equal(i.comments[0].id, "55");
  assert.equal(i.comments[0].body, "*see* PROJ-8");
  assert.equal(i.comments[0].author.display_name, "Bob");
  assert.equal(i.changelogs[0].items[0].to_string, "In Arbeit");
  assert.equal(i.browse_url, "https://jira.example.com/browse/PROJ-7");
  // …and Zeff's own normalizer reads it as the same ticket
  const t = normalizeIssue(extractIssues(p)[0], "https://jira.example.com")!;
  assert.equal(t.statusCategory, "inprogress");
  assert.equal(t.assignee, "Jane Doe");
  assert.equal(t.respondedAt, "2026-11-03T08:00:00.000+0100");
});

test("Cloud: e-mail + API token as basic auth, search over /search/jql paged by token", async () => {
  let n = 0;
  const j = fakeJira({
    "GET /rest/api/2/search/jql": () => (n++ === 0 ? { body: { issues: [ISSUE], nextPageToken: "t2" } } : { body: { issues: [{ ...ISSUE, key: "PROJ-8" }], isLast: true } }),
  });
  const { call } = jiraRest({ base: "https://acme.atlassian.net", token: "api", email: "me@acme.test" }, { fetch: j.fetch });
  const p = resultToPayload(await call("jira_search", { jql: "x", fields: "summary", limit: 10 })) as { issues: { key: string }[] };
  assert.equal(j.seen[0].headers.Authorization, `Basic ${Buffer.from("me@acme.test:api").toString("base64")}`);
  assert.deepEqual(p.issues.map((i) => i.key), ["PROJ-7", "PROJ-8"]);
  assert.equal(new URL(j.seen[1].url).searchParams.get("nextPageToken"), "t2");
});

test("board issues, boards, transitions, transition, assign, comment, edit, create + link", async () => {
  const j = fakeJira({
    "GET /rest/agile/1.0/board/12/issue": () => ({ body: { total: 1, issues: [ISSUE] } }),
    "GET /rest/agile/1.0/board": () => ({ body: { values: [{ id: 12, name: "Team", type: "kanban" }] } }),
    "GET /rest/api/2/issue/PROJ-7/transitions": () => ({ body: { transitions: [{ id: "31", name: "Fertig", to: { name: "Erledigt" } }] } }),
    "POST /rest/api/2/issue/PROJ-7/transitions": () => ({ status: 204, body: "" }),
    "GET /rest/api/2/issue/PROJ-7": () => ({ body: ISSUE }),
    "GET /rest/api/2/user/search": () => ({ body: [{ name: "jdoe", displayName: "Jane Doe" }] }),
    "PUT /rest/api/2/issue/PROJ-7": () => ({ status: 204, body: "" }),
    "POST /rest/api/2/issue/PROJ-7/comment": (r) => ({ status: 201, body: { id: "99", body: (r.body as { body: string }).body, author: { displayName: "Me" } } }),
    "PUT /rest/api/2/issue/PROJ-7/comment/99": (r) => ({ body: { id: "99", body: (r.body as { body: string }).body } }),
    "POST /rest/api/2/issue": () => ({ status: 201, body: { id: "2", key: "PROJ-9" } }),
    "GET /rest/api/2/issue/PROJ-9": () => ({ body: { ...ISSUE, key: "PROJ-9" } }),
    "POST /rest/api/2/issueLink": () => ({ status: 201, body: "" }),
  });
  const { call } = jiraRest({ base: "https://jira.example.com", token: "PAT" }, { fetch: j.fetch });
  const last = () => j.seen[j.seen.length - 1];

  const board = resultToPayload(await call("jira_get_board_issues", { board_id: "12", jql: "ORDER BY updated DESC", fields: "summary", limit: 50, start_at: 50 })) as { issues: unknown[]; total: number };
  assert.equal(board.issues.length, 1);
  assert.equal(new URL(last().url).searchParams.get("startAt"), "50");
  assert.deepEqual(resultToPayload(await call("jira_get_agile_boards", { project_key: "PROJ" })), [{ id: "12", name: "Team", type: "kanban" }]);

  const list = transitionsOf(resultToPayload(await call("jira_get_transitions", { issue_key: "PROJ-7" })));
  assert.deepEqual(list, [{ id: "31", name: "Fertig", to: "Erledigt" }]);
  await call("jira_transition_issue", { issue_key: "PROJ-7", transition_id: "31" });
  assert.deepEqual(j.seen.find((r) => r.method === "POST" && r.url.endsWith("/transitions"))!.body, { transition: { id: "31" } });

  await call("jira_update_issue", { issue_key: "PROJ-7", fields: JSON.stringify({ assignee: "Jane Doe" }) });
  assert.deepEqual(j.seen.find((r) => r.method === "PUT")!.body, { fields: { assignee: { name: "jdoe" } } });

  const c = resultToPayload(await call("jira_add_comment", { issue_key: "PROJ-7", body: "**Done** see `x`" })) as { id: string };
  assert.equal(c.id, "99");
  assert.deepEqual(last().body, { body: "*Done* see {{x}}" });
  await call("jira_edit_comment", { issue_key: "PROJ-7", comment_id: "99", body: "- one\n- two" });
  assert.deepEqual(last().body, { body: "* one\n* two" });

  const created = resultToPayload(await call("jira_create_issue", { project_key: "PROJ", summary: "New", issue_type: "Aufgabe", description: "# Head", components: "Relaunch", additional_fields: JSON.stringify({ labels: ["a"] }) })) as { issue: { key: string } };
  assert.equal(created.issue.key, "PROJ-9");
  assert.deepEqual(j.seen.find((r) => r.method === "POST" && new URL(r.url).pathname === "/rest/api/2/issue")!.body, {
    fields: { project: { key: "PROJ" }, summary: "New", issuetype: { name: "Aufgabe" }, description: "h1. Head", components: [{ name: "Relaunch" }], labels: ["a"] },
  });
  await call("jira_create_issue_link", { link_type: "Relates", inward_issue_key: "PROJ-9", outward_issue_key: "PROJ-7" });
  assert.deepEqual(last().body, { type: { name: "Relates" }, inwardIssue: { key: "PROJ-9" }, outwardIssue: { key: "PROJ-7" } });
});

test("errors keep Jira's status (401 → sign-in, 404 → gone) and its words; an HTML page stays recognisable", async () => {
  const j = fakeJira({
    "GET /rest/api/2/search": () => ({ status: 401, body: "" }),
    "PUT /rest/api/2/issue/PROJ-7/comment/5": () => ({ status: 404, body: { errorMessages: ["Can not find a comment for the id: 5."] } }),
    "GET /rest/api/2/myself": () => ({ status: 503, body: "<!DOCTYPE html><html>Wartung</html>" }),
  });
  const { call, myself } = jiraRest({ base: "https://jira.example.com", token: "bad" }, { fetch: j.fetch });
  await assert.rejects(call("jira_search", { jql: "x" }), /\b401\b/);
  await assert.rejects(call("jira_edit_comment", { issue_key: "PROJ-7", comment_id: "5", body: "x" }), /404.*Can not find a comment/);
  await assert.rejects(myself(), /503.*Wartung/);
  await assert.rejects(call("jira_unknown_tool", {}), /not available/);
});

test("Markdown ↔ Jira markup round trip of the common marks", () => {
  const md = "## Title\n**bold** and *it* and `c`\n- a\n  - b\n1. one\n[l](https://x.test)\n```js\nx = 1\n```";
  const jira = markdownToJira(md);
  assert.equal(jira, "h2. Title\n*bold* and _it_ and {{c}}\n* a\n** b\n# one\n[l|https://x.test]\n{code:js}\nx = 1\n{code}");
  assert.equal(jiraToMarkdown(jira), md);
});
