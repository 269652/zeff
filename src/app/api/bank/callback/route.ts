import { NextResponse, type NextRequest } from "next/server";
import { getPublicOrigin } from "mcp-handler";
import { errorMessage } from "@/lib/errors";
import { casesAfterBookings, casesThere } from "@/lib/cases/there";
import { localDay } from "@/lib/dates";

/** GET /api/bank/callback?code=…&state=… — your bank (through Enable Banking) sends you back here after you allowed access. */
export async function GET(req: NextRequest) {
  if (!casesThere()) return new Response("Plugin not installed", { status: 404 });
  const origin = getPublicOrigin(req);
  const db = await (await import("@/plugins/cases/database")).casesDatabase();
  const back = (query: string) => NextResponse.redirect(new URL(`${db ? `/workspace/${db}` : "/workspace"}${query}`, origin));
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back(`?bank=${encodeURIComponent(`${sp.get("error")}${sp.get("error_description") ? `: ${sp.get("error_description")}` : ""}`)}`);
  const code = sp.get("code");
  if (!code) return back(`?bank=${encodeURIComponent("No code came back from the bank.")}`);
  try {
    // (the bank is the kernel's driver; the bookings matched by who keeps your cases — the built-in, or its port's flows)
    const sync = await import("@/lib/bank/sync");
    await sync.finishBankAuth(code, sp.get("state") ?? "");
    // The bookings right away, matched.
    await sync.syncBank();
    await casesAfterBookings(localDay());
    return back("?bank=connected");
  } catch (e) {
    return back(`?bank=${encodeURIComponent(errorMessage(e))}`);
  }
}
