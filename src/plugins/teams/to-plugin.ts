/**
 * From the built-in Teams to the plugin (zeff-plugins/plugins/teams-ext): its scraper (the driver lambda teams.driver, kept like any
 * lambda — mended in the Studio when Teams changes) reads your mentions and 1:1 messages in the automation Chrome, the flow teams.sync keeps
 * them (the kernel's teams.keep) and is a step of the Sync menu in the built-in's place; replies go through the same scraper. Teams read
 * through Microsoft's API (your sign-in) isn't in the plugin yet: that stays on the built-in. Server only.
 */
export async function switchTeamsToPlugin(): Promise<{ flow: string }> {
  const { driverOf } = await import("@/lib/connectors/store");
  if (driverOf("teams") === "api") throw new Error("Teams is read through Microsoft's API (your sign-in): the plugin reads through the automation Chrome only — switch Teams to the Chrome on the Connections page first, or stay on the built-in.");
  const { getTeamsSettings } = await import("@/lib/teams/store");
  return (await import("../connector-port")).switchConnectorToPlugin("teams", { port: "teams-ext", flow: "teams.sync", minutes: () => getTeamsSettings().syncMinutes });
}
