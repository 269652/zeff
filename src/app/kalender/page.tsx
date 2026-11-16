import type { Metadata } from "next";
import { redirect } from "@/lib/redirect";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Calendar") };
}

/**
 * Kalender: the calendar lives in the Workspace (a database "Calendar" shown by the calendar app, or by the plugin's page once switched) —
 * this address takes you there (old links, the menu; ?v=…&d=YYYY-MM-DD, ?w= of old links). Without the Workspace there is no calendar screen.
 */
export default async function KalenderPage({ searchParams }: { searchParams: Promise<{ v?: string; d?: string; w?: string }> }) {
  await connection();
  if (!isInstalled("calendar")) return <PluginNotInstalled id="calendar" />;
  if (!isInstalled("workspace")) return <PluginNotInstalled id="workspace" />;
  const sp = await searchParams;
  const home = (await import("@/plugins/workspace/calendar-database")).calendarDatabase();
  if (!home) return <PluginNotInstalled id="workspace" />;
  redirect(`/workspace/${home}${sp.v || sp.d || sp.w ? `?${new URLSearchParams({ ...(sp.v ? { v: sp.v } : {}), ...((sp.d ?? sp.w) ? { d: (sp.d ?? sp.w)! } : {}) })}` : ""}`);
}
