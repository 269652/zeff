import { t } from "@/lib/i18n/server";
import type { PluginSecret } from "../secrets";

/** Your own Microsoft app registration, for the calendar's sign-in (without it the shared public client is used). */
export const secrets = (): PluginSecret[] => [
  { name: "MS_CLIENT_ID", label: t("Microsoft app (client id)"), what: t("Your own Entra app registration, for the calendar's sign-in"), secret: false },
  { name: "MS_CLIENT_SECRET", label: t("Microsoft app secret"), what: t("That app's client secret") },
  { name: "MS_TENANT_ID", label: t("Microsoft tenant"), what: t("Your tenant id (empty: any organisation)"), secret: false },
];
