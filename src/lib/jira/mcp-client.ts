import { t } from "@/lib/i18n/server";
import { installCommand } from "@/lib/prerequisites-shared";

// (the stdio MCP client is the kernel's: lib/mcp/stdio.ts — re-exported for what still imports it from here)
export * from "@/lib/mcp/stdio";

/** What to add when uvx isn't installed — the Jira MCP server (mcp-atlassian) starts with it, the one most PCs lack. */
export function jiraNotFoundHint(command: string): string {
  const base = command.trim().split(/[\\/]/).pop()?.replace(/\.exe$/i, "") ?? "";
  if (base === "uvx" || base === "uv") return ` ${t("uv isn't installed (or not on the PATH) — the Jira sync starts its MCP server with uvx. Install uv ({command}) and restart Zeff, or set JIRA_MCP_COMMAND to another command.", { command: installCommand("uv") })}`;
  return ` ${t("The program \"{command}\" was not found — install it, or give its full path.", { command })}`;
}

/**
 * Jira not there to answer (its maintenance page, a proxy's error page instead of data): what to
 * say instead of the tool's raw error — null when it's another error.
 */
export function jiraDown(message: string): string | null {
  if (!/<!DOCTYPE html|<html|Maintenance|Wartung|502 Bad Gateway|503 Service|504 Gateway/i.test(message)) return null;
  const maintenance = /Maintenance|Wartung/i.test(message);
  return maintenance
    ? t("Jira can't be reached right now (maintenance page) — try again later.")
    : t("Jira can't be reached right now (it answers with an error page instead of data) — try again later.");
}
