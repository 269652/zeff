"use client";

import { forgetShared, shareCall } from "./share-call";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { bringPackageUpdateAction, packageUpdateOfAction } from "../actions";
import { AppMergeNote } from "./app-merge";

/**
 * A newer version of the app this page belongs to (its top page, a database of it) (an installed package — Learn's comes with Zeff): said in the view, with the button
 * that brings it in. Nothing is updated by itself; "Later" hides it until a still newer version comes (the browser keeps that). An update
 * that left spots both you and it changed waits for you like a git merge: its note (app-merge.tsx) stands here until it is settled.
 */
export function PackageUpdateNote({ dbId, reload }: { /** A page of the app (its top page, a database of it). */ dbId: number; reload?: () => void }) {
  const t = useT();
  const router = useRouter();
  const [u, setU] = useState<{ id: string; name: string; from: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [brought, setBrought] = useState(0);
  useEffect(() => {
    let live = true;
    // (Shared: every block of a page asks this of the same page — once — share-call.ts.)
    void shareCall(`package-update:${dbId}`, () => packageUpdateOfAction(dbId)).then((x) => {
      if (!live || !x.ok || !x.update) return;
      let later: string[] = [];
      try {
        later = JSON.parse(localStorage.getItem("zeff-updates-later") ?? "[]") as string[];
      } catch {
        // (shown, then)
      }
      if (!later.includes(`${x.update.id}@${x.update.to}`)) setU(x.update);
    });
    return () => {
      live = false;
    };
  }, [dbId]);
  if (!u) return <AppMergeNote pageId={dbId} reload={reload} refresh={brought} />;
  const bring = async () => {
    setBusy(true);
    const r = await bringPackageUpdateAction(u.id);
    forgetShared("package-update:");
    forgetShared("app-merge:");
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    const open = "open" in r && typeof r.open === "number" ? r.open : 0;
    if (open) toast(open === 1 ? t("{name} {to} is in — one spot changed by you and by the update waits for you.", { name: u.name, to: u.to }) : t("{name} {to} is in — {n} spots changed by you and by the update wait for you.", { name: u.name, to: u.to, n: open }), { tone: "ok", ms: 8000 });
    else toast(t("{name} is up to date (version {to}).", { name: u.name, to: u.to }), { tone: "ok" });
    setU(null);
    setBrought((n) => n + 1);
    reload?.();
    router.refresh();
  };
  const later = () => {
    try {
      const have = JSON.parse(localStorage.getItem("zeff-updates-later") ?? "[]") as string[];
      localStorage.setItem("zeff-updates-later", JSON.stringify([...have, `${u.id}@${u.to}`].slice(-20)));
    } catch {
      // (shown again next time, then)
    }
    setU(null);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900 print:hidden dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200" role="status">
      <div className="min-w-0 flex-1">
        <b>✨ {t("A new version of {name} is there", { name: u.name })}</b>
        <div className="text-xs">{t("Version {from} → {to}. Your own entries stay as they are.", { from: u.from, to: u.to })}</div>
      </div>
      <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void bring()}>
        {busy ? t("Updating …") : t("Update now")}
      </button>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={later}>
        {t("Later")}
      </button>
    </div>
  );
}
