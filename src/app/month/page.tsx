import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { redirect } from "@/lib/redirect";
import { reportLink } from "@/plugins/zeiterfassung/to-plugin";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Monthly report") };
}

/** The monthly report lives in the time report of the Time tracking plugin (zeff-plugins/plugins/zeiterfassung-ext): this is the way in the links have always used — it opens that tab. Without the plugin: the Plugins page. */
export default async function MonthPage({ searchParams }: { searchParams: Promise<{ month?: string; by?: string }> }) {
  await connection();
  const sp = await searchParams;
  return redirect(await reportLink({ view: "month", month: sp.month, by: sp.by }));
}
