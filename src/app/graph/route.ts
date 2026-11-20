import { NextResponse } from "next/server";
import "@/plugins/contributions"; // (static on purpose — what this route loads reaches it anyway: docs/plugins/performance.md, "Compiling")
import { prefixedUrl } from "@/lib/redirect";
import { knowledgeBrowserUrl } from "@/plugins/knowledge/client";
import { isInstalled } from "@/plugins/state";

/** /graph in Zeff: the knowledge graph — the knowledge server's (of the account you're in), where your browser reaches it. ?e=<id> comes along. */
export function GET(req: Request) {
  if (!isInstalled("knowledge")) return NextResponse.redirect(prefixedUrl("/plugins", req.url));
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const search = new URL(req.url).search;
  return NextResponse.redirect(`${knowledgeBrowserUrl(host, proto)}/graph${search}`, 307);
}
