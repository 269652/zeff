/**
 * Files kept in a plain folder of the account's data folder (flow actions files.keep / files.take, served by /api/files/kept): which folders those can be and where a
 * file in one lies. Server only.
 */
import path from "node:path";

/** A folder of the account's data folder a flow may keep files in: a plain name — not Zeff's own (plugins, accounts, backups …). */
export const KEEP_DIR = /^[a-z][a-z0-9_-]{0,39}$/;
export const OWN_DIRS = new Set(["plugins", "accounts", "backups", "lambdas", "notebooks", "logs", "launcher", "work", "account-secret", "files", "ext", "uploads"]);

/** A file's place inside a folder of the account's data folder — throws for anything else (no path in a name, no folder of Zeff's own). */
export async function inDataDir(dir: unknown, file: unknown): Promise<string> {
  const d = dir == null ? "" : String(dir);
  const name = file == null ? "" : String(file);
  if (!KEEP_DIR.test(d) || OWN_DIRS.has(d)) throw new Error("dir: a plain folder name of your data folder (not one of Zeff's own).");
  if (!name || name !== path.basename(name) || name.startsWith(".")) throw new Error("file: a file name, no path.");
  const { dataDir } = await import("@/db");
  return path.join(dataDir(), d, name);
}
