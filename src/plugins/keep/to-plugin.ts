import { getPref } from "@/lib/prefs";
import { stepMinutes } from "@/lib/sync/intervals";

const PORT = "keep-ext";
const FLOW = "keep.sync";

/**
 * From the built-in Google Keep to the plugin (zeff-plugins/plugins/keep-ext) — all of Keep's own goes with it: its scraper (the driver
 * lambda keep.driver), keeping the notes (the store notes — the built-in's table, adopted), the Google Keep database (the kernel's
 * db.mirror — the built-in's database goes on). The Google account read carried over into the plugin's setting; the plugin on (granted
 * exec: its scraper runs with the account's Chrome); its package installed under System — the flow keep.sync, allowed to run the scraper
 * and use the store (your click is the yes), as often as the built-in synced —; the built-in off. Server only.
 */
export async function switchKeepToPlugin(): Promise<{ flow: string }> {
  const reg = await import("@/lib/ext/registry");
  const p = reg.scanPlugins(true).plugins.find((x) => x.id === PORT);
  if (!p) throw new Error(`The Google Keep plugin (${PORT}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  // (its table there before the plugin adopts it — a Zeff that never synced Keep has none yet)
  const { keepCount, keepSettings } = await import("./store");
  keepCount();
  const minutes = stepMinutes("keep");
  const { saveSettings } = await import("@/lib/ext/plugin-settings");
  saveSettings(PORT, p.manifest, { ACCOUNT: keepSettings().account });
  reg.setEnabled(PORT, true);
  const flows = await import("@/plugins/workspace/flows/store");
  if (!flows.flowByName(FLOW)) {
    const life = await import("@/plugins/workspace/package-life");
    const pkg = await life.offeredPackage(PORT);
    if (!pkg) throw new Error(`The Google Keep plugin (${PORT}) brings no package.`);
    const system = getPref<number | null>("system.root", null);
    const { getPage } = await import("@/plugins/workspace/store");
    await life.installTracked(pkg, system && getPage(system) && !getPage(system)!.archivedAt ? system : null, { allow: true });
  }
  flows.setSyncFlowMinutes(FLOW, minutes);
  (await import("@/plugins/state")).setInstalled("keep", false);
  return { flow: FLOW };
}
