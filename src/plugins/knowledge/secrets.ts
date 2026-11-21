import { t } from "@/lib/i18n/server";
import type { PluginSecret } from "../secrets";

/** The token of the knowledge server an account runs beside Zeff. */
export const secrets = (): PluginSecret[] => [{ name: "KNOWLEDGE_TOKEN", label: t("Knowledge server token"), what: t("The token of the knowledge server this account runs beside Zeff") }];
