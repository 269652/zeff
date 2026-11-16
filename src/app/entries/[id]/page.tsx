import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { redirect } from "@/lib/redirect";
import { reportLink } from "@/plugins/zeiterfassung/to-plugin";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Edit entry") };
}

/** An entry's page (its form and its context) lives in the time report of the Time tracking plugin (zeff-plugins/plugins/zeiterfassung-ext): this is the way in the links have always used — it opens that tab. Without the plugin: the Plugins page. */
export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const { getEntry } = await import("@/lib/entries");
  const entry = Number.isInteger(Number(id)) ? getEntry(Number(id)) : undefined;
  if (!entry) return redirect(await reportLink({ view: "week" }));
  return redirect(await reportLink({ view: "week", week: entry.date, entryedit: String(entry.id) }));
}
