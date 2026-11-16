import { switchConnectorToPlugin } from "../connector-port";

/**
 * From the built-in Jira briefing to the plugin (zeff-plugins/plugins/jira-lage-ext): the plugin on, its package installed under System (the flow of the Board-Lage run,
 * allowed to write the comments it reads fresh, to ask the AI and to run the databases' reviews), the built-in off — it stands in through its port (state.ts PROVIDED_BY:
 * the boards' databases, Meine Lage, the ticket picker and "Assign to me" go on reading the same tables). The run is by hand only, as before. Server only.
 */
export async function switchJiraLageToPlugin(): Promise<{ flow: string }> {
  return switchConnectorToPlugin("jira-lage", { port: "jira-lage-ext", flow: "jira-lage.board-lage", minutes: async () => 0 });
}
