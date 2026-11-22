"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { VNode } from "../view-template";
import type { BlockEnv } from "./view-blocks";
import { SidebarFrame } from "@/components/SidebarFrame";
import { CopyButton } from "@/components/CopyButton";
import { TodoCheck } from "@/components/TodoCheck";
import { BookIcon, CalendarIcon, CheckIcon, ChevronIcon, CollapseIcon, ExpandIcon, PencilIcon, ClockIcon, CloseIcon, FlagIcon, NoteIcon, PaperclipIcon, SparkIcon, ToBottomIcon, ToTopIcon } from "@/components/icons";

/**
 * The view language's pieces for a list of things to do and a screen around it (view-template.ts): a page with a foldable sidebar
 * (<sidebarframe>), a card (<card>), a segmented switch with counts (<segmented>), a list of rows with a round tick box and a bar of
 * buttons that shows on hover (<checklist>, <checkrow>, <hoverbar>, <vrule>), icon buttons (<iconbtn>), pills (<pill>), lines of text
 * in a few looks (<line>, <ink>), a caption with a dot and a count (<caption>), a text you copy by a click (<copytext>), a framed panel
 * under a row (<inset>) and a search field with tokens and a list of hits under it (<searchfield>, <token>, <popover>, <option>).
 * Colours: the app's zinc, indigo and the tones — light and dark.
 */

type Node = Extract<VNode, object>;
type Kids = (nodes: VNode[]) => ReactNode;
const items = (n: Node) => n.c.filter((c): c is Node => typeof c !== "string");
const acts = (a: Record<string, string>) => !!(a.action || a.run || a.emit || a.href || a.do);

/** The tick box's row: how it stands out. */
const ROW_TONE: Record<string, string> = {
  ask: "bg-amber-50 ring-1 ring-amber-300 dark:bg-amber-950/40 dark:ring-amber-800",
  suggest: "bg-zinc-100/80 ring-1 ring-zinc-200 dark:bg-zinc-800/40 dark:ring-zinc-700",
  good: "bg-emerald-50 ring-1 ring-emerald-300 dark:bg-emerald-950/30 dark:ring-emerald-800",
  busy: "bg-indigo-50 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:ring-indigo-900",
  new: "bg-sky-50/80 ring-1 ring-sky-100 dark:bg-sky-950/30 dark:ring-sky-900/60",
  dim: "opacity-60 hover:bg-zinc-50 hover:opacity-100 dark:hover:bg-zinc-800/40",
  plain: "hover:bg-zinc-50 dark:hover:bg-zinc-800/40",
};

/** An action card's colour by what it does (lib/todos/op-look.ts's tones). */
const CARD_TONE: Record<string, { bar: string; bubble: string }> = {
  indigo: { bar: "border-l-indigo-400", bubble: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" },
  emerald: { bar: "border-l-emerald-400", bubble: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  sky: { bar: "border-l-sky-400", bubble: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
  violet: { bar: "border-l-violet-400", bubble: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  amber: { bar: "border-l-amber-400", bubble: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  zinc: { bar: "border-l-zinc-300", bubble: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
};

const LINE: Record<string, string> = {
  h1: "text-xl font-semibold tracking-tight",
  h2: "text-lg font-semibold",
  lead: "block leading-snug font-medium text-zinc-900 dark:text-zinc-100",
  struck: "block leading-snug text-zinc-400 line-through",
  aside: "block leading-snug text-zinc-600 italic dark:text-zinc-300",
  meta: "mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400",
  note: "block text-xs text-zinc-400",
  ask: "mt-1 block text-xs whitespace-pre-line text-amber-700 dark:text-amber-300",
  error: "mt-1 flex items-start gap-2 text-xs text-red-600 dark:text-red-400",
  caption: "text-xs font-semibold text-zinc-500 uppercase",
  heading: "text-sm font-semibold text-zinc-500 uppercase",
  small: "text-xs text-zinc-500",
  faint: "text-xs text-zinc-400",
  chips: "flex flex-wrap gap-1 text-[11px] text-zinc-500 max-sm:hidden dark:text-zinc-400",
  bar: "flex flex-wrap items-center gap-1.5 text-xs",
  tools: "flex flex-wrap items-center gap-2",
  between: "flex flex-wrap items-center justify-between gap-2",
  body: "max-w-[80ch] leading-relaxed whitespace-pre-line",
  bullets: "list-disc space-y-0.5 pl-5 text-sm text-zinc-700 dark:text-zinc-300",
  bullet: "list-item",
  empty: "text-sm text-zinc-500",
  plaque: "card p-6 text-center text-sm text-zinc-500",
  alert: "alert-error text-sm",
  mono: "flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-zinc-400",
  stack: "space-y-1",
  head: "flex flex-wrap items-start justify-between gap-x-3 gap-y-2",
  grow: "min-w-[12rem] flex-1 space-y-2",
  shrink: "max-w-full shrink-0",
  day: "flex items-center gap-2",
  run: "flex flex-wrap items-center gap-3",
  status: "inline-flex items-center gap-2 text-sm text-zinc-500",
  section: "space-y-1",
  header: "flex flex-wrap items-baseline gap-x-2 gap-y-0.5",
  strong: "font-medium",
  sub: "text-xs text-zinc-400",
  subnote: "mt-0.5 text-xs whitespace-pre-line text-zinc-500 dark:text-zinc-400",
  lines: "space-y-3",
  groups: "space-y-5",
  fold: "pt-1",
  block: "",
  toggles: "mt-2 flex flex-wrap items-center gap-1.5",
  opsbox: "relative mt-1.5 flex flex-col gap-1.5",
  plan: "mt-1.5 block space-y-0.5 border-l-2 border-zinc-200 pl-2 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400",
  draft: "block rounded-md bg-zinc-50 px-2.5 py-2 text-sm whitespace-pre-wrap text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200",
  suggested: "flex min-w-0 flex-1 items-start gap-1.5 rounded-md bg-violet-50 px-2 py-1 text-xs text-violet-800 dark:bg-violet-950/40 dark:text-violet-200",
  outcome: "text-xs text-red-600 dark:text-red-400",
  retry: "flex shrink-0 gap-1",
  groups4: "space-y-4",
  facts: "mt-1.5 space-y-1",
  fact: "flex items-baseline gap-2 text-xs text-zinc-600 dark:text-zinc-300",
  stepsnote: "border-b border-zinc-200 px-3 py-2.5 text-xs text-zinc-500 dark:border-zinc-800",
  warnline: "text-xs text-amber-700 dark:text-amber-400",
};

const INK: Record<string, string> = {
  bad: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
  good: "font-medium text-emerald-700 dark:text-emerald-400",
  accent: "text-violet-600 dark:text-violet-400",
  link: "font-medium text-indigo-600 hover:underline dark:text-indigo-400",
  mono: "font-mono text-indigo-700 not-italic hover:underline dark:text-indigo-300",
  code: "font-mono",
  faint: "text-zinc-400",
  muted: "text-zinc-500",
  strong: "font-bold",
  medium: "font-medium",
  chip: "rounded-md bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800",
  tag: "rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:bg-zinc-800 dark:text-zinc-300",
  label: "ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-500 uppercase dark:bg-zinc-800 dark:text-zinc-400",
  flag: "mr-1 inline-flex align-[-2px] text-red-600 dark:text-red-400",
  sign: "mr-1 font-bold text-amber-600 not-italic dark:text-amber-400",
  lead: "mr-1 not-italic",
  reveal: "opacity-0 transition group-hover:opacity-100 hover:text-zinc-600 hover:underline focus:opacity-100",
  time: "w-11 shrink-0 pt-px font-mono text-xs text-zinc-400 tabular-nums",
  event: "w-24 shrink-0 text-xs font-semibold",
  sky: "text-sky-600 dark:text-sky-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  violet: "text-violet-600 dark:text-violet-400",
  zinc: "text-zinc-500",
  ticket: "font-mono text-sm font-semibold text-indigo-700 dark:text-indigo-300",
  grow: "min-w-0 flex-1",
  push: "ml-auto",
  dot: "size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-amber-500",
  normal: "font-normal normal-case text-zinc-400",
  quiet: "text-xs text-zinc-400",
  warnline: "text-xs text-amber-700 dark:text-amber-400",
  danger: "text-xs font-medium text-red-600 hover:underline dark:text-red-400",
  pulse: "size-2 animate-pulse rounded-full bg-indigo-500",
  facttime: "w-10 shrink-0 font-mono text-zinc-400",
  factkind: "shrink-0 rounded px-1.5 py-0.5 text-xs font-medium",
  "fill-emerald": "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  "fill-zinc": "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  "fill-indigo": "bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200",
  "fill-sky": "bg-sky-50 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200",
  "fill-amber": "bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  "fill-orange": "bg-orange-50 text-orange-800 dark:bg-orange-950/60 dark:text-orange-200",
};

const PILL: Record<string, string> = {
  bad: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900",
  warn: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  plain: "bg-zinc-50 text-zinc-600 ring-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:ring-zinc-700",
  off: "bg-transparent text-zinc-400 ring-zinc-200 dark:ring-zinc-700",
};

function Glyph({ name }: { name: string }) {
  const s = "size-3.5";
  switch (name) {
    case "flag":
      return <FlagIcon />;
    case "flag-on":
      return <FlagIcon filled />;
    case "flag-sm":
      return <FlagIcon filled className="size-3.5" />;
    case "top":
      return <ToTopIcon />;
    case "bottom":
      return <ToBottomIcon />;
    case "clock":
      return <ClockIcon />;
    case "calendar":
      return <CalendarIcon />;
    case "close":
      return <CloseIcon />;
    case "book":
      return <BookIcon className={s} />;
    case "note":
      return <NoteIcon className={s} />;
    case "spark":
      return <SparkIcon className={s} />;
    case "clip":
      return <PaperclipIcon className={s} />;
    case "time":
      return (
        <svg viewBox="0 0 20 20" className={s} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 6v4l2.5 2" />
        </svg>
      );
    case "attach":
      return (
        <svg viewBox="0 0 20 20" className={s} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15.5 9.5 9.2 15.8a3.5 3.5 0 0 1-5-5l6.6-6.6a2.3 2.3 0 0 1 3.3 3.3l-6.6 6.6a1.1 1.1 0 0 1-1.6-1.6l6-6" />
        </svg>
      );
    case "reply":
      return (
        <svg viewBox="0 0 20 20" className={s} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M8 5 3 10l5 5" />
          <path d="M3 10h8a6 6 0 0 1 6 6v1" />
        </svg>
      );
    case "qr":
      return (
        <svg viewBox="0 0 20 20" className={s} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="5" height="5" />
          <rect x="12" y="3" width="5" height="5" />
          <rect x="3" y="12" width="5" height="5" />
          <path d="M12 12h2v2h-2zM15 15h2v2h-2z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "x":
      return <>×</>;
    case "tool-edit":
      return <PencilIcon className={s} />;
    case "pencil":
      return <PencilIcon className={s} />;
    case "check":
      return <CheckIcon className={s} />;
    case "close-sm":
      return <CloseIcon className={s} />;
    case "reopen":
      return (
        <svg viewBox="0 0 20 20" className={s} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 10a6 6 0 1 0 1.8-4.3" />
          <path d="M4 3.5V7h3.5" />
        </svg>
      );
    default:
      return <>{name}</>;
  }
}

/** A calendar button that opens the browser's date picker: the day picked goes to state.<bind>. */
function DatePick({ a, env }: { a: Record<string, string>; env: BlockEnv }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className="icon-btn"
        title={a.label || undefined}
        aria-label={a.label || undefined}
        onClick={() => {
          try {
            input.current?.showPicker();
          } catch {
            input.current?.focus();
          }
        }}
      >
        <CalendarIcon />
      </button>
      <input ref={input} type="date" key={env.state[a.bind] ?? ""} defaultValue={env.state[a.bind] || a.value || ""} max={a.max || undefined} onChange={(e) => e.target.value && env.setState(a.bind, e.target.value)} className="pointer-events-none absolute inset-0 opacity-0" tabIndex={-1} aria-hidden />
    </span>
  );
}

/** A fold-out: its label, what is inside under it once opened — kept open or closed in this browser (store=). */
function Fold({ a, children }: { a: Record<string, string>; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!a.store || !ref.current) return;
    try {
      const v = localStorage.getItem(`zeff:open:${a.store}`);
      if (v !== null) ref.current.open = v === "1";
    } catch {
      // as it is
    }
  }, [a.store]);
  const group = a.look === "group";
  return (
    <details
      ref={ref}
      open={a.open === "true" ? true : undefined}
      className={group ? "pt-1" : "text-sm"}
      onToggle={(e) => {
        if (!a.store) return;
        try {
          localStorage.setItem(`zeff:open:${a.store}`, e.currentTarget.open ? "1" : "0");
        } catch {
          // not kept
        }
      }}
    >
      <summary className={group ? "cursor-pointer px-3 text-xs font-semibold tracking-wide text-zinc-500" : "cursor-pointer text-xs text-zinc-500"}>{a.label}</summary>
      <div className={group ? "" : "mt-1.5"}>{children}</div>
    </details>
  );
}

/** A main button and, beside it, a chevron that opens what is inside (the steps it does, each on its own). */
function SplitButton({ a, kids, go }: { a: Record<string, string>; kids: () => ReactNode; go: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => root.current && !root.current.contains(e.target as globalThis.Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <div ref={root} className="relative flex">
      <button type="button" className="btn btn-primary rounded-r-none" disabled={a.disabled === "true"} title={a.tip || undefined} onClick={go}>
        {a.label}
      </button>
      <button type="button" className="btn btn-primary rounded-l-none border-l border-white/30 px-2" aria-haspopup="true" aria-expanded={open} title={a.menutip || undefined} onClick={() => setOpen(!open)}>
        <ChevronIcon className={`size-4 ${open ? "-rotate-90" : "rotate-90"}`} />
      </button>
      {open && <div className="absolute top-full left-0 z-50 mt-1 max-h-[70vh] w-[22rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">{kids()}</div>}
    </div>
  );
}

/** A search field with tokens before the text (the filters picked) and, under it, the hits (a <popover>). */
function SearchField({ a, n, kids, env }: { a: Record<string, string>; n: Node; kids: Kids; env: BlockEnv }) {
  const [v, setV] = useState(env.state[a.bind] ?? "");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const outer = env.state[a.bind] ?? "";
  const was = useRef(outer);
  useEffect(() => {
    if (outer !== was.current) (was.current = outer), setV(outer);
  }, [outer]);
  useEffect(() => {
    const t = setTimeout(() => v !== (env.state[a.bind] ?? "") && env.setState(a.bind, v), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- typing settles into the state
  }, [v]);
  useEffect(() => {
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as globalThis.Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);
  const tokens = n.c.filter((c) => typeof c === "string" || c.t !== "popover");
  const pop = items(n).filter((c) => c.t === "popover");
  return (
    <div ref={box} className="relative flex min-w-[16rem] flex-1 flex-wrap items-center gap-1 rounded-md border border-zinc-300 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-900" role="search">
      {kids(tokens)}
      <input
        value={v}
        onChange={(e) => (setV(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && a.enter) (e.preventDefault(), env.emitLater?.(a.enter), setV(""), setOpen(false));
          else if (e.key === "Escape") setOpen(false);
          else if (e.key === "Backspace" && !v && a.back) env.emitLater?.(a.back);
        }}
        placeholder={a.placeholder}
        className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-xs outline-none"
        aria-label={a.label || a.placeholder}
        aria-expanded={open}
        role="combobox"
      />
      {open && v.trim().length >= 2 && pop.length > 0 && (
        <ul role="listbox" className="absolute top-full left-0 z-30 mt-1 max-h-[60vh] w-full min-w-[22rem] overflow-auto rounded-lg border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900" onClick={() => (setOpen(false), setV(""))}>
          {kids(pop.flatMap((p) => p.c))}
        </ul>
      )}
    </div>
  );
}

/** A node of these blocks drawn — undefined: not one of them. */
export function listBlock(n: Node, key: string | number, kids0: Kids, env: BlockEnv): ReactNode | undefined {
  const a = n.a;
  // (What is inside these pieces flows as text: words and the pieces themselves side by side, not one line each.)
  const kids: Kids = (nodes) => nodes.map((c, i) => (typeof c === "string" ? c : <Fragment key={i}>{kids0([c])}</Fragment>));
  const go = (e?: React.SyntheticEvent) => (e?.stopPropagation(), env.run(a));
  switch (n.t) {
    case "sidebarframe": {
      const side = items(n).find((c) => c.t === "sidebar");
      const rest = n.c.filter((c) => c !== side);
      return (
        <SidebarFrame key={key} storageKey={a.store || "zeff-view-sidebar"} contentClassName="flex-col overflow-y-auto pr-1" sidebar={side ? kids(side.c) : null}>
          {kids(rest)}
        </SidebarFrame>
      );
    }
    case "sidebar":
      return <div key={key}>{kids(n.c)}</div>;
    case "card":
      return (
        <section key={key} className={`card ${a.gap === "2" ? "space-y-2" : "space-y-3"} p-4 ${a.flush === "phone" ? "max-sm:-mx-2 max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:shadow-none max-sm:dark:bg-transparent" : ""}`}>
          {kids(n.c)}
        </section>
      );
    case "segmented": {
      let opts: [string, string, string?][] = [];
      try {
        opts = JSON.parse(a.options || "[]");
      } catch {
        opts = [];
      }
      const cur = env.state[a.bind] ?? a.value ?? "";
      return (
        <div key={key} className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800/70" role="tablist" aria-label={a.label || undefined}>
          {opts.map(([v, label, count]) => (
            <button key={v} type="button" role="tab" aria-selected={cur === v} onClick={() => env.setState(a.bind, v)} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition ${cur === v ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>
              {label}
              {count !== undefined && count !== "" && <span className={`rounded-full px-1.5 text-xs tabular-nums ${cur === v ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" : "text-zinc-400"}`}>{count}</span>}
            </button>
          ))}
        </div>
      );
    }
    case "checklist":
      return (
        <ul key={key} className={a.spacing === "loose" ? "mt-1.5 space-y-1" : "space-y-0.5"}>
          {kids(n.c)}
        </ul>
      );
    case "checkrow": {
      const bar = items(n).filter((c) => c.t === "hoverbar");
      const rest = n.c.filter((c) => typeof c === "string" || c.t !== "hoverbar");
      const suggest = a.look === "suggest";
      const pinned = bar.some((b) => b.a.pin === "true");
      return (
        <li key={key} id={a.id || undefined} className={`group relative flex scroll-mt-24 items-start gap-3 rounded-lg px-3 py-2.5 transition-colors target:bg-amber-50 max-sm:flex-wrap max-sm:gap-y-1 dark:target:bg-amber-950/40 ${ROW_TONE[a.tone ?? "plain"] ?? ROW_TONE.plain}`} title={a.tip || undefined}>
          <span className="relative mt-px flex size-[18px] shrink-0">
            <TodoCheck
              className={`peer size-[18px] shrink-0 cursor-pointer appearance-none rounded-full border-[1.5px] bg-white transition hover:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-900 ${suggest ? "border-zinc-400 checked:border-zinc-400 checked:bg-zinc-400" : "border-zinc-300 checked:border-indigo-600 checked:bg-indigo-600 dark:border-zinc-600"}`}
              checked={a.checked === "true"}
              disabled={a.disabled === "true"}
              title={a.checktip || undefined}
              label={a.label ?? ""}
              onChange={() => (acts(a) ? env.run(a) : undefined)}
            />
            <svg viewBox="0 0 16 16" className="pointer-events-none absolute inset-0 m-auto size-3 text-white opacity-0 peer-checked:opacity-100" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m3.5 8.5 3 3 6-7" />
            </svg>
          </span>
          <div className="min-w-0 flex-1 text-sm">{kids(rest)}</div>
          {bar.length > 0 && (
            <div className={`ws-hoverbar absolute top-1.5 right-2 flex items-center gap-0.5 rounded-lg bg-white/95 p-0.5 shadow-sm ring-1 ring-zinc-200 backdrop-blur transition max-sm:static max-sm:order-last max-sm:ml-[30px] max-sm:basis-full max-sm:justify-start max-sm:bg-transparent max-sm:p-0 max-sm:shadow-none max-sm:ring-0 dark:bg-zinc-900/95 dark:ring-zinc-700 max-sm:[&>*]:!opacity-100 ${pinned ? "" : "sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-has-[:focus-visible]:pointer-events-auto sm:group-has-[:focus-visible]:opacity-100"}`}>
              {kids(bar.flatMap((b) => b.c))}
            </div>
          )}
        </li>
      );
    }
    case "datepick":
      return <DatePick key={key} a={a} env={env} />;
    case "fold":
      return (
        <Fold key={key} a={a}>
          {kids(n.c)}
        </Fold>
      );
    case "actioncard": {
      // An action as a card: an icon in the colour of what it does, its title and a quiet line, what it carries (a draft) below, the button that runs it
      // inside (<cardaction>) and small tools that show on hover (<cardtools>).
      const tools = items(n).filter((c) => c.t === "cardtools");
      const action = items(n).filter((c) => c.t === "cardaction");
      const rest = n.c.filter((c) => typeof c === "string" || (c.t !== "cardtools" && c.t !== "cardaction"));
      const tone = CARD_TONE[a.tone ?? "zinc"] ?? CARD_TONE.zinc;
      return (
        <span key={key} className={`group/op flex max-w-full min-w-0 flex-col gap-1.5 rounded-xl border border-l-4 border-zinc-200 bg-white px-3 py-2.5 shadow-sm transition hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900 ${tone.bar}`}>
          <span className="flex items-start gap-2.5">
            <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold ${tone.bubble}`} aria-hidden>
              {a.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm leading-snug font-medium break-words">{a.title}</span>
              {a.detail && <span className="mt-0.5 block text-xs break-words text-zinc-500 dark:text-zinc-400">{a.detail}</span>}
            </span>
            {tools.length > 0 && <span className="flex shrink-0 items-center gap-0.5 opacity-50 transition group-hover/op:opacity-100 focus-within:opacity-100">{kids(tools.flatMap((x) => x.c))}</span>}
          </span>
          {kids(rest)}
          {action.length > 0 && <span className="flex justify-end">{kids(action.flatMap((x) => x.c))}</span>}
        </span>
      );
    }
    case "cardtools":
    case "cardaction":
      return <span key={key}>{kids(n.c)}</span>;
    case "splitbutton":
      return <SplitButton key={key} a={a} kids={() => kids(n.c)} go={go} />;
    case "rows":
      return (
        <ul key={key} className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {kids(n.c)}
        </ul>
      );
    case "listrow":
      return (
        <li key={key} className={`flex items-start gap-2 py-1.5 text-sm ${a.tone === "new" ? "-mx-2 rounded bg-amber-50 px-2 dark:bg-amber-950/30" : ""}`}>
          {kids(n.c)}
        </li>
      );
    case "hoverbar":
      return <span key={key}>{kids(n.c)}</span>;
    case "vrule":
      return <span key={key} className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" aria-hidden />;
    case "iconbtn": {
      const small = a.size === "sm";
      const on = a.on === "true";
      const cls = small
        ? `relative inline-flex size-5 items-center justify-center rounded align-middle text-zinc-400 hover:bg-zinc-100 hover:text-indigo-600 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-indigo-400 ${on ? "bg-zinc-100 text-indigo-600 dark:bg-zinc-800 dark:text-indigo-400" : ""}`
        : `icon-btn ${a.glyph === "x" ? "text-base" : ""} ${on ? (a.tone === "bad" ? "text-red-600 opacity-100 dark:text-red-400" : "text-indigo-600 opacity-100 dark:text-indigo-400") : a.reveal === "true" ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" : ""}`;
      // grace="3.5": the click counts after that many seconds — meanwhile its row is struck through and the button reads undo= (taken back: nothing happened)
      if (a.grace) return <GraceButton key={key} a={a} cls={cls} run={() => env.run(a)} />;
      // (one that runs something: a small spinner in its place while it does — the click was taken)
      if (a.run || a.do) return <BusyIconButton key={key} a={a} cls={cls} run={() => env.run(a)} />;
      return (
        <button key={key} type="button" className={cls} title={a.tip || undefined} aria-label={a.label || a.tip || undefined} aria-pressed={a.pressed ? a.pressed === "true" : undefined} aria-expanded={a.expanded ? a.expanded === "true" : undefined} disabled={a.disabled === "true"} onClick={go}>
          <Glyph name={a.glyph ?? ""} />
          {a.dot === "true" && <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-500" aria-hidden />}
        </button>
      );
    }
    case "pill": {
      const cls =
        a.look === "area"
          ? `inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md border px-2 py-0.5 text-left text-xs font-medium transition ${a.on === "true" ? "border-zinc-300 bg-zinc-100 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100" : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"} ${a.tone === "violet" ? "[&_svg]:text-violet-600 dark:[&_svg]:text-violet-400" : a.tone === "emerald" ? "[&_svg]:text-emerald-600 dark:[&_svg]:text-emerald-400" : "[&_svg]:text-indigo-500 dark:[&_svg]:text-indigo-400"}`
          : a.look === "run"
            ? "btn btn-sm btn-primary shrink-0 rounded-full px-3.5 shadow-sm"
            : a.look === "open"
              ? "self-start rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-300 dark:hover:bg-sky-900"
          : a.look === "primary"
          ? "btn btn-primary"
          : a.look === "retry"
            ? "rounded border border-red-300 px-1.5 font-medium hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:hover:bg-red-950"
            : a.look === "hide"
              ? "rounded px-1.5 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950"
          : a.look === "filter"
          ? `rounded-full border px-2.5 py-0.5 ${a.on === "true" ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`
          : a.look === "ghost"
            ? "ml-0.5 rounded-full px-2 py-px text-zinc-400 opacity-0 ring-1 ring-zinc-200 ring-inset transition group-hover:opacity-100 hover:text-zinc-600 focus:opacity-100 dark:ring-zinc-700"
            : a.look === "shortcut"
              ? "rounded-full border border-violet-200 px-2 py-0.5 text-xs text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-900 dark:text-violet-300 dark:hover:bg-violet-950"
              : `ml-0.5 rounded-full px-2 py-px font-medium ring-1 ring-inset ${PILL[a.tone ?? "plain"] ?? PILL.plain} ${a.tone === "off" ? "" : "hover:brightness-95"}`;
      // (look=area: a toggle of a row's area — folded/unfolded marks before it, an icon of its kind; look=open with href: a link out)
      const mark = a.look === "area" ? (a.on === "true" ? <CollapseIcon className="size-3 !text-zinc-400" /> : <ExpandIcon className="size-3 !text-zinc-400" />) : null;
      const glyph = a.glyph ? <Glyph name={a.glyph} /> : null;
      if (a.href)
        return (
          <a key={key} href={a.href} target="_blank" rel="noreferrer" className={cls} title={a.tip || undefined}>
            {kids(n.c)}
          </a>
        );
      return acts(a) ? (
        <button key={key} type="button" className={cls} title={a.tip || undefined} disabled={a.disabled === "true"} aria-pressed={a.look === "filter" ? a.on === "true" : undefined} aria-expanded={a.look === "area" ? a.on === "true" : undefined} onClick={go}>
          {mark}
          {a.look === "area" ? <span>{kids(n.c)}</span> : kids(n.c)}
          {glyph}
        </button>
      ) : (
        <span key={key} className={cls} title={a.tip || undefined}>
          {kids(n.c)}
        </span>
      );
    }
    case "line": {
      const cls = LINE[a.look ?? "small"] ?? LINE.small;
      if (a.look === "bullets") return <ul key={key} className={cls}>{kids(n.c)}</ul>;
      if (a.look === "bullet") return <li key={key}>{kids(n.c)}</li>;
      const Tag = a.look === "h1" ? "h1" : a.look === "h2" ? "h2" : a.look === "heading" || a.look === "caption" ? "h3" : ["lead", "struck", "aside", "meta", "note", "ask", "error", "status"].includes(a.look ?? "") ? "span" : a.look === "body" || a.look === "empty" ? "p" : "div";
      return (
        <Tag key={key} className={cls} title={a.tip || undefined}>
          {kids(n.c)}
        </Tag>
      );
    }
    case "ink": {
      const cls = (a.tone ?? "").split(/\s+/).map((x) => INK[x] ?? "").join(" ");
      const glyph = a.glyph ? <Glyph name={a.glyph} /> : null;
      if (a.tone === "dot") return <span key={key} role="img" className={cls} aria-label={a.tip || undefined} />;
      if (a.href)
        return (
          <a key={key} href={a.href} className={cls} title={a.tip || undefined} {...(/^https?:/i.test(a.href) ? { target: "_blank", rel: "noreferrer" } : {})}>
            {glyph}
            {kids(n.c)}
          </a>
        );
      // hover="…": while its row is hovered it reads that instead and is the button (a "Dismissed" label that turns into "Reopen")
      if (acts(a) && a.hover && a.grace)
        return (
          <GraceInk key={key} a={a} cls={cls} run={() => env.run(a)}>
            {glyph}
            {kids(n.c)}
          </GraceInk>
        );
      if (acts(a) && a.hover)
        return (
          <button key={key} type="button" className={`${cls} hover:bg-indigo-50 hover:text-indigo-700 group-hover:text-indigo-700 dark:hover:bg-indigo-950/50 dark:group-hover:text-indigo-300`} title={a.tip || undefined} aria-label={a.hover} onClick={go}>
            {glyph}
            <span className="group-hover:hidden group-has-[:focus-visible]:hidden">{kids(n.c)}</span>
            <span className="hidden group-hover:inline group-has-[:focus-visible]:inline">{a.hover}</span>
          </button>
        );
      if (acts(a))
        return (
          <button key={key} type="button" className={`${cls} hover:underline`} title={a.tip || undefined} aria-label={a.label || undefined} onClick={go}>
            {glyph}
            {kids(n.c)}
          </button>
        );
      return (
        <span key={key} className={cls} title={a.tip || undefined}>
          {glyph}
          {kids(n.c)}
        </span>
      );
    }
    case "caption":
      return (
        <h2 key={key} className="mb-1 flex items-center gap-2 px-3 text-xs font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">
          {a.dot && <span className="size-1.5 rounded-full" style={{ background: a.dot }} aria-hidden />}
          <span className={a.tone === "bad" ? "text-red-600 dark:text-red-400" : undefined}>{kids(n.c)}</span>
          {a.n && <span className="font-normal text-zinc-400 tabular-nums">{a.n}</span>}
        </h2>
      );
    case "copytext":
      return (
        <CopyButton key={key} text={a.text ?? ""} title={a.tip || undefined} className="font-mono text-zinc-400 hover:text-indigo-600 hover:underline dark:hover:text-indigo-400">
          {a.label || a.text}
        </CopyButton>
      );
    case "inset":
      return (
        <div key={key} className={`mt-1.5 space-y-1.5 rounded-md border border-zinc-200 p-2 dark:border-zinc-700 ${a.small === "true" ? "text-xs" : ""}`}>
          {kids(n.c)}
        </div>
      );
    case "searchfield":
      return <SearchField key={key} a={a} n={n} kids={kids} env={env} />;
    case "token":
      return (
        <span key={key} className="inline-flex max-w-[16rem] items-center gap-1 rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100" title={a.tip || undefined}>
          {a.icon && <span aria-hidden>{a.icon}</span>}
          <span className="truncate">{a.label}</span>
          <button type="button" className="opacity-60 hover:opacity-100" aria-label={a.remove || "Remove"} onClick={go}>
            ×
          </button>
        </span>
      );
    case "popover":
      return null; // (drawn by its <searchfield>)
    case "optgroup":
      return (
        <li key={key} role="presentation" className="px-2 pt-1.5 pb-0.5 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
          {a.label}
        </li>
      );
    case "option":
      if (a.empty === "true") return <li key={key} className="px-3 py-2 text-xs text-zinc-500">{a.label}</li>;
      return (
        <li key={key} role="presentation">
          <button type="button" role="option" aria-selected={false} onClick={go} className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {a.icon && <span aria-hidden>{a.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{a.label}</span>
              {a.sub && <span className="block truncate text-xs text-zinc-500">{a.sub}</span>}
            </span>
            {a.meta && <span className="shrink-0 text-xs text-zinc-500 tabular-nums">{a.meta}</span>}
          </button>
        </li>
      );
    default:
      return undefined;
  }
}

/** The clicks that wait (grace=), by what they do: kept across a redraw of the list (new data arriving meanwhile), the timer going on. */
const graceWaiting = new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>();

/**
 * A click that waits (grace= seconds) before it counts — the row (the nearest list item) shows it at once: pending=strike (the
 * default) strikes it through, pending=unstrike takes its strike away (a todo reopened). Clicked again meanwhile: nothing happened.
 * A redraw meanwhile (the list's data refreshed) keeps the wait.
 */
function useGrace(a: Record<string, string>, run: () => void) {
  const id = `${a.run ?? a.do ?? a.action ?? ""}|${a.with ?? ""}|${a.value ?? ""}`;
  const [waiting, setWaiting] = useState(() => graceWaiting.has(id));
  const ref = useRef<HTMLButtonElement>(null);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
    const w = graceWaiting.get(id);
    if (w) w.run = run;
  });
  const cls = a.pending === "unstrike" ? "ws-pending-open" : "ws-pending";
  useEffect(() => {
    ref.current?.closest("li")?.classList.toggle(cls, waiting);
  }, [waiting, cls]);
  const ms = Math.max(0.5, Math.min(30, Number(a.grace) || 3.5)) * 1000;
  const click = (e: React.MouseEvent) => {
    e.stopPropagation();
    const w = graceWaiting.get(id);
    if (w) {
      clearTimeout(w.timer);
      graceWaiting.delete(id);
      setWaiting(false);
      return;
    }
    const entry = {
      run: runRef.current,
      timer: setTimeout(() => {
        graceWaiting.delete(id);
        entry.run();
      }, ms),
    };
    graceWaiting.set(id, entry);
    setWaiting(true);
  };
  return { waiting, click, ref };
}

const UNDO = "ws-undo inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-indigo-700 no-underline opacity-100 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-zinc-800";

/** An icon button whose click waits (useGrace): meanwhile it reads undo=. */
function GraceButton({ a, cls, run }: { a: Record<string, string>; cls: string; run: () => void }) {
  const { waiting, click, ref } = useGrace(a, run);
  if (waiting)
    return (
      <button ref={ref} type="button" onClick={click} className={UNDO}>
        {a.undo || "Undo"}
      </button>
    );
  return (
    <button ref={ref} type="button" className={cls} title={a.tip || undefined} aria-label={a.label || a.tip || undefined} disabled={a.disabled === "true"} onClick={click}>
      <Glyph name={a.glyph ?? ""} />
    </button>
  );
}

/** A label that turns into its button on the row's hover (ink hover=) and waits (useGrace): meanwhile it reads undo=. */
function GraceInk({ a, cls, run, children }: { a: Record<string, string>; cls: string; run: () => void; children: ReactNode }) {
  const { waiting, click, ref } = useGrace(a, run);
  if (waiting)
    return (
      <button ref={ref} type="button" onClick={click} className={UNDO}>
        {a.undo || "Undo"}
      </button>
    );
  return (
    <button ref={ref} type="button" className={`${cls} hover:bg-indigo-50 hover:text-indigo-700 group-hover:text-indigo-700 dark:hover:bg-indigo-950/50 dark:group-hover:text-indigo-300`} title={a.tip || undefined} aria-label={a.hover} onClick={click}>
      <span className="group-hover:hidden group-has-[:focus-visible]:hidden">{children}</span>
      <span className="hidden group-hover:inline group-has-[:focus-visible]:inline">{a.hover}</span>
    </button>
  );
}

/** An icon button that runs a flow: while it runs, a small spinner in its place (the click was taken — a slow first run shows it). */
function BusyIconButton({ a, cls, run }: { a: Record<string, string>; cls: string; run: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const click = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await run();
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={cls} title={a.tip || undefined} aria-label={a.label || a.tip || undefined} aria-pressed={a.pressed ? a.pressed === "true" : undefined} aria-busy={busy || undefined} disabled={a.disabled === "true"} onClick={click}>
      {busy ? <span className="zeff-spinner zeff-spinner-sweep inline-block size-3 text-indigo-500 dark:text-indigo-400 rounded-full border-2 border-zinc-300 border-t-indigo-500 dark:border-zinc-700 dark:border-t-indigo-400" aria-hidden /> : <Glyph name={a.glyph ?? ""} />}
      {!busy && a.dot === "true" && <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-500" aria-hidden />}
    </button>
  );
}
