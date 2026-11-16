import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Documents settings") };
}

/** Settings → Documents: the settings page of the Documents plugin (a database page of its package: local folders, what waits for you, the reading, the transcriber). */
export default async function DocumentsSettingsPage() {
  await connection();
  if (!isInstalled("documents")) return <PluginNotInstalled id="documents" />;
  const row = getSqlite().prepare("select id from ws_pages where kind = 'database' and title = 'Documents settings' and archived_at is null order by id desc limit 1").get() as { id: number } | undefined;
  redirect(row ? `/workspace/${row.id}` : "/workspace");
}
