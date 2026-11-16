/**
 * The Google Drive port (zeff-plugins/plugins/google-drive-ext) as the built-in's neighbours see it: while it is on, the Backups toggle and the
 * copy after each backup work through its sync flows (a sync flow standing in for the step it replaces — lib/sync/registry.ts), and "signed in"
 * is the kernel's sign-in for plugins (lib/ext/oauth.ts). Server only.
 */
export const PORT = "google-drive-ext";
export const BACKUP_FLOW = "google-drive.sync-backups";
export const DOCUMENTS_FLOW = "google-drive.sync-documents";

/** The port is on (installed from the plugins repository and switched on). */
export async function portOn(): Promise<boolean> {
  const { getPlugin } = await import("@/lib/ext/registry");
  return !!getPlugin(PORT)?.enabled;
}

/** Whether backups go to Drive through the port: its backup flow runs by itself. */
export async function portBackupOn(): Promise<boolean> {
  const { flowByName } = await import("@/plugins/workspace/flows/store");
  const f = flowByName(BACKUP_FLOW);
  return !!f && f.enabled !== false && f.triggers.some((x) => x.kind === "schedule" && !!(x as { everyMinutes?: number }).everyMinutes);
}

/** Backups to Drive on or off through the port (its backup flow's schedule: hourly, as the built-in's default; none: by hand only). */
export async function setPortBackup(on: boolean): Promise<void> {
  (await import("@/plugins/workspace/flows/store")).setSyncFlowMinutes(BACKUP_FLOW, on ? 60 : 0);
}

/** Signed in through the port. */
export async function portConnected(): Promise<boolean> {
  try {
    return (await import("@/lib/ext/oauth")).oauthStatus(`${PORT}.drive`).connected;
  } catch {
    return false;
  }
}
