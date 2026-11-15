/**
 * From the built-in GitLab to the plugin (zeff-plugins/plugins/gitlab-ext): its scraper (the driver lambda gitlab.driver, kept like any
 * lambda — mended in the Studio when GitLab changes) reads your merge requests, comments and branches, the flow gitlab.sync keeps them and
 * is a step of the Sync menu in the built-in's place; replies, merges, opened merge requests and resolved threads go through the same
 * scraper. GitLab read through its API (a token or sign-in) isn't in the plugin yet: that stays on the built-in. Server only.
 */
export async function switchGitlabToPlugin(): Promise<{ flow: string }> {
  const { driverOf } = await import("@/lib/connectors/store");
  if (driverOf("gitlab") === "api") throw new Error("GitLab is connected through its API (a token or sign-in): the plugin reads through the automation Chrome only — connect GitLab through the Chrome on the Connections page first, or stay on the built-in.");
  const { getGitlabSettings } = await import("@/lib/gitlab/store");
  return (await import("../connector-port")).switchConnectorToPlugin("gitlab", { port: "gitlab-ext", flow: "gitlab.sync", minutes: () => getGitlabSettings().syncMinutes });
}
