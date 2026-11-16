import { switchConnectorToPlugin } from "../connector-port";

/**
 * From the built-in Explorer to the plugin (zeff-plugins/plugins/explorer-ext): the plugin on, its package installed under System (the screen's database and the flows
 * that save, make, import, watch and open — allowed the permission "api", your click is the yes), the built-in off — it stands in through its port (state.ts PROVIDED_BY):
 * the disk reads (fs.*), the file route of the viewer, the watchers and the imports stay Zeff's. Server only.
 */
export async function switchExplorerToPlugin(): Promise<{ flow: string }> {
  return switchConnectorToPlugin("explorer", { port: "explorer-ext", flow: "explorer.save", minutes: async () => 0 });
}
