/**
 * Jira's REST API, spoken as the Jira MCP server (mcp-atlassian) spoke it — so every place in Zeff that calls `call("jira_search", …)`
 * in a session keeps its code: `jiraRestCaller(auth)` is a ToolCaller whose answers have the same shape as mcp-atlassian's simplified
 * ones (issues with summary/status{name,category}/issue_type/assignee{display_name,name}/comments/changelogs, transitions with to_status,
 * comment bodies and descriptions as Markdown, written back as Jira's wiki markup).
 *
 * Auth: Jira Server / Data Center with a Personal Access Token (`Authorization: Bearer <PAT>`); Jira Cloud with your e-mail and an API
 * token (basic auth). The REST v2 API on both (Cloud's search: /rest/api/2/search/jql, paged by token).
 *
 * Pure: only `fetch` (passed in, for tests and for the plugin's driver — scripts/port-jira.mts bundles this file). No Zeff imports.
 */

export type JiraRestAuth = {
  /** The base address, e.g. https://jira.example.com (no trailing slash needed). */
  base: string;
  /** A Personal Access Token (Server/DC), or Cloud's API token when `email` is set. */
  token: string;
  /** Jira Cloud: the e-mail you sign in with — the token is then an API token (basic auth). */
  email?: string;
};

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => Promise<{ ok: boolean; status: number; statusText?: string; text(): Promise<string> }>;
export type JiraRestOptions = {
  fetch?: Fetch;
  /** Reads a local file for an attachment (the server's fs; not given: attachments can't be sent). */
  readFile?: (path: string) => Promise<{ name: string; data: Uint8Array }>;
};
export type JiraToolCaller = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
  }
  return out;
}

/** Cloud or Server: an e-mail login means Cloud's basic auth; an atlassian.net address too. */
export const isCloud = (auth: JiraRestAuth) => !!auth.email || /\.atlassian\.net$/i.test(hostOf(auth.base));
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};

export function authHeader(auth: JiraRestAuth): string {
  return auth.email ? `Basic ${base64(`${auth.email}:${auth.token}`)}` : `Bearer ${auth.token}`;
}

// ── Jira wiki markup ↔ Markdown (what mcp-atlassian does on the way in and out; the common marks) ───────────────────────────────────

export function jiraToMarkdown(s: string): string {
  if (!s) return s;
  const blocks: string[] = [];
  const keep = (x: string) => `\u0000${blocks.push(x) - 1}\u0000`;
  let t = s.replace(/\{code(?::([^}|]*))?[^}]*\}([\s\S]*?)\{code\}/g, (_, lang, body) => keep("```" + (lang && !lang.includes("=") ? lang : "") + "\n" + String(body).replace(/^\n|\n$/g, "") + "\n```"));
  t = t.replace(/\{noformat\}([\s\S]*?)\{noformat\}/g, (_, body) => keep("```\n" + String(body).replace(/^\n|\n$/g, "") + "\n```"));
  t = t.replace(/\{quote\}([\s\S]*?)\{quote\}/g, (_, body) => String(body).trim().split("\n").map((l) => `> ${l}`).join("\n"));
  t = t.replace(/\{\{([^}]+)\}\}/g, (_, c) => keep("`" + c + "`"));
  t = t
    .split("\n")
    .map((line) => {
      const h = /^h([1-6])\.\s+(.*)$/.exec(line);
      if (h) return `${"#".repeat(Number(h[1]))} ${h[2]}`;
      const ul = /^(\*+|-)\s+(.*)$/.exec(line);
      if (ul && !/^\*[^*\s].*\*$/.test(line)) return `${"  ".repeat(ul[1] === "-" ? 0 : ul[1].length - 1)}- ${ul[2]}`;
      const ol = /^(#+)\s+(.*)$/.exec(line);
      if (ol) return `${"  ".repeat(ol[1].length - 1)}1. ${ol[2]}`;
      if (/^bq\.\s+/.test(line)) return line.replace(/^bq\.\s+/, "> ");
      return line;
    })
    .join("\n");
  t = t.replace(/\[([^|\]\n]+)\|([^\]\n]+)\]/g, "[$1]($2)");
  t = t.replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=$|[\s).,:;!?])/g, "$1**$2**");
  t = t.replace(/(^|[\s(])_(\S(?:[^_\n]*\S)?)_(?=$|[\s).,:;!?])/g, "$1*$2*");
  t = t.replace(/(^|[\s(])-(\S(?:[^-\n]*\S)?)-(?=$|[\s).,:;!?])/g, "$1~~$2~~");
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
}

export function markdownToJira(s: string): string {
  if (!s) return s;
  const blocks: string[] = [];
  const keep = (x: string) => `\u0000${blocks.push(x) - 1}\u0000`;
  let t = s.replace(/```([\w+-]*)\n([\s\S]*?)\n?```/g, (_, lang, body) => keep(`{code${lang ? `:${lang}` : ""}}\n${body}\n{code}`));
  t = t.replace(/`([^`\n]+)`/g, (_, c) => keep(`{{${c}}}`));
  t = t.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label, url) => keep(`[${label}|${url}]`));
  t = t
    .split("\n")
    .map((line) => {
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) return `h${h[1].length}. ${h[2]}`;
      const ul = /^(\s*)[-*+]\s+(.*)$/.exec(line);
      if (ul) return `${"*".repeat(Math.floor(ul[1].length / 2) + 1)} ${ul[2]}`;
      const ol = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
      if (ol) return `${"#".repeat(Math.floor(ol[1].length / 2) + 1)} ${ol[2]}`;
      if (/^>\s?/.test(line)) return line.replace(/^>\s?/, "bq. ");
      return line;
    })
    .join("\n");
  // bold first (as a placeholder mark), then italic, then bold back as Jira's *…*
  t = t.replace(/\*\*(\S(?:[^*\n]*\S)?)\*\*|__(\S(?:[^_\n]*\S)?)__/g, (_, a, b) => `\u0001${a ?? b}\u0001`);
  t = t.replace(/(^|[^*\w])\*(\S(?:[^*\n]*\S)?)\*(?!\*)/g, "$1_$2_");
  t = t.replace(/~~(\S(?:[^~\n]*\S)?)~~/g, "-$1-");
  t = t.replace(/\u0001([^\u0001]*)\u0001/g, "*$1*");
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
}

// ── simplified shapes (as mcp-atlassian's to_simplified_dict) ──────────────────────────────────────────────────────────────────────

type O = Record<string, unknown>;
const obj = (v: unknown): O => (v && typeof v === "object" ? (v as O) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);

export function simplifyUser(u: unknown): O | null {
  const o = obj(u);
  if (!Object.keys(o).length) return null;
  const display = str(o.displayName) ?? str(o.name) ?? "";
  const avatars = obj(o.avatarUrls);
  return { account_id: str(o.accountId) ?? null, display_name: display, name: str(o.name) ?? display, email: str(o.emailAddress) ?? null, avatar_url: str(avatars["48x48"]) ?? null, ...(str(o.key) ? { key: str(o.key) } : {}) };
}

function simplifyComment(c: unknown): O {
  const o = obj(c);
  const author = simplifyUser(o.author);
  return { id: str(o.id) ?? "", body: jiraToMarkdown(str(o.body) ?? ""), ...(author ? { author } : {}), ...(str(o.created) ? { created: o.created } : {}), ...(str(o.updated) ? { updated: o.updated } : {}) };
}

/** An issue as mcp-atlassian simplified it — only the fields asked for (`fields`: a list, or "*all"). */
export function simplifyIssue(raw: unknown, fields: string[] | "*all", base: string): O {
  const o = obj(raw);
  const f = obj(o.fields);
  const want = (name: string) => fields === "*all" || fields.includes(name);
  const key = str(o.key) ?? "";
  const out: O = { id: str(o.id) ?? "", key };
  if (want("summary")) out.summary = str(f.summary) ?? "";
  if (key) out.browse_url = `${base}/browse/${key}`;
  if (want("description") && str(f.description)) out.description = jiraToMarkdown(str(f.description)!);
  if (want("status") && f.status) {
    const s = obj(f.status);
    const cat = obj(s.statusCategory);
    out.status = { name: str(s.name) ?? "", ...(Object.keys(cat).length ? { category: str(cat.name) ?? "", color: str(cat.colorName) ?? "" } : {}) };
  }
  if (want("issuetype") && f.issuetype) out.issue_type = { name: str(obj(f.issuetype).name) ?? "" };
  if (want("priority") && f.priority) out.priority = { name: str(obj(f.priority).name) ?? "" };
  if (want("project") && f.project) out.project = { key: str(obj(f.project).key), name: str(obj(f.project).name) };
  if (want("resolution") && f.resolution) out.resolution = { name: str(obj(f.resolution).name) ?? "" };
  if (want("duedate") && f.duedate) out.duedate = f.duedate;
  if (want("resolutiondate") && f.resolutiondate) out.resolutiondate = f.resolutiondate;
  if (want("parent") && f.parent) out.parent = f.parent;
  if (want("subtasks") && Array.isArray(f.subtasks) && f.subtasks.length) out.subtasks = f.subtasks;
  if (want("assignee")) out.assignee = simplifyUser(f.assignee) ?? { display_name: "Unassigned" };
  if (want("reporter") && f.reporter) out.reporter = simplifyUser(f.reporter);
  if (want("labels") && Array.isArray(f.labels) && f.labels.length) out.labels = f.labels;
  if (want("components") && Array.isArray(f.components) && f.components.length) out.components = f.components.map((c) => str(obj(c).name) ?? "").filter(Boolean);
  if (want("fixVersions") && Array.isArray(f.fixVersions) && f.fixVersions.length) out.fix_versions = f.fixVersions.map((c) => str(obj(c).name) ?? "").filter(Boolean);
  if (want("created") && f.created) out.created = f.created;
  if (want("updated") && f.updated) out.updated = f.updated;
  const comments = obj(f.comment).comments;
  if (want("comment") && Array.isArray(comments) && comments.length) out.comments = comments.map(simplifyComment);
  if (want("attachment") && Array.isArray(f.attachment) && f.attachment.length)
    out.attachments = f.attachment.map((a) => ({ filename: str(obj(a).filename) ?? "", size: Number(obj(a).size ?? 0), url: str(obj(a).content) ?? null, ...(str(obj(a).mimeType) ? { content_type: obj(a).mimeType } : {}), ...(str(obj(a).created) ? { created: obj(a).created } : {}) }));
  if (want("issuelinks") && Array.isArray(f.issuelinks) && f.issuelinks.length) out.issuelinks = f.issuelinks;
  const histories = obj(o.changelog).histories;
  if (Array.isArray(histories) && histories.length)
    out.changelogs = histories.map((h) => {
      const x = obj(h);
      const author = simplifyUser(x.author);
      return {
        ...(Array.isArray(x.items) && x.items.length ? { items: x.items.map((i) => ({ field: str(obj(i).field) ?? "", fieldtype: str(obj(i).fieldtype) ?? "", ...(obj(i).fromString != null ? { from_string: obj(i).fromString } : {}), ...(obj(i).toString != null && typeof obj(i).toString === "string" ? { to_string: obj(i).toString } : {}) })) } : {}),
        ...(author ? { author } : {}),
        ...(str(x.created) ? { created: x.created } : {}),
      };
    });
  // custom fields asked for by id
  if (Array.isArray(fields)) for (const name of fields) if (name.startsWith("customfield_") && f[name] !== undefined && f[name] !== null) out[name] = { value: f[name] };
  return out;
}

const fieldList = (fields: unknown): string[] | "*all" => {
  const s = String(fields ?? "").trim();
  if (!s) return DEFAULT_FIELDS;
  if (s === "*all") return "*all";
  return s.split(",").map((x) => x.trim()).filter(Boolean);
};
const DEFAULT_FIELDS = ["summary", "description", "status", "assignee", "reporter", "labels", "priority", "created", "updated", "issuetype"];
const restFields = (f: string[] | "*all") => (f === "*all" ? "*all" : f.join(","));

// ── the caller ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** An error from Jira as text: its status (401/403/404 — what the sync's "sign in again" and "gone" checks look for) and its own words. */
export class JiraRestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function errorText(status: number, statusText: string, body: string): string {
  let words = body.slice(0, 600);
  try {
    const j = JSON.parse(body) as { errorMessages?: string[]; errors?: Record<string, string>; message?: string };
    const parts = [...(j.errorMessages ?? []), ...Object.entries(j.errors ?? {}).map(([k, v]) => `${k}: ${v}`), ...(j.message ? [j.message] : [])];
    if (parts.length) words = parts.join("; ");
  } catch {
    // (not JSON: an HTML error page — kept as is, so "Jira is down" can be told)
  }
  return `Jira answered ${status}${statusText ? ` ${statusText}` : ""}${words ? `: ${words}` : ""}`;
}

/** As an MCP tools/call result (so resultToPayload and the driver's payloadOf read it as before). */
const envelope = (payload: unknown) => ({ content: [{ type: "text", text: JSON.stringify(payload) }] });

export function jiraRest(auth: JiraRestAuth, opts: JiraRestOptions = {}) {
  const base = auth.base.trim().replace(/\/+$/, "");
  const doFetch: Fetch = opts.fetch ?? (globalThis.fetch as unknown as Fetch);
  const cloud = isCloud(auth);
  const headers = { Authorization: authHeader(auth), Accept: "application/json" };

  async function req(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<unknown> {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const r = await doFetch(`${base}${path}`, {
      method,
      headers: { ...headers, ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}), ...(extra ?? {}) },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) throw new JiraRestError(r.status, errorText(r.status, r.statusText ?? "", text));
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      // A 200 with a login page instead of JSON (an SSO proxy in front of Jira): not signed in.
      throw new JiraRestError(r.status, `Jira answered with a page instead of data (not signed in?): ${text.slice(0, 300)}`);
    }
  }
  const q = (params: Record<string, unknown>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
    const s = u.toString();
    return s ? `?${s}` : "";
  };

  /** Search with JQL, `limit` at most, paged as Jira pages it. */
  async function search(jql: string, fields: string[] | "*all", limit: number, startAt: number, expand?: string): Promise<{ total: number; start_at: number; max_results: number; issues: O[] }> {
    const issues: O[] = [];
    let total = 0;
    if (cloud) {
      // Cloud: /search/jql, paged by nextPageToken (start_at: skipped through)
      let token: string | undefined;
      let skipped = 0;
      for (;;) {
        const page = obj(await req("GET", `/rest/api/2/search/jql${q({ jql, fields: restFields(fields), maxResults: Math.min(100, limit + startAt - skipped), expand, nextPageToken: token })}`));
        const list = Array.isArray(page.issues) ? page.issues : [];
        for (const i of list) {
          if (skipped < startAt) skipped++;
          else if (issues.length < limit) issues.push(simplifyIssue(i, fields, base));
        }
        token = str(page.nextPageToken);
        if (!token || page.isLast === true || issues.length >= limit || !list.length) break;
      }
      total = startAt + issues.length + (token ? 1 : 0);
    } else {
      let at = startAt;
      for (;;) {
        const page = obj(await req("GET", `/rest/api/2/search${q({ jql, fields: restFields(fields), maxResults: Math.min(100, limit - issues.length), startAt: at, expand })}`));
        const list = Array.isArray(page.issues) ? page.issues : [];
        total = Number(page.total ?? 0);
        for (const i of list) issues.push(simplifyIssue(i, fields, base));
        at += list.length;
        if (!list.length || issues.length >= limit || at >= total) break;
      }
    }
    return { total, start_at: startAt, max_results: limit, issues };
  }

  /** Who a name/login/e-mail is in Jira, as an assignee field ({name} on Server, {accountId} on Cloud). */
  async function assigneeOf(who: unknown): Promise<O | null> {
    const s = String(who ?? "").trim();
    if (!s || /^(unassigned|none|null|-)$/i.test(s)) return cloud ? { accountId: null } : { name: null };
    if (cloud) {
      if (/^[0-9a-f:-]{20,}$/i.test(s)) return { accountId: s };
      const list = await req("GET", `/rest/api/2/user/search${q({ query: s })}`).catch(() => []);
      const hit = (Array.isArray(list) ? list : []).map(obj).find((u) => [u.emailAddress, u.displayName, u.accountId].some((x) => str(x)?.toLowerCase() === s.toLowerCase())) ?? obj((Array.isArray(list) ? list : [])[0]);
      if (!str(hit.accountId)) throw new JiraRestError(404, `No Jira user “${s}” found.`);
      return { accountId: hit.accountId };
    }
    const list = await req("GET", `/rest/api/2/user/search${q({ username: s })}`).catch(() => []);
    const users = (Array.isArray(list) ? list : []).map(obj);
    const hit = users.find((u) => [u.name, u.key, u.emailAddress, u.displayName].some((x) => str(x)?.toLowerCase() === s.toLowerCase())) ?? (users.length === 1 ? users[0] : null);
    return { name: str(hit?.name) ?? s };
  }

  /** The fields of an update/create: the assignee resolved, the description written as Jira's markup. */
  async function fieldsFor(input: O): Promise<O> {
    const out: O = {};
    for (const [k, v] of Object.entries(input)) {
      if (k === "assignee") out.assignee = typeof v === "object" && v ? v : await assigneeOf(v);
      else if (k === "description" && typeof v === "string") out.description = markdownToJira(v);
      else if (k === "components" && typeof v === "string") out.components = v.split(",").map((x) => x.trim()).filter(Boolean).map((name) => ({ name }));
      else if (k === "labels" && typeof v === "string") out.labels = v.split(",").map((x) => x.trim()).filter(Boolean);
      else out[k] = v;
    }
    return out;
  }
  const json = (v: unknown): O => {
    if (v && typeof v === "object") return v as O;
    const s = String(v ?? "").trim();
    if (!s) return {};
    try {
      return obj(JSON.parse(s));
    } catch {
      throw new Error(`Not a JSON object: ${s.slice(0, 100)}`);
    }
  };
  const key = (a: O) => {
    const k = String(a.issue_key ?? "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(k)) throw new Error(`Not a Jira key: “${String(a.issue_key ?? "")}”`);
    return k;
  };
  const getIssue = async (k: string, fields: string[] | "*all", expand?: string) => simplifyIssue(await req("GET", `/rest/api/2/issue/${k}${q({ fields: restFields(fields), expand })}`), fields, base);

  const tools: Record<string, (a: O) => Promise<unknown>> = {
    jira_search: (a) => search(String(a.jql ?? ""), fieldList(a.fields), Number(a.limit) > 0 ? Number(a.limit) : 10, Number(a.start_at) > 0 ? Number(a.start_at) : 0, str(a.expand)),
    jira_get_board_issues: async (a) => {
      const fields = fieldList(a.fields);
      const limit = Number(a.limit) > 0 ? Number(a.limit) : 10;
      const startAt = Number(a.start_at) > 0 ? Number(a.start_at) : 0;
      const page = obj(await req("GET", `/rest/agile/1.0/board/${encodeURIComponent(String(a.board_id))}/issue${q({ jql: a.jql, fields: restFields(fields), startAt, maxResults: limit, expand: a.expand })}`));
      const list = Array.isArray(page.issues) ? page.issues : [];
      return { total: Number(page.total ?? list.length), start_at: startAt, max_results: limit, issues: list.map((i) => simplifyIssue(i, fields, base)) };
    },
    jira_get_agile_boards: async (a) => {
      const page = obj(await req("GET", `/rest/agile/1.0/board${q({ projectKeyOrId: a.project_key, name: a.board_name, type: a.board_type, startAt: a.start_at, maxResults: Number(a.limit) > 0 ? a.limit : 50 })}`));
      return (Array.isArray(page.values) ? page.values : []).map((b) => ({ id: str(obj(b).id) ?? "", name: str(obj(b).name) ?? "", type: str(obj(b).type) ?? "" }));
    },
    jira_get_issue: (a) => getIssue(key(a), a.fields ? fieldList(a.fields) : [...DEFAULT_FIELDS, "comment"], str(a.expand)),
    jira_get_transitions: async (a) => {
      const r = obj(await req("GET", `/rest/api/2/issue/${key(a)}/transitions`));
      return (Array.isArray(r.transitions) ? r.transitions : []).map((x) => ({ id: str(obj(x).id) ?? "", name: str(obj(x).name) ?? "", to_status: str(obj(obj(x).to).name) ?? "" }));
    },
    jira_transition_issue: async (a) => {
      const k = key(a);
      const body: O = { transition: { id: String(a.transition_id) } };
      if (a.fields) body.fields = await fieldsFor(json(a.fields));
      if (typeof a.comment === "string" && a.comment.trim()) body.update = { comment: [{ add: { body: markdownToJira(a.comment) } }] };
      await req("POST", `/rest/api/2/issue/${k}/transitions`, body);
      return { message: `Issue ${k} transitioned successfully`, issue: await getIssue(k, DEFAULT_FIELDS) };
    },
    jira_update_issue: async (a) => {
      const k = key(a);
      const fields = await fieldsFor({ ...json(a.fields), ...json(a.additional_fields) });
      if (Object.keys(fields).length) await req("PUT", `/rest/api/2/issue/${k}`, { fields });
      let attached: string[] = [];
      const paths = (() => {
        const v = a.attachments;
        if (Array.isArray(v)) return v.map(String);
        const s = String(v ?? "").trim();
        if (!s) return [];
        try {
          const p = JSON.parse(s);
          return Array.isArray(p) ? p.map(String) : [s];
        } catch {
          return s.split(",").map((x) => x.trim()).filter(Boolean);
        }
      })();
      if (paths.length) {
        if (!opts.readFile) throw new Error("Attachments can't be sent from here.");
        for (const p of paths) {
          const file = await opts.readFile(p);
          const form = new FormData();
          form.append("file", new Blob([file.data as BlobPart]), file.name);
          await req("POST", `/rest/api/2/issue/${k}/attachments`, form, { "X-Atlassian-Token": "no-check" });
          attached.push(file.name);
        }
      }
      return { message: "Issue updated successfully", issue: await getIssue(k, DEFAULT_FIELDS), ...(attached.length ? { attachment_results: { success: attached.map((filename) => ({ filename })) } } : {}) };
    },
    jira_create_issue: async (a) => {
      const extra = json(a.additional_fields);
      const fields = await fieldsFor({
        project: { key: String(a.project_key ?? "").trim() },
        summary: String(a.summary ?? ""),
        issuetype: { name: String(a.issue_type ?? "Task") },
        ...(a.description ? { description: String(a.description) } : {}),
        ...(a.components ? { components: String(a.components) } : {}),
        ...(a.assignee ? { assignee: String(a.assignee) } : {}),
        ...extra,
      });
      const r = obj(await req("POST", "/rest/api/2/issue", { fields }));
      const k = str(r.key) ?? "";
      return { message: "Issue created successfully", issue: k ? await getIssue(k, DEFAULT_FIELDS).catch(() => ({ id: r.id, key: k })) : r };
    },
    jira_create_issue_link: async (a) => {
      await req("POST", "/rest/api/2/issueLink", { type: { name: String(a.link_type ?? "Relates") }, inwardIssue: { key: String(a.inward_issue_key ?? "") }, outwardIssue: { key: String(a.outward_issue_key ?? "") }, ...(a.comment ? { comment: { body: markdownToJira(String(a.comment)) } } : {}) });
      return { success: true, message: `Link created between ${a.inward_issue_key} and ${a.outward_issue_key}` };
    },
    jira_add_comment: async (a) => simplifyComment(await req("POST", `/rest/api/2/issue/${key(a)}/comment`, { body: markdownToJira(String(a.body ?? a.comment ?? "")) })),
    jira_edit_comment: async (a) => simplifyComment(await req("PUT", `/rest/api/2/issue/${key(a)}/comment/${encodeURIComponent(String(a.comment_id ?? ""))}`, { body: markdownToJira(String(a.body ?? "")) })),
    jira_get_user_profile: async (a) => {
      const who = String(a.user_identifier ?? "").trim();
      if (!who || who.toLowerCase() === "me") return { success: true, user: simplifyUser(await req("GET", "/rest/api/2/myself")) };
      try {
        const u = cloud
          ? (await req("GET", `/rest/api/2/user/search${q({ query: who })}`).then((l) => (Array.isArray(l) ? l[0] : null)))
          : await req("GET", `/rest/api/2/user${q({ username: who })}`);
        if (!u) throw new JiraRestError(404, `User '${who}' not found`);
        return { success: true, user: simplifyUser(u) };
      } catch (e) {
        if (e instanceof JiraRestError && e.status === 404) return { success: false, error: `User '${who}' not found`, user_identifier: who };
        throw e;
      }
    },
  };

  /** A tool as mcp-atlassian names it, called over REST; the answer in an MCP result envelope. */
  const call: JiraToolCaller = async (tool, args) => {
    const fn = tools[tool];
    if (!fn) throw new Error(`tool "${tool}": not available over Jira's REST API`);
    try {
      return envelope(await fn(args ?? {}));
    } catch (e) {
      throw e instanceof JiraRestError ? new Error(`tool "${tool}": ${e.message}`) : e;
    }
  };
  /** Who the token signs in as (GET /rest/api/2/myself) — the connection check. */
  const myself = async () => simplifyUser(await req("GET", "/rest/api/2/myself"));
  return { call, myself, tools: Object.keys(tools) };
}
