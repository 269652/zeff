const PORT = "revolut-ext";

/**
 * From the built-in Revolut to the plugin (zeff-plugins/plugins/revolut-ext): the plugin on — it reads your statements now (the kernel's
 * service bank.statement) —, the built-in off. Your bookings stay in the bank, the statements among your documents stay read; paying by
 * RevTag stays a todo action (state.ts PROVIDED_BY: the built-in counts as there through its port). Needs the plugin in the plugins
 * folder. Server only.
 */
export async function switchRevolutToPlugin(): Promise<{ plugin: string }> {
  const reg = await import("@/lib/ext/registry");
  if (!reg.scanPlugins(true).plugins.some((x) => x.id === PORT)) throw new Error(`The Revolut plugin (${PORT}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  reg.setEnabled(PORT, true);
  (await import("@/plugins/state")).setInstalled("revolut", false);
  return { plugin: PORT };
}
