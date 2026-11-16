import path from "node:path";

/**
 * Files a view's <upload run="…"> brings, on the way to a flow (actions/uploads.ts stages them; the flow action `files.take` takes them): each is
 * kept in the account's data folder (uploads/<token>), bounded in size and age. Server only.
 */

/** The largest file a view's upload stages. */
export const MAX_STAGED_BYTES = 50 * 1024 * 1024;
/** A staged file nobody took is removed after this long. */
export const STAGED_KEEP_MS = 60 * 60 * 1000;
export const STAGED_TOKEN = /^[a-f0-9]{32}$/;

/** The folder of staged files. */
export async function stagingDir(): Promise<string> {
  const { dataDir } = await import("@/db");
  return path.join(dataDir(), "uploads");
}

/** A staged file's place by its token (throws for anything else than a token the staging made). */
export async function stagedPath(token: unknown): Promise<string> {
  const k = String(token ?? "");
  if (!STAGED_TOKEN.test(k)) throw new Error("token: a staged file's token.");
  return path.join(await stagingDir(), k);
}
