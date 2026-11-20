import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { redirect } from "@/lib/redirect";
import { reportLink } from "@/plugins/zeiterfassung/to-plugin";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Project") };
}

/** A project's page lives in the time report of the Time tracking plugin (zeff-plugins/plugins/zeiterfassung-ext): this is the way in the links have always used — it opens that tab. Without the plugin: the Plugins page. */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  return redirect(await reportLink({ view: "projects", jd: `project:${id}` }));
}
