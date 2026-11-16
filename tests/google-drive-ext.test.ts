import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

const S = setupTempData();

/**
 * Google Drive's port (zeff-plugins/plugins/google-drive-ext) and the kernel's sign-in for plugins (`contributes.oauth`, lib/ext/oauth.ts):
 * against a fake Drive and a fake Google — every fetch is answered here, nothing real is called, the tokens are made up. The built-in's
 * sign-in taken over (kept encrypted), the way there and back (PKCE, the state checked), the two syncs as flows (uploads in chunks, folders
 * made, the retention mirrored, a 401 refreshed, documents coming in — Google's own as Office files — the oversized one remembered), a lambda
 * only reading, a flow needing the permission, the page drawn in every state, the switch.
 */
const PLUGIN = path.resolve(process.env.ZEFF_PLUGINS_REPO ?? "../zeff-plugins", "plugins/google-drive-ext");
const have = fs.existsSync(path.join(PLUGIN, "zeff-plugin.json"));
if (have) {
  fs.cpSync(PLUGIN, path.join(S, "plugins", "google-drive-ext"), { recursive: true });
  process.env.ZEFF_PLUGINS_DIR = path.join(S, "plugins");
}
process.env.ZEFF_UPLOAD_CHUNK = String(262144);

// ── The fake Drive ──
type F = { id: string; name: string; mimeType: string; parents: string[]; trashed?: boolean; content?: Buffer; modifiedTime: string; md5Checksum?: string; size?: string };
const files = new Map<string, F>();
let seq = 0;
const calls: string[] = [];
const sessions = new Map<string, { meta: { name: string; parents: string[] }; got: Buffer; mime: string; total: number }>();
const FOLDER = "application/vnd.google-apps.folder";
let tokens = 0;
let fail401Once = false;
const jwt = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;
const addFile = (f: Partial<F> & { name: string }): F => {
  const id = `f${++seq}`;
  const row: F = { id, mimeType: "application/octet-stream", parents: [], modifiedTime: `2026-11-1${seq % 9}T10:00:00Z`, ...f } as F;
  if (row.content && !row.md5Checksum) row.md5Checksum = `md5-${id}`;
  files.set(id, row);
  return row;
};
const view = (f: F) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size ?? (f.content ? String(f.content.length) : undefined), md5Checksum: f.md5Checksum, modifiedTime: f.modifiedTime, parents: f.parents, trashed: !!f.trashed });
const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(status === 204 || body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const bytes = (b: Buffer, status = 200) => new Response(new Uint8Array(b), { status });

globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  calls.push(`${method} ${url.host}${url.pathname}${url.search.slice(0, 80)}`);
  if (url.host === "oauth2.googleapis.com") {
    const body = new URLSearchParams(String(init.body));
    if (body.get("client_id") !== "123-abc.apps.googleusercontent.com" || body.get("client_secret") !== "fake-secret-0000") return reply({ error: "invalid_client" }, 401);
    if (body.get("grant_type") === "refresh_token") {
      if (body.get("refresh_token") !== "fake-refresh") return reply({ error: "invalid_grant" }, 400);
      return reply({ access_token: `fake-at-${++tokens}`, expires_in: 3600 });
    }
    assert.equal(body.get("code_verifier")!.length > 40, true, "PKCE verifier sent");
    return reply({ access_token: `fake-at-${++tokens}`, refresh_token: "fake-refresh-2", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/drive", id_token: jwt("other@example.com") });
  }
  if (url.host !== "www.googleapis.com") throw new Error(`a real call to ${url.host}`);
  const auth = headers.get("authorization") ?? "";
  if (!/^Bearer fake-at-\d+$/.test(auth)) return reply({ error: { message: "no token" } }, 401);
  if (fail401Once) {
    fail401Once = false;
    return reply({ error: { message: "expired" } }, 401);
  }
  const p = url.pathname;
  if (p === "/upload/drive/v3/files" && method === "POST") {
    const meta = JSON.parse(String(init.body));
    const id = `s${++seq}`;
    sessions.set(id, { meta, got: Buffer.alloc(0), mime: headers.get("x-upload-content-type") ?? "", total: Number(headers.get("x-upload-content-length")) });
    return reply({}, 200, { location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${id}` });
  }
  if (p === "/upload/drive/v3/files" && method === "PUT") {
    const s = sessions.get(url.searchParams.get("upload_id")!)!;
    const range = headers.get("content-range") ?? "";
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    if (!m) return s.got.length >= s.total ? reply({}, 200) : reply({}, 308, s.got.length ? { range: `bytes=0-${s.got.length - 1}` } : {});
    assert.equal(Number(m[1]), s.got.length, "chunks in order");
    s.got = Buffer.concat([s.got, Buffer.from(init.body as Uint8Array)]);
    if (s.got.length < s.total) return reply({}, 308, { range: `bytes=0-${s.got.length - 1}` });
    const f = addFile({ name: s.meta.name, parents: s.meta.parents, content: s.got, mimeType: s.mime });
    calls.push(`  stored ${f.name} (${f.content!.length} bytes, ${Math.ceil(s.total / 262144)} chunk(s))`);
    return reply(view(f));
  }
  if (p === "/drive/v3/files" && method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    let m = /^mimeType='[^']+' and name='([^']*)' and trashed=false and '([^']*)' in parents$/.exec(q);
    if (m) return reply({ files: [...files.values()].filter((f) => f.mimeType === FOLDER && f.name === m![1] && !f.trashed && (m![2] === "root" ? f.parents.length === 0 : f.parents.includes(m![2]))).map(view) });
    m = /^'([^']*)' in parents and trashed=false$/.exec(q);
    if (m) return reply({ files: [...files.values()].filter((f) => f.parents.includes(m![1]) && !f.trashed).map(view) });
    throw new Error(`unknown query ${q}`);
  }
  if (p === "/drive/v3/files" && method === "POST") {
    const meta = JSON.parse(String(init.body));
    const f = addFile({ name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? [] });
    return reply({ id: f.id });
  }
  const one = /^\/drive\/v3\/files\/([^/]+)(\/export)?$/.exec(p);
  if (one) {
    const f = files.get(decodeURIComponent(one[1]));
    if (method === "DELETE") {
      if (!f) return reply({ error: { message: "not found" } }, 404);
      files.delete(f.id);
      return reply(null, 204);
    }
    if (!f) return reply({ error: { message: "File not found" } }, 404);
    if (one[2]) return bytes(Buffer.from(`exported ${f.name} as ${url.searchParams.get("mimeType")}`));
    if (url.searchParams.get("alt") === "media") return bytes(f.content ?? Buffer.alloc(0));
    return reply(view(f));
  }
  throw new Error(`unknown call ${method} ${url}`);
}) as typeof fetch;

const ok = (m: string) => console.log(`  ✓ ${m}`);
const section = (m: string) => console.log(`\n${m}`);

test("Google Drive: sign-in, the two syncs, the folders, the page, the switch", { skip: !have && "zeff-plugins isn't beside Zeff" }, async () => {
// ── The world ──
const { getSqlite } = await import("@/db");
const { setInstalled } = await import("@/plugins/state");
for (const id of ["workspace", "documents", "backup"]) setInstalled(id as never, true);
await import("@/plugins/contributions");
const reg = await import("@/lib/ext/registry");
reg.setEnabled("google-drive-ext", true);
const life = await import("@/plugins/workspace/package-life");
const pkg = await life.offeredPackage("google-drive-ext");
assert.ok(pkg, "the package is offered");
const installed = await life.installTracked(pkg!, null, { allow: true });
const flows = await import("@/plugins/workspace/flows/store");
const engine = await import("@/plugins/workspace/flows/engine");
const { flowAction } = await import("@/plugins/workspace/flows/actions");

section("the built-in's sign-in is taken over");
const sql = getSqlite();
sql.prepare("delete from google_drive").run();
sql.prepare("delete from google_drive_files").run();
sql.prepare("insert into google_drive (id, client_id, client_secret, refresh_token, access_token, expires_at, scope, email, connected_at, folder_name, mirror_backup_retention, upload_unencrypted, pull_documents) values (1, ?, ?, ?, '', 0, ?, ?, ?, '', 1, 0, 0)").run("123-abc.apps.googleusercontent.com", "fake-secret-0000", "fake-refresh", "openid email https://www.googleapis.com/auth/drive.file", "me@example.com", "2026-11-10T10:00:00Z");
sql.prepare("insert into google_drive_files (kind, key, drive_id, version, size, origin, synced_at) values ('backup', 'zeff-backup-old.zip', 'd-old', 'm', 5, 'push', ?)").run("2026-11-10T10:00:00Z");
const ctx = (perms: Record<string, unknown> = {}) => ({ flow: "harness", runId: null, dryRun: false, perms, web: async (u: string) => new URL(u), canWrite: () => undefined, may: () => undefined, log: () => undefined }) as never;
const status = (await flowAction("oauth.status")!.run({ connection: "google-drive-ext.drive" }, ctx())) as { connected: boolean; email: string; hasClient: boolean; scopes: string[]; redirectUri: string };
assert.equal(status.connected, true);
assert.equal(status.email, "me@example.com");
assert.equal(status.hasClient, true);
assert.ok(JSON.stringify(status).indexOf("fake-refresh") < 0, "no token in the status");
assert.match(status.redirectUri, /\/api\/ext\/oauth\/google-drive-ext\/drive\/callback$/);
ok(`connected as ${status.email}, client set, redirect ${status.redirectUri}`);
const { getPref } = await import("@/lib/prefs");
const stored = String(getPref<string>("ext:oauth:google-drive-ext.drive", ""));
assert.ok(stored.startsWith("v1:") && !stored.includes("fake-refresh"), "the tokens are kept encrypted");
ok("tokens kept encrypted (v1:…), not in clear");
const { pluginSettings } = await import("@/lib/ext/plugin-settings");
const set = pluginSettings("google-drive-ext", reg.getPlugin("google-drive-ext")!.manifest);
assert.equal(set.clientId, "123-abc.apps.googleusercontent.com");
assert.equal(set.clientSecret, "fake-secret-0000");
assert.equal(set.mirrorBackupRetention, true);
assert.equal(set.pullDocuments, false);
ok("the OAuth client and the switches carried over into the plugin's settings");
await assert.rejects(async () => flowAction("oauth.token")!.run({ connection: "google-drive-ext.drive" }, ctx()), /may not use the sign-in/);
ok("oauth.token refused without the permission");

section("the sign-in: connect and callback routes (a fake Google)");
const { NextRequest } = await import("next/server");
const connect = await import("@/app/api/ext/oauth/[plugin]/[id]/connect/route");
const callback = await import("@/app/api/ext/oauth/[plugin]/[id]/callback/route");
const params = (plugin: string, id: string) => ({ params: Promise.resolve({ plugin, id }) });
const c1 = await connect.GET(new NextRequest("http://127.0.0.1:9444/api/ext/oauth/google-drive-ext/drive/connect?with=full", { headers: { referer: "http://127.0.0.1:9444/workspace/12" } }), params("google-drive-ext", "drive"));
assert.equal(c1.status, 307);
const auth = new URL(c1.headers.get("location")!);
assert.equal(auth.host, "accounts.google.com");
assert.equal(auth.searchParams.get("scope"), "openid email https://www.googleapis.com/auth/drive");
assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
assert.equal(auth.searchParams.get("access_type"), "offline");
assert.equal(auth.searchParams.get("redirect_uri"), "http://localhost:9444/api/ext/oauth/google-drive-ext/drive/callback");
const cookie = c1.cookies.get("zeff_oauth_google-drive-ext_drive")!;
ok(`sent to Google with the full scope and PKCE; state ${auth.searchParams.get("state")!.slice(0, 6)}…`);
const bad = await callback.GET(new NextRequest("http://127.0.0.1:9444/api/ext/oauth/google-drive-ext/drive/callback?code=abc&state=wrong", { headers: { cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}` } }), params("google-drive-ext", "drive"));
assert.match(decodeURIComponent(bad.headers.get("location")!), /error=Login state did not match/);
ok("a wrong state is refused");
const c2 = await connect.GET(new NextRequest("http://127.0.0.1:9444/api/ext/oauth/google-drive-ext/drive/connect"), params("google-drive-ext", "drive"));
const good = await callback.GET(new NextRequest(`http://127.0.0.1:9444/api/ext/oauth/google-drive-ext/drive/callback?code=abc&state=${new URL(c2.headers.get("location")!).searchParams.get("state")}`, { headers: { cookie: `zeff_oauth_google-drive-ext_drive=${encodeURIComponent(c2.cookies.get("zeff_oauth_google-drive-ext_drive")!.value)}` } }), params("google-drive-ext", "drive"));
assert.match(good.headers.get("location")!, /connected=1/);
const after = (await flowAction("oauth.status")!.run({ connection: "google-drive-ext.drive" }, ctx())) as { email: string; scopes: string[] };
assert.equal(after.email, "other@example.com");
assert.ok(after.scopes.includes("https://www.googleapis.com/auth/drive"));
ok(`code exchanged: now ${after.email} with all of Drive`);
// (back to the first account for the syncs: the way the built-in's sign-in comes over — a fresh import)
const { setPref } = await import("@/lib/prefs");
const { seal } = await import("@/lib/ext/plugin-settings");
setPref("ext:oauth:google-drive-ext.drive", seal(JSON.stringify({ accessToken: "", refreshToken: "fake-refresh", expiresAt: 0, scope: "openid email https://www.googleapis.com/auth/drive.file", email: "me@example.com", connectedAt: "2026-11-10T10:00:00Z" })));

// ── Local things to sync ──
const { backupDir } = await import("@/plugins/backup/backup");
sql.prepare("update app_settings set backup_dir = ?").run(path.join(S, "my-backups"));
fs.mkdirSync(backupDir(), { recursive: true });
const zip = (n: number, encrypted: boolean) => {
  const b = Buffer.alloc(n, 7);
  b.writeUInt32LE(0x04034b50, 0);
  b.writeUInt16LE(encrypted ? 1 : 0, 6);
  return b;
};
fs.writeFileSync(path.join(backupDir(), "zeff-backup-a.zip"), zip(600_000, true)); // (three chunks)
fs.writeFileSync(path.join(backupDir(), "zeff-backup-b.zip"), zip(1000, false)); // (no password: stays home)
const { addDocument } = await import("@/plugins/documents/store");
const d1 = addDocument("letter.pdf", Buffer.from("first letter"), "application/pdf").doc;
const d2 = addDocument("notes.txt", Buffer.from("some notes"), "text/plain").doc;

section("backups → Drive");
let r = await engine.runFlow("google-drive.sync-backups", {});
assert.equal(r.status, "done", r.error ?? "");
console.log("   ", JSON.stringify(r.output));
assert.deepEqual(r.output, { ok: true, message: "1 uploaded · 1 removed (the retention) · 1 not uploaded: no password set" });
const root = [...files.values()].find((f) => f.name === "Zeff" && f.mimeType === FOLDER)!;
const backups = [...files.values()].find((f) => f.name === "Backups" && f.parents.includes(root.id))!;
assert.ok(root && backups, "Zeff and Backups folders made");
const up = [...files.values()].find((f) => f.name === "zeff-backup-a.zip")!;
assert.equal(up.content!.length, 600_000);
assert.deepEqual(up.parents, [backups.id]);
assert.ok(calls.includes("  stored zeff-backup-a.zip (600000 bytes, 3 chunk(s))"));
ok("folders made, the encrypted backup uploaded in 3 chunks, the one without a password stayed home");
const rec = sql.prepare("select kind, key, drive_id, version, origin from google_drive_files where key = 'zeff-backup-a.zip'").get() as { drive_id: string; version: string };
assert.equal(rec.drive_id, up.id);
assert.equal(rec.version, up.md5Checksum);
ok("recorded in the built-in's own table (adopted)");
// the old recorded one is gone locally: the retention mirror removes it from Drive (only because it was Zeff's)
assert.ok(!sql.prepare("select 1 from google_drive_files where drive_id = 'd-old'").get(), "the mirrored removal forgot the old record");
assert.ok(calls.some((c) => c === "DELETE www.googleapis.com/drive/v3/files/d-old"));
ok("what the retention removed locally went from Drive (DELETE d-old, 404 accepted) and is forgotten");
const before = calls.length;
fail401Once = true;
r = await engine.runFlow("google-drive.sync-backups", {});
assert.deepEqual(r.output, { ok: true, message: "1 not uploaded: no password set" }, JSON.stringify(r.output));
assert.ok(!calls.slice(before).some((c) => c.startsWith("POST www.googleapis.com/upload")), "nothing uploaded twice");
ok("a second run uploads nothing twice (a 401 on the way refreshed the token and went on)");

section("documents ↔ Drive");
const docsFolder = () => [...files.values()].find((f) => f.name === "Documents" && f.parents.includes(root.id));
r = await engine.runFlow("google-drive.sync-documents", {});
assert.equal(r.status, "done", r.error ?? "");
assert.deepEqual(r.output, { ok: true, message: "2 uploaded" }, JSON.stringify(r.output));
assert.ok(docsFolder());
assert.deepEqual([...files.values()].filter((f) => f.parents.includes(docsFolder()!.id)).map((f) => f.name).sort(), ["letter.pdf", "notes.txt"]);
ok("both documents uploaded into Zeff/Documents");
r = await engine.runFlow("google-drive.sync-documents", {});
assert.deepEqual(r.output, { ok: true, message: "Everything is in sync." });
ok("the next run: everything is in sync");

section("documents coming back: needs all of Drive, then comes in");
const { saveSettings } = await import("@/lib/ext/plugin-settings");
saveSettings("google-drive-ext", reg.getPlugin("google-drive-ext")!.manifest, { pullDocuments: true });
r = await engine.runFlow("google-drive.sync-documents", {});
assert.equal(r.status, "done");
assert.match((r.output as { message: string }).message, /can't be read with the access Zeff has/);
ok(`says so: ${(r.output as { message: string }).message}`);
setPref("ext:oauth:google-drive-ext.drive", seal(JSON.stringify({ accessToken: "", refreshToken: "fake-refresh", expiresAt: 0, scope: "openid email https://www.googleapis.com/auth/drive", email: "me@example.com", connectedAt: "2026-11-10T10:00:00Z" })));
const inbox = [...files.values()].find((f) => f.name === "Documents" && f.parents.includes(root.id))!;
addFile({ name: "from-drive.txt", parents: [inbox.id], content: Buffer.from("hello from Drive"), mimeType: "text/plain" });
addFile({ name: "Google Doc", parents: [inbox.id], mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-11-12T08:00:00Z" });
addFile({ name: "huge.bin", parents: [inbox.id], size: String(60 * 1024 * 1024), mimeType: "application/octet-stream" });
r = await engine.runFlow("google-drive.sync-documents", {});
assert.equal(r.status, "done", r.error ?? "");
console.log("   ", JSON.stringify(r.output));
const docs = (await import("@/plugins/documents/store")).listDocuments().map((d) => d.name).sort();
assert.ok(docs.includes("from-drive.txt") && docs.includes("Google Doc.docx"), docs.join(", "));
assert.match((r.output as { message: string }).message, /2 came in from Drive · 1 failed — huge\.bin: .*too large/);
assert.equal((r.output as { ok: boolean }).ok, false);
ok("a file and a Google Doc (as .docx) came in; the oversized one said so and is remembered");
const skipped = sql.prepare("select count(*) n from google_drive_files where key = 'skipped'").get() as { n: number };
assert.equal(skipped.n, 1);
r = await engine.runFlow("google-drive.sync-documents", {});
assert.deepEqual(r.output, { ok: true, message: "Everything is in sync." }, JSON.stringify(r.output));
ok("the second run takes nothing in again, the oversized one isn't tried again");

section("the folders to read (flows) and the page's lambdas");
r = await engine.runFlow("google-drive.add-folder", { id: inbox.id, path: "My Drive → Zeff → Documents" });
assert.equal(r.status, "done", r.error ?? "");
const { invokeLambda } = await import("@/plugins/workspace/lambdas/run");
const st = await invokeLambda("drive.status", {});
assert.ok(st.ok, JSON.stringify(st));
const sv = (st as { result: { pullFolders: { path: string }[]; documentsInDrive: number; backupsInDrive: number; connected: boolean; needsReconnect: boolean } }).result;
assert.equal(sv.pullFolders[0].path, "My Drive → Zeff → Documents");
assert.equal(sv.connected, true);
assert.equal(sv.needsReconnect, false);
ok(`the page's data: ${sv.documentsInDrive} documents, ${sv.backupsInDrive} backups in Drive, 1 folder read`);
const fl = await invokeLambda("drive.folders", { parent: root.id });
assert.ok(fl.ok, JSON.stringify(fl));
const fv = (fl as { result: { path: string; up: string; folders: { name: string }[] } }).result;
assert.equal(fv.path, "My Drive → Zeff");
assert.deepEqual(fv.folders.map((x) => x.name).sort(), ["Backups", "Documents"]);
ok(`the folder browser: “${fv.path}”, subfolders ${fv.folders.map((x) => x.name).join(", ")}`);
r = await engine.runFlow("google-drive.remove-folder", { id: inbox.id });
assert.equal(r.status, "done", r.error ?? "");
assert.equal(((await invokeLambda("drive.status", {})) as { result: { pullFolders: unknown[] } }).result.pullFolders.length, 0);
ok("a folder removed");

section("a lambda can't write or reach what it didn't name; a flow needs the permission");
const flow = flows.flowByName("google-drive.sync-backups")!;
assert.deepEqual(flow.permissions.oauth, ["google-drive-ext.drive"]);
assert.equal(flow.sync?.replaces, "drivebackup");
assert.equal(flows.flowByName("google-drive.sync-documents")!.sync?.replaces, "drivedocs");
flows.createFlow({ name: "t.no-oauth", nodes: [{ id: "x", kind: "action", action: "oauth.fetch", input: { connection: "google-drive-ext.drive", url: "https://www.googleapis.com/drive/v3/files/x" } }], permissions: { web: ["www.googleapis.com"] } });
const denied = await engine.runFlow("t.no-oauth");
assert.equal(denied.status, "failed");
assert.match(denied.error ?? "", /may not use the sign-in/);
ok("sync flows are marked as replacing drivebackup / drivedocs; a flow without the oauth permission is refused");

section("the page draws without an error in every state");
const { renderView } = await import("@/plugins/workspace/view-template");
const template = (JSON.parse(fs.readFileSync(path.join(PLUGIN, "google-drive.package.json"), "utf8")) as { blocks: { def: { template: string } }[] }).blocks[0].def.template;
const O = { connected: true, email: "me@example.com", hasClient: true, redirectUri: "http://localhost:9333/api/ext/oauth/google-drive-ext/drive/callback", scopes: [] };
const D = { connected: true, needsReconnect: false, connectWith: "", folder: "Zeff", mirrorBackupRetention: true, uploadUnencrypted: false, pullDocuments: false, pullFolders: [{ id: "x", path: "My Drive → A, B" }], backupsInDrive: 2, documentsInDrive: 5 };
const F = { id: "f9", path: "My Drive → Zeff", up: "root", folders: [{ id: "a", name: "Backups" }] };
const find = (nodes: unknown[], tag: string): { t: string; a: Record<string, string> }[] => (nodes as ({ t: string; a: Record<string, string>; c: unknown[] } | string)[]).flatMap((n) => (typeof n === "string" ? [] : [...(n.t === tag ? [n] : []), ...find(n.c, tag)]));
for (const [state, data] of [
  [{}, {}],
  [{}, { o: { ...O, connected: false, hasClient: false }, d: { ...D, connected: false, pullFolders: [] } }],
  [{}, { o: O, d: D }],
  [{}, { o: O, d: { ...D, needsReconnect: true, connectWith: "full" } }],
  [{ browse: "1", cur: "f9" }, { o: O, d: D, f: F }],
  [{ browse: "1", cur: "root" }, { o: O, d: D, f: { ...F, id: "root", folders: [] } }],
] as [Record<string, string>, Record<string, unknown>][]) {
  const r = renderView(template, { rows: [], props: [], titleName: "Name", state, app: {}, data, db: { id: 1, title: "Google Drive" }, now: new Date("2026-11-15T12:00:00"), locale: "de-DE" } as never, { parts: [], actions: [] });
  assert.deepEqual(r.errors, [], JSON.stringify(state));
}
const drawn = renderView(template, { rows: [], props: [], titleName: "Name", state: { browse: "1", cur: "f9" }, app: {}, data: { o: O, d: D, f: F }, db: { id: 1, title: "x" }, now: new Date("2026-11-15T12:00:00"), locale: "de-DE" } as never, { parts: [], actions: [] });
const add = find(drawn.nodes, "button").find((b) => b.a.run === "google-drive.add-folder")!;
assert.deepEqual(JSON.parse(add.a.with), { id: "f9", path: "My Drive → Zeff" });
assert.deepEqual(JSON.parse(find(drawn.nodes, "button").find((b) => b.a.run === "google-drive.remove-folder")!.a.with), { id: "x" });
ok("six states drawn with zero errors; the folder buttons carry the id and the path as JSON");

section("the switch, and what the backup toggle and the copy after a backup do through the port");
setInstalled("google-drive" as never, true);
const ext = await import("@/plugins/extension-state");
ext.setExtensionInstalled("google-drive:documents-sync", true);
ext.setExtensionInstalled("google-drive:backup-sync", false);
const { switchGoogleDriveToPlugin } = await import("@/plugins/google-drive/to-plugin");
await switchGoogleDriveToPlugin();
const { isInstalled } = await import("@/plugins/state");
assert.equal(isInstalled("google-drive" as never), false);
assert.equal(flows.flowByName("google-drive.sync-documents")!.triggers.find((x) => x.kind === "schedule")?.everyMinutes, 15);
assert.equal(flows.flowByName("google-drive.sync-backups")!.triggers.find((x) => x.kind === "schedule"), undefined, "backups stay by hand: the built-in's extension for them was off");
ok("built-in off, the documents flow every 15 minutes (the built-in's), the backup flow by hand (its extension was off)");
const portmod = await import("@/plugins/google-drive/port");
assert.equal(await portmod.portBackupOn(), false);
await portmod.setPortBackup(true);
assert.equal(await portmod.portBackupOn(), true);
await portmod.setPortBackup(false);
assert.equal(await portmod.portBackupOn(), false);
await (await import("@/plugins/google-drive/after")).afterBackup();
ok("the Backups toggle is the backup flow's schedule; no copy after a backup while it is by hand");

section("disconnect");
await flowAction("oauth.disconnect")!.run({ connection: "google-drive-ext.drive" }, ctx());
assert.equal(((await flowAction("oauth.status")!.run({ connection: "google-drive-ext.drive" }, ctx())) as { connected: boolean }).connected, false);
const gone = await engine.runFlow("google-drive.sync-documents", {});
assert.equal(gone.status, "failed");
assert.match(gone.error ?? "", /Not connected/);
ok(`disconnected: a sync says so (“${gone.error}”)`);

console.log("\nall green");
process.exit(0);




});
