import fs from "node:fs";
import { inDataDir } from "@/lib/files/kept";
import { foreignRequest, refused } from "@/lib/request-guard";

/** Shown in the browser by the file's ending (never by what the caller says); anything else downloads. SVG and HTML can carry scripts, so they download. */
const INLINE: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
  pdf: "application/pdf", txt: "text/plain; charset=utf-8",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", aac: "audio/aac",
};

/**
 * GET /api/files/kept?dir=documents&file=<kept name>&name=<shown name> — a file kept in a plain folder of the data folder (flow actions files.keep / files.take),
 * shown in the browser when it is a picture, PDF, text or audio; `&download=1` saves it. Only for Zeff's own pages.
 */
export async function GET(req: Request) {
  const why = foreignRequest(req);
  if (why) return refused(why);
  const q = new URL(req.url).searchParams;
  let target: string;
  try {
    target = await inDataDir(q.get("dir"), q.get("file"));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!fs.existsSync(target)) return new Response("Not found", { status: 404 });
  const name = (q.get("name") || q.get("file") || "file").replace(/[\r\n"]/g, "_").slice(0, 200);
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1]?.toLowerCase() ?? "";
  const inline = !!INLINE[ext] && q.get("download") !== "1";
  return new Response(new Uint8Array(fs.readFileSync(target)), {
    headers: {
      "Content-Type": inline ? INLINE[ext] : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
