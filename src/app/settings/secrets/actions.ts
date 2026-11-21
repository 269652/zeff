"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

/** Settings → Secrets: its server actions. A value is only ever sent in, never back. */

const allowed = async (name: string): Promise<boolean> => {
  const { pluginSecretDefs } = await import("@/plugins/secrets-modules");
  const { listSecrets } = await import("@/lib/secrets/store");
  return listSecrets(pluginSecretDefs()).some((r) => r.name === name);
};

export async function saveSecretAction(name: string, value: string): Promise<ActionState> {
  try {
    if (!(await allowed(String(name)))) return { ok: false, error: t("No plugin asks for “{name}”.", { name: String(name) }) };
    const { setSecret } = await import("@/lib/secrets/store");
    setSecret(String(name), String(value));
    revalidatePath("/settings/secrets");
    return { ok: true, message: String(value).trim() ? t("Saved.") : t("Removed.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function removeSecretAction(name: string): Promise<ActionState> {
  try {
    const { deleteSecret } = await import("@/lib/secrets/store");
    deleteSecret(String(name));
    revalidatePath("/settings/secrets");
    return { ok: true, message: t("Removed.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Copy what .env holds of these into the store. */
export async function importEnvAction(): Promise<ActionState> {
  try {
    const { pluginSecretDefs } = await import("@/plugins/secrets-modules");
    const { importFromEnvFile } = await import("@/lib/secrets/store");
    const done = importFromEnvFile(pluginSecretDefs());
    revalidatePath("/settings/secrets");
    return { ok: true, message: done.length ? t("Copied from .env: {names}. You can remove those lines from .env now.", { names: done.join(", ") }) : t("Nothing new in .env.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function moveSecretsAction(to: string): Promise<ActionState> {
  try {
    const { moveSecrets } = await import("@/lib/secrets/store");
    moveSecrets(to === "separate" ? "separate" : "account");
    revalidatePath("/settings/secrets");
    return { ok: true, message: to === "separate" ? t("Secrets now live in a database of their own.") : t("Secrets now live in this account's database.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
