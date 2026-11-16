import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { CodeMoved } from "@/components/work/CodeMoved";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Repos") };
}

/** Repos: where the workers implement — the plugin's settings screen now (work-ext); this address opens it. */
export default async function ReposPage() {
  await connection();
  if (!isInstalled("work")) return <PluginNotInstalled id="work" />;
  return <CodeMoved to="settings" />;
}
