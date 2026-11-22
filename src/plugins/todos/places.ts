import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import { integrationServer, integrationServerIds } from "@/lib/integrations/server";
import type { PluginId } from "@/plugins/catalog";
import { installedPlugins } from "@/plugins/state";

/**
 * The places of the Todos screen that other plugins fill: buttons beside its tabs — a link (an address of Zeff, e.g. a page of the plugin)
 * or a button that runs a flow (with: "a=1, b=2"). A plugin contributes a TodoPlace under its own id (extension point "todos.actions");
 * an integration that is mounted into Zeff may hand the same (IntegrationServer.todoActions). The screen reads them through the kernel's
 * todos.actions. Nothing here knows a plugin. Server only.
 */
export type TodoAction = { label: string; href?: string; flow?: string; with?: string; confirm?: string; tip?: string };
export type TodoPlace = { actions: () => TodoAction[] | Promise<TodoAction[]> };

export const todoPlaces = extensionPoint<TodoPlace>("todos.actions");

/** Every installed contributor's buttons, in their order, each with every field there (a template can't ask for what is missing). */
export async function todoActions(): Promise<{ plugin: string; actions: Required<TodoAction>[] }[]> {
  const out: { plugin: string; actions: Required<TodoAction>[] }[] = [];
  for (const c of todoPlaces.list()) {
    try {
      const actions = (await c.impl.actions()).filter((a) => a && a.label && (a.href || a.flow));
      if (actions.length) out.push({ plugin: String(c.plugin), actions: actions.map((a) => ({ href: "", flow: "", with: "", confirm: "", tip: "", ...a })) });
    } catch (e) {
      console.error(`[todos.actions] ${c.plugin}:`, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

// A mounted integration may hand its buttons too (IntegrationServer.todoActions): they are contributions like any plugin's.
todoPlaces.provide("integrations", () =>
  integrationServerIds().flatMap((id) => {
    const actions = integrationServer(id)?.todoActions;
    return actions && installedPlugins().has(id as PluginId) ? [{ plugin: id as PluginId, impl: { actions } }] : [];
  }),
);
