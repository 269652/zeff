import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { redirect } from "@/lib/redirect";
import { isInstalled } from "@/plugins/state";

/**
 * Knowledge: the chat with the knowledge server is the plugin's (knowledge-ext, state.ts PROVIDED_BY) — a page of the Workspace,
 * which /knowledge opens. Without it there is nothing here.
 */
export default async function KnowledgePage() {
  await connection();
  if (!isInstalled("knowledge")) return <PluginNotInstalled id="knowledge" />;
  const { getPref } = await import("@/lib/prefs");
  const { getPage } = await import("@/plugins/workspace/store");
  const id = getPref<number | null>("knowledge.chatPage", null);
  if (id && getPage(id) && !getPage(id)!.archivedAt) return redirect(`/workspace/${id}`);
  return <PluginNotInstalled id="knowledge" />;
}
