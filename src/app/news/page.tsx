import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { redirect } from "@/lib/redirect";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("News") };
}

/**
 * News lives in the Workspace: its page "News" shown by the News plugin's view (zeff-plugins/plugins/news-ext). This is the way in the links have always used
 * (/news?view=saved&source=3&category=Tech): it opens that page with the view, the source and the category set. Without the plugin: the Plugins page.
 */
export default async function NewsPage({ searchParams }: { searchParams: Promise<{ view?: string; source?: string; category?: string }> }) {
  await connection();
  const id = await (await import("@/plugins/workspace/news-app")).newsApp();
  if (!id) return redirect("/plugins");
  const sp = await searchParams;
  const link = new URLSearchParams(Object.entries({ view: sp.view, source: sp.source, category: sp.category }).flatMap(([k, v]) => (v ? [[`s.${k}`, v]] : []))).toString();
  return redirect(`/workspace/${id}${link ? `?${link}` : ""}`);
}
