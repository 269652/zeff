import { integrationServer, integrationServerIds } from "@/lib/integrations/server";
import type { SecretDef } from "@/lib/secrets/store";
import { catalogText } from "./catalog-text";
import { PLUGINS, type PluginId } from "./catalog";
import { installedPlugins } from "./state";
import type { PluginSecret } from "./secrets";
import { secrets as jira } from "./jira/secrets";
import { secrets as outlookCalendar } from "./outlook/calendar-secrets";
import { secrets as googleDrive } from "./google-drive/secrets";
import { secrets as knowledge } from "./knowledge/secrets";
import { t } from "@/lib/i18n/server";

/**
 * Each plugin's secrets module — add a plugin's here (one line) when it needs a token or a login; it then shows on
 * Settings → Secrets under its name. The mounted integrations bring theirs as `secrets` of their server part.
 */
const modules = (): Partial<Record<PluginId, () => PluginSecret[]>> => ({
  jira,
  "outlook-calendar": outlookCalendar,
  "google-drive": googleDrive,
  knowledge,
  ...Object.fromEntries(integrationServerIds().flatMap((id) => { const s = integrationServer(id)?.secrets; return s ? [[id, () => s]] : []; })),
});

/** The secrets of every installed plugin that brings some, in the catalog's order. */
export function pluginSecretDefs(): SecretDef[] {
  const on = installedPlugins();
  const MODULES = modules();
  return PLUGINS.filter((p) => on.has(p.id) && MODULES[p.id]).flatMap((p) =>
    MODULES[p.id]!().map((s) => ({ name: s.name, plugin: catalogText(t, p.name), label: s.label, what: s.what, secret: s.secret !== false })),
  );
}
