/**
 * From a built-in to its port when the port is only functions and a manifest (no package, no flows to install — Questions: the plugin's lambda plans and
 * phrases, the kernel keeps the query layer): the plugin on, the built-in off (state.ts PROVIDED_BY: the built-in counts as there through its port).
 * Needs the plugin in the plugins folder. Server only.
 */
export async function switchPlainToPlugin(builtin: string, port: string): Promise<{ plugin: string }> {
  const reg = await import("@/lib/ext/registry");
  if (!reg.scanPlugins(true).plugins.some((x) => x.id === port)) throw new Error(`The plugin ${port} isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  reg.setEnabled(port, true);
  (await import("@/plugins/state")).setInstalled(builtin as never, false);
  return { plugin: port };
}
