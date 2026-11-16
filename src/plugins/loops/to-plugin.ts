import { switchConnectorToPlugin } from "../connector-port";

/**
 * From the built-in Open loops to the plugin (zeff-plugins/plugins/loops-ext): the table of what became of each loop is made if it isn't there yet (the
 * plugin's store adopts it — nothing is copied), the plugin on, its package installed under System (the flows that write your word and the closings, allowed to),
 * the built-in off — it stands in through its port (state.ts PROVIDED_BY: the Today page, the chips and the MCP tool read the plugin's answer). Server only.
 */
export async function switchLoopsToPlugin(): Promise<{ flow: string }> {
  (await import("./state")).allStates();
  return switchConnectorToPlugin("loops", { port: "loops-ext", flow: "loops.decide", minutes: async () => 0 });
}
