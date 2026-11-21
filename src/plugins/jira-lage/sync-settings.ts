import { t } from "@/lib/i18n/server";
import type { PluginSyncSettings } from "../sync-settings";

/** Jira Lage's part of the Sync settings: the Board analysis (Board-Analyse) runs only by hand. */
export const syncSettings: PluginSyncSettings = {
  follows: [
    {
      key: "boardlage",
      get label() {
        return t("Board analysis");
      },
      get what() {
        return t("By hand: “Analyse” on a whole Jira board — the AI goes through every relevant ticket on it, not only yours.");
      },
      get follows() {
        return t("by hand only — “Analyse” on a Jira board");
      },
    },
  ],
};
