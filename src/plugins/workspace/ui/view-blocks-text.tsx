"use client";

import { useState } from "react";
import { EditDiff, Patch } from "@/components/work/Diff";
import { useT } from "@/components/I18nProvider";

/**
 * Text pieces of the view language for what programs say: a diff (an edit's old and new text, or a unified patch, coloured), a terminal's output (dark,
 * folded under its command line), a spinner and a pill (a small rounded label: a state, a short reference). Generic: any plugin's view may show a change,
 * a command's output, that something is under way or how something stands.
 */
type A = Record<string, string>;

export function textBlock(t: string, a: A, key: string | number, run?: (a: A) => void) {
  switch (t) {
    case "pill":
      return <Pill key={key} a={a} run={run} />;
    case "diff":
      return a.patch !== undefined ? <Patch key={key} patch={a.patch} /> : <EditDiff key={key} old={a.old ?? ""} new={a.new ?? ""} />;
    case "terminal":
      return <Terminal key={key} a={a} />;
    case "spinner":
      return <span key={key} className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-500 align-[-2px] dark:border-zinc-700 dark:border-t-indigo-400" aria-hidden />;
    default:
      return undefined;
  }
}

/** shape=bare: only the dot has the tone's colour. */
const DOT: Record<string, string> = { run: "bg-indigo-500", plain: "bg-zinc-400", muted: "bg-zinc-400", off: "bg-zinc-300", done: "bg-emerald-500", bad: "bg-red-500", warn: "bg-amber-500" };
const PILL: Record<string, string> = {
  run: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  plain: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  muted: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  off: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  bad: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
};

/**
 * A small rounded label — how something stands (working, done, failed …) or a short reference (a branch, a todo): tone= its colour, dot=pulse|still|space
 * (a dot in its colour, pulsing; still; or its room kept so it doesn't shift), mono=true, tag= a smaller label inside it, caret=true a ▾, shape=tag (corners,
 * not round). With href= or state=/value= it is a link or sets the view's state (a menu opened); disabled=true.
 */
function Pill({ a, run }: { a: A; run?: (a: A) => void }) {
  const bare = a.shape === "bare";
  const cls = `inline-flex max-w-full shrink-0 items-center gap-1 text-xs whitespace-nowrap ${bare ? "gap-1.5 text-zinc-500" : a.shape === "tag" ? "rounded px-1.5 py-0.5" : "rounded-full px-2 py-px"} ${a.bold === "true" ? "font-medium" : ""} ${a.mono === "true" ? "font-mono" : ""} ${bare ? "" : (PILL[a.tone ?? "plain"] ?? PILL.plain)}`;
  const inner = (
    <>
      {a.dot && a.dot !== "none" && <span className={`size-1.5 shrink-0 rounded-full ${bare ? (DOT[a.tone ?? ""] ?? "bg-zinc-300") : "bg-current"} ${a.dot === "pulse" ? "animate-pulse" : a.dot === "space" ? "invisible" : ""}`} aria-hidden />}
      <span className="truncate">{a.label}</span>
      {a.tag && <span className="rounded bg-indigo-100 px-1 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{a.tag}</span>}
      {a.caret === "true" && <span aria-hidden>▾</span>}
    </>
  );
  if (a.href)
    return (
      <a href={a.href} title={a.tip || undefined} className={cls} style={a.width ? { maxWidth: Number(a.width) } : undefined}>
        {inner}
      </a>
    );
  if (a.state && run)
    return (
      <button type="button" title={a.tip || undefined} disabled={a.disabled === "true"} className={`${cls} hover:bg-zinc-200 disabled:cursor-default disabled:hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:disabled:hover:bg-zinc-800`} onClick={() => run({ ...a, action: "state" })}>
        {inner}
      </button>
    );
  return (
    <span title={a.tip || undefined} className={cls} style={a.width ? { maxWidth: Number(a.width) } : undefined}>
      {inner}
    </span>
  );
}

/** A command's output on a dark ground: with a title, folded under it (tone: its colour — warn amber, bad red); without, the output as it is. */
function Terminal({ a }: { a: A }) {
  const t = useT();
  const [open, setOpen] = useState(a.open === "true");
  const pre = (
    <pre tabIndex={0} className={`max-h-96 overflow-auto font-mono text-xs whitespace-pre-wrap text-zinc-300 ${a.title ? "mt-1" : ""}`}>
      {a.text || t("(no output)")}
    </pre>
  );
  if (!a.title) return <div className="rounded-lg bg-zinc-950 px-3 py-1.5">{pre}</div>;
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="rounded-lg bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-200">
      <summary className={`cursor-pointer ${a.tone === "bad" ? "text-red-300" : a.tone === "warn" ? "text-amber-300" : "text-zinc-300"}`}>{a.title}</summary>
      {pre}
    </details>
  );
}
