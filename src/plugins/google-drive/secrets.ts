import { t } from "@/lib/i18n/server";
import type { PluginSecret } from "../secrets";

/** Your own Google OAuth client, for Drive's sign-in. */
export const secrets = (): PluginSecret[] => [
  { name: "GOOGLE_CLIENT_ID", label: t("Google client id"), what: t("Your own OAuth client, for Google Drive"), secret: false },
  { name: "GOOGLE_CLIENT_SECRET", label: t("Google client secret"), what: t("That client's secret") },
];
