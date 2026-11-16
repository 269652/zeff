"use client";

import { useState, useTransition } from "react";
import { switchToPortAction } from "@/lib/ext/actions";
import { useT } from "@/components/I18nProvider";

/** On a built-in plugin's card when its port is in the plugins folder (plugins/ports.ts): switch to the plugin, settings and all. */
/** switched: it runs through its plugin already (state.ts PROVIDED_BY) — said so, instead of a button that seems to do nothing. */
export function SwitchToPort({ builtin, switched = false }: { builtin: string; switched?: boolean }) {
  const t = useT();
  const [said, setSaid] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (switched) return <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{t("It runs as a plugin now — the plugin of the same name below does its work; its settings came along.")}</div>;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
      <span>{t("This is also there as a plugin from its repository: it updates without a new Zeff, and its keys are kept encrypted. Your settings come along.")}</span>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await switchToPortAction(builtin);
            setSaid(r.ok ? (r.message ?? "") : (r.error ?? ""));
            if (r.ok) window.location.reload();
          })
        }
      >
        {t("Switch to the plugin")}
      </button>
      {said && <span>{said}</span>}
    </div>
  );
}
