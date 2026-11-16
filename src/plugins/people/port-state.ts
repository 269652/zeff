/**
 * Which parts of People the port (people-ext) brings while it is on: what it declares in its manifest stands in for the built-in's — the built-in's gives
 * nothing then, so the review queue, the tree's badges and the Correlations don't list things twice. Server only.
 */
export async function portDeclares(key: "reviewSources" | "rowBadges" | "seriesProviders"): Promise<boolean> {
  return (await import("@/lib/ext/registry")).enabledPlugins().some((p) => p.id === "people-ext" && p.manifest.contributes[key].length > 0);
}
