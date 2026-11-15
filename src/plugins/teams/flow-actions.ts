import type { FlowAction } from "@/plugins/workspace/flows/actions";

/**
 * What a Teams port's sync flow needs of Zeff around its scraper (the driver lambda teams.driver, kept in the plugin): how Teams is read
 * (Microsoft's API — the kernel's — or the automation Chrome), and what it brought kept, the sync noted for the Teams page. Server only.
 */
export const TEAMS_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "teams.settings",
    group: "teams",
    label: "How Teams is read",
    summary: "How Teams is read: api (Microsoft Graph with your sign-in) or cdp (the automation Chrome), and how far back its chats go.",
    input: [],
    output: "{ via, pmDays, chatDays }",
    run: async () => ({ via: (await import("@/lib/connectors/store")).driverOf("teams"), pmDays: 90, chatDays: 3 }),
  },
  {
    name: "teams.keep",
    group: "teams",
    label: "Keep what was read from Teams",
    summary: "Teams messages a reader brought, kept (the inbox, the chats, the todos found in them read them); how the sync went is noted for the Teams page. A reader that failed says so (ok: false, message) — a sign-in it wants is asked of you. Needs the flow's sync permission for teams.",
    input: [{ name: "messages", type: "json" }, { name: "ok", type: "boolean" }, { name: "message", type: "text" }],
    output: "{ ok, message }",
    writes: true,
    run: async (i, ctx) => {
      if (!(ctx.perms.sync ?? []).includes("teams")) throw new Error("This flow may not keep Teams' messages — grant “teams” under the flow's permissions (sync).");
      if (ctx.dryRun) return { ok: true, message: "dry run" };
      const store = await import("@/lib/teams/store");
      const { clearAttention, needsSignIn, raiseLogin } = await import("@/lib/attention");
      const { t } = await import("@/lib/i18n/server");
      const note = (ok: boolean, message: string) => {
        store.updateTeamsSettings({ lastSyncAt: new Date().toISOString(), lastResult: message, lastOk: ok });
        return { ok, message };
      };
      if (i.ok === false || i.ok === "false") {
        const message = String(i.message ?? "").slice(0, 300);
        if (needsSignIn(message)) raiseLogin("teams", message);
        return note(false, message);
      }
      const { added, total } = store.saveTeamsMessages(Array.isArray(i.messages) ? (i.messages as never[]) : []);
      clearAttention("login:teams");
      return note(true, t("{added} new · {total} in all", { added, total }));
    },
  },
];
