import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { CodeMoved } from "@/components/work/CodeMoved";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Code") };
}

/**
 * Code: the sessions are the plugin's screen now (state.ts PROVIDED_BY: work-ext) — this address opens it, and what was picked (a run, a ticket) goes along.
 * The workers, the runs, the work host and the live sessions stay Zeff's own (src/plugins/work).
 */
export default async function WorkPage({ searchParams }: { searchParams: Promise<{ run?: string; ticket?: string }> }) {
  await connection();
  if (!isInstalled("work")) return <PluginNotInstalled id="work" />;
  const sp = await searchParams;
  const pick = Number(sp.run) ? `run:${Number(sp.run)}` : sp.ticket !== undefined ? `ticket:${sp.ticket || "-"}` : "";
  return <CodeMoved to="code" pick={pick} />;
}
