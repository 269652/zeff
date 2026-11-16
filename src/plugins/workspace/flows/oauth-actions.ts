import fs from "node:fs";
import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import { sleep } from "@/lib/abort";
import type { ActionCtx, FlowAction } from "./actions";
import type { FieldSpec } from "./types";

/**
 * The kernel's sign-in actions for plugins (lib/ext/oauth.ts — a manifest's `contributes.oauth`): how a sign-in stands, where to go to
 * sign in, signing out, a fresh access token for a plugin's lambda (a read), and — for a flow, which writes — calling the service as the
 * user: any request (`oauth.fetch`), a file of Zeff up in a resumable upload (`oauth.upload`), a file down into the documents
 * (`oauth.download`). A flow or lambda needs the permission `oauth: ["<plugin>.<id>"]` (a plugin's package asks for it, you allow it when
 * installing; its lambdas get their own plugin's) and reaches only the domains its `web` allows. Beside them two reads of what the kernel
 * keeps for everyone: the backup files and the documents (what a sync of them plans from). Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const text = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Zeff's own address as the page was asked for (the sign-in comes back there). */
async function origin(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  } catch {
    return `http://127.0.0.1:${process.env.PORT ?? 9333}`;
  }
}

/** The connection a call may use: the flow's (or the lambda's own plugin's) permission names it. */
function allowed(v: unknown, ctx: ActionCtx): string {
  const c = text(v).trim();
  if (!(ctx.perms.oauth ?? []).includes(c)) throw new Error(`This flow may not use the sign-in “${c}” — grant it under the flow's permissions (oauth).`);
  return c;
}

/** One call to the service with the token: 401 → a fresh token once; 429 and 5xx and network errors → tried again a few times. */
async function authed(conn: string, url: string, init: { method?: string; headers?: Record<string, string>; body?: BodyInit; retries?: number }, ctx: ActionCtx): Promise<Response> {
  const oauth = await import("@/lib/ext/oauth");
  const target = await ctx.web(url);
  const retries = init.retries ?? 4;
  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    const { accessToken } = await oauth.accessToken(conn, refreshed);
    let res: Response | null = null;
    let failure: unknown = null;
    try {
      res = await fetch(target, { method: init.method ?? "GET", headers: { ...(init.headers ?? {}), authorization: `Bearer ${accessToken}` }, body: init.body, redirect: "manual", signal: AbortSignal.timeout(120000) });
    } catch (e) {
      failure = e;
    }
    if (res) {
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        attempt--;
        continue;
      }
      // (308 is a resumable upload's "go on"; a 403 that is a rate limit is waited out too)
      if (res.ok || res.status === 308 || (res.status < 500 && res.status !== 429 && res.status !== 403)) return res;
      const body = res.status === 403 ? await res.clone().text() : "";
      const limited = res.status === 429 || res.status >= 500 || /rateLimitExceeded|userRateLimitExceeded|backendError/.test(body);
      if (!limited || attempt >= retries) return res;
      await sleep(Number(res.headers.get("retry-after")) * 1000 || Math.min(30000, 1000 * 2 ** attempt));
      continue;
    }
    if (attempt >= retries) throw failure instanceof Error ? failure : new Error(String(failure));
    await sleep(Math.min(15000, 1000 * 2 ** attempt));
  }
}

/** What the service said was wrong, in its own words (Google's { error: { message } }, OAuth's { error_description }). */
async function problem(res: Response, host: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string; message?: string }[] } | string; error_description?: string; message?: string };
  const message = (typeof body.error === "object" ? body.error?.message : body.error_description || body.error) || body.message || res.statusText || String(res.status);
  const reason = typeof body.error === "object" ? body.error?.errors?.find((e) => e.reason)?.reason : undefined;
  return Object.assign(new Error(`${host}: ${message} (${res.status})`), { status: res.status, reason });
}

/** A file of Zeff the kernel keeps, by what it is: a backup (its name) or a document (its id) — where it is on disk. */
async function sourceFile(s: Record<string, unknown>): Promise<{ path: string; name: string; size: number }> {
  if (s.kind === "backup") {
    const { accountBackupFiles } = await import("@/plugins/backup/backup");
    const b = accountBackupFiles().find((x) => x.name === text(s.name));
    if (!b) throw new Error(`There is no backup “${text(s.name)}”.`);
    return { path: b.path, name: b.name, size: b.size };
  }
  if (s.kind === "document") {
    const { documentFile } = await import("@/plugins/documents/store");
    const d = documentFile(Number(s.id));
    if (!d) throw new Error(`There is no document ${String(s.id)}.`);
    return { path: d.path, name: d.name, size: fs.statSync(d.path).size };
  }
  throw new Error("A source is { kind: \"backup\", name } or { kind: \"document\", id }.");
}

/** How far a 308 says the service has the file: the byte after "Range: bytes=0-N" (none: nothing yet). */
const rangeEnd = (res: Response): number => {
  const m = /bytes=0-(\d+)/.exec(res.headers.get("range") ?? "");
  return m ? Number(m[1]) + 1 : 0;
};

export const OAUTH_ACTIONS: FlowAction[] = [
  {
    name: "oauth.status",
    group: "oauth",
    label: "How a sign-in stands",
    summary: "Whether the plugin is signed in (never the tokens): who (the e-mail, when the service gives it), what it was granted, since when, whether its OAuth client is set, the address the service must send you back to, and the scopes each set asks for.",
    input: [f("connection", "text", { required: true, help: "<plugin>.<id>" })],
    output: "{ connected, email, scope, scopes, connectedAt, hasClient, label, sets, redirectUri }",
    run: async (i) => {
      const oauth = await import("@/lib/ext/oauth");
      const conn = text(i.connection).trim();
      const { plugin, decl } = oauth.connectionOf(conn);
      return { ...oauth.oauthStatus(conn), redirectUri: `${await origin()}/api/ext/oauth/${plugin}/${decl.id}/callback` };
    },
  },
  {
    name: "oauth.connect-url",
    group: "oauth",
    label: "Where to sign in",
    summary: "The address that sends you to the service to sign in (with the OAuth client set in the plugin's settings) — it comes back to Zeff. `with` names one of the plugin's sets of scopes.",
    input: [f("connection", "text", { required: true }), f("with", "text")],
    output: "{ href }",
    run: async (i) => {
      const oauth = await import("@/lib/ext/oauth");
      const conn = text(i.connection).trim();
      const { plugin, decl } = oauth.connectionOf(conn);
      const q = new URLSearchParams(text(i.with) ? { with: text(i.with) } : {});
      // (an absolute address: the page opens it in a tab of its own)
      return { href: `${await origin()}/api/ext/oauth/${plugin}/${decl.id}/connect${q.size ? `?${q}` : ""}` };
    },
  },
  {
    name: "oauth.disconnect",
    group: "oauth",
    label: "Sign out",
    summary: "The plugin's sign-in forgotten (what it put at the service stays there).",
    input: [f("connection", "text", { required: true })],
    output: "{ ok }",
    writes: true,
    run: async (i, ctx) => {
      if (ctx.dryRun) return { dryRun: true };
      (await import("@/lib/ext/oauth")).oauthDisconnect(text(i.connection).trim());
      return { ok: true };
    },
  },
  {
    name: "oauth.token",
    group: "oauth",
    label: "A fresh access token",
    summary: "An access token for the plugin's sign-in, refreshed when it is about to run out (`force`: after the service said 401). For the plugin's lambdas, which call the service themselves (their web allows its domain) — they never see the refresh token or the client secret.",
    input: [f("connection", "text", { required: true }), f("force", "boolean")],
    output: "{ accessToken, expiresAt }",
    run: async (i, ctx) => (await import("@/lib/ext/oauth")).accessToken(allowed(i.connection, ctx), i.force === true || i.force === "true"),
  },
  {
    name: "oauth.fetch",
    group: "oauth",
    label: "Call a service as the user",
    summary: "A request to the service with the plugin's access token (refreshed on 401, tried again on rate limits and hiccups). The address must be one of the flow's web domains. An error answer throws with the service's own words — except the statuses in `okStatus`. Gives the status, the JSON (or the text), the Location header.",
    input: [f("connection", "text", { required: true }), f("url", "text", { required: true }), f("method", "text"), f("json", "json", { help: "The body, as JSON" }), f("headers", "json"), f("okStatus", "json", { help: "Statuses that aren't errors, e.g. [404]" })],
    output: "{ status, ok, json, text, location }",
    needs: ["web"],
    writes: true,
    run: async (i, ctx) => {
      const conn = allowed(i.connection, ctx);
      const url = text(i.url);
      const method = (text(i.method) || (i.json === undefined ? "GET" : "POST")).toUpperCase();
      if (ctx.dryRun && method !== "GET") return { dryRun: true, method, url };
      const headers = { ...Object.fromEntries(Object.entries(obj(i.headers)).map(([k, v]) => [k, String(v)])), ...(i.json !== undefined ? { "content-type": "application/json" } : {}) };
      const res = await authed(conn, url, { method, headers, body: i.json === undefined ? undefined : JSON.stringify(i.json) }, ctx);
      const fine = Array.isArray(i.okStatus) ? (i.okStatus as unknown[]).map(Number) : [];
      if (!res.ok && !fine.includes(res.status)) throw await problem(res, new URL(url).hostname);
      const raw = await res.text();
      let json: unknown = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        json = null;
      }
      return { status: res.status, ok: res.ok, json, text: json === null ? raw.slice(0, 20000) : "", location: res.headers.get("location") ?? "" };
    },
  },
  {
    name: "oauth.upload",
    group: "oauth",
    label: "Put a file of Zeff up (resumable)",
    summary: "A backup (source { kind: \"backup\", name }) or a document ({ kind: \"document\", id }) uploaded to the service with a resumable upload — the request that starts it (`start`: url, json, headers — the service answers the address to send the bytes to in Location), then the file in chunks (a hiccup resumes where it was). Gives the service's last answer (its JSON).",
    input: [f("connection", "text", { required: true }), f("start", "json", { required: true, help: "{ url, method?, json?, headers? }" }), f("source", "json", { required: true }), f("mime", "text"), f("chunk", "number", { help: "Bytes per chunk (a multiple of 262144; default 8 MiB)" })],
    output: "{ json }",
    needs: ["web"],
    writes: true,
    run: async (i, ctx) => {
      const conn = allowed(i.connection, ctx);
      const start = obj(i.start);
      const file = await sourceFile(obj(i.source));
      if (ctx.dryRun) return { dryRun: true, file: file.name, size: file.size };
      const mime = text(i.mime) || "application/octet-stream";
      const first = await authed(conn, text(start.url), { method: text(start.method) || "POST", headers: { "content-type": "application/json; charset=UTF-8", "x-upload-content-type": mime, "x-upload-content-length": String(file.size), ...Object.fromEntries(Object.entries(obj(start.headers)).map(([k, v]) => [k, String(v)])) }, body: JSON.stringify(start.json ?? {}) }, ctx);
      if (!first.ok) throw await problem(first, new URL(text(start.url)).hostname);
      const session = first.headers.get("location");
      if (!session) throw new Error("The service gave no upload address.");
      const host = new URL(session).hostname;
      const asked = Number(i.chunk) || Number(process.env.ZEFF_UPLOAD_CHUNK);
      const chunkSize = asked >= 262144 && asked % 262144 === 0 ? asked : 8 * 1048576;
      const fd = fs.openSync(file.path, "r");
      try {
        let offset = 0;
        let failures = 0;
        const resumeFrom = async (): Promise<number> => {
          const res = await authed(conn, session, { method: "PUT", headers: { "content-length": "0", "content-range": `bytes */${file.size}` }, retries: 2 }, ctx);
          if (res.status === 308) return rangeEnd(res);
          if (res.ok) return file.size;
          throw await problem(res, host);
        };
        for (;;) {
          const len = Math.min(chunkSize, file.size - offset);
          const buf = Buffer.alloc(len);
          if (len) fs.readSync(fd, buf, 0, len, offset);
          let res: Response;
          try {
            res = await authed(conn, session, { method: "PUT", headers: { "content-length": String(len), "content-range": len ? `bytes ${offset}-${offset + len - 1}/${file.size}` : `bytes */${file.size}` }, body: buf, retries: 0 }, ctx);
          } catch (e) {
            if (++failures > 4) throw e;
            offset = await resumeFrom();
            continue;
          }
          if (res.ok) return { json: await res.json().catch(() => null) };
          if (res.status === 308) {
            offset = rangeEnd(res);
            failures = 0;
            continue;
          }
          if (res.status >= 500 || res.status === 429) {
            if (++failures > 4) throw await problem(res, host);
            await sleep(Math.min(15000, 1000 * 2 ** failures));
            offset = await resumeFrom();
            continue;
          }
          throw await problem(res, host);
        }
      } finally {
        fs.closeSync(fd);
      }
    },
  },
  {
    name: "oauth.download",
    group: "oauth",
    label: "Take a file from the service into the documents",
    summary: "A file at an address of the service (with the plugin's access token) kept among the documents under `name` — each once (the same bytes are the same document). Gives the document's id and size.",
    input: [f("connection", "text", { required: true }), f("url", "text", { required: true }), f("name", "text", { required: true }), f("mime", "text")],
    output: "{ id, size, fresh }",
    needs: ["web"],
    writes: true,
    run: async (i, ctx) => {
      const conn = allowed(i.connection, ctx);
      if (ctx.dryRun) return { dryRun: true };
      const url = text(i.url);
      const res = await authed(conn, url, {}, ctx);
      if (!res.ok) throw await problem(res, new URL(url).hostname);
      const data = Buffer.from(await res.arrayBuffer());
      const { addDocument } = await import("@/plugins/documents/store");
      const { doc, fresh } = addDocument(text(i.name), data, text(i.mime));
      return { id: doc.id, size: data.length, fresh };
    },
  },
  {
    name: "backup.files",
    group: "files",
    label: "This account's backup files",
    summary: "The backup ZIPs (and their config ZIPs) in the backup folder: name, size, whether encrypted (null: unknown), whether a config ZIP.",
    input: [],
    output: "{ files: [{ name, size, encrypted, config }] }",
    run: async () => ({ files: (await import("@/plugins/backup/backup")).accountBackupFiles().map((x) => ({ name: x.name, size: x.size, encrypted: x.encrypted, config: x.config })) }),
  },
  {
    name: "documents.list",
    group: "files",
    label: "The documents' files",
    summary: "Every document that has its file: id, name, mime, size.",
    input: [],
    output: "{ docs: [{ id, name, mime, size }] }",
    run: async () => {
      const { listDocuments, documentFile } = await import("@/plugins/documents/store");
      return { docs: listDocuments().flatMap((d) => (documentFile(d.id) ? [{ id: d.id, name: d.name, mime: d.mime ?? "", size: d.size }] : [])) };
    },
  },
];

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("core:oauth", OAUTH_ACTIONS);
