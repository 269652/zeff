import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "./actions";
import type { FieldSpec } from "./types";

/**
 * Pictures of the Workspace's pages from and to the web, for flows and lambdas: a picture at a web address kept among the page pictures
 * (another service's links that expire — a sync keeps its own copy), and a kept picture read as data (to hand it to another service).
 * Pictures only, by their first bytes, 15 MB at most — like an upload in the editor. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const MAX = 15 * 1024 * 1024;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" };

/** The kind of picture a file is, by its first bytes (not by what the server calls it) — as the upload route checks. */
export function imageExt(b: Buffer): string | null {
  if (b.length > 8 && b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG") return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 6 && b.toString("latin1", 0, 3) === "GIF") return "gif";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (b.length > 12 && b.toString("latin1", 4, 8) === "ftyp" && /avif|avis/.test(b.toString("latin1", 8, 16))) return "avif";
  return null;
}

/** Kept by the hash of its bytes (the same picture twice is one file); its address on a page. */
export async function keepPicture(bytes: Buffer): Promise<string> {
  const ext = imageExt(bytes);
  if (!ext) throw new Error("Not a picture (PNG, JPEG, GIF, WebP, AVIF).");
  if (bytes.length > MAX) throw new Error("The picture is larger than 15 MB.");
  const { filesDir } = await import("../files");
  const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}.${ext}`;
  const target = path.join(filesDir(), name);
  if (!fs.existsSync(target)) fs.writeFileSync(target, bytes);
  return `/api/workspace/files/${name}`;
}

export const FILE_ACTIONS: FlowAction[] = [
  {
    name: "files.save",
    group: "data",
    label: "Keep a picture from the web",
    summary: "A picture at a web address (the flow's web permission) kept among the Workspace's page pictures — for links that expire. Gives its address for a page (src).",
    input: [f("url", "text", { required: true })],
    output: "{ src } — /api/workspace/files/…",
    writes: true,
    run: async (i, ctx) => {
      const url = await ctx.web(String(i.url ?? ""));
      const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`${url.hostname}: ${r.status} ${r.statusText}`);
      const len = Number(r.headers.get("content-length") ?? 0);
      if (len > MAX) throw new Error("The picture is larger than 15 MB.");
      return { src: await keepPicture(Buffer.from(await r.arrayBuffer())) };
    },
  },
  {
    name: "files.keep-page",
    group: "data",
    label: "Keep a page's pictures",
    summary: "The pictures of a page (and its cover) that are at web addresses the flow may reach (its web permission) kept among the Workspace's page pictures, the page pointing at the kept ones — another service's links that expire stay shown. Needs the flow's “pages” permission (Zeff's structure).",
    input: [f("page", "number", { required: true })],
    output: "{ kept, failed }",
    writes: true,
    run: async (i, ctx) => {
      if (!(ctx.perms.meta ?? []).includes("pages")) throw new Error("This flow may not change pages — grant “pages” under the flow's permissions (Zeff's structure).");
      const { getPage, updatePage } = await import("../store");
      const id = Number(i.page);
      const p = getPage(id);
      if (!p) throw new Error(`There is no page ${id}.`);
      const memo = new Map<string, string | null>();
      let kept = 0;
      let failed = 0;
      const local = async (src: string): Promise<string | null> => {
        if (!/^https?:\/\//i.test(src)) return null;
        if (memo.has(src)) return memo.get(src)!;
        let out: string | null = null;
        try {
          const url = await ctx.web(src);
          const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
          if (!r.ok) throw new Error(String(r.status));
          out = await keepPicture(Buffer.from(await r.arrayBuffer()));
          kept++;
        } catch {
          // (a host the flow may not reach stays as it is; one that fails is counted)
          if (/^https?:\/\//i.test(src)) failed++;
        }
        memo.set(src, out);
        return out;
      };
      type N = { type?: string; attrs?: Record<string, unknown>; content?: N[] };
      const walk = async (n: N): Promise<boolean> => {
        let changed = false;
        if (n.type === "image" && typeof n.attrs?.src === "string") {
          const to = await local(n.attrs.src);
          if (to) {
            n.attrs = { ...n.attrs, src: to };
            changed = true;
          }
        }
        for (const c of n.content ?? []) if (await walk(c)) changed = true;
        return changed;
      };
      const doc = JSON.parse(JSON.stringify(p.content)) as N;
      const docChanged = ctx.dryRun ? false : await walk(doc);
      const cover = p.cover && !ctx.dryRun ? await local(p.cover) : null;
      if (docChanged || cover) updatePage(id, { ...(docChanged ? { content: doc } : {}), ...(cover ? { cover } : {}) });
      return { kept, failed };
    },
  },
  {
    name: "files.read",
    group: "data",
    label: "Read a page picture",
    summary: "A picture kept for the Workspace's pages (its src, /api/workspace/files/…) as data: its name, type and bytes (base64) — to hand it to another service.",
    input: [f("src", "text", { required: true })],
    output: "{ name, mime, size, base64 }",
    run: async (i) => {
      const m = /^\/api\/workspace\/files\/([\w-]+\.(png|jpg|gif|webp|avif))$/.exec(String(i.src ?? "").trim());
      if (!m) throw new Error("Not a picture of the Workspace's pages (/api/workspace/files/…).");
      const { filesDir } = await import("../files");
      const p = path.join(filesDir(), m[1]);
      if (!fs.existsSync(p)) throw new Error("This picture isn't kept (any more).");
      const bytes = fs.readFileSync(p);
      return { name: m[1], mime: MIME[m[2]], size: bytes.length, base64: bytes.toString("base64") };
    },
  },
];

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("core:files", FILE_ACTIONS);
