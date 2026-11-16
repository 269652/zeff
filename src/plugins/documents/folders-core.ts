/**
 * What a scan of a local folder decides — pure, so the built-in's scan (folders.ts) and the Documents plugin's port (scripts/port-documents.mts bundles it)
 * decide alike: of the files found and the files known, which are new or changed (read in), which came back, which are gone. And what the scan says.
 * Client-safe.
 */

/** What is known of a file (the table doc_local_files). */
export type KnownFile = { path: string; folder_id: string; rel: string; doc_id: number | null; size: number; mtime: number; missing_at: string | null };
export type FoundFile = { path: string; rel: string; size: number; mtime: number };

/**
 * `files` are what the folder holds now, `known` what was known of it; `budget` how many may still be read in (new or changed) — the rest next time.
 * `work`: read in (a file new or changed), `restore`: back where it was (a file marked gone that is there again, unchanged), `gone`: no longer there (not marked yet).
 */
export function diffFolder(files: FoundFile[], known: KnownFile[], budget: number): { work: { file: FoundFile; had: KnownFile | null }[]; restore: string[]; gone: KnownFile[]; budget: number } {
  const left = new Map(known.map((r) => [r.path, r]));
  const work: { file: FoundFile; had: KnownFile | null }[] = [];
  const restore: string[] = [];
  for (const f of files) {
    const had = left.get(f.path) ?? null;
    left.delete(f.path);
    if (had && had.size === f.size && had.mtime === f.mtime && !had.missing_at) continue;
    if (had && had.missing_at && had.size === f.size && had.mtime === f.mtime) {
      restore.push(f.path);
      continue;
    }
    if (budget <= 0) continue;
    budget--;
    work.push({ file: f, had });
  }
  // What's left of the known ones is gone from the folder.
  return { work, restore, gone: [...left.values()].filter((r) => !r.missing_at), budget };
}

/** What the scan says (the sync step's message): how many new, changed, gone — or the first errors when nothing came of it. */
export function scanSummary(r: { added: number; updated: number; missing: number; errors: string[] }, t: (s: string, v?: Record<string, string | number>) => string): { ok: boolean; message: string } {
  const parts = [r.added && t("{n} new", { n: r.added }), r.updated && t("{n} changed", { n: r.updated }), r.missing && t("{n} gone from the folder", { n: r.missing })].filter(Boolean);
  return r.errors.length && !r.added && !r.updated ? { ok: false, message: r.errors.slice(0, 3).join(" · ") } : { ok: true, message: parts.length ? parts.join(", ") : t("Nothing new.") };
}
