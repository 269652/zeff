import { NextResponse, type NextRequest } from "next/server";
import { getPublicOrigin } from "mcp-handler";
import { prefixedUrl } from "@/lib/redirect";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { connectionOf, exchangeCode } from "@/lib/ext/oauth";

const cookieName = (plugin: string, id: string) => `zeff_oauth_${plugin}_${id}`.slice(0, 80);

/** GET /api/ext/oauth/<plugin>/<id>/callback?code=…&state=… — the service sends you back here after you signed in. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ plugin: string; id: string }> }) {
  const { plugin, id } = await params;
  const origin = getPublicOrigin(req);
  const sp = req.nextUrl.searchParams;
  let cookie: { state?: string; verifier?: string; redirectUri?: string; returnTo?: string } | null = null;
  try {
    cookie = JSON.parse(req.cookies.get(cookieName(plugin, id))?.value ?? "null");
  } catch {
    cookie = null;
  }
  const finish = (query: string) => {
    const to = cookie?.returnTo && cookie.returnTo.startsWith("/") && !cookie.returnTo.startsWith("//") ? new URL(`${cookie.returnTo}?${query}`, origin) : prefixedUrl(`/plugins?${query}&oauth=${encodeURIComponent(`${plugin}.${id}`)}`, origin);
    const res = NextResponse.redirect(to);
    res.cookies.set(cookieName(plugin, id), "", { path: "/api/ext/oauth", maxAge: 0 });
    return res;
  };
  const fail = (message: string) => finish(`error=${encodeURIComponent(message)}`);
  try {
    connectionOf(`${plugin}.${id}`);
  } catch (e) {
    return fail(errorMessage(e));
  }
  if (sp.get("error")) return fail(`${sp.get("error")}${sp.get("error_description") ? `: ${sp.get("error_description")}` : ""}`);
  if (!cookie?.state || !cookie.verifier || !cookie.redirectUri || sp.get("state") !== cookie.state) return fail(t("Login state did not match — please try connecting again."));
  const code = sp.get("code");
  if (!code) return fail(t("The service did not return an authorization code."));
  try {
    await exchangeCode(`${plugin}.${id}`, { code, redirectUri: cookie.redirectUri, verifier: cookie.verifier });
  } catch (e) {
    return fail(errorMessage(e));
  }
  return finish("connected=1");
}
