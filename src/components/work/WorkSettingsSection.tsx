import { t } from "@/lib/i18n/server";
import { aiChoice } from "@/lib/ai";
import { isInstalled, onlyThroughPort } from "@/plugins/state";
import { copilotModels } from "@/plugins/copilot-cli/cli";
import { workSettingsData } from "@/lib/work/view";
import { claudeSessionSettings } from "@/lib/work/store";
import { ClaudeSessionSettingsForm } from "./ClaudeSessionSettingsForm";
import { WorkSettingsForm } from "./WorkSettingsForm";

/** The Work section of the Settings page: live Claude sessions, and the workers (how many, what they may do, the model, rules). */
export async function WorkSettingsSection() {
  // The plugin stands in for the built-in (state.ts PROVIDED_BY): its settings are a page of the Workspace.
  if (onlyThroughPort("work")) {
    const page = (await import("@/plugins/work/to-plugin")).workSettingsPage();
    if (page)
      return (
        <section id="work" className="card scroll-mt-24 space-y-1 p-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Code")}</h2>
          <p className="text-sm text-zinc-500">
            {t("It runs as a plugin now — the plugin of the same name below does its work; its settings came along.")}{" "}
            <a href={`/workspace/${page}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
              {t("Code")} →
            </a>
          </p>
        </section>
      );
  }
  const d = workSettingsData(aiChoice().provider === "copilot" ? await copilotModels() : []);
  return (
    <>
      <section id="work" className="card scroll-mt-24 space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Code")}</h2>
          <p className="mt-1 text-sm text-zinc-500">{t("How the Code tab's sessions and workers run: Claude Code live, its permission modes, and the workers' limits, model and house rules.")}</p>
        </div>
        <ClaudeSessionSettingsForm s={claudeSessionSettings()} admin={isInstalled("work-elevated")} />
      </section>
      <section className="card p-4">
        <WorkSettingsForm s={d.settings} repos={d.repos} defaultModel={d.defaultModel} models={d.models} provider={d.preferred} pools={d.pools} rulesPage={await (await import("@/lib/prompts")).promptHref("work-rules")} />
      </section>
    </>
  );
}
