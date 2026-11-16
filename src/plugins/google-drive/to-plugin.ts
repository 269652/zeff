import { getPref } from "@/lib/prefs";
import { stepMinutes } from "@/lib/sync/intervals";
import { BACKUP_FLOW, DOCUMENTS_FLOW, PORT } from "./port";

/**
 * From the built-in Google Drive to the plugin (zeff-plugins/plugins/google-drive-ext): the plugin on, its package installed under System — its
 * page, the two sync flows (allowed what they ask for: Drive's domain, the sign-in, the plugin's stores — your click is the yes), the folder
 * flows — the syncs running as often as the built-in's did (the backup copy only if its extension was on), the built-in off. The sign-in, the
 * OAuth client and the switches are taken over the first time the plugin reads them (lib/ext/oauth.ts OAUTH_ADOPTS: the built-in's row stays
 * as it is); the files Zeff recorded in Drive are the built-in's own table, so nothing goes up twice. One thing is new: Google sends you back
 * to a new address (the page shows it) — add it to your OAuth client's redirect addresses; the sign-in itself goes on working. Server only.
 */
export async function switchGoogleDriveToPlugin(): Promise<{ flows: string[] }> {
  const reg = await import("@/lib/ext/registry");
  if (!reg.scanPlugins(true).plugins.some((x) => x.id === PORT)) throw new Error(`The Google Drive plugin (${PORT}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  const { extensionInstalled } = await import("@/plugins/extension-state");
  const docsOn = extensionInstalled("google-drive:documents-sync");
  const backupsOn = extensionInstalled("google-drive:backup-sync");
  const docsMinutes = docsOn ? stepMinutes("drivedocs") : 0;
  const backupMinutes = backupsOn ? stepMinutes("drivebackup") : 0;
  reg.setEnabled(PORT, true);
  const flows = await import("@/plugins/workspace/flows/store");
  if (!flows.flowByName(DOCUMENTS_FLOW)) {
    const life = await import("@/plugins/workspace/package-life");
    const pkg = await life.offeredPackage(PORT);
    if (!pkg) throw new Error(`The Google Drive plugin (${PORT}) brings no package.`);
    const system = getPref<number | null>("system.root", null);
    const { getPage } = await import("@/plugins/workspace/store");
    await life.installTracked(pkg, system && getPage(system) && !getPage(system)!.archivedAt ? system : null, { allow: true });
  }
  // (as often as the built-in synced — by hand only stays by hand)
  flows.setSyncFlowMinutes(DOCUMENTS_FLOW, docsMinutes);
  flows.setSyncFlowMinutes(BACKUP_FLOW, backupMinutes);
  (await import("@/plugins/state")).setInstalled("google-drive", false);
  return { flows: [DOCUMENTS_FLOW, BACKUP_FLOW] };
}
