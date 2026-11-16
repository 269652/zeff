import { enabledPlugins } from "@/lib/ext/registry";

/**
 * The AI tasks the plugins declare in their manifest (`contributes.aiTasks`): each its own row in Settings → AI (its backend and model), counted
 * under the id `<plugin>.<task>` when a flow or lambda asks (`ai.json` with task=…). Server only.
 */
export type PluginAiTask = { id: string; plugin: string; label: string; what: string; idempotent: boolean };

export function pluginAiTasks(): PluginAiTask[] {
  try {
    return enabledPlugins().flatMap((p) => p.manifest.contributes.aiTasks.map((t) => ({ id: `${p.id}.${t.id}`, plugin: p.manifest.name, label: t.label, what: t.what, idempotent: t.idempotent === true })));
  } catch {
    return [];
  }
}

export const isPluginAiTask = (id: unknown): boolean => typeof id === "string" && pluginAiTasks().some((t) => t.id === id);
