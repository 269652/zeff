/** Right after a backup is made: the Google Drive extension for Backups copies it at once (when it is on and connected) — the built-in's, or the port's flow. */
export async function afterBackup(): Promise<void> {
  const port = await import("./port");
  // (the port: its backup flow, when it runs by itself — the sign-in is its own)
  if (await port.portOn()) {
    if (!(await port.portBackupOn())) return;
    const { startSync } = await import("@/lib/sync/registry");
    void startSync(`flow:${port.BACKUP_FLOW}` as never);
    return;
  }
  const { stepAvailable } = await import("@/plugins/state");
  if (!stepAvailable("drivebackup")) return;
  (await import("@/lib/sync/registry")).startSync("drivebackup");
}
