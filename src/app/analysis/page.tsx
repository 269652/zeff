import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { redirect } from "@/lib/redirect";
import { reportLink } from "@/plugins/zeiterfassung/to-plugin";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Analysis") };
}

/** The analysis lives in the time report of the Time tracking plugin (zeff-plugins/plugins/zeiterfassung-ext): this is the way in the links have always used — it opens that tab. Without the plugin: the Plugins page. */
export default async function AnalysisPage({ searchParams }: { searchParams: Promise<{ weeks?: string; tickets?: string; split?: string }> }) {
  await connection();
  const sp = await searchParams;
  return redirect(await reportLink({ view: "analysis", aweeks: sp.weeks, atickets: sp.tickets === "mine" ? "mine" : undefined, asplit: sp.split === "type" ? "type" : undefined }));
}
