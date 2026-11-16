/**
 * The built-in plugins that have a port in the plugins repository (docs/plugins/runtime-conversion.md): which external plugin replaces
 * each and how you switch to it. The Plugins page offers *Switch to the plugin* on the built-in's card when the port is in the plugins
 * folder. A built-in leaves Zeff's code only once its port is 1:1 and you switched. Server only.
 */
export type Port = { builtin: string; plugin: string; switch: () => Promise<unknown> };

/** How often a built-in step synced (the Sync settings) — its port's flow takes it over. */
const stepMinutesOf = (key: string) => async () => (await import("@/lib/sync/intervals")).stepMinutes(key as never);

export const PORTS: Port[] = [
  { builtin: "lookups", plugin: "lookups-ext", switch: async () => (await import("./lookups/to-plugin")).switchLookupsToPlugin() },
  { builtin: "web-search", plugin: "web-search-ext", switch: async () => (await import("./web-search/to-plugin")).switchWebSearchToPlugin() },
  { builtin: "browser", plugin: "browser-ext", switch: async () => (await import("./browser/to-plugin")).switchBrowserToPlugin() },
  { builtin: "correlations", plugin: "correlations-ext", switch: async () => (await import("./correlations/to-plugin")).switchCorrelationsToPlugin() },
  { builtin: "agenda", plugin: "agenda-ext", switch: async () => (await import("./agenda/to-plugin")).switchAgendaToPlugin() },
  { builtin: "mail-client", plugin: "mail-client-ext", switch: async () => (await import("./mail-client/to-plugin")).switchMailClientToPlugin() },
  { builtin: "teams", plugin: "teams-ext", switch: async () => (await import("./teams/to-plugin")).switchTeamsToPlugin() },
  { builtin: "whatsapp", plugin: "whatsapp-ext", switch: async () => (await import("./connector-port")).switchConnectorToPlugin("whatsapp", { port: "whatsapp-ext", flow: "whatsapp.sync", minutes: stepMinutesOf("whatsapp") }) },
  { builtin: "signal", plugin: "signal-ext", switch: async () => (await import("./connector-port")).switchConnectorToPlugin("signal", { port: "signal-ext", flow: "signal.sync", minutes: stepMinutesOf("signal") }) },
  { builtin: "outlook-mail", plugin: "outlook-mail-ext", switch: async () => (await import("./connector-port")).switchConnectorToPlugin("outlook-mail", { port: "outlook-mail-ext", flow: "outlook-mail.sync", minutes: async () => (await import("@/lib/mail/store")).getMailSettings().syncMinutes }) },
  { builtin: "gmail", plugin: "gmail-ext", switch: async () => (await import("./connector-port")).switchConnectorToPlugin("gmail", { port: "gmail-ext", flow: "gmail.sync", minutes: async () => (await import("@/lib/mail/store")).getMailSettings().syncMinutes }) },
  { builtin: "imap-mail", plugin: "imap-mail-ext", switch: async () => (await import("./connector-port")).switchConnectorToPlugin("imap-mail", { port: "imap-mail-ext", flow: "imap-mail.sync", minutes: async () => (await import("@/lib/mail/store")).getMailSettings().syncMinutes }) },
  { builtin: "local-ai", plugin: "local-ai-ext", switch: async () => (await import("./local-ai/to-plugin")).switchLocalAiToPlugin() },
  { builtin: "google-calendar", plugin: "google-calendar-ext", switch: async () => (await import("./google-calendar/to-plugin")).switchGoogleCalendarToPlugin() },
  { builtin: "gitlab", plugin: "gitlab-ext", switch: async () => (await import("./gitlab/to-plugin")).switchGitlabToPlugin() },
  { builtin: "jira", plugin: "jira-ext", switch: async () => (await import("./jira/to-plugin")).switchJiraToPlugin() },
  { builtin: "keep", plugin: "keep-ext", switch: async () => (await import("./keep/to-plugin")).switchKeepToPlugin() },
  { builtin: "revolut", plugin: "revolut-ext", switch: async () => (await import("./revolut/to-plugin")).switchRevolutToPlugin() },
  { builtin: "google-drive", plugin: "google-drive-ext", switch: async () => (await import("./google-drive/to-plugin")).switchGoogleDriveToPlugin() },
  { builtin: "cases", plugin: "cases-ext", switch: async () => (await import("./cases/to-plugin")).switchCasesToPlugin() },
];

/** The port of a built-in, when there is one and it is in the plugins folder (installed from its repository). */
export async function portOf(builtin: string): Promise<Port | null> {
  const port = PORTS.find((p) => p.builtin === builtin);
  if (!port) return null;
  const { scanPlugins } = await import("@/lib/ext/registry");
  return scanPlugins().plugins.some((p) => p.id === port.plugin) ? port : null;
}
