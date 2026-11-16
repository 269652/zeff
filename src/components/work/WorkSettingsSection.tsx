import { t } from "@/lib/i18n/server";
import { onlyThroughPort } from "@/plugins/state";

/** The Code section of the Settings page: the plugin's settings (work-ext) are a page of the Workspace — this links to it. */
export async function WorkSettingsSection() {
  const page = onlyThroughPort("work") ? (await import("@/plugins/work/to-plugin")).workSettingsPage() : null;
  return (
    <section id="work" className="card scroll-mt-24 space-y-1 p-4">
      <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Code")}</h2>
      <p className="text-sm text-zinc-500">
        {page ? t("It runs as a plugin now — the plugin of the same name below does its work; its settings came along.") : t("The Code screens are a plugin now (Code). Switch it on under Plugins — the workers, the runs and the sessions go on as they were.")}{" "}
        <a href={page ? `/workspace/${page}` : "/plugins"} className="text-indigo-600 hover:underline dark:text-indigo-400">
          {page ? t("Code") : t("Plugins")} →
        </a>
      </p>
    </section>
  );
}
