import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { redirect } from "@/lib/redirect";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Todos") };
}

/**
 * Todos live in the Workspace: its page "Todos" shown by the Todos plugin's view (zeff-plugins/plugins/todos-ext). This is the way in the links have always used
 * (/todos?todos=done, /todos?part=tickets, /todos?view=recap&day=…): it opens that page with the tab set. Without the plugin: the Plugins page.
 */
export default async function TodosPage({ searchParams }: { searchParams: Promise<{ todos?: string; part?: string; view?: string; day?: string; ticket?: string }> }) {
  await connection();
  if (!isInstalled("todos")) return <PluginNotInstalled id="todos" />;
  const { todosApp, todosState } = await import("@/plugins/workspace/todos-app");
  const id = todosApp();
  if (!id) return redirect("/plugins");
  const q = todosState(await searchParams);
  return redirect(`/workspace/${id}${q ? `?${q}` : ""}`);
}
