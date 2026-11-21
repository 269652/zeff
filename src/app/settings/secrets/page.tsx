import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { listSecrets, secretMode } from "@/lib/secrets/store";
import { pluginSecretDefs } from "@/plugins/secrets-modules";
import { SecretsForm } from "./SecretsForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Secrets") };
}

/** Settings → Secrets: the tokens and logins each plugin needs, kept encrypted per account. */
export default async function SecretsPage() {
  await connection();
  const rows = listSecrets(pluginSecretDefs());
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("All settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("Secrets")}</h1>
        <p className="text-sm text-zinc-500">{t("The tokens and logins each plugin needs, kept encrypted for this account. A saved secret is never shown again.")}</p>
      </div>
      <SecretsForm rows={rows} mode={secretMode()} />
    </div>
  );
}
