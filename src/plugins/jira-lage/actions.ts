"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";

/** A Jira board's "Auswerten": the Board-Lage — the relevant tickets you're in, or all — in the background. */
export async function startBoardLageAction(opts: { all?: boolean } = {}): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    if (!isInstalled("jira-lage")) return { ok: false, error: t("Jira briefing is not installed (Menu → Plugins).") };
    // Through its port (jira-lage-ext): its flow does it, in the background — told the scope as its input.
    if ((await import("@/plugins/state")).onlyThroughPort("jira-lage")) {
      const { runFlow } = await import("@/plugins/workspace/flows/engine");
      void runFlow("jira-lage.board-lage", { all: !!opts.all }, { trigger: { kind: "manual" } }).catch((e) => console.error("[jira-lage] the board briefing failed", e));
      return { ok: true, message: t("The board briefing is running — the cards fill in as parts are done.") };
    }
    // The tickets you're in — or (on request) all, also those without you.
    // (The briefing runs on the sync host, when there is one: it is told the scope there.)
    const { delegates } = await import("@/lib/host/role");
    if (delegates()) await (await import("@/lib/host/client")).callHost("boardlage.scope", { all: !!opts.all });
    else (await import("./board-lage")).setBoardLageScope(!!opts.all);
    const r = await (await import("@/lib/sync/registry")).startSync("boardlage");
    revalidatePath("/workspace", "layout");
    return r.ok ? { ok: true, message: t("The board briefing is running — the cards fill in as parts are done.") } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
