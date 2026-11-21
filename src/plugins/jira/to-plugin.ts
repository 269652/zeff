/**
 * From the built-in Jira to the plugin (zeff-plugins/plugins/jira-ext) — stage 3, reading: Jira's address and your token (Zeff Secrets — the
 * REST API) and, as the fallback, the Jira MCP server's command, arguments,
 * environment (your token — straight into the plugin's encrypted settings, never shown or said), address, search tool, JQL and fields carried
 * over from where Zeff had them (the environment or .mcp.json); the plugin on (granted exec: its reader starts that server); its package
 * installed under System — the flow jira.sync, allowed to run the reader and keep tickets (your click is the yes), as often as the built-in
 * synced —; the built-in off. Changing Jira and writing into it stay Zeff's for now. Server only.
 */
export async function switchJiraToPlugin(): Promise<{ flow: string }> {
  const { getJiraSyncConfig } = await import("@/lib/jira/sync");
  const cfg = getJiraSyncConfig();
  const rest = (await import("@/lib/jira/connection")).jiraRestAuth();
  if (!rest && (!cfg.configured || !cfg.command)) throw new Error("Jira isn't set up in Zeff yet — enter its address and your token on Settings → Secrets first, then switch.");
  const reg = await import("@/lib/ext/registry");
  const p = reg.scanPlugins(true).plugins.find((x) => x.id === "jira-ext");
  if (!p) throw new Error("The Jira plugin (jira-ext) isn't in the plugins folder — install it from its repository first (Plugins → Sources).");
  const { saveSettings } = await import("@/lib/ext/plugin-settings");
  saveSettings("jira-ext", p.manifest, {
    // Zeff Secrets' address and token (the REST API) — the MCP server's config, if any, as the fallback
    TOKEN: rest?.token ?? "",
    EMAIL: rest?.email ?? "",
    MCP_COMMAND: cfg.command ?? "",
    MCP_ARGS: JSON.stringify(cfg.args),
    MCP_ENV: Object.entries(cfg.env).map(([k, v]) => `${k}=${v}`).join("\n"),
    BASE_URL: rest?.base ?? cfg.baseUrl ?? "",
    TOOL: cfg.tool,
    JQL: cfg.jql,
    FIELDS: cfg.fields,
    LIMIT: String(cfg.limit),
  });
  const { stepMinutes } = await import("@/lib/sync/intervals");
  return (await import("../connector-port")).switchConnectorToPlugin("jira", { port: "jira-ext", flow: "jira.sync", minutes: () => stepMinutes("jira") });
}
