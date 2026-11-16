import { NextResponse, type NextRequest } from "next/server";
import { getPublicOrigin } from "mcp-handler";
import { prefixedUrl } from "@/lib/redirect";
import { errorMessage } from "@/lib/errors";
import { authorizeUrl, connectionOf, newPkce, newState } from "@/lib/ext/oauth";

/**
 * GET /api/ext/oauth/<plugin>/<id>/connect[?with=<scope set>] — sends you to the service to sign in, with the OAuth client the plugin's
 * settings hold (a plugin's `contributes.oauth`, lib/ext/oauth.ts). It comes back to /callback; you land on the page the click came from
 * (else the Plugins page) with ?connected=1 or ?error=.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ plugin: string; id: string }> }) {
  const { plugin, id } = await params;
  const origin = getPublicOrigin(req);
  const back = (q: string) => NextResponse.redirect(prefixedUrl(`/plugins?${q}&oauth=${encodeURIComponent(`${plugin}.${id}`)}`, origin));
  try {
    connectionOf(`${plugin}.${id}`);
    const redirectUri = `${origin}/api/ext/oauth/${plugin}/${id}/callback`;
    const { verifier, challenge } = newPkce();
    const state = newState();
    const withSet = req.nextUrl.searchParams.get("with") ?? "";
    // Back to the page the click came from (same address only), else the Plugins page.
    let returnTo = "";
    try {
      const ref = new URL(req.headers.get("referer") ?? "");
      if (ref.origin === new URL(origin).origin) returnTo = ref.pathname;
    } catch {
      returnTo = "";
    }
    const res = NextResponse.redirect(authorizeUrl(`${plugin}.${id}`, { redirectUri, state, challenge, with: withSet || undefined }));
    res.cookies.set(`zeff_oauth_${plugin}_${id}`.slice(0, 80), JSON.stringify({ state, verifier, redirectUri, returnTo }), { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), path: "/api/ext/oauth", maxAge: 600 });
    return res;
  } catch (e) {
    return back(`error=${encodeURIComponent(errorMessage(e))}`);
  }
}
