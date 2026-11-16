import type { Metadata } from "next";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { CodeMoved } from "@/components/work/CodeMoved";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Admin sessions" };

/** Admin sessions (beta plugin): its settings are a part of the plugin's settings screen now (work-ext); this address opens it. */
export default async function AdminSessionsPage() {
  await connection();
  if (!isInstalled("work-elevated")) return <PluginNotInstalled id="work-elevated" />;
  return <CodeMoved to="settings" />;
}
