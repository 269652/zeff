/** The marketplace's categories (a manifest's `category`; the plugins repository's catalog.json uses the same). Client-safe. */
export const PLUGIN_CATEGORIES = ["app", "connector", "communication", "ai", "time", "finance", "knowledge", "language", "developer", "system"] as const;
export type PluginCategoryId = (typeof PLUGIN_CATEGORIES)[number];
