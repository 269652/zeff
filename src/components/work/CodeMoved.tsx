import Link from "next/link";
import { t } from "@/lib/i18n/server";
import { redirect } from "@/lib/redirect";
import { onlyThroughPort } from "@/plugins/state";

/**
 * The Code screens (the sessions, the repos, the settings, Admin sessions) are the plugin's now (zeff-plugins: work-ext, pages of the Workspace); the old addresses
 * (/work, /repos, /work/admin, the Code section of the Settings) open them. Where the plugin isn't switched on yet, this says where to do that.
 * `pick`: what the address asked for (?s.sel=run:12) goes along.
 */
export async function CodeMoved({ to, pick }: { to: "code" | "settings"; pick?: string }) {
  if (onlyThroughPort("work")) {
    const { workCodePage, workSettingsPage } = await import("@/plugins/work/to-plugin");
    const page = to === "code" ? workCodePage() : workSettingsPage();
    if (page) return redirect(`/workspace/${page}${pick ? `?s.sel=${encodeURIComponent(pick)}` : ""}`);
  }
  return (
    <div className="mx-auto max-w-xl space-y-2 p-6 text-sm">
      <h1 className="text-lg font-semibold">{t("Code")}</h1>
      <p className="text-zinc-500">{t("The Code screens are a plugin now (Code). Switch it on under Plugins — the workers, the runs and the sessions go on as they were.")}</p>
      <Link href="/plugins" className="text-indigo-600 hover:underline dark:text-indigo-400">
        {t("Plugins")} →
      </Link>
    </div>
  );
}
