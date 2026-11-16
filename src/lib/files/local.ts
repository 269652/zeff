/**
 * Files of this computer, for what reads folders (a plugin's flows through `files.scan`, Documents' own local folders): a folder's path as kept
 * (the host's path mapped to a mounted one in a container) and the walk through its subfolders — hidden files, Office's lock files and the system's
 * own folders left out. Server only.
 */
import fs from "node:fs";
import path from "node:path";
import { toLocalPath } from "@/lib/hostpath";

/** Folders never looked into (version control, packages, the system's own). */
export const SKIP_DIRS = new Set(["node_modules", "$recycle.bin", "system volume information", "__pycache__"]);

/** A folder's path as kept: absolute, without a trailing separator — but a drive's root stays "C:\" ("C:" alone is the current folder on C). */
export const normFolder = (p: string): string => {
  const given = toLocalPath(p.trim());
  const abs = path.resolve(/^[A-Za-z]:$/.test(given) ? `${given}\\` : given);
  const root = path.parse(abs).root;
  return abs === root || abs.replace(/[\\/]+$/, "") === root.replace(/[\\/]+$/, "") ? root : abs.replace(/[\\/]+$/, "");
};

export type LocalFile = { path: string; rel: string; size: number; mtime: number };

/**
 * The files of a folder, subfolders too: those `accept` takes (by name), not empty and at most `maxBytes`; at most `maxEntries` entries looked at
 * (a whole drive by mistake stays bounded).
 */
export function walkFiles(root: string, o: { accept: (name: string) => boolean; maxBytes: number; maxEntries?: number; skipDirs?: Set<string> }): LocalFile[] {
  const out: LocalFile[] = [];
  const stack = [root];
  const max = o.maxEntries ?? 50_000;
  const skip = o.skipDirs ?? SKIP_DIRS;
  let seen = 0;
  while (stack.length && seen < max) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // not readable (permissions): left out
    }
    for (const e of entries) {
      seen++;
      if (e.name.startsWith(".") || e.name.startsWith("~$")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name.toLowerCase())) stack.push(p);
      } else if (e.isFile() && o.accept(e.name)) {
        try {
          const st = fs.statSync(p);
          if (st.size > 0 && st.size <= o.maxBytes) out.push({ path: p, rel: path.relative(root, p), size: st.size, mtime: Math.round(st.mtimeMs) });
        } catch {
          // gone meanwhile
        }
      }
    }
  }
  return out;
}
