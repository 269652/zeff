import crypto from "node:crypto";
import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { saveSettings, pluginSettings, seal, unseal } from "./plugin-settings";
import { getPlugin } from "./registry";
import type { Manifest } from "./manifest";

/**
 * Signing in for plugins (a manifest's `contributes.oauth`, docs/plugins/manifest.md): the authorization-code flow with PKCE against the
 * user's OWN OAuth client (its id and secret are the plugin's settings), kept small and generic —
 *  - the way there and back is the kernel's (`/api/ext/oauth/<plugin>/<id>/connect` and `/callback`; the pending sign-in lives in a cookie);
 *  - the tokens are kept encrypted (the same key as the plugin's secrets: AES-256-GCM, a key file beside the data) per plugin and account;
 *  - refreshing is the kernel's: a plugin's lambda asks for a fresh access token (the read action `oauth.token`) and never sees the refresh
 *    token, the client secret or how it was got; a flow calls the service as the user (`oauth.fetch`, `oauth.upload`, `oauth.download`).
 * A port may take over the sign-in its built-in already had (OAUTH_ADOPTS: only what the kernel allows, once, nothing is removed from the
 * built-in) — so the sign-in keeps working through the switch. Server only.
 */

export type OauthDecl = Manifest["contributes"]["oauth"][number];
type Tokens = { accessToken: string; refreshToken: string; expiresAt: number; scope: string; email: string; connectedAt: string | null };
const NONE: Tokens = { accessToken: "", refreshToken: "", expiresAt: 0, scope: "", email: "", connectedAt: null };

const KEY = (full: string) => `ext:oauth:${full}`;
const ADOPTED = (plugin: string) => `ext:oauth-adopted:${plugin}`;

/** A connection by its full name "<plugin>.<id>": the plugin must be on. */
export function connectionOf(full: string): { plugin: string; manifest: Manifest; decl: OauthDecl } {
  const at = String(full ?? "").indexOf(".");
  const plugin = full.slice(0, at);
  const id = full.slice(at + 1);
  const p = at > 0 ? getPlugin(plugin) : undefined;
  if (!p?.enabled) throw new Error(`The plugin “${plugin}” isn't on.`);
  const decl = p.manifest.contributes.oauth.find((o) => o.id === id);
  if (!decl) throw new Error(`The plugin “${plugin}” has no sign-in “${id}”.`);
  return { plugin, manifest: p.manifest, decl };
}

/**
 * The built-ins' sign-ins their ports may take over (by the port's plugin id): the built-in's own row of tokens and settings. Imported once
 * — tokens sealed, settings written where the port has none yet — when the port has no sign-in of its own. The built-in's row stays as it
 * is (a refresh token isn't rotated: both keep working until you switch).
 */
export const OAUTH_ADOPTS: Record<string, { connection: string; table: string; where: string; tokens: Record<keyof Tokens, string>; settings: Record<string, string> }> = {
  "google-drive-ext": {
    connection: "drive",
    table: "google_drive",
    where: "id = 1",
    tokens: { accessToken: "access_token", refreshToken: "refresh_token", expiresAt: "expires_at", scope: "scope", email: "email", connectedAt: "connected_at" },
    settings: { clientId: "client_id", clientSecret: "client_secret", folderName: "folder_name", mirrorBackupRetention: "mirror_backup_retention", uploadUnencrypted: "upload_unencrypted", pullDocuments: "pull_documents" },
  },
};

function adoptOnce(plugin: string, manifest: Manifest): void {
  const a = OAUTH_ADOPTS[plugin];
  if (!a || getPref<boolean>(ADOPTED(plugin), false)) return;
  setPref(ADOPTED(plugin), true);
  let row: Record<string, unknown> | undefined;
  try {
    row = getSqlite().prepare(`select * from "${a.table}" where ${a.where}`).get() as Record<string, unknown> | undefined;
  } catch {
    return; // (the built-in never ran here)
  }
  if (!row) return;
  const have = pluginSettings(plugin, manifest);
  const values: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(a.settings)) {
    const v = row[col];
    if (v === null || v === undefined || v === "" || (have[key] !== null && have[key] !== undefined && have[key] !== "" && have[key] !== manifest.contributes.settings.find((s) => s.key === key)?.default)) continue;
    values[key] = typeof v === "number" && /^(mirror|upload|pull)/.test(key) ? v !== 0 : v;
  }
  if (Object.keys(values).length) saveSettings(plugin, manifest, values);
  const stored = getPref<string | null>(KEY(`${plugin}.${a.connection}`), null);
  if (!stored && row[a.tokens.refreshToken]) {
    const tokens = Object.fromEntries(Object.entries(a.tokens).map(([k, col]) => [k, row![col] ?? NONE[k as keyof Tokens]])) as Tokens;
    setPref(KEY(`${plugin}.${a.connection}`), seal(JSON.stringify(tokens)));
  }
}

function read(full: string): Tokens {
  const { plugin, manifest } = connectionOf(full);
  adoptOnce(plugin, manifest);
  const s = getPref<string | null>(KEY(full), null);
  if (!s) return { ...NONE };
  try {
    return { ...NONE, ...(JSON.parse(unseal(s)) as Partial<Tokens>) };
  } catch {
    return { ...NONE }; // (the key file changed: connect again)
  }
}
const write = (full: string, tokens: Tokens) => setPref(KEY(full), seal(JSON.stringify(tokens)));

/** The client the plugin's settings hold. */
function client(full: string): { id: string; secret: string } {
  const { plugin, manifest, decl } = connectionOf(full);
  const v = pluginSettings(plugin, manifest);
  return { id: String(v[decl.clientId] ?? "").trim(), secret: String(v[decl.clientSecret] ?? "").trim() };
}

const b64url = (b: Buffer) => b.toString("base64url");
export const newState = () => b64url(crypto.randomBytes(24));
export function newPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()) };
}

/** What it asks for: the default scopes, or the named set. */
export function scopesOf(decl: OauthDecl, withSet?: string): string[] {
  return (withSet && decl.scopeSets[withSet]) || decl.scopes;
}

/** Where to send the user to sign in. */
export function authorizeUrl(full: string, o: { redirectUri: string; state: string; challenge: string; with?: string }): string {
  const { decl } = connectionOf(full);
  const c = client(full);
  if (!c.id || !c.secret) throw new Error(t("Set your OAuth client first."));
  const q = new URLSearchParams({ client_id: c.id, redirect_uri: o.redirectUri, response_type: "code", scope: scopesOf(decl, o.with).join(" "), state: o.state, code_challenge: o.challenge, code_challenge_method: "S256", ...decl.authParams });
  return `${decl.authUrl}?${q}`;
}

type TokenResponse = { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; id_token?: string; error?: string; error_description?: string };

async function tokenRequest(decl: OauthDecl, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(decl.tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body), signal: AbortSignal.timeout(30000) });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || json.error) {
    if (json.error === "invalid_grant") throw new Error(t("The saved sign-in is no longer accepted (revoked — or, for an app still in “Testing”, older than 7 days). Connect again."));
    throw new Error(`${json.error ?? res.status}${json.error_description ? `: ${json.error_description}` : ""}`);
  }
  return json;
}

function emailOf(idToken?: string): string {
  try {
    return (JSON.parse(Buffer.from(String(idToken).split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string }).email ?? "";
  } catch {
    return "";
  }
}

/** The code the provider sent back, exchanged for tokens — kept. */
export async function exchangeCode(full: string, o: { code: string; redirectUri: string; verifier: string }): Promise<void> {
  const { decl } = connectionOf(full);
  const c = client(full);
  if (!c.id || !c.secret) throw new Error(t("Set your OAuth client first."));
  const tok = await tokenRequest(decl, { grant_type: "authorization_code", code: o.code, redirect_uri: o.redirectUri, code_verifier: o.verifier, client_id: c.id, client_secret: c.secret });
  if (!tok.access_token || !tok.refresh_token) throw new Error(t("The service gave no long-lived sign-in (refresh token) — remove Zeff in your account's third-party access and connect again."));
  write(full, {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000,
    scope: tok.scope ?? "",
    email: decl.identity === "id_token" ? emailOf(tok.id_token) : "",
    connectedAt: new Date().toISOString(),
  });
}

const refreshing = new Map<string, Promise<string>>();

/** A valid access token — refreshed when it is about to run out (or `force`d, after the service said 401). */
export async function accessToken(full: string, force = false): Promise<{ accessToken: string; expiresAt: number }> {
  const { decl } = connectionOf(full);
  const rec = read(full);
  if (!rec.refreshToken) throw new Error(t("Not connected — connect it on its page."));
  if (!force && rec.accessToken && rec.expiresAt - Date.now() > 60000) return { accessToken: rec.accessToken, expiresAt: rec.expiresAt };
  let p = refreshing.get(full);
  if (!p) {
    p = (async () => {
      try {
        const c = client(full);
        const tok = await tokenRequest(decl, { grant_type: "refresh_token", refresh_token: rec.refreshToken, client_id: c.id, client_secret: c.secret });
        if (!tok.access_token) throw new Error(t("The service gave no access token."));
        write(full, { ...rec, accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000, ...(tok.scope ? { scope: tok.scope } : {}) });
        return tok.access_token;
      } catch (e) {
        throw new Error(errorMessage(e));
      }
    })().finally(() => refreshing.delete(full));
    refreshing.set(full, p);
  }
  const token = await p;
  return { accessToken: token, expiresAt: read(full).expiresAt };
}

/** How the sign-in stands — never the tokens. */
export function oauthStatus(full: string): { connected: boolean; email: string; scope: string; scopes: string[]; connectedAt: string | null; hasClient: boolean; label: string; sets: Record<string, string[]> } {
  const { decl } = connectionOf(full);
  const rec = read(full);
  const c = client(full);
  return { connected: !!rec.refreshToken, email: rec.email, scope: rec.scope, scopes: rec.scope.split(/\s+/).filter(Boolean), connectedAt: rec.connectedAt, hasClient: !!(c.id && c.secret), label: decl.label, sets: { default: decl.scopes, ...decl.scopeSets } };
}

/** Signed out: the tokens go (what the plugin put at the service stays there). */
export function oauthDisconnect(full: string): void {
  connectionOf(full);
  setPref(KEY(full), null);
}

/** A new client is another project's — and any account: the sign-in goes (the plugin saves its settings, then asks for this). */
export const oauthForget = oauthDisconnect;
