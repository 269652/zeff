import path from "node:path";
import { accountChrome } from "@/db/accounts";
import { integrationDriverPath } from "@/lib/integrations/server";

/**
 * The plugins' browser drivers (MCP servers over stdio, run by Zeff) — Outlook Web serves the mail and
 * the calendar plugin. Signal's attaches to Signal Desktop instead (its own debug port, see signal/endpoint.ts).
 */
export type DriverId = CoreDriverId | (string & {});
type CoreDriverId = "teams" | "gitlab" | "outlook" | "gmail" | "whatsapp" | "signal" | "keep" | "google-calendar";

/** Where a plugin's driver is — in its integration's mount, else in src/plugins/<id>/. */
export const driverPath = (id: DriverId) => integrationDriverPath(id) ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "src", "plugins", id, "driver.mjs");

const ENDPOINTS = ["CHRONO_CDP_ENDPOINT", "TEAMS_CDP_ENDPOINT", "GITLAB_CDP_ENDPOINT", "OUTLOOK_CDP_ENDPOINT", "GMAIL_CDP_ENDPOINT", "WHATSAPP_CDP_ENDPOINT", "KEEP_CDP_ENDPOINT", "GCAL_CDP_ENDPOINT"] as const;

/**
 * The environment a driver runs in: the automation Chrome of the account it runs for (each
 * account its own — its own sign-ins), unless the server was started with an endpoint set.
 */
export function automationEnv(): Record<string, string> {
  const c = accountChrome();
  const env: Record<string, string> = {};
  for (const k of ENDPOINTS) if (!process.env[k]) env[k] = c.endpoint;
  if (c.profile) env.ZEFF_CHROME_PROFILE = c.profile;
  return env;
}

/** The automation Chrome's debug endpoint for one service (its own env setting first), of the account this runs for. */
export const automationCdp = (service?: "teams" | "gitlab" | "outlook" | "gmail" | "whatsapp" | "keep") =>
  (service && process.env[`${service.toUpperCase()}_CDP_ENDPOINT`]) || process.env.CHRONO_CDP_ENDPOINT || accountChrome().endpoint;

/** Whether a Chrome debug endpoint answers (its /json/version) — nothing is started for it. */
export const cdpUp = (endpoint: string, timeoutMs = 3000): Promise<boolean> =>
  fetch(`${endpoint.replace(/\/+$/, "")}/json/version`, { signal: AbortSignal.timeout(timeoutMs) })
    .then((r) => r.ok)
    .catch(() => false);

/** Whether the automation Chrome of this account runs (the endpoint of one service, as `automationCdp`). */
export const automationUp = (service?: Parameters<typeof automationCdp>[0], timeoutMs?: number): Promise<boolean> =>
  cdpUp(automationCdp(service), timeoutMs);

type DriverCall = (name: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * A connector's driver run for one session of tool calls (body gets `call(tool, args)`, answered as an MCP result) — its plugin's driver
 * lambda (`<id>.driver`, kind driver — the scraper kept in the plugin, fixable in the Studio) when its port is on, else the built-in's
 * program. What calls it (a reply sent, a history pulled) needn't know which.
 */
export async function runDriver<T>(id: DriverId, label: string, body: (call: DriverCall) => Promise<T>, timeoutMs = 150000, extraEnv: Record<string, string> = {}): Promise<T> {
  const { getLambda } = await import("@/plugins/workspace/lambdas/store");
  const name = `${id}.driver`;
  if (getLambda(name)?.manifest.kind === "driver") {
    const { invokeLambda } = await import("@/plugins/workspace/lambdas/run");
    return body(async (tool, args) => {
      const r = await invokeLambda(name, { tool, args }, { asDriver: true });
      if (!r.ok) return { content: [{ type: "text", text: `Error: ${r.error}` }], isError: true };
      return { content: [{ type: "text", text: typeof r.result === "string" ? r.result : JSON.stringify(r.result) }] };
    });
  }
  const { runStdioSession } = await import("@/lib/mcp/stdio");
  return runStdioSession({ command: process.execPath, args: [driverPath(id)], env: { ...automationEnv(), ...extraEnv }, label }, body, timeoutMs);
}
