import { t } from "@/lib/i18n/server";
import type { PluginSecret } from "../secrets";

/** What Zeff's Jira connection needs. */
export const secrets = (): PluginSecret[] => [
  { name: "JIRA_URL", label: t("Jira address"), what: t("The base address of your Jira, e.g. https://jira.example.com"), secret: false },
  { name: "JIRA_USERNAME", label: t("Jira login"), what: t("Your login or e-mail in Jira — for “Assign to me” and “tickets for me”"), secret: false },
  { name: "JIRA_PERSONAL_TOKEN", label: t("Jira token"), what: t("A Personal Access Token from Jira (Profile → Personal Access Tokens)") },
  { name: "JIRA_API_TOKEN", label: t("Jira API token (Cloud)"), what: t("Only for Jira Cloud: an API token, used with your e-mail as login") },
];
