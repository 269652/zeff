import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Documents") };
}

/** Documents: the document inbox of the Workspace (the Documents plugin's screen) — its database page. */
export default async function DocumentsPage() {
  await connection();
  if (!isInstalled("documents")) return <PluginNotInstalled id="documents" />;
  const { ensureDocumentDatabases, documentInbox } = await import("@/plugins/workspace/document-databases");
  await ensureDocumentDatabases();
  const id = documentInbox();
  redirect(id ? `/workspace/${id}` : "/workspace");
}
