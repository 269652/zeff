"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { importEnvAction, moveSecretsAction, removeSecretAction, saveSecretAction } from "./actions";

export type Row = { name: string; plugin: string; label: string; what: string; secret: boolean; stored: boolean; inEnv: boolean; value: string | null };

/** Settings → Secrets: per plugin, what it needs. A saved secret is never shown again — only that it is set. */
export function SecretsForm({ rows, mode }: { rows: Row[]; mode: "account" | "separate" }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const run = (f: () => Promise<{ ok: boolean; error?: string; message?: string } | null>) =>
    start(async () => {
      const r = await f();
      if (r?.ok) toast(r.message ?? t("Saved."));
      else toast(r?.error ?? t("Failed."), { tone: "error" });
      router.refresh();
    });
  const plugins = [...new Set(rows.map((r) => r.plugin))];
  return (
    <div className="space-y-4">
      {plugins.map((p) => (
        <section key={p} className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{p || t("Other")}</h2>
          {rows
            .filter((r) => r.plugin === p)
            .map((r) => (
              <div key={r.name} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <label htmlFor={`s-${r.name}`} className="font-medium">
                    {r.label}
                  </label>
                  <code className="code text-xs">{r.name}</code>
                  <span className="text-xs text-zinc-500">{r.stored ? t("stored") : r.inEnv ? t("from .env (not moved yet)") : t("not set")}</span>
                </div>
                {r.what && <p className="text-xs text-zinc-500">{r.what}</p>}
                <div className="flex gap-2">
                  <input
                    id={`s-${r.name}`}
                    className="input flex-1"
                    type={r.secret ? "password" : "text"}
                    autoComplete="off"
                    placeholder={r.stored && r.secret ? t("set — type to replace") : ""}
                    defaultValue={r.stored && !r.secret ? (r.value ?? "") : ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [r.name]: e.target.value }))}
                  />
                  <button className="btn" disabled={pending || !(r.name in draft)} onClick={() => run(() => saveSecretAction(r.name, draft[r.name] ?? ""))}>
                    {t("Save")}
                  </button>
                  {r.stored && (
                    <button className="btn" disabled={pending} onClick={() => run(() => removeSecretAction(r.name))}>
                      {t("Remove")}
                    </button>
                  )}
                </div>
              </div>
            ))}
        </section>
      ))}
      <section className="card space-y-2 p-4 text-sm">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Move over")}</h2>
        <p className="text-xs text-zinc-500">{t("Copy what .env holds of these into the store. The file stays as it is — remove the lines yourself afterwards.")}</p>
        <button className="btn" disabled={pending} onClick={() => run(importEnvAction)}>
          {t("Copy from .env")}
        </button>
      </section>
      <section className="card space-y-2 p-4 text-sm">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Where they are kept")}</h2>
        <p className="text-xs text-zinc-500">{t("Encrypted either way. In a database of their own, a copy of this account's database carries none of them.")}</p>
        <div className="flex gap-2">
          <button className="btn" aria-pressed={mode === "account"} disabled={pending || mode === "account"} onClick={() => run(() => moveSecretsAction("account"))}>
            {t("In this account's database")}
          </button>
          <button className="btn" aria-pressed={mode === "separate"} disabled={pending || mode === "separate"} onClick={() => run(() => moveSecretsAction("separate"))}>
            {t("In a database of their own")}
          </button>
        </div>
      </section>
    </div>
  );
}
