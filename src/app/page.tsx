import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { redirect } from "@/lib/redirect";
import { reportLink } from "@/plugins/zeiterfassung/to-plugin";
import { fullScreen } from "@/lib/full-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Weekly report") };
}
/**
 * Home is the weekly report: the time report of the Time tracking plugin (zeff-plugins/plugins/zeiterfassung-ext), its week tab. A new Zeff (or account): nothing
 * here — the layout shows the way into the setup assistant. Without the weekly report: the first installed application. Without the plugin: the Plugins page.
 */
export default async function WeekPage({ searchParams }: { searchParams: Promise<{ week?: string; by?: string }> }) {
  await connection();
  if (!(await import("@/lib/ai")).getAppSettings().setupDoneAt) return null;
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("weekly-report")) {
    const { firstAppTab } = await import("@/plugins/tabs");
    return redirect(firstAppTab());
  }
  const sp = await searchParams;
  // (From the header menu: the app full screen — no header, no Workspace sidebar; Esc or ⤡ brings them back.)
  return redirect(fullScreen(await reportLink({ view: "week", week: sp.week, by: sp.by })));
}
