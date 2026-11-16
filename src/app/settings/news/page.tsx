import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { redirect } from "@/lib/redirect";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("News settings") };
}

/** Settings → News: the News plugin's settings page — its database "News settings" in the Workspace (zeff-plugins/plugins/news-ext). Without it: the Plugins page. */
export default async function NewsSettingsPage() {
  await connection();
  const { search } = await import("@/plugins/workspace/store");
  const hit = search("News settings", 10).find((h) => h.title === "News settings" && h.kind === "database");
  return redirect(hit ? `/workspace/${hit.id}` : "/plugins");
}
