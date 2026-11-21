/**
 * The marketplace fields of a plugin's zeff-plugin.json (keywords, category, icon, screenshots, homepage — written in the plugins
 * repository, read by its catalog.json): a port script that writes the manifest anew keeps them from the one already there.
 */
const FIELDS = ["keywords", "category", "icon", "screenshots", "homepage"] as const;

export function keepCatalogFields(old: unknown): Record<string, unknown> {
  const o = (old && typeof old === "object" ? old : {}) as Record<string, unknown>;
  return Object.fromEntries(FIELDS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
}
