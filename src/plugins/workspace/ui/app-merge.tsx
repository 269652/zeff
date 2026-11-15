"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { abortAppMergeAction, appMergeOfPageAction, finishAppMergeAction, proposeAppSpotAction, settleAppSpotAction } from "../actions";
import type { MergeSpot, PendingAppMerge } from "../package-merge";

/**
 * An app's update that waits for you, the way git waits in a merge (package-merge.ts): everything only one side changed is in already;
 * the spots you and the update both changed are listed — each with the version before, yours and the update's. Keep yours, take the
 * update's, both (a page's text), or write it yourself (a text of lines starts with git's markers around the lines both changed; ✨ the
 * AI proposes a merge you check). Finish puts it all in place; Undo the update takes the whole app back to how it was before it.
 */

const show = (v: unknown): string => (v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2));
/** Where a spot is, said for a person: ".properties[Farbe].name" → "properties › Farbe › name". */
const whereOf = (s: MergeSpot) => s.where.replace(/^\./, "").replace(/\[([^\]]+)\]/g, " › $1").replace(/\./g, " › ");

export function AppMergeResolver({ merge: first, onClose, onDone }: { merge: PendingAppMerge; onClose: () => void; onDone?: () => void }) {
  const t = useT();
  const router = useRouter();
  const [merge, setMerge] = useState(first);
  const [pick, setPick] = useState(() => first.spots.find((s) => !s.choice)?.n ?? first.spots[0]?.n ?? 0);
  const [tab, setTab] = useState<"mine" | "theirs" | "base" | "edit">("mine");
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [note, setNote] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const s = merge.spots.find((x) => x.n === pick);
  const open = merge.spots.filter((x) => !x.choice).length;
  const editText = s ? (draft[s.n] ?? (s.choice === "edited" ? show(s.value) : (s.marked ?? show(s.mine)))) : "";
  const hasMarkers = /^(<{7}|={7}|>{7}|\|{7})/m.test(editText);

  const after = (m: PendingAppMerge, n: number) => {
    setMerge(m);
    const next = m.spots.find((x) => !x.choice && x.n !== n);
    if (next) setPick(next.n);
    setTab("mine");
  };
  const settle = async (choice: "mine" | "theirs" | "both" | "edited") => {
    if (!s) return;
    setBusy(choice);
    const r = await settleAppSpotAction(merge.id, s.n, choice, choice === "edited" ? editText : undefined, choice === "edited" ? note[s.n] : undefined);
    setBusy(null);
    if (!r.ok) return void toast(r.error, { tone: "error", ms: 10000 });
    after(r.merge, s.n);
  };
  const askAi = async () => {
    if (!s) return;
    setBusy("ai");
    const r = await proposeAppSpotAction(merge.id, s.n);
    setBusy(null);
    if (!r.ok) return void toast(r.error, { tone: "error", ms: 12000 });
    setDraft((d) => ({ ...d, [s.n]: r.text }));
    setNote((x) => ({ ...x, [s.n]: r.note }));
    setTab("edit");
  };
  const finish = async () => {
    setBusy("finish");
    const r = await finishAppMergeAction(merge.id);
    setBusy(null);
    if (!r.ok) return void toast(r.error, { tone: "error", ms: 12000 });
    toast(r.missing.length ? t("The update is finished — {n} spots were no longer there.", { n: r.missing.length }) : t("The update of {name} is finished.", { name: merge.name }), { tone: "ok", ms: 8000 });
    onDone?.();
    router.refresh();
    onClose();
  };
  const abort = async () => {
    if (!window.confirm(t("Take the whole app back to how it was before the update to {to}?", { to: merge.to }))) return;
    setBusy("abort");
    const r = await abortAppMergeAction(merge.id);
    setBusy(null);
    if (!r.ok) return void toast(r.error, { tone: "error", ms: 12000 });
    toast(t("{name} is back to version {v}.", { name: merge.name, v: r.to ?? merge.from }), { tone: "ok" });
    onDone?.();
    router.refresh();
    onClose();
  };
  const choiceLabel = (c: MergeSpot["choice"]) => (c === "mine" ? t("yours") : c === "theirs" ? t("update's") : c === "both" ? t("both") : c === "edited" ? t("your own") : "");

  return (
    <Modal title={t("Merge {name} {from} → {to}", { name: merge.name, from: merge.from, to: merge.to })} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          {open === 0
            ? t("Every spot is settled. Finish puts it in place.")
            : open === 1
              ? t("Everything else of the update is in. One spot was changed by you and by the update — yours stands there until you settle it.")
              : t("Everything else of the update is in. {n} spots were changed by you and by the update — yours stands there until you settle them.", { n: open })}
        </p>
        <div className="grid gap-3 md:grid-cols-[16rem_minmax(0,1fr)]">
          <ul className="space-y-0.5 text-sm" aria-label={t("Spots")}>
            {merge.spots.map((x) => (
              <li key={x.n}>
                <button type="button" className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left ${x.n === pick ? "bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`} onClick={() => (setPick(x.n), setTab("mine"))}>
                  <span aria-hidden className={x.choice ? "text-emerald-600" : "text-amber-600"}>
                    {x.choice ? "✓" : "●"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{x.title}</span>
                    <span className="block truncate font-mono text-[11px] text-zinc-500">{whereOf(x)}</span>
                  </span>
                  {x.choice && <span className="text-[10px] text-zinc-400">{choiceLabel(x.choice)}</span>}
                </button>
              </li>
            ))}
          </ul>
          {s && (
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-1 text-xs" role="tablist">
                {(
                  [
                    ["mine", t("Yours")],
                    ["theirs", s.removed ? t("Update's (removed)") : t("Update's")],
                    ["base", t("Before (the version installed)")],
                    ...(s.part !== "doc" ? ([["edit", t("Write it yourself")]] as const) : []),
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} className={`rounded-md px-2 py-1 ${tab === k ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`} onClick={() => setTab(k)}>
                    {l}
                  </button>
                ))}
              </div>
              {s.part === "doc" && tab !== "edit" ? (
                <p className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{t("The page's text: in the places both changed, keep yours, take the update's, or both one after the other — then change the page itself.")}</p>
              ) : tab === "edit" ? (
                <>
                  <textarea className="h-72 w-full resize-y rounded-lg border border-zinc-300 bg-white p-2 font-mono text-xs leading-relaxed dark:border-zinc-700 dark:bg-zinc-950" spellCheck={false} value={editText} aria-label={t("Write it yourself")} onChange={(e) => setDraft((d) => ({ ...d, [s.n]: e.target.value }))} />
                  {note[s.n] && <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800 dark:bg-violet-950/40 dark:text-violet-200">✨ {note[s.n]}</p>}
                  {hasMarkers && <p className="text-xs text-amber-700 dark:text-amber-400">{t("Both sides still stand between <<<<<<< and >>>>>>> — settle each place, or let the AI merge.")}</p>}
                </>
              ) : (
                <pre className="h-72 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap dark:border-zinc-800 dark:bg-zinc-900">{tab === "theirs" && s.removed ? t("(the update removes it)") : show(tab === "mine" ? s.mine : tab === "theirs" ? s.theirs : s.base) || t("(empty)")}</pre>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void settle("mine")}>
                  {t("Keep yours")}
                </button>
                <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void settle("theirs")}>
                  {s.removed ? t("Remove it, as the update does") : t("Take the update's")}
                </button>
                {s.part === "doc" ? (
                  <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void settle("both")}>
                    {t("Both")}
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn btn-sm text-violet-700 dark:text-violet-300" disabled={!!busy} onClick={() => void askAi()}>
                      {busy === "ai" ? t("The AI is merging …") : `✨ ${t("Merge with AI")}`}
                    </button>
                    {tab === "edit" && (
                      <button type="button" className="btn btn-primary btn-sm ml-auto" disabled={!!busy || hasMarkers} onClick={() => void settle("edited")}>
                        {t("Use this")}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void abort()}>
            {t("Undo the update")}
          </button>
          <button type="button" className="btn btn-primary" disabled={!!busy || open > 0} onClick={() => void finish()}>
            {busy === "finish" ? t("Working …") : open === 1 ? t("One still open") : open ? t("{n} still open", { n: open }) : t("Finish the update")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** The note on an app's pages while its update waits for you: how many spots are left, and the button that opens the merge. */
export function AppMergeNote({ pageId, reload, refresh = 0 }: { pageId: number; reload?: () => void; /** Counted up: look again (an update was just brought in). */ refresh?: number }) {
  const t = useT();
  const [merge, setMerge] = useState<PendingAppMerge | null>(null);
  const [opened, setOpened] = useState(false);
  const look = useCallback(async () => {
    const r = await appMergeOfPageAction(pageId);
    if (r.ok) setMerge(r.merge);
    return r.ok ? r.merge : null;
  }, [pageId]);
  useEffect(() => {
    let live = true;
    void appMergeOfPageAction(pageId).then((r) => {
      if (!live || !r.ok) return;
      setMerge(r.merge);
      // (just brought in with spots open: the merge opens at once)
      if (refresh && r.merge) setOpened(true);
    });
    return () => {
      live = false;
    };
  }, [pageId, refresh]);
  if (!merge) return null;
  const open = merge.spots.filter((s) => !s.choice).length;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 print:hidden dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status">
        <div className="min-w-0 flex-1">
          <b>{t("The update of {name} to {to} waits for you", { name: merge.name, to: merge.to })}</b>
          <div className="text-xs">{open === 1 ? t("One spot was changed by you and by the update.") : open ? t("{n} spots were changed by you and by the update.", { n: open }) : t("Every spot is settled — finish it.")}</div>
        </div>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setOpened(true)}>
          {t("Settle")}
        </button>
      </div>
      {opened && <AppMergeResolver merge={merge} onClose={() => (setOpened(false), void look())} onDone={() => (setMerge(null), reload?.())} />}
    </>
  );
}
