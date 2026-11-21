import crypto from "node:crypto";

const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const isText = (b: Buffer) => !b.subarray(0, 8000).includes(0);

/**
 * A plugin folder's content hash, as the catalog's generator computes it: every file by its path in the folder, sorted, "path\0sha256\n" —
 * text counted with LF line endings (a Windows checkout hashes like the repository).
 */
export function contentHash(files: Map<string, Buffer>): string {
  const norm = (b: Buffer) => (isText(b) ? Buffer.from(b.toString("latin1").replace(/\r\n/g, "\n"), "latin1") : b);
  return sha256([...files.keys()].sort().map((rel) => `${rel}\0${sha256(norm(files.get(rel)!))}\n`).join(""));
}
