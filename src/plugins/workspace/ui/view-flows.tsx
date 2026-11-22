"use client";

import { shareCall } from "./share-call";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { rowLifecycleAction, runFlowAction, runLambdaAction, runUserAction, takeTransitionAction } from "../actions";
import { parseWith } from "../flows/with";
import { keepAnswer, keptAnswer, keptKey, onlyHeldChanged, preloadsOf } from "./data-kept";

/**
 * A view's flows (flows/): <data> loading a flow's output into data.<name> whenever what it is called with changes, and a row's
 * <transitions> — its lifecycle's buttons, the ones it can't take now greyed with why, and its way so far.
 */

export { parseWith };

export type SetData = (name: string, patch: Record<string, unknown>) => void;

type FlowAnswer = Awaited<ReturnType<typeof runFlowAction>>;

/**
 * The same flow asked with the same values by several <data> at once — blocks side by side on a page (stat tiles, a heatmap, a list),
 * each reading what it shows from one flow — runs once: they all get that one answer. An answer counts as shared for a moment after it
 * came (blocks that are drawn a little later), not longer: a <data> asked again later asks the flow again.
 */
const SHARE_MS = 2000;
const shared = new Map<string, { done: number; answer: Promise<FlowAnswer> }>();
export function runFlowShared(flow: string, inputs: Record<string, unknown>, opts: { row?: number; lambda?: boolean; user?: boolean } = {}): Promise<FlowAnswer> {
  const key = JSON.stringify([opts.user ? "do" : opts.lambda ? "lambda" : "flow", flow, inputs, opts.row ?? null]);
  const now = Date.now();
  for (const [k, v] of shared) if (now - v.done > SHARE_MS) shared.delete(k);
  const hit = shared.get(key);
  if (hit) return hit.answer;
  // (<data lambda="…">: a lambda answers instead of a flow — read-only, the same shape of answer)
  // (<data do="…">: one of Zeff's own actions a view may do by itself — read a conversation, mark one read — as you)
  // (Asked through /api/workspace/data: the <data> of a page run side by side — server actions would queue one behind the other.)
  const entry = { done: Infinity, answer: askData(opts.user ? "do" : opts.lambda ? "lambda" : "flow", flow, inputs, opts.row) };
  entry.answer.finally(() => (entry.done = Date.now())).catch(() => undefined);
  shared.set(key, entry);
  return entry.answer;
}

type DataKind = "flow" | "lambda" | "do";

/** One <data> asked of the server's route (parallel with the others); when the route can't be reached, the server action as before. */
function askData(kind: DataKind, name: string, inputs: Record<string, unknown>, row?: number): Promise<FlowAnswer> {
  const viaAction = (): Promise<FlowAnswer> =>
    (kind === "do"
      ? runUserAction(name, { ...(row ? { row } : {}), ...inputs }, { auto: true }).then((r) => (r.ok ? { ok: true as const, status: "done" as const, output: r.output, error: null } : r))
      : kind === "lambda"
        ? runLambdaAction(name, inputs)
        : runFlowAction(name, inputs, { row })) as Promise<FlowAnswer>;
  if (typeof fetch === "undefined") return viaAction();
  return fetch("/api/workspace/data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, name, input: inputs, ...(row ? { row } : {}) }) })
    .then((r) => (r.ok ? (r.json() as Promise<FlowAnswer>) : Promise.reject(new Error(String(r.status)))))
    .catch(viaAction);
}

/** The answer the server kept the last time (nothing computed): shown at once where this browser kept none. Null when there is none. */
function peekData(kind: DataKind, name: string, inputs: Record<string, unknown>, row?: number): Promise<unknown | null> {
  if (kind === "do" || typeof fetch === "undefined") return Promise.resolve(null);
  // (The blocks of a page asking the same thing peek once.)
  return shareCall(`peek:${JSON.stringify([kind, name, inputs, row ?? null])}`, () => peekOnce(kind, name, inputs, row));
}
async function peekOnce(kind: DataKind, name: string, inputs: Record<string, unknown>, row?: number): Promise<unknown | null> {
  try {
    const r = await fetch("/api/workspace/data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, name, input: inputs, peek: true, ...(row ? { row } : {}) }) });
    if (!r.ok) return null;
    const j = (await r.json()) as { hit?: boolean; answer?: { ok?: boolean; status?: string; output?: unknown } };
    return j.hit && j.answer?.ok && j.answer.status === "done" ? { output: j.answer.output } : null;
  } catch {
    return null;
  }
}

const RELOAD_EVENT = "zeff:flowdata-reload";
/** Every <data> on the screen loads again (a reload button: the blocks of a page that read from flows, not only its own). */
export function reloadFlowData(): void {
  shared.clear();
  preloadedAt.clear();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RELOAD_EVENT));
}

/**
 * preload=: once the answer on screen is in, the answers for the other values of an input (another tab) are asked quietly and kept
 * (data-kept.ts) — the first switch to them shows at once. One at a time for the whole page, in idle time, not while the tab is
 * hidden, each at most every 30 s; asked through runFlowShared (a block asking the same at once gets the same answer).
 */
const PRELOAD_EVERY_MS = 30_000;
const preloadedAt = new Map<string, number>();
let preloadQueue: Promise<void> = Promise.resolve();
const idle = (): Promise<void> =>
  new Promise((done) => {
    const w = typeof window !== "undefined" ? (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }) : undefined;
    if (w?.requestIdleCallback) w.requestIdleCallback(() => done(), { timeout: 3000 });
    else setTimeout(done, 400);
  });
function preloadOthers(flow: string, source: string, inputs: Record<string, unknown>, others: { name: string; value: string }[], opts: { row?: number; lambda?: boolean }): void {
  const now = keptKey(source, inputs);
  for (const o of others) {
    const alt = { ...inputs, ...parseWith(`${o.name}=${o.value}`) };
    const key = keptKey(source, alt);
    if (key === now || Date.now() - (preloadedAt.get(key) ?? 0) < PRELOAD_EVERY_MS) continue;
    preloadedAt.set(key, Date.now());
    preloadQueue = preloadQueue.then(async () => {
      await idle();
      if (typeof document !== "undefined" && document.hidden) return void preloadedAt.delete(key);
      const r = await runFlowShared(flow, alt, opts).catch(() => null);
      if (r?.ok && r.status === "done") keepAnswer(key, r.output ?? null);
      else preloadedAt.delete(key);
    });
  }
}

/** Loads a flow's output into data.<name> (nothing drawn): again when its input changes, after a pause while it is typed. */
export function FlowData({ a, setData, row, reload }: { a: Record<string, string>; setData: SetData; row?: number; /** reload="true": the view's rows read again once it answered (a <data do> that changed them — marked read). */ reload?: () => void }) {
  const source = a.flow ?? (a.do ? `do:${a.do}` : `lambda:${a.lambda}`);
  const key = JSON.stringify([source, a.with ?? "", a.when ?? "__"]);
  const seq = useRef(0);
  const keptFor = useRef("");
  const keptText = useRef<string | null>(null);
  // (What it was asked with the last time, and whether data.<name> holds an answer now — for hold=.)
  const askedWith = useRef<Record<string, unknown> | null>(null);
  const onScreen = useRef(false);
  // (Bumped by reloadFlowData: asked anew.)
  const [round, setRound] = useState(0);
  useEffect(() => {
    const again = () => setRound((n) => n + 1);
    window.addEventListener(RELOAD_EVENT, again);
    return () => window.removeEventListener(RELOAD_EVENT, again);
  }, []);
  // (A layout effect: what this browser kept is in data.<name> before the view is painted — the view shows it at once, not its
  // loading screen for a frame, and never a frame of the answer for the inputs before. The asking itself is on a timer anyway.)
  useLayoutEffect(() => {
    const name = a.name;
    // (An answer on screen: data.<name>; data.<name>_last the last answer whatever it was asked with — for what may show the one
    // before while the new loads: counts, headings; data.<name>_loading off.)
    const show = (value: unknown, status: string) => {
      onScreen.current = true;
      setData(name, { [name]: value, [`${name}_last`]: value, [`${name}_status`]: status, [`${name}_error`]: null, [`${name}_loading`]: false });
    };
    if (a.when !== undefined && !a.when.trim()) {
      keptFor.current = "";
      onScreen.current = false;
      setData(name, { [name]: null, [`${name}_status`]: "", [`${name}_error`]: null, [`${name}_loading`]: false });
      return;
    }
    const inputs = parseWith(a.with);
    // What this flow gave the last time it was asked this (per page and inputs: in memory for the session — data-kept.ts — and in
    // localStorage across visits): shown at once while it loads again — the screen is there, not empty.
    const cacheKey = keptKey(source, inputs);
    // (Only when it is asked anew — not at a reload with the same inputs, when what it shows is already the last answer.)
    let nothingKept = false;
    if (keptFor.current !== cacheKey) {
      const before = keptFor.current ? askedWith.current : null;
      keptFor.current = cacheKey;
      keptText.current = null;
      let kept = keptAnswer(cacheKey);
      if (kept === undefined) {
        try {
          keptText.current = localStorage.getItem(cacheKey);
          if (keptText.current) kept = JSON.parse(keptText.current);
        } catch {
          // no storage: it loads as before
        }
      }
      if (kept !== undefined) show(kept, "stale");
      else {
        nothingKept = true;
        // (Only a held input changed — a search typed: the list on screen stays while the narrowed one loads.)
        if (onScreen.current && onlyHeldChanged(before, inputs, a.hold)) setData(name, { [`${name}_status`]: "stale" });
        else {
          // Nothing for these inputs yet: no answer shown as if it were theirs — empty and loading (the view draws its loader).
          onScreen.current = false;
          setData(name, { [name]: null, [`${name}_status`]: "loading", [`${name}_error`]: null, [`${name}_loading`]: true });
        }
      }
    }
    askedWith.current = inputs;
    const mine = ++seq.current;
    // (Nothing kept for these inputs: the server's last answer, asked for at the same time as the fresh one — whichever is there first.)
    let freshIn = false;
    if (nothingKept && (a.flow || a.lambda)) {
      void peekData(a.flow ? "flow" : "lambda", a.flow ?? a.lambda, inputs, row).then((kept) => {
        if (kept && !freshIn && mine === seq.current) show((kept as { output: unknown }).output, "stale");
      });
    }
    const timer = setTimeout(
      async () => {
        setData(name, { [`${name}_status`]: "loading" });
        const r = await runFlowShared(a.flow ?? a.do ?? a.lambda, inputs, { ...(row ? { row } : {}), ...(!a.flow && a.do ? { user: true } : !a.flow && a.lambda ? { lambda: true } : {}) });
        if (mine !== seq.current) return;
        freshIn = true;
        if (!r.ok) return setData(name, { [`${name}_status`]: "error", [`${name}_error`]: r.error, [`${name}_loading`]: false });
        const res = r;
        if (res.status === "failed") setData(name, { [`${name}_status`]: "error", [`${name}_error`]: res.error, [`${name}_loading`]: false });
        else {
          show(res.output, res.status === "waiting" ? "waiting" : "ok");
          if (a.reload === "true" && res.status === "done") reload?.();
          if (res.status !== "waiting") {
            keepAnswer(cacheKey, res.output ?? null);
            // (preload="scope=done|worker": the answers for the other tabs too, quietly — the first switch to them shows at once.)
            if (res.status === "done" && a.preload && (a.flow || a.lambda)) preloadOthers(a.flow ?? a.lambda, source, inputs, preloadsOf(a.preload), { ...(row ? { row } : {}), ...(a.flow ? {} : { lambda: true }) });
          }
        }
        if (res.status !== "waiting") {
          try {
            const text = JSON.stringify(res.output ?? null);
            if (text.length < 200_000 && text !== keptText.current) localStorage.setItem(cacheKey, (keptText.current = text));
          } catch {
            // full or blocked: nothing kept
          }
        }
      },
      Math.max(0, Math.min(3000, Number(a.debounce) || 0)),
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key holds what it depends on
  }, [key, round]);
  return null;
}

type Lifecycle = { transitions: { id: string; name: string; toName: string; ok: boolean; why?: string; confirm?: string }[]; history: { id: number; transition: string | null; from: string | null; to: string; by: string | null; note: string | null; at: string }[] };

/** A row's transitions as buttons and its way so far. */
export function TransitionsBlock({ row, history, reload }: { row: number; history: boolean; reload: () => void }) {
  const t = useT();
  const [lc, setLc] = useState<Lifecycle | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void rowLifecycleAction(row).then((r) => live && r.ok && setLc({ transitions: r.transitions, history: r.history }));
    return () => {
      live = false;
    };
  }, [row, tick]);
  if (!lc || (!lc.transitions.length && !lc.history.length)) return null;
  const take = async (id: string, name: string, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    const r = await takeTransitionAction(row, id);
    if (!r.ok) return toast(r.error, { tone: "error" });
    toast(t("{name}: done.", { name }), { tone: "ok" });
    setTick((x) => x + 1);
    reload();
  };
  return (
    <div className="space-y-2">
      {lc.transitions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {lc.transitions.map((x) => (
            <button key={x.id} type="button" className="btn btn-sm" disabled={!x.ok} title={x.ok ? `→ ${x.toName}` : x.why} onClick={() => void take(x.id, x.name, x.confirm)}>
              {x.name}
            </button>
          ))}
        </div>
      )}
      {history && lc.history.length > 0 && (
        <ol className="space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
          {lc.history.slice(0, 8).map((h) => (
            <li key={h.id}>
              {new Date(h.at).toLocaleString()} · {h.from ?? "—"} → {h.to}
              {h.transition ? ` (${h.transition})` : ""}
              {h.by ? ` · ${h.by}` : ""}
              {h.note ? ` · ${h.note}` : ""}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** A button's run=: the flow run, its output into data.<into>; what it says when it is through. */
export async function runFlowButton(a: Record<string, string>, v: { row: number | null; setData: SetData; setState: (k: string, v: string) => void; reload: () => void; t: ReturnType<typeof useT> }): Promise<void> {
  const r = await runFlowAction(a.run, parseWith(a.with), v.row ? { row: v.row } : {});
  if (!r.ok) return void toast(r.error, { tone: "error" });
  const res = r;
  if (res.status === "failed") return void toast(res.error ?? v.t("The flow failed."), { tone: "error" });
  if (a.into) v.setData(a.into, { [a.into]: res.output, [`${a.into}_status`]: res.status === "waiting" ? "waiting" : "ok" });
  if (res.status === "waiting") toast(res.waiting?.kind === "approve" ? v.t("It waits for your approval: {title}", { title: res.waiting.title ?? "" }) : v.t("It goes on later."), { ms: 6000 });
  else if (a.done) toast(a.done, { tone: "ok" });
  // (no done=: what the flow says of itself — an output's `message` — is said; a person's page that is gone goes to its `href`)
  else if (typeof (res.output as { message?: unknown } | null)?.message === "string" && (res.output as { message: string }).message) toast((res.output as { message: string }).message, { tone: "ok" });
  const goTo = (res.output as { href?: unknown } | null)?.href;
  if (typeof goTo === "string" && goTo.startsWith("/workspace/")) window.location.assign(goTo);
  // (then="a=1; b=": states set after it worked)
  for (const pair of (a.then ?? "").split(";")) {
    const i = pair.indexOf("=");
    if (i > 0) v.setState(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  v.reload();
}

/** A button's transition=: the row moves on (a note asked for when note=true). */
export async function transitionButton(a: Record<string, string>, v: { row: number | null; reload: () => void; t: ReturnType<typeof useT> }): Promise<void> {
  if (!v.row) return;
  const note = a.note === "true" ? (window.prompt(v.t("A note (optional)")) ?? undefined) : undefined;
  const r = await takeTransitionAction(v.row, a.transition, note || undefined);
  if (!r.ok) return void toast(r.error, { tone: "error" });
  toast(a.done || v.t("{name}: done.", { name: a.transition }), { tone: "ok" });
  v.reload();
}
