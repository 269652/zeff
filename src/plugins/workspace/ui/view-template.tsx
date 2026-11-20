"use client";

import { confirmAction } from "@/components/confirm";
import { ComputeData } from "./compute-data";
import { GiroCode } from "@/components/GiroCode";
import { TimelineList } from "@/plugins/timeline/ui/TimelineList";
import { SourcesBlock } from "./sources-block";
import { SuggestedActions } from "./suggested";
import { KnowPanel } from "@/plugins/know/ui/KnowPanel";
import { ExtFrame } from "@/components/ext/ExtFrame";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLang, useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { formatNumber, type Labels, type Property, type Row } from "../model";
import type { ViewAppMeta } from "../view-apps";
import { navOf, renderView, viewDefaults, type ViewNavEntry, type VNode } from "../view-template";
import type { ActionEnv, AppViewProps, ViewAppModule } from "./app-view";
import { draw, Level, type DrawExt } from "./card-template";
import { ChannelLogo } from "@/components/ChannelLogo";
import { HoverCard } from "@/components/HoverCard";
import { toggleTaskAction } from "../actions";
import { askWorkspace } from "./chat-client";
import { WS_CHANGED } from "./ChatPanel";
import { TodoMark } from "./todo-mark";
import { Cell } from "./cells";
import { EmptyState, Sparkline, viewBlock } from "./view-blocks";
import { CheckBox, QrCode, SeriesChart, type SeriesPoint } from "./view-blocks-apps";
import { LookupField } from "./view-lookup";
import { AskBox, DossierBox } from "./view-notebook";
import { keysMatch } from "../view-keys";
import { themeStyle } from "../view-theme";
import { loadViewSettingsAction, saveViewSettingAction } from "../actions";
import { settingValue, type SettingDecl } from "../view-settings";
import { FlowData, reloadFlowData, runFlowButton, transitionButton, TransitionsBlock } from "./view-flows";
import { WidgetBlock } from "./widget-node";
import { useBlockDefs } from "./use-blocks";
import { AppWidget } from "./app-widget";
import { useWidgetOutputs } from "./use-outputs";
import { WidgetFrame } from "@/components/widgets/WidgetFrame";
import { ChatBox } from "./chat-box";
import { errorMessage, resultMessage } from "../widget-tell";
import { chatStartAction, chatTellAction, runFlowAction, runUserAction } from "../actions";
import { PackageUpdateNote } from "./package-update-note";
import { parseWith } from "../flows/with";
import type { BlockDef } from "../blocks";

/**
 * A view drawn from its template (view-template.ts): the nodes as this page's own components — tiles, tabs, lists, a table of cells,
 * charts, buttons that act on the rows, the app's parts and the plugins' widgets. The view's state (tabs, search, the row picked) lives
 * here; what the app loads (app.*) comes from its hook.
 */

type Props = AppViewProps & {
  src: string;
  onErrors?: (errors: { line: number; message: string }[]) => void;
  module: ViewAppModule;
  meta: ViewAppMeta;
  /** A row's own page: the row it is. */ current?: Row;
  /** Blocks drawn as given here instead of as saved (the Studio's preview of a block being edited). */ draftBlocks?: BlockDef[];
};

const TONE: Record<string, string> = { good: "text-emerald-700 dark:text-emerald-400", warn: "text-amber-700 dark:text-amber-400", bad: "text-red-600 dark:text-red-400", muted: "text-zinc-500" };
const BOX_TONE: Record<string, string> = { accent: "border-transparent bg-indigo-50 shadow-none dark:bg-indigo-950/40", muted: "bg-zinc-50 dark:bg-zinc-900/40", good: "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20", warn: "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20", bad: "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20" };
/** A button variant=chip by its tone. */
const CHIP_TONE: Record<string, string> = { plain: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200", good: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200", warn: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200", bad: "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-200" };
/** A tinted tile (tint=true): the colours of a report's status cards. */
const STAT_TONE: Record<string, { box: string; text: string }> = {
  bad: { box: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40", text: "text-red-700 dark:text-red-300" },
  warn: { box: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40", text: "text-amber-700 dark:text-amber-300" },
  good: { box: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-300" },
};
/** A status sign in a circle (a tile's mark): cross — a problem, info — a heads-up, check — all good; in the text's colour. */
function StatusMark({ kind, className = "" }: { kind: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`size-5 shrink-0 ${className}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      {kind === "cross" && <path d="M9 9l6 6M15 9l-6 6" />}
      {kind === "info" && <path d="M12 11v5M12 8h.01" />}
      {kind === "check" && <path d="M8.5 12.5l2.5 2.5 4.5-5" />}
    </svg>
  );
}
const CELL_TONE: Record<string, string> = {
  today: "bg-indigo-50 dark:bg-indigo-950/40",
  off: "bg-zinc-50 dark:bg-zinc-900/60",
  muted: "text-zinc-400 dark:text-zinc-500",
  good: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  warn: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  bad: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
};
const json = <T,>(s: string | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function TemplateView({ src, onErrors, module, meta, current, draftBlocks, ...props }: Props) {
  const t = useT();
  // (The template is written in English: in English there is nothing to look up.)
  const lang = useLang();
  const router = useRouter();
  const schema = props.data.schema;
  const defaults = useMemo(() => viewDefaults(src), [src]);
  // (what a <state keep=true> was left at, kept in this browser for this view: the view opens with it)
  const keepKey = `zeff:view-state:${props.data.id}:${props.view.id}`;
  const [own, setOwn] = useState<Record<string, string>>(() => {
    try {
      const saved = typeof window === "undefined" ? null : (JSON.parse(localStorage.getItem(keepKey) ?? "null") as unknown);
      return saved && typeof saved === "object" && !Array.isArray(saved) ? Object.fromEntries(Object.entries(saved).filter((e): e is [string, string] => typeof e[1] === "string")) : {};
    } catch {
      return {};
    }
  });
  // In the tree, the entry picked there (?nav=state=value) is the view's state — read with it, not set after it is drawn.
  const params = useSearchParams();
  const asked = params.get("nav");
  // ?s.<name>=<value>: the view's state set by the link (a search, a channel, a filter): /workspace/12?s.q=invoice&s.channel=Gmail.
  const fromLink = useMemo((): Record<string, string> => {
    const out: Record<string, string> = {};
    params.forEach((v, k) => {
      if (k.startsWith("s.") && /^[\p{L}_][\p{L}\p{N}_]*$/u.test(k.slice(2))) out[k.slice(2)] = v;
    });
    return out;
  }, [params]);
  const inTree = props.view.nav === "workspace";
  const fromTree = useMemo((): Record<string, string> => {
    const i = asked?.indexOf("=") ?? -1;
    return inTree && asked && i > 0 ? { [asked.slice(0, i)]: asked.slice(i + 1) } : {};
  }, [inTree, asked]);
  const state = useMemo(() => ({ ...defaults, ...fromLink, ...own, ...fromTree }), [defaults, fromLink, own, fromTree]);
  const setState = useCallback((name: string, value: string) => setOwn((s) => ({ ...s, [name]: value })), []);
  const app = module.useAppData(props, state);
  const saved = useBlockDefs();
  const blocks = useMemo(() => (draftBlocks?.length && saved ? [...saved.filter((b) => !draftBlocks.some((d) => d.name === b.name)), ...draftBlocks] : saved), [saved, draftBlocks]);
  const outputs = useWidgetOutputs();
  // The app's settings (<setting>, <settings/>): saved per database.
  const [settings, setSettings] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    void loadViewSettingsAction(props.data.id).then((x) => live && x.ok && setSettings(x.values));
    return () => {
      live = false;
    };
  }, [props.data.id]);
  // What flows gave (a <data>'s output, a button's into=): data.<name>.
  const [flowData, setFlowData] = useState<Record<string, unknown>>({});
  const setData = useCallback((_name: string, patch: Record<string, unknown>) => setFlowData((d) => ({ ...d, ...patch })), []);
  const labels: Labels = useMemo(() => ({ person: (id) => props.data.labels.people[id] ?? `#${id}`, page: (id) => props.data.labels.pages[id]?.title ?? `#${id}`, todo: (id) => props.data.labels.todos[id] ?? `T-${id}` }), [props.data.labels]);
  // What the rows' pages say (their first lines — a task ticked or not, a list's bullet): `text` in a row.
  const previews = props.data.extras?.previews;
  const texts = useMemo(() => Object.fromEntries(Object.entries(previews ?? {}).map(([id, lines]) => [id, lines.map((l) => (l.kind === "task" ? `${l.checked ? "☑" : "☐"} ${l.text}` : l.text)).join("\n")])), [previews]);
  // The time the view is drawn at: a <tick every=…> draws it again every so many seconds, now with it.
  const [nowAt, setNowAt] = useState(() => Date.now());
  const r = useMemo(
    () => renderView(src, { rows: props.rows, props: schema.properties, titleName: schema.titleName, state, app: app.data, data: flowData, db: { id: props.data.id, title: props.data.title }, labels, locale: typeof navigator !== "undefined" ? navigator.language : "de-DE", current, texts, outputs, settings, tr: lang === "en" ? undefined : t, now: new Date() }, { parts: meta.parts, actions: meta.actions, blocks }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nowAt: a <tick> draws it again (now is read inside)
    [src, props.rows, schema, state, app.data, flowData, props.data.id, props.data.title, labels, meta, current, texts, blocks, outputs, settings, lang, t, nowAt],
  );
  // <dialog reset="ee_, ec_">: the fields of a dialog start afresh whenever what opens it changes (another row, closed).
  const watched = useRef<Record<string, string>>({});
  const watchList = useMemo(() => {
    const out: { bind: string; reset: string; value: string }[] = [];
    const walk = (ns: VNode[]) => ns.forEach((n) => typeof n !== "string" && (n.t === "watch" && out.push({ bind: n.a.bind, reset: n.a.reset, value: n.a.value }), walk(n.c)));
    walk(r.nodes);
    return out;
  }, [r.nodes]);
  useEffect(() => {
    for (const w of watchList) {
      const was = watched.current[w.bind];
      watched.current[w.bind] = w.value;
      if (was === undefined || was === w.value) continue;
      const prefixes = w.reset.split(",").map((x) => x.trim()).filter(Boolean);
      setOwn((st) => Object.fromEntries(Object.entries(st).filter(([k]) => !prefixes.some((p) => k.startsWith(p)))));
    }
  }, [watchList]);
  // <state keep=true>: those names are kept in this browser for this view — written when they change, read when it opens (useState below).
  const kept = useMemo(() => {
    const names: string[] = [];
    const walk = (ns: VNode[]) => ns.forEach((n) => typeof n !== "string" && (n.t === "keep" && names.push(n.a.name), walk(n.c)));
    walk(r.nodes);
    return names.sort().join("\n");
  }, [r.nodes]);
  // <state keep=url>: those names are also in the address (?s.<name>=<value>, only when not the default) — a reload or a shared link opens the same place.
  const urlNames = useMemo(() => {
    const names: string[] = [];
    const walk = (ns: VNode[]) => ns.forEach((n) => typeof n !== "string" && (n.t === "keep" && n.a.url === "true" && names.push(n.a.name), walk(n.c)));
    walk(r.nodes);
    return names.sort().join("\n");
  }, [r.nodes]);
  const urlJson = useMemo(() => (urlNames ? JSON.stringify(Object.fromEntries(urlNames.split("\n").map((k) => [k, state[k] ?? ""]))) : ""), [urlNames, state]);
  useEffect(() => {
    if (!urlJson || typeof window === "undefined") return;
    try {
      const now = JSON.parse(urlJson) as Record<string, string>;
      const u = new URL(window.location.href);
      let changed = false;
      for (const [k, v] of Object.entries(now)) {
        const want = v !== "" && v !== (defaults[k] ?? "") ? v : null;
        const had = u.searchParams.get("s." + k);
        if (want === had) continue;
        changed = true;
        if (want === null) u.searchParams.delete("s." + k);
        else u.searchParams.set("s." + k, want);
      }
      if (changed) window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
    } catch {
      /* no address to write */
    }
  }, [urlJson, defaults]);
  const keptJson = useMemo(() => (kept ? JSON.stringify(Object.fromEntries(kept.split("\n").map((k) => [k, state[k] ?? ""]))) : ""), [kept, state]);
  useEffect(() => {
    if (!keptJson) return;
    try {
      localStorage.setItem(keepKey, keptJson);
    } catch {
      /* no storage: not kept */
    }
  }, [keptJson, keepKey]);
  const tickEvery = useMemo(() => {
    let every = 0;
    const walk = (ns: VNode[]) => ns.forEach((n) => typeof n !== "string" && (n.t === "tick" && (every = every ? Math.min(every, Number(n.a.every) || 1) : Number(n.a.every) || 1), walk(n.c)));
    walk(r.nodes);
    return every;
  }, [r.nodes]);
  useEffect(() => {
    if (!tickEvery) return;
    const id = setInterval(() => setNowAt(Date.now()), tickEvery * 1000);
    return () => clearInterval(id);
  }, [tickEvery]);
  // Its sidebar (a <nav>): beside the view — or, the view's setting, in the Workspace tree, whose entry picked (?nav=) sets the state.
  const nav = useMemo(() => navOf(r.nodes), [r.nodes]);
  const go = (e: ViewNavEntry) => (e.row ? props.openRow(e.row) : e.state ? setState(e.state, e.value ?? "") : e.href ? router.push(e.href) : undefined);

  // The toolbar's New, when the app takes it over: run with the view as it is at the click.
  const envRef = useRef<ActionEnv | null>(null);
  useEffect(() => {
    envRef.current = { props, state: r.state, setState, app: app.data, reloadApp: app.reload, rowId: null, attrs: {}, t };
  });
  const takeNew = props.onNew;
  const appNew = module.onNew;
  useEffect(() => {
    if (!takeNew || !appNew) return;
    takeNew(() => envRef.current && appNew(envRef.current));
    return () => takeNew(null);
  }, [takeNew, appNew]);
  const errKey = JSON.stringify(r.errors);
  useEffect(() => onErrors?.(JSON.parse(errKey)), [errKey, onErrors]);

  const byId = useMemo(() => new Map(props.rows.map((x) => [x.id, x])), [props.rows]);

  // Events and keys: the <on> handlers and the buttons with keys="…" of what is drawn now.
  const handlers = useMemo(() => {
    const out: Extract<VNode, object>[] = [];
    const walk = (ns: VNode[]) => ns.forEach((n) => typeof n !== "string" && ((n.t === "on" || (n.t === "button" && n.a.keys)) && out.push(n), walk(n.c)));
    walk(r.nodes);
    return out;
  }, [r.nodes]);
  const handlersRef = useRef(handlers);
  const runRef = useRef<(a: Record<string, string>) => Promise<void>>(async () => undefined);
  useEffect(() => {
    const keyed = handlers.filter((h) => h.a.keys);
    if (!keyed.length) return;
    const onKey = (e: KeyboardEvent) => {
      const hit = keyed.find((h) => keysMatch(h.a.keys, e));
      if (!hit) return;
      // Typing in a field (or on a focused button, which Enter presses itself): only combinations with Ctrl/⌘/Alt count.
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.tagName === "BUTTON" || el.isContentEditable);
      if (typing && !(e.ctrlKey || e.metaKey || e.altKey)) return;
      e.preventDefault();
      void runRef.current(hit.a);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
  const propOf = (id: string): Property | undefined => schema.properties.find((p) => p.id === id);

  /** What a button does (and the events it sends after it). */
  const run = async (a: Record<string, string>): Promise<void> => {
    await doRun(a);
    if (a.emit) await fire(a.emit);
  };
  const emitDepth = useRef(0);
  /** An event: every <on event=…> does its action (a handler may send events too — at most 8 deep). */
  const fire = async (event: string): Promise<void> => {
    if (emitDepth.current >= 8) return void toast(t("Events send each other too deep — stopped."), { tone: "error" });
    emitDepth.current++;
    try {
      for (const h of handlersRef.current) if (h.t === "on" && h.a.event === event) await run(h.a);
    } finally {
      emitDepth.current--;
    }
  };
  const doRun = async (a: Record<string, string>) => {
    if (a.confirm && !confirmAction(a.confirm)) return;
    const rowId = a.row ? Number(a.row) : null;
    const row = rowId ? byId.get(rowId) : undefined;
    const valueFor = (p: Property | undefined, v: string | undefined): unknown => {
      if (v === undefined) return null;
      if (!p) return v;
      if (p.type === "number") return v === "" ? null : Number(v);
      if (p.type === "checkbox") return v === "true";
      if (p.type === "multi_select" || p.type === "person" || p.type === "relation") return json(v, v ? [v] : []);
      return v;
    };
    try {
      switch (a.action) {
        case "new": {
          const id = await props.rowOps?.add(json<Record<string, unknown>>(a.values, {}));
          if (id) props.openRow(id);
          return;
        }
        case "open":
          return void (rowId && props.openRow(rowId));
        case "set":
          return void (rowId && a.prop && props.ctx?.set(rowId, a.prop, valueFor(propOf(a.prop), a.value)));
        case "toggle":
          return void (row && a.prop && props.ctx?.set(row.id, a.prop, row.cells[a.prop] !== true));
        case "delete":
          return void (rowId && (await props.rowOps?.remove(rowId)));
        case "duplicate":
          return void (rowId && (await props.rowOps?.duplicate(rowId)));
        case "hide":
          return void (rowId && props.rowOps?.hide(rowId));
        case "state":
          return void (a.state && setState(a.state, a.value ?? ""));
        case "pop": {
          if (!a.state) return;
          let list: unknown[] = [];
          try {
            const v: unknown = JSON.parse(r.state[a.state] || "[]");
            if (Array.isArray(v)) list = v;
          } catch {
            list = [];
          }
          return void (list.length && setState(a.state, JSON.stringify(list.slice(0, -1))));
        }
        case "pick": {
          // A value in or out of the list kept in a state (what <check> does for one box) — a chip picked, a filter taken off.
          if (!a.state) return;
          let list: string[] = [];
          try {
            const v: unknown = JSON.parse(r.state[a.state] || "[]");
            if (Array.isArray(v)) list = v.map(String);
          } catch {
            list = [];
          }
          const val = a.value ?? "";
          return void setState(a.state, JSON.stringify(list.includes(val) ? list.filter((x) => x !== val) : [...list, val]));
        }
        case "report": {
          // A <subview>'s result: as a code widget's zeff.report — its flow, and the chat it tells.
          const num = (v: string | undefined) => (v === undefined || v.trim() === "" || Number.isNaN(Number(v)) ? undefined : Number(v));
          return void (await reportWidget(a, { score: Math.max(0, Math.min(1, num(a.score) ?? 0)), correct: num(a.correct), total: num(a.total), note: a.feedback ?? "", done: a.finished === "true" }));
        }
        case "select":
          return void (rowId && setState(a.selkey || "selected", String(rowId)));
        case "url":
          // Zeff's own pages in place, a mail written in the mail program, anything else in a new tab.
          return void (a.href && (a.href.startsWith("/") ? router.push(a.href) : a.href.startsWith("mailto:") ? (window.location.href = a.href) : window.open(a.href, "_blank", "noopener")));
        case "say": {
          // Into a plugin's live chat: its running session hears it; a chat that has not begun begins with it. The <chat> box shows the rest.
          if (!a.chat || !a.key || !a.text?.trim()) return;
          const told = await chatTellAction(a.chat, a.key, a.text);
          if (!told.ok) return void toast(told.error, { tone: "error" });
          if (!told.runId) {
            const begun = await chatStartAction(a.chat, a.key, a.title || a.key, a.text);
            if (!begun.ok) return void toast(begun.error, { tone: "error" });
          }
          return;
        }
        case "assistant": {
          if (!a.request?.trim()) return;
          toast(t("The assistant is on it …"), { ms: 5000 });
          const r = await askWorkspace([{ role: "user", text: a.request }], props.data.id);
          props.reload();
          app.reload();
          return toast(r.ok ? r.reply || t("Done.") : r.error, { tone: r.ok ? "ok" : "error" });
        }
        case "run":
          return await runFlowButton(a, { row: rowId, setData, setState, reload: () => (props.reload(), app.reload()), t });
        case "do": {
          // One of Zeff's own actions, done by you (actions/flows.ts runUserAction): the row it stands in goes along as `row`.
          const r = await runUserAction(a.do, { ...(rowId ? { row: rowId } : {}), ...parseWith(a.with) });
          if (!r.ok) return void toast(r.error, { tone: "error" });
          // (what didn't work of it — a mail its server didn't archive — said as an error)
          const failed = (r.output as { failed?: unknown } | null)?.failed;
          if (Array.isArray(failed) && failed.length) toast(failed.map(String).join(" · "), { tone: "error" });
          if (a.into) setData(a.into, { [a.into]: r.output, [`${a.into}_status`]: "ok", [`${a.into}_error`]: null });
          // fill="body=text, to=to": fields of the answer into the view's state (a draft into the reply's boxes)
          const out = (r.output && typeof r.output === "object" ? r.output : {}) as Record<string, unknown>;
          for (const [k, field] of Object.entries(parseWith(a.fill))) setState(k, String(out[String(field)] ?? ""));
          // (a link it gives — a draft opened in Outlook — opens; what it did is said)
          if (typeof out.href === "string" && /^https?:\/\//.test(out.href)) window.open(out.href, "_blank", "noopener");
          else if (typeof out.href === "string" && out.href.startsWith("/workspace/")) router.push(out.href);
          else if (typeof out.what === "string" && out.what && !a.done) toast(out.what, { tone: "ok" });
          // (undo='{…}': the notice offers Undo — the same action with this input)
          const undo = a.undo ? () => void runUserAction(a.do, { ...(rowId ? { row: rowId } : {}), ...parseWith(a.undo) }).then((u) => (u.ok ? (props.reload(), app.reload()) : toast(u.error, { tone: "error" }))) : undefined;
          if (a.done) toast(a.done, { tone: "ok", ...(undo ? { action: { label: t("Undo"), run: undo } } : {}) });
          // (then="a=1; b=": states set after it worked)
          for (const pair of (a.then ?? "").split(";")) {
            const i = pair.indexOf("=");
            if (i > 0) setState(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
          }
          // (what it changed may be what a <data> reads — another database's rows: read again)
          reloadFlowData();
          props.reload();
          app.reload();
          return;
        }
        case "transition":
          return await transitionButton(a, { row: rowId, reload: () => (props.reload(), app.reload()), t });
        case "print":
          return window.print();
        case "reload":
          // (The flows read on the screen too — every <data>, the blocks beside this one on a page as well.)
          reloadFlowData();
          props.reload();
          return app.reload();
        default: {
          const fn = module.actions?.[a.action];
          if (fn) fn({ props, state, setState, app: app.data, reloadApp: app.reload, rowId, attrs: a, t });
        }
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: "error" });
    }
  };

  useEffect(() => {
    handlersRef.current = handlers;
    runRef.current = run;
  });

  // <on when="{{ … }}">: done each time its condition turns true (not when the view opens with it true).
  const wasTrue = useRef<Map<string, boolean> | null>(null);
  useEffect(() => {
    const seen = new Map<string, boolean>();
    handlers.forEach((h, i) => h.t === "on" && h.a.when !== undefined && seen.set(`${i}:${h.a.event ?? ""}:${h.a.action ?? ""}:${h.a.run ?? ""}:${h.a.do ?? ""}`, h.a.when === "true"));
    const before = wasTrue.current;
    wasTrue.current = seen;
    if (!before) return;
    handlers.forEach((h, i) => {
      const k = `${i}:${h.a.event ?? ""}:${h.a.action ?? ""}:${h.a.run ?? ""}:${h.a.do ?? ""}`;
      if (seen.get(k) && before.get(k) === false) void runRef.current(h.a);
    });
  }, [handlers]);

  /** What a code widget reports: the flow runs with the with= values and the result; its answer may carry a notice to show. */
  const reportWidget = async (a: Record<string, string>, r: { score: number; correct?: number; total?: number; note?: string; done?: boolean; answers?: { q: string; a: string; ok?: boolean }[]; snapshot?: string }) => {
    // The agent of the chat hears of it: at once when the exercise is over, else once the widget has been quiet.
    if (a.tell && a.tellkey) {
      const send = () => void chatTellAction(a.tell, a.tellkey, resultMessage(a.title || "", r, a.kind)).then((x) => (x.ok ? undefined : toast(x.error, { tone: "error" })));
      const id = `${a.tell}|${a.tellkey}|${a.title}`;
      clearTimeout(quiet.get(id));
      if (r.done) send();
      else quiet.set(id, setTimeout(send, 10_000));
    }
    if (!a.report) return;
    const res = await runFlowAction(a.report, { ...parseWith(a.with), score: r.score, correct: r.correct ?? null, total: r.total ?? null, note: r.note ?? "", done: r.done === true, answers: JSON.stringify(r.answers ?? []), snapshot: (r.snapshot ?? "").length <= 1_500_000 ? (r.snapshot ?? "") : "" }, current ? { row: current.id } : {});
    if (!res.ok) return void toast(res.error, { tone: "error" });
    if (res.status === "failed") return void toast(res.error ?? t("The flow failed."), { tone: "error" });
    const out = res.output as { notice?: unknown } | null;
    if (out && typeof out === "object" && typeof out.notice === "string" && out.notice) toast(out.notice, { tone: "ok" });
    props.reload();
    app.reload();
  };

  // A drop sets its state first; the event follows once the view has been drawn with it (the handlers read it).
  const [pending, setPending] = useState<{ event: string; id: number } | null>(null);
  const pendingSeq = useRef(0);
  useEffect(() => {
    if (pending) void fire(pending.event);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per drop
  }, [pending?.id]);

  const cols = (a: Record<string, string>): CSSProperties => {
    const n = Math.max(1, Math.min(8, Number(a.cols) || 3));
    const gap = (Number(a.gap) || 3) * 4;
    const min = Number(a.min) || 180;
    // (Fixed columns: only the characters of a track list — numbers, units, repeat(), minmax(), fr, auto, max-content.)
    if (a.tracks && /^[a-z0-9 .,()%-]{1,120}$/i.test(a.tracks)) return { gap, gridTemplateColumns: a.tracks, ...(Number(a.minw) > 0 ? { minWidth: Math.min(2000, Number(a.minw)) } : {}) };
    return { gap, gridTemplateColumns: `repeat(${a.keep === "true" ? "auto-fill" : "auto-fit"}, minmax(max(min(100%, ${min}px), calc((100% - ${(n - 1) * gap}px) / ${n})), 1fr))` };
  };

  const ext: DrawExt = (n, key, kids) => {
    const a = n.a;
    switch (n.t) {
      case "row":
      case "col": {
        // (A column of a fixed width — what follows it starts at the same place in every row; align=end puts its content at the
        // right edge, so a shorter one leaves room on its left.)
        if (n.t === "col" && Number(a.width) > 0) {
          const inner = draw({ ...n, a: { ...a, width: "" } }, key, ext);
          return (
            <div key={key} className="min-w-0 shrink-0" style={{ width: Math.min(800, Number(a.width)) }} title={a.tip || undefined}>
              {inner}
            </div>
          );
        }
        // dock=bottom: stays at the bottom of the pane while what is above it scrolls (a reply box). scroll=N: at most N% of the
        // screen's height, scrolling in itself — end=true: opened at its end, kept there as more comes (a chat's newest message).
        if (n.t === "col" && (a.dock === "bottom" || Number(a.scroll) > 0)) {
          const inner = draw({ ...n, a: { ...a, dock: "", scroll: "", end: "" } }, key, ext);
          if (a.dock === "bottom") return <div key={key} className="ws-reply-dock">{inner}</div>;
          return <ScrollBox key={key} vh={Math.min(90, Number(a.scroll))} end={a.end === "true"}>{inner}</ScrollBox>;
        }
        if (a.fill !== "true" && !a.tip && !a.max) return undefined;
        // (Taking the room left — and letting what is in it be cut to one line; max=70ch: not wider than that.)
        const inner = draw({ ...n, a: { ...a, fill: "", tip: "", max: "" } }, key, ext);
        const max = /^\d+(?:\.\d+)?(?:ch|px|rem|%)$/.test(a.max ?? "") ? a.max : undefined;
        return (
          <div key={key} className={a.fill === "true" ? "min-w-0 flex-1" : ""} style={max ? { maxWidth: max } : undefined} title={a.tip || undefined}>
            {inner}
          </div>
        );
      }
      case "truncate":
        return (
          <span key={key} className="block min-w-0 truncate" title={a.tip || undefined}>
            {kids(n.c)}
          </span>
        );
      case "strike":
        return (
          <s key={key} className="text-zinc-400">
            {kids(n.c)}
          </s>
        );
      case "mono":
        return (
          <span key={key} className="font-mono text-xs" title={a.tip || undefined}>
            {kids(n.c)}
          </span>
        );
      case "b":
      case "small":
      case "muted":
        if (!a.tip && !TONE[a.tone ?? ""] && a.normal !== "true") return undefined;
        return (
          <span key={key} title={a.tip || undefined} className={`${TONE[a.tone ?? ""] ?? ""} ${a.normal === "true" ? "block font-normal tracking-normal normal-case" : ""}`}>
            {draw({ ...n, a: { ...a, tip: "", tone: "", normal: "" } }, key, ext)}
          </span>
        );
      case "split": {
        // Two side by side (on a phone one under the other): in a ratio, or a side column of a fixed width.
        const w = Number(a.width) || 0;
        const fr: Record<string, string> = { "1:1": "1fr 1fr", "1:2": "1fr 2fr", "2:1": "2fr 1fr", "2:3": "2fr 3fr", "3:2": "3fr 2fr", "1:3": "1fr 3fr", "3:1": "3fr 1fr" };
        const columns = w ? (a.side === "left" ? `${w}px minmax(0,1fr)` : `minmax(0,1fr) ${w}px`) : (fr[a.ratio ?? ""] ?? "1fr 2fr").replace(/(\d)fr/g, "minmax(0,$1fr)");
        return (
          <div key={key} className="ws-split" style={{ "--split": columns, ...(Number(a.gap) > 0 ? { columnGap: Math.min(16, Number(a.gap)) * 4 } : {}) } as CSSProperties}>
            {n.c
              .filter((c) => typeof c !== "string" || c.trim())
              .map((c, i) => (
                // (sticky=true: the side column stays in view while the other one scrolls — a page's controls beside its content.)
                <div key={i} className={`min-w-0 ${a.sticky === "true" && i === (a.side === "left" ? 0 : 1) ? "self-start lg:sticky lg:top-0" : ""}`}>
                  {draw(c, i, ext)}
                </div>
              ))}
          </div>
        );
      }
      case "grid":
        // (masonry: the cells in columns of their own, each cell in the shortest — CSS columns balance the heights)
        if (a.masonry === "true") {
          const gap = (Number(a.gap) || 3) * 4;
          return (
            <div key={key} style={{ columnWidth: `${Number(a.min) || 280}px`, columnGap: gap, ...(Number(a.cols) ? { columnCount: Math.max(1, Math.min(8, Number(a.cols))) } : {}) }}>
              {n.c.map((c, i) => (
                <div key={i} className="min-w-0 break-inside-avoid" style={{ marginBottom: gap }}>
                  {draw(c, i, ext)}
                </div>
              ))}
            </div>
          );
        }
        const table = (
          <div key={key} className="grid" style={cols(a)}>
            {n.c.map((c, i) => (
              <div key={i} className="min-w-0">
                {draw(c, i, ext)}
              </div>
            ))}
          </div>
        );
        return a.tracks && Number(a.minw) > 0 ? <div key={key} className="overflow-x-auto">{table}</div> : table;
      case "section": {
        // (card=true: the section as a bordered card with a small grey heading — how a report's parts stand on a page.)
        const card = a.card === "true";
        const fold = a.collapsible === "true";
        const inner = fold ? (
          <Fold key={card ? undefined : key} title={a.title} aside={a.aside} note={a.note} dense={a.dense === "true"} quiet={a.quiet === "true"} framed={a.framed === "true"} open={a.open === "wide" ? "wide" : a.open !== "false"}>
            {/* (framed: its parts are lines, one under the other with a rule between them) */}
            <div className={a.framed === "true" ? "divide-y divide-zinc-100 text-sm dark:divide-zinc-800/60 [&>*]:px-3 [&>*]:py-1.5" : a.dense === "true" ? "space-y-0.5" : "space-y-3 pt-2"} style={scrolls(a)}>
              {kids(n.c)}
            </div>
          </Fold>
        ) : (
          <section key={card ? undefined : key} className="space-y-2 break-inside-avoid">
            {(a.title || a.aside) && (
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className={card ? `text-sm font-semibold tracking-wide uppercase ${a.tone === "warn" ? "text-amber-900 dark:text-amber-200" : "text-zinc-500 dark:text-zinc-400"}` : "text-sm font-semibold"}>{a.title}</h2>
                {a.aside && <span className="text-xs text-zinc-500">{a.aside}</span>}
              </div>
            )}
            <div className="space-y-3" style={scrolls(a)}>
              {kids(n.c)}
            </div>
          </section>
        );
        return card ? (
          <div key={key} className={`card min-w-0 p-4 ${a.tone === "warn" ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30" : ""}`}>
            {inner}
          </div>
        ) : (
          inner
        );
      }
      case "item": {
        const DOTS: Record<string, string> = { run: "bg-indigo-500 animate-pulse", queued: "bg-zinc-400", done: "bg-emerald-500", bad: "bg-red-500", off: "bg-zinc-300", warn: "bg-amber-500" };
        const menu = n.c.length > 0;
        return (
          <div key={key} className="group relative print:hidden">
            <button
              type="button"
              title={a.tip || undefined}
              onClick={(e) => (e.stopPropagation(), void run({ ...a, action: "state" }))}
              className={`flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-[5px] text-left text-[13px] leading-tight hover:bg-zinc-100 dark:hover:bg-zinc-800 ${a.selected === "true" ? "bg-indigo-50 font-medium dark:bg-indigo-950/50" : ""} ${a.dim === "true" ? "opacity-60" : ""}`}
            >
              {a.tone !== "none" && <span className={`size-1.5 shrink-0 rounded-full ${DOTS[a.tone ?? "off"] ?? DOTS.off}`} aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{a.label}</span>
              {a.sub && <span className="shrink-0 font-mono text-xs text-zinc-400">{a.sub}</span>}
              {a.meta && <span className={`w-7 shrink-0 text-right text-xs whitespace-nowrap text-zinc-400 ${menu ? "group-focus-within:invisible group-hover:invisible [@media(hover:none)]:invisible" : ""}`}>{a.meta}</span>}
            </button>
            {menu && <div className="absolute top-1/2 right-0.5 -translate-y-1/2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">{kids(n.c)}</div>}
          </div>
        );
      }
      case "scroller":
        return (
          <Scroller key={key} end={a.end === "true"} pad={a.pad === "true"} center={a.center === "true"}>
            {kids(n.c)}
          </Scroller>
        );
      case "dock":
        return (
          <div key={key} className={a.plain === "true" ? (a.edge === "top" ? "shrink-0 border-b border-zinc-200 pb-2.5 dark:border-zinc-800" : "max-h-[55%] shrink-0 overflow-y-auto overscroll-contain pt-2") : `shrink-0 bg-white px-4 py-3 dark:bg-zinc-900 ${a.edge === "top" ? "border-b" : "max-h-[55%] overflow-y-auto overscroll-contain border-t"} border-zinc-200 dark:border-zinc-800`}>
            {a.center === "true" ? <div className="mx-auto w-full max-w-3xl">{kids(n.c)}</div> : kids(n.c)}
          </div>
        );
      case "bubble":
        return <Bubble key={key} text={a.text ?? ""} note={a.note} end={a.end !== "false"} />;
      case "sheet":
        return (
          <div key={key} className="overflow-x-auto">
            <table className={`table ${a.compact === "true" ? "table-compact" : ""}`}>
              {a.caption && <caption className="sr-only">{a.caption}</caption>}
              {kids(n.c)}
            </table>
          </div>
        );
      case "shead":
        return <thead key={key}>{kids(n.c)}</thead>;
      case "sbody":
        return <tbody key={key}>{kids(n.c)}</tbody>;
      case "sfoot":
        return <tfoot key={key}>{kids(n.c)}</tfoot>;
      case "srow":
        return (
          <tr key={key} className={`${a.bold === "true" ? "font-semibold" : ""} ${a.tone === "bad" ? "text-red-600 dark:text-red-400" : a.tone === "good" ? "text-emerald-600 dark:text-emerald-400" : a.tone === "warn" ? "text-amber-600 dark:text-amber-400" : a.tone === "muted" ? "text-zinc-500" : ""} ${a.hover === "true" ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/40" : ""}`}>{kids(n.c)}</tr>
        );
      case "scell": {
        const cls = [
          a.num === "true" ? "num" : "",
          a.top === "true" ? "align-top" : "",
          a.dim === "true" ? "text-zinc-400 dark:text-zinc-500" : "",
          a.bold === "true" ? "font-semibold" : "",
          // (A row's head looks like the plain cell it stands for: the table style gives th a column-head look.)
          a.row === "true" ? "border-b border-zinc-100 px-3 py-2 text-left align-top text-sm font-[weight:inherit] tracking-normal text-inherit normal-case dark:border-zinc-800/60" : "",
          CELL_TONE[a.tone ?? ""] ?? "",
        ].join(" ");
        const span = Number(a.span) > 1 ? Math.min(12, Number(a.span)) : undefined;
        return a.head === "true" || a.row === "true" ? (
          <th key={key} scope={a.row === "true" ? "row" : "col"} colSpan={span} className={cls} title={a.tip || undefined}>
            {kids(n.c)}
          </th>
        ) : (
          <td key={key} colSpan={span} className={cls} title={a.tip || undefined}>
            {kids(n.c)}
          </td>
        );
      }
      case "subview":
        return (
          <div key={key} className="space-y-3" data-subview={a.title || undefined}>
            {kids(n.c)}
          </div>
        );
      case "box":
        // (A box with an action is what you click, like a button: a card that opens something.)
        const go = !!(a.action || a.run || a.emit || a.href);
        return (
          <div
            key={key}
            className={`${a.field === "true" ? "rounded-2xl border border-zinc-200 bg-white shadow-sm transition focus-within:border-indigo-400 focus-within:shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-indigo-500 pb-2 [&>.flex]:px-2.5" : a.dashed === "true" ? "space-y-3 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700" : a.dense === "true" ? "flex min-h-14 flex-col justify-between rounded-md border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-800 dark:bg-zinc-900" : "space-y-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900"} ${BOX_TONE[a.tone ?? ""] ?? ""} ${go ? "cursor-pointer transition hover:border-indigo-300 dark:hover:border-indigo-700" : ""}`}
            style={scrolls(a)}
            {...(go ? { role: "button", tabIndex: 0, title: a.tip || undefined, onClick: () => void run(a), onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), void run(a)) } : {})}
          >
            {a.title && <h3 className="text-sm font-semibold">{a.title}</h3>}
            {kids(n.c)}
          </div>
        );
      case "heading": {
        const cls = a.level === "1" ? "text-2xl font-semibold" : a.level === "3" ? "text-sm font-semibold" : "text-lg font-semibold";
        return (
          <div key={key} role="heading" aria-level={Number(a.level) || 2} className={cls}>
            {kids(n.c)}
          </div>
        );
      }
      case "text":
        return (
          <div key={key} className={`text-sm ${a.pre === "true" ? "whitespace-pre-line" : ""} ${TONE[a.tone ?? ""] ?? ""}`} title={a.tip || undefined}>
            {kids(n.c)}
          </div>
        );
      case "on":
      case "theme":
      case "tick":
      case "keep":
      case "watch":
        return null;
      case "check":
        return <CheckBox key={key} a={a} onChange={(v) => setState(a.bind, v)} />;
      case "media": {
        const h = Math.min(1200, Number(a.h) || 560);
        if (a.kind === "audio") return <audio key={key} src={a.src} controls className="w-full" aria-label={a.label || undefined} />;
        if (a.kind === "video") return <video key={key} src={a.src} controls className="w-full rounded-md bg-black" style={{ maxHeight: h }} aria-label={a.label || undefined} />;
        return <iframe key={key} src={a.src} title={a.label || "PDF"} className="w-full rounded-md border-0" style={{ height: h }} />;
      }
      case "frame": {
        const h = Math.min(1600, Number(a.h) || 560);
        if (a.plugin)
          return (
            <div key={key} style={{ height: h }}>
              <ExtFrame plugin={a.plugin} entry={a.entry} title={a.title} context={{ runId: Number(a.run) || undefined, ticket: a.ticket || undefined, todoId: Number(a.todo) || undefined }} />
            </div>
          );
        return <iframe key={key} src={a.src} title={a.title || "Preview"} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" className="w-full rounded-md border border-zinc-200 bg-white dark:border-zinc-800" style={{ height: h }} />;
      }
      case "qr":
        return <QrCode key={key} value={a.value} size={Number(a.size) || 160} label={a.label} />;
      case "chat":
        return (
          <ChatBox
            key={key}
            chat={a.chat}
            keyName={a.key}
            title={a.title || a.key}
            first={a.first || t("Let's begin.")}
            placeholder={a.placeholder || t("Your message …")}
            begin={a.begin || t("Start")}
            onGrew={() => (a.bump ? setState(a.bump, String(Number(r.state[a.bump] ?? 0) + 1)) : props.reload())}
            write={a.write === "true"}
            quiet={a.quiet === "true"}
          />
        );
      case "codewidget":
        return (
          <div key={key} style={a.height ? { minHeight: Math.min(1200, Number(a.height)) } : undefined}>
            <WidgetFrame
              html={a.html}
              libs={a.libs ? a.libs.split(",") : []}
              title={a.title || t("Widget")}
              errorNote={t("This widget hit a problem.")}
              onResult={(r) => void reportWidget(a, r)}
              onError={(m) => {
                if (a.fail) void runFlowAction(a.fail, { ...parseWith(a.with), message: m }, current ? { row: current.id } : {});
                if (a.tell && a.tellkey) void tellOnce(`${a.tell}|${a.tellkey}|${a.title}|${m}`, () => chatTellAction(a.tell, a.tellkey, errorMessage(a.title || "", m, a.kind)));
              }}
            />
          </div>
        );
      case "settings":
        return <SettingsForm key={key} title={a.title} decls={json<SettingDecl[]>(a.decls, [])} values={json<Record<string, string>>(a.values, {})} onSave={async (name, value, decl) => {
          const x = await saveViewSettingAction(props.data.id, name, value, { type: decl.type, options: decl.options });
          if (!x.ok) return void toast(x.error, { tone: "error" });
          setSettings(x.values);
        }} />;
      case "hover": {
        const card = n.c.filter((c): c is Exclude<VNode, string> => typeof c !== "string" && c.t === "hovercard");
        const rest = n.c.filter((c) => typeof c === "string" || c.t !== "hovercard");
        if (!card.length) return <span key={key}>{kids(rest)}</span>;
        return (
          <HoverCard key={key} width={Math.min(720, Number(a.width) || 420)} card={<div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-900">{kids(card.flatMap((c) => c.c))}</div>}>
            {kids(rest)}
          </HoverCard>
        );
      }
      case "drag":
        return (
          <div key={key} draggable title={a.tip || undefined} className="cursor-grab active:cursor-grabbing" onDragStart={(e) => (e.stopPropagation(), e.dataTransfer.setData("text/plain", `zeff-drag:${a.value ?? ""}`), (e.dataTransfer.effectAllowed = "move"))}>
            {kids(n.c)}
          </div>
        );
      case "drop":
        return <DropTarget key={key} a={a} onDropped={(v) => (setState(a.bind, v), a.emit && setPending({ event: a.emit, id: ++pendingSeq.current }))}>{kids(n.c)}</DropTarget>;
      case "suggested": {
        // The row's suggested actions — its "rowactions" (the AI's), when the row is one of this view's.
        const r = props.rows.find((x) => x.id === Number(a.row));
        const value = r?.cells.rowactions;
        return typeof value === "string" && value ? <SuggestedActions key={key} rowId={Number(a.row)} value={value} onDone={() => (props.reload(), app.reload())} /> : null;
      }
      case "sources":
        return <SourcesBlock key={key} refs={a.refs} open={a.open === "true"} />;
      case "rowtimeline":
        return <TimelineList key={key} row={Number(a.row)} limit={Number(a.limit) || 20} compact filters={false} title={a.title || undefined} hideWhenOff />;
      case "girocode": {
        // ("1.234,56" as you write it, or "1234.56")
        const raw = String(a.amount ?? "").trim();
        const amount = Number(raw.includes(",") ? raw.replace(/./g, "").replace(",", ".") : raw);
        return (
          <div key={key} className="max-w-sm pt-1">
            <GiroCode name={a.name ?? ""} iban={a.iban} bic={a.bic || null} amount={a.amount && Number.isFinite(amount) ? amount : null} purpose={a.purpose || null} />
          </div>
        );
      }
      case "know":
        return <KnowPanel key={key} row={Number(a.row)} compact={a.compact !== "false"} />;
      case "todomark":
        return <TodoMark key={key} mark={props.data.extras?.todoMarks?.[Number(a.row)]} />;
      case "data":
        // (compute=: a plugin's pure function in the browser — compute-data.tsx; else a flow's or a lambda's answer)
        if (a.compute) return <ComputeData key={key} a={a} setData={setData} rows={props.rows} props={schema.properties} state={state} extras={props.data.extras as Record<string, unknown> | undefined} />;
        return <FlowData key={key} a={a} setData={setData} row={current?.id} reload={props.reload} />;
      case "transitions":
        return <TransitionsBlock key={key} row={Number(a.row)} history={a.history === "true"} reload={props.reload} />;
      case "task": {
        // A box of a row's checklist: the n-th task of its page, ticked there.
        const rowId = Number(a.row);
        const index = (previews?.[rowId] ?? []).filter((l) => l.kind === "task")[Number(a.n)]?.index;
        return <TaskBox key={key} rowId={rowId} index={index} checked={a.checked === "true"} label={a.label ?? ""} editable={!!props.ctx?.editable} done={() => props.reload()} />;
      }
      case "tile": {
        // (tint=true: a report's status card — tinted by its tone, the value and the caption in the tone's colour, mark=cross|info|check its sign
        // in a circle at the top right; suffix: what follows the value in normal weight ("/ 38 h"); what is inside stands between value and caption.)
        const tint = a.tint === "true";
        const stat = tint ? STAT_TONE[a.tone ?? ""] : undefined;
        return (
          <div key={key} className={tint ? `card h-full px-4 py-3 ${stat ? stat.box : ""}` : "h-full rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-xs dark:border-zinc-800 dark:bg-zinc-900"} title={a.tip || undefined}>
            <div className={`flex ${tint ? "items-start" : "items-center"} justify-between gap-2 text-xs font-medium text-zinc-500 ${tint ? "uppercase" : ""}`}>
              <span className="truncate">{a.label}</span>
              {a.mark && <StatusMark kind={a.mark} className={stat?.text} />}
              {a.icon && <span aria-hidden>{a.icon}</span>}
            </div>
            {/* (A tile of content alone — a ring, a part — has no value line.) */}
            {(a.value !== undefined || a.spark || !n.c.length) && (
              <div className={tint ? "" : "mt-1 flex items-end justify-between gap-2"}>
                <div className={tint ? `text-2xl font-semibold tabular-nums ${stat?.text ?? TONE[a.tone ?? ""] ?? ""}` : `text-2xl leading-7 font-semibold tracking-tight tabular-nums ${TONE[a.tone ?? ""] ?? ""}`}>
                  {a.value || "—"}
                  {a.suffix && <span className={`font-normal ${stat ? "opacity-70" : "text-zinc-400"}`}> {a.suffix}</span>}
                </div>
                {a.spark && <Sparkline values={json<number[]>(a.spark, [])} />}
              </div>
            )}
            {a.trend && <div className={`mt-0.5 text-xs font-medium tabular-nums ${a.trend.startsWith("-") || a.trend.startsWith("−") ? TONE.bad : TONE.good}`}>{a.trend}</div>}
            {tint && n.c.length > 0 && <div>{n.c.map((c, i) => draw(c, i, ext))}</div>}
            {(a.sub || (!tint && n.c.length > 0)) && (
              <div className={tint ? `text-xs ${stat?.text ?? "text-zinc-500"}` : "mt-0.5 text-xs text-zinc-500"}>
                {a.sub}
                {!tint && n.c.length > 0 && <span className="inline">{n.c.map((c, i) => draw(c, i, ext))}</span>}
              </div>
            )}
          </div>
        );
      }
      case "badge":
        if (!a.tint) return undefined;
        return (
          <span key={key} className="badge badge-type" style={{ "--type-color": paint(a.tint) } as CSSProperties}>
            {kids(n.c)}
          </span>
        );
      case "dot":
        return <span key={key} className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: paint(a.color) }} aria-hidden />;
      case "bar": {
        if (!a.fill) return undefined;
        const value = Number(a.value) || 0;
        const max = Number(a.max) || 1;
        return (
          <span key={key} className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
            <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: paint(a.fill) }} />
          </span>
        );
      }
      case "printonly":
        return (
          <div key={key} className="hidden print:block">
            {kids(n.c)}
          </div>
        );
      case "noprint":
        return (
          <div key={key} className="print:hidden">
            {kids(n.c)}
          </div>
        );
      case "datatable": {
        const cols = json<{ label: string; align?: string; foot?: string; nowrap?: string; width?: string; sort?: string }[]>(a.cols, []);
        // (a column that can be sorted: its head a button — again: the other way; where it stands is the view's state)
        const [sortedCol, sortedDir] = (a.sorted ?? "").split(":");
        const sortBy = (i: number) => a.sortstate && setState(a.sortstate, `${i + 1}:${sortedCol === String(i + 1) && sortedDir !== "desc" ? "desc" : "asc"}`);
        const rows = n.c.filter((c): c is Extract<VNode, object> => typeof c !== "string");
        const align = (c: { align?: string }) => (c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left");
        if (!rows.length) return a.empty ? <p key={key} className="rounded-xl border border-dashed border-zinc-200 px-3 py-4 text-sm text-zinc-400 dark:border-zinc-800">{a.empty}</p> : null;
        return (
          // (On a phone each row a card — its first column the head, the others "label … value" — see .ws-datatable.)
          <div key={key} className="overflow-x-auto rounded-xl border border-zinc-200 max-sm:overflow-visible max-sm:border-0 dark:border-zinc-800 print:overflow-visible print:rounded-none print:border-0">
            <table className="ws-datatable w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:bg-zinc-900/60">
                  {cols.map((c, i) => (
                    <th key={i} className={`px-3 py-2 ${align(c)} ${c.nowrap === "true" ? "whitespace-nowrap" : ""}`} style={c.width ? { width: Number(c.width) } : undefined} aria-sort={sortedCol === String(i + 1) ? (sortedDir === "desc" ? "descending" : "ascending") : undefined}>
                      {c.sort === "true" ? (
                        <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => sortBy(i)}>
                          {c.label}
                          <span aria-hidden className={sortedCol === String(i + 1) ? "text-indigo-600 dark:text-indigo-400" : "opacity-30"}>{sortedCol === String(i + 1) && sortedDir === "desc" ? "↓" : "↑"}</span>
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows.map((tr, ri) => (
                  <tr key={tr.a.row ?? ri} className="group align-top transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40">
                    {tr.c.map((td, ci) => (
                      <td key={ci} data-label={cols[ci]?.label || undefined} className={`px-3 py-3 ${align(cols[ci] ?? {})} ${cols[ci]?.nowrap === "true" ? "whitespace-nowrap" : ""}`}>
                        {typeof td === "string" ? td : <div className={`flex flex-col gap-0.5 ${cols[ci]?.align === "right" ? "items-end" : ""}`}><Level nodes={td.c} ext={ext} /></div>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {cols.some((c) => c.foot) && (
                <tfoot>
                  <tr className="border-t border-zinc-200 bg-zinc-50 font-semibold dark:border-zinc-800 dark:bg-zinc-900/60">
                    {cols.map((c, i) => (
                      <td key={i} data-label={i > 0 && c.foot ? c.label || undefined : undefined} className={`px-3 py-2.5 whitespace-nowrap tabular-nums ${align(c)} ${c.foot ? "" : "max-sm:hidden"}`}>
                        {c.foot}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        );
      }
      case "tabs": {
        const opts = json<[string, string, string?][]>(a.options, []);
        return (
          <div key={key} className={a.look === "line" ? "flex flex-wrap gap-1 border-b border-zinc-200 print:hidden dark:border-zinc-800" : "inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 print:hidden dark:bg-zinc-800/70"} role="tablist">
            {opts.map(([v, label, count]) => {
              // A label "logo-<channel> Name": the channel's mark alone, its name the tab's tooltip and accessible name.
              const logo = /^logo-(\S+)\s+(.*)$/.exec(label);
              return (
              <button key={v} type="button" role="tab" aria-selected={a.current === v} aria-label={logo ? `${logo[2]}${count ? ` (${count})` : ""}` : undefined} title={logo?.[2]} className={a.look === "line" ? `-mb-px inline-flex items-center border-b-2 px-3 py-1.5 text-sm ${a.current === v ? "border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}` : `inline-flex items-center rounded-md px-3 py-1 text-sm font-medium transition ${a.current === v ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`} onClick={() => setState(a.bind, v)}>
                {logo ? <ChannelLogo name={logo[1]} className="size-[18px]" /> : label}
                {count !== undefined && <span className="ml-1 text-xs font-normal text-zinc-400 tabular-nums">{count}</span>}
              </button>
              );
            })}
          </div>
        );
      }
      case "select": {
        const opts = json<[string, string, string?][]>(a.options, []);
        // (emit=: what the view does with the value picked, at once — a status saved)
        const picked = (v: string) => (setState(a.bind, v), a.emit && setPending({ event: a.emit, id: ++pendingSeq.current }));
        const stack = a.stack === "true";
        if (a.search === "true") {
          const box = <SearchSelect key={key} options={opts} value={a.current ?? ""} label={a.label} onPick={picked} />;
          return stack && a.label ? (
            <label key={key} className="flex w-full flex-col gap-1 text-sm print:hidden">
              <span className="label mb-0">{a.label}</span>
              {box}
            </label>
          ) : (
            box
          );
        }
        return (
          <label key={key} className={stack ? "flex w-full flex-col gap-1 text-sm print:hidden" : "inline-flex items-center gap-1.5 text-sm print:hidden"}>
            {a.label && <span className={stack ? "label mb-0" : "text-xs text-zinc-500"}>{a.label}</span>}
            <select className={`input text-sm ${stack ? "w-full" : "w-auto py-1"}`} value={a.current} onChange={(e) => picked(e.target.value)}>
              {opts.map(([v, label, count]) => (
                <option key={v} value={v}>
                  {label}
                  {count !== undefined ? ` (${count})` : ""}
                </option>
              ))}
            </select>
          </label>
        );
      }
      case "search":
        return <input key={key} type="search" className="input w-44 py-1 text-sm print:hidden" placeholder={a.placeholder ?? t("Search …")} aria-label={a.placeholder ?? t("Search")} value={a.current} onChange={(e) => setState(a.bind, e.target.value)} />;
      case "ask":
        return <AskBox key={key} a={a} dbId={props.data.id} openRow={props.openRow} />;
      case "dossier":
        return <DossierBox key={key} a={a} dbId={props.data.id} rowsKey={props.rows.map((x) => `${x.id}:${x.updatedAt}`).join()} />;
      case "logo":
        return <ChannelLogo key={key} name={a.name ?? ""} className={a.size === "lg" ? "size-5" : "size-4"} />;
      case "lookup":
        return <LookupField key={key} a={a} dbId={props.data.id} reload={props.reload} openRow={props.openRow} />;
      case "toggle":
        return (
          <label key={key} className="inline-flex items-center gap-1.5 text-sm print:hidden">
            <input type="checkbox" className="accent-indigo-600" checked={a.current === "true"} onChange={(e) => setState(a.bind, e.target.checked ? "true" : "")} />
            {a.label}
          </label>
        );
      case "list":
      case "cards": {
        const items = n.c.filter((c): c is Extract<VNode, object> => typeof c !== "string");
        if (!items.length) return a.empty ? <EmptyState key={key} text={a.empty} /> : null;
        const selkey = a.selkey || "selected";
        const active = (it: Extract<VNode, object>) => it.a.row && it.a.row === r.state[selkey];
        const click = (it: Extract<VNode, object>) => (it.a.row ? () => (a.select === "true" ? setState(selkey, it.a.row) : a.open === "true" ? props.openRow(Number(it.a.row)) : undefined) : undefined);
        const clickable = a.select === "true" || a.open === "true";
        if (n.t === "cards")
          return (
            <div key={key} className="grid" style={cols({ cols: a.cols ?? "3", min: "200" })}>
              {items.map((it, i) => (
                <div key={it.a.row ?? i} className={`min-w-0 rounded-xl border bg-white p-3 text-sm shadow-xs transition dark:bg-zinc-900 ${active(it) ? "border-indigo-400 ring-2 ring-indigo-200 dark:ring-indigo-900" : "border-zinc-200 dark:border-zinc-800"} ${clickable ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md" : ""}`} onClick={click(it)}>
                  <div className="flex flex-col gap-1">{kids(it.c)}</div>
                </div>
              ))}
            </div>
          );
        // grid="max-content minmax(0,70ch) 1fr max-content": the rows share one grid — each column as wide as its widest
        // cell in any row; an item's one <row> gives its parts as the cells.
        const template = /^[\w\s().,%-]+$/.test(a.grid ?? "") ? a.grid : "";
        if (template)
          return (
            // (On a phone one column: the cells of a row one under the other.)
            <ul key={key} className="ws-list-grid grid divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800" style={{ "--cols": template } as CSSProperties}>
              {items.map((it, i) => {
                const parts = it.c.filter((c) => typeof c !== "string" || c.trim());
                const one = parts.length === 1 && typeof parts[0] !== "string" && parts[0].t === "row" ? parts[0] : null;
                const cells = one ? one.c.filter((c) => typeof c !== "string" || c.trim()) : parts;
                return (
                  <li
                    key={it.a.row ?? i}
                    className={`col-span-full grid items-start ${a.spacing === "roomy" ? "px-4 py-3" : "px-3 py-2"} text-sm ${active(it) ? "bg-indigo-50/70 dark:bg-indigo-950/40" : ""} ${clickable ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50" : ""}`}
                    style={{ gridTemplateColumns: "subgrid", columnGap: one ? (Number(one.a.gap) || 3) * 4 : 12, rowGap: 6 }}
                    onClick={click(it)}
                  >
                    {kids(cells)}
                  </li>
                );
              })}
            </ul>
          );
        return (
          <ul key={key} className="ws-list divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {items.map((it, i) => (
              <li key={it.a.row ?? i} className={`${a.spacing === "roomy" ? "px-4 py-3" : "px-3 py-2"} text-sm ${active(it) ? "bg-indigo-50/70 dark:bg-indigo-950/40" : ""} ${clickable ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50" : ""}`} onClick={click(it)}>
                <div className={`flex flex-col ${a.spacing === "roomy" ? "gap-2" : "gap-1"}`}>{kids(it.c)}</div>
              </li>
            ))}
          </ul>
        );
      }
      case "table":
        return <RowsTable key={key} columns={json<string[]>(a.columns, [])} rows={json<number[]>(a.rows, []).map((id) => byId.get(id)).filter((x): x is Row => !!x)} sum={a.sum} empty={a.empty} props={props} />;
      case "chart":
        // (series=: a part per value of a second field — stacked, or a line each)
        if (a.series) return <SeriesChart key={key} kind={a.kind} data={json<SeriesPoint[]>(a.data, [])} series={json<{ name: string; color?: string }[]>(a.series, [])} />;
        return <MiniChart key={key} kind={a.kind} data={json<{ label: string; value: number; color?: string }[]>(a.data, [])} />;
      case "selected":
        return (
          <div key={key} className="space-y-2">
            {kids(n.c)}
          </div>
        );
      case "button": {
        // A label that is only a sign (‹ ›): its tip is the button's name, and it is wide enough to hit (24 px).
        const sign = !!a.label && !/\p{L}/u.test(a.label);
        const variant = a.variant === "send" ? "ml-auto grid size-8 shrink-0 place-items-center rounded-full bg-zinc-900 text-white transition hover:bg-zinc-700 disabled:bg-zinc-200 disabled:text-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600" : a.variant === "link" ? "truncate text-left font-medium hover:underline" : a.variant === "primary" ? "btn btn-primary btn-sm" : a.variant === "danger" ? "btn btn-sm btn-danger" // (chip: a small coloured label that is a button — a week in a card, green when booked, red when hours are missing)
          : a.variant === "chip" ? `rounded px-1.5 py-0.5 text-xs font-medium tabular-nums hover:brightness-95 dark:hover:brightness-125 ${CHIP_TONE[a.tone ?? ""] ?? CHIP_TONE.plain}`
          : a.variant === "quiet" ? "rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800" : "btn btn-sm";
        return (
          <button
            key={key}
            type="button"
            disabled={a.disabled === "true"}
            title={a.tip || (a.keys ? `${a.label ?? a.action} (${a.keys})` : undefined)}
            aria-keyshortcuts={a.keys || undefined}
            aria-label={sign && a.tip ? a.tip : undefined}
            className={`${a.size === "md" ? variant.replace(" btn-sm", "").replace("btn-sm ", "") : variant} ${sign ? "min-w-7 justify-center" : ""} ${a.wide === "true" ? "w-full justify-center" : ""} ${a.print === "true" ? "" : "print:hidden"} ${a.action === "print" ? "max-sm:hidden" : ""}`}
            onClick={(e) => (e.stopPropagation(), void run(a))}
          >
            {a.icon && <span aria-hidden>{a.icon}</span>}
            {a.label ?? a.action}
          </button>
        );
      }
      case "field": {
        const row = byId.get(Number(a.row));
        const p = propOf(a.prop);
        if (!row || !p || !props.ctx) return null;
        return (
          <span key={key} className="inline-flex min-w-24 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <span className="text-xs text-zinc-500">{p.name}</span>
            <Cell p={p} row={row} ctx={props.ctx} className="rounded-md" />
          </span>
        );
      }
      case "part": {
        const { name, row: rowAttr, ...attrs } = a;
        const Part = module.parts[name];
        if (!Part) return null;
        return <Part key={key} {...props} attrs={attrs} state={r.state} setState={setState} app={app.data} reloadApp={app.reload} rowId={rowAttr ? Number(rowAttr) : null}>{n.c.length ? kids(n.c) : undefined}</Part>;
      }
      case "nav":
      case "entry":
        return null; // (drawn beside the view, below — or in the tree)
      case "appwidget":
        return <BlockWidget key={key} block={a.block} params={a.params} title={a.title} height={a.height ? Number(a.height) : undefined} pageId={props.data.id} />;
      case "widget": {
        const { id, title, ...config } = a;
        const conf = Object.fromEntries(Object.entries(config).map(([k, v]) => [k, /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === "true" ? true : v === "false" ? false : v]));
        return <WidgetBlock key={key} id={id} config={conf} title={title} />;
      }
      default:
        return viewBlock(n, key, kids, { props, state: r.state, setState, run: (x) => void run(x), emitLater: (event) => setPending({ event, id: ++pendingSeq.current }) });
    }
  };

  const theme = themeStyle(findTheme(r.nodes) ?? {});
  // (A <data> showing its last answer while the new one is on its way: a thin line at the top says so — it takes no room, so nothing jumps.)
  const refreshing = Object.keys(flowData).some((k) => k.endsWith("_status") && (flowData[k] === "stale" || flowData[k] === "loading") && flowData[k.slice(0, -7)] != null);
  const refreshLine = refreshing ? <div aria-hidden className="ws-refresh pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-full bg-indigo-500/10 print:hidden"><div className="ws-refresh-bar h-full w-1/3 rounded-full bg-indigo-500/50" /></div> : null;
  if (nav && !inTree && props.view.nav !== "off")
    return (
      <div className="relative flex flex-col gap-5 md:flex-row md:items-start" data-print-root style={theme as CSSProperties}>
        {refreshLine}
        <ViewNav title={nav.title} entries={nav.entries} active={(e) => (e.state ? (r.state[e.state] ?? "") === (e.value ?? "") : false)} onPick={go} />
        <div className="min-w-0 flex-1 space-y-5">
          {!onErrors && <PackageUpdateNote dbId={props.data.id} reload={props.reload} />}
          <Level nodes={r.nodes} ext={ext} />
        </div>
      </div>
    );
  return (
    <div className="relative space-y-5" data-print-root style={theme as CSSProperties}>
      {refreshLine}
      {!onErrors && <PackageUpdateNote dbId={props.data.id} reload={props.reload} />}
      {!onErrors && r.errors.length > 0 && <TemplateTrouble errors={r.errors} view={props.view.name} dbId={props.data.id} dbTitle={props.data.title} reload={props.reload} />}
      <Level nodes={r.nodes} ext={ext} />
    </div>
  );
}

/** A block that is a widget (blocks.ts): its code in the frame, the block's parameters as zeff.context.params. */
/** A column that scrolls in itself (<col scroll=60>) — with end=true opened at its end and kept there as more comes (a chat). */
function ScrollBox({ vh, end, children }: { vh: number; end: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const size = useRef(0);
  useEffect(() => {
    const el = box.current;
    if (!el || !end || el.scrollHeight === size.current) return;
    size.current = el.scrollHeight;
    el.scrollTop = el.scrollHeight;
  });
  return (
    <div ref={box} className="min-h-0 overflow-y-auto" style={{ maxHeight: `${vh}vh` }}>
      {children}
    </div>
  );
}

function BlockWidget({ block, params, title, height, pageId }: { block: string; params: string; title: string; height?: number; pageId: number | null }) {
  const t = useT();
  const defs = useBlockDefs();
  const def = defs?.find((b) => b.name === block);
  const parsed = useMemo(() => {
    try {
      return JSON.parse(params) as unknown;
    } catch {
      return {};
    }
  }, [params]);
  if (!def?.widget) return defs ? <p className="text-sm text-red-600">{t("There is no widget block “{name}”.", { name: block })}</p> : null;
  const w = def.widget;
  return (
    <div style={height || w.height ? { minHeight: height ?? w.height } : undefined}>
      <AppWidget html={w.html} libs={w.libs} title={title} wants={{ writes: w.writes, ai: w.ai, flows: w.flows }} pageId={pageId} params={parsed} />
    </div>
  );
}

/** A view's sidebar: its entries (under their headings), the one picked marked, a count on the right. */
function ViewNav({ title, entries, active, onPick }: { title: string; entries: ViewNavEntry[]; active: (e: ViewNavEntry) => boolean; onPick: (e: ViewNavEntry) => void }) {
  return (
    <nav className="w-full shrink-0 md:sticky md:top-2 md:w-56 print:hidden">
      {title && <div className="px-2 pb-1 text-xs font-semibold tracking-wide text-zinc-400 uppercase">{title}</div>}
      <ul className="space-y-0.5">
        {entries.map((e, i) => {
          // A heading where a group starts.
          const heading = e.group && e.group !== entries.slice(0, i).findLast((x) => x.group)?.group ? e.group : "";
          const on = active(e);
          return (
            <li key={e.id}>
              {heading && <div className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">{heading}</div>}
              <button type="button" onClick={() => onPick(e)} aria-current={on || undefined} className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${on ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300" : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
                {e.icon && <span className="shrink-0">{e.icon}</span>}
                <span className="min-w-0 flex-1 truncate">{e.label}</span>
                {e.n > 0 && <span className="shrink-0 text-xs text-zinc-400 tabular-nums">{e.n}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The rows as a table: the columns named (their cells editable), the title opens a row, a sum under one column. */
function RowsTable({ columns, rows, sum, empty, props }: { columns: string[]; rows: Row[]; sum?: string; empty?: string; props: AppViewProps }) {
  const t = useT();
  const schema = props.data.schema;
  const cols = columns.map((id) => (id === "title" ? null : (schema.properties.find((p) => p.id === id) ?? null)));
  if (!rows.length) return <p className="text-sm text-zinc-500">{empty ?? t("No rows.")}</p>;
  const sumProp = sum ? schema.properties.find((p) => p.id === sum) : undefined;
  const total = sumProp ? rows.reduce((n, r) => n + (Number(r.cells[sumProp.id]) || 0), 0) : 0;
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:bg-zinc-900/60">
            {cols.map((p, i) => (
              <th key={p?.id ?? `t${i}`} className={`px-3 py-2 ${p?.type === "number" ? "text-right" : ""}`}>
                {p ? p.name : schema.titleName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40">
              {cols.map((p, i) =>
                p ? (
                  <td key={p.id} className={p.type === "number" ? "text-right tabular-nums" : ""}>
                    {props.ctx ? <Cell p={p} row={r} ctx={props.ctx} /> : null}
                  </td>
                ) : (
                  <td key={`t${i}`} className="px-3 py-2">
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => props.openRow(r.id)}>
                      {r.icon ? `${r.icon} ` : ""}
                      {r.title || t("Untitled")}
                    </button>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
        {sumProp && (
          <tfoot>
            <tr className="border-t border-zinc-200 bg-zinc-50 font-semibold dark:border-zinc-800 dark:bg-zinc-900/60">
              {cols.map((p, i) => (
                <td key={p?.id ?? `t${i}`} className={`px-3 py-2 ${p?.type === "number" ? "text-right tabular-nums" : ""}`}>
                  {p?.id === sumProp.id ? formatNumber(sumProp, total) : i === 0 ? t("Total") : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** A section or box at most `scroll` rem high — what is more scrolls in it. */
const scrolls = (a: Record<string, string>): CSSProperties | undefined => (a.scroll ? { maxHeight: `${Number(a.scroll)}rem`, overflowY: "auto" } : undefined);
/** A template's colour: #hex as it is, a name as the chips' colours. */
const paint = (c: string | undefined) => (!c ? "#a1a1aa" : c.startsWith("#") ? c : (CHART_COLORS[c] ?? "#a1a1aa"));
const CHART_COLORS: Record<string, string> = { gray: "#a1a1aa", brown: "#a16207", orange: "#f97316", yellow: "#eab308", green: "#22c55e", blue: "#3b82f6", purple: "#a855f7", pink: "#ec4899", red: "#ef4444" };
const PALETTE = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#a855f7", "#ec4899", "#84cc16"];

/** A small chart of a template's data: bars, columns, a line or a pie. */
function MiniChart({ kind = "bar", data }: { kind?: string; data: { label: string; value: number; color?: string }[] }) {
  if (!data.length) return null;
  const colorOf = (d: { color?: string }, i: number) => (d.color ? (d.color.startsWith("#") ? d.color : (CHART_COLORS[d.color] ?? PALETTE[i % PALETTE.length])) : PALETTE[i % PALETTE.length]);
  const max = Math.max(...data.map((d) => d.value), 1);
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (kind === "pie") {
    const total = data.reduce((n, d) => n + Math.max(0, d.value), 0) || 1;
    const upTo = (i: number) => data.slice(0, i).reduce((n, d) => n + Math.max(0, d.value), 0);
    const stops = data.map((d, i) => `${colorOf(d, i)} ${(upTo(i) / total) * 360}deg ${(upTo(i + 1) / total) * 360}deg`);
    return (
      <div className="flex flex-wrap items-center gap-4">
        <div className="size-32 shrink-0 rounded-full" style={{ background: `conic-gradient(${stops.join(", ")})` }} aria-hidden />
        <ul className="space-y-1 text-xs">
          {data.map((d, i) => (
            <li key={d.label} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: colorOf(d, i) }} />
              {d.label} <span className="text-zinc-500 tabular-nums">{fmt(d.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (kind === "column" || kind === "line") {
    const w = 100 / data.length;
    return (
      <div>
        <svg viewBox="0 0 100 50" className="h-40 w-full" preserveAspectRatio="none" aria-hidden>
          {kind === "column" ? data.map((d, i) => <rect key={d.label} x={i * w + w * 0.15} width={w * 0.7} y={50 - (d.value / max) * 48} height={(d.value / max) * 48} fill={colorOf(d, i)} rx={0.6} />) : <polyline fill="none" stroke="#6366f1" strokeWidth={0.8} vectorEffect="non-scaling-stroke" points={data.map((d, i) => `${i * w + w / 2},${50 - (d.value / max) * 48}`).join(" ")} />}
        </svg>
        <div className="flex text-[10px] text-zinc-500">
          {data.map((d) => (
            <span key={d.label} className="flex-1 truncate text-center" title={`${d.label}: ${fmt(d.value)}`}>
              {d.label}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <ul className="space-y-1.5 text-xs">
      {data.map((d, i) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2">
          <span className="truncate">{d.label}</span>
          <span className="h-2.5 rounded-sm" style={{ width: `${Math.max(1, (d.value / max) * 100)}%`, background: colorOf(d, i) }} />
          <span className="text-zinc-500 tabular-nums">{fmt(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A <select search=true>: typed to find — the matching options under it (arrows, Enter, Esc); the first option with no value is its placeholder. */
function SearchSelect({ options, value, label, onPick }: { options: [string, string, string?][]; value: string; label?: string; onPick: (v: string) => void }) {
  const t = useT();
  const [query, setQuery] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const blank = options.find(([v]) => v === "");
  const real = options.filter(([v]) => v !== "");
  const current = real.find(([v]) => v === value);
  const q = (query ?? "").trim().toLowerCase();
  const found = query === null ? [] : real.filter(([, l]) => l.toLowerCase().includes(q)).slice(0, 8);
  const pick = (v: string) => {
    onPick(v);
    setQuery(null);
  };
  return (
    <div className="relative min-w-0 flex-1 print:hidden">
      <input
        className="input w-full py-1 text-sm"
        role="combobox"
        aria-expanded={found.length > 0}
        aria-autocomplete="list"
        aria-label={label ?? blank?.[1] ?? t("Search …")}
        placeholder={blank?.[1] ?? t("Search …")}
        value={query ?? current?.[1] ?? ""}
        onFocus={(e) => (setQuery(""), setHi(0), e.currentTarget.select())}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        onChange={(e) => (setQuery(e.target.value), setHi(0))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(h + 1, found.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)));
          else if (e.key === "Enter" && found[hi]) (e.preventDefault(), pick(found[hi][0]), e.currentTarget.blur());
          else if (e.key === "Escape") (setQuery(null), e.currentTarget.blur());
        }}
      />
      {query !== null && (
        <ul role="listbox" className="absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {found.length ? (
            found.map(([v, l], i) => (
              <li key={v} role="option" aria-selected={i === hi}>
                <button type="button" className={`block w-full truncate px-3 py-1 text-left ${i === hi ? "bg-indigo-50 dark:bg-indigo-950/50" : ""}`} onMouseDown={(e) => (e.preventDefault(), pick(v))} onMouseEnter={() => setHi(i)}>
                  {l}
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-1 text-zinc-500">{t("No match")}</li>
          )}
        </ul>
      )}
    </div>
  );
}

/** A pane's part that scrolls by itself (min-h-0, the room left); end=true: kept at its end as more comes — unless you scrolled up. */
function Scroller({ end, pad, center, children }: { end: boolean; pad: boolean; center: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (!el || !end) return;
    el.scrollTop = el.scrollHeight;
    const follow = new MutationObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    follow.observe(el, { childList: true, subtree: true, characterData: true });
    return () => follow.disconnect();
  }, [end]);
  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${pad ? "px-4 py-4" : ""}`}
    >
      {center ? <div className="mx-auto w-full max-w-3xl">{children}</div> : children}
    </div>
  );
}

/** Your message in a conversation: a rounded grey bubble (right-aligned), a long one cut — 'Show all'. */
function Bubble({ text, note, end }: { text: string; note?: string; end: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const long = text.length > 1500;
  return (
    <div className={`flex ${end ? "justify-end" : ""}`}>
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-100 px-4 py-2.5 text-sm whitespace-pre-wrap text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
        {long && !open ? `${text.slice(0, 600)} …` : text}
        {long && (
          <button type="button" onClick={() => setOpen(!open)} className="mt-1 block text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
            {open ? t("Show less") : t("Show all")}
          </button>
        )}
        {note ? <span className="mt-1 block text-xs text-zinc-500">{note}</span> : null}
      </div>
    </div>
  );
}

/** A section that folds: open or not — or "wide": open on a wide screen, folded on a phone (decided once it is shown). */
function Fold({ title, aside, note, dense, quiet, framed, open, children }: { title: string; aside?: string; note?: string; dense?: boolean; quiet?: boolean; framed?: boolean; open: boolean | "wide"; children: React.ReactNode }) {
  const [isOpen, setOpen] = useState(open !== false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the window's width is known only in the browser
    if (open === "wide" && window.matchMedia("(max-width: 639px)").matches) setOpen(false);
  }, [open]);
  // framed: a fold in a frame of its own — its head a grey bar (the title, while closed its note, on the right the aside), its lines under it (a day of a report).
  if (framed)
    return (
      <details open={isOpen} onToggle={(e) => setOpen(e.currentTarget.open)} className="group overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-zinc-50 px-3 py-1.5 text-sm font-semibold select-none group-open:border-b group-open:border-zinc-100 hover:bg-zinc-100 dark:bg-zinc-900/60 dark:group-open:border-zinc-800 dark:hover:bg-zinc-800/60 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-2">
            <span className="w-3 shrink-0 text-zinc-400" aria-hidden>
              {isOpen ? "▾" : "▸"}
            </span>
            {title}
            {note && !isOpen && <span className="text-xs font-normal text-zinc-400">· {note}</span>}
          </span>
          {aside && <span className="shrink-0 tabular-nums">{aside}</span>}
        </summary>
        {children}
      </details>
    );
  return (
    <details open={isOpen} onToggle={(e) => setOpen(e.currentTarget.open)} className={dense ? "group space-y-0.5" : "group space-y-2"}>
      {dense ? (
        <summary className="flex cursor-pointer items-center gap-1 px-0.5 pt-2 pb-0.5 text-xs text-zinc-500 select-none">
          <span className={quiet ? "" : "font-medium tracking-wide uppercase"}>{title}</span>
          {aside && <span className="ml-auto shrink-0 text-zinc-400 tabular-nums">{aside}</span>}
        </summary>
      ) : (
        quiet ? (
          // (quiet: a line that opens — its title in normal weight after ▸, the aside on the right)
          <summary className="flex cursor-pointer list-none items-start justify-between gap-3 text-sm select-none [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="mr-1 inline-block w-3 text-zinc-400" aria-hidden>
                {isOpen ? "▾" : "▸"}
              </span>
              {title}
            </span>
            {aside && <span className="shrink-0 font-medium tabular-nums">{aside}</span>}
          </summary>
        ) : (
          <summary className="cursor-pointer text-sm font-semibold select-none">{title}</summary>
        )
      )}
      {children}
    </details>
  );
}

/** A box of a row's checklist in a view: ticks the item in the row's page itself (and the view shows it at once). */
function TaskBox({ rowId, index, checked, label, editable, done }: { rowId: number; index: number | undefined; checked: boolean; label: string; editable: boolean; done: () => void }) {
  // (Ticked here until the view brings the page's own state — then that.)
  const [on, setOn] = useState<{ was: boolean; v: boolean } | null>(null);
  const shown = on && on.was === checked ? on.v : checked;
  const tick = (next: boolean) => {
    if (index === undefined) return;
    setOn({ was: checked, v: next });
    void toggleTaskAction(rowId, index, next).then((r) => {
      if (!r.ok) {
        toast(r.error, { tone: "error" });
        return setOn(null);
      }
      window.dispatchEvent(new Event(WS_CHANGED));
      done();
    });
  };
  return (
    <input
      type="checkbox"
      className="mr-1.5 size-3.5 translate-y-0.5 accent-indigo-600"
      checked={shown}
      disabled={!editable || index === undefined}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => tick(e.target.checked)}
    />
  );
}

/** The first <theme> of what is drawn. */
function findTheme(nodes: VNode[]): { accent?: string; radius?: string; font?: string } | null {
  for (const n of nodes) {
    if (typeof n === "string") continue;
    if (n.t === "theme") return n.a;
    const inner = findTheme(n.c);
    if (inner) return inner;
  }
  return null;
}

/** What <drop> draws: a box that takes what <drag> picked up (nothing else), lit while something is over it. */
function DropTarget({ a, onDropped, children }: { a: Record<string, string>; onDropped: (value: string) => void; children: ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`rounded-lg border border-dashed p-2 transition-colors ${over ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-zinc-300 dark:border-zinc-700"}`}
      onDragOver={(e) => (e.preventDefault(), e.stopPropagation(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const text = e.dataTransfer.getData("text/plain");
        if (text.startsWith("zeff-drag:")) onDropped(text.slice("zeff-drag:".length));
      }}
    >
      {a.label && <div className="mb-1 text-xs text-zinc-500">{a.label}</div>}
      {children}
    </div>
  );
}

/** The form of an app's settings (<settings/>): each saved as it is changed. */
function SettingsForm({ title, decls, values, onSave }: { title?: string; decls: SettingDecl[]; values: Record<string, string>; onSave: (name: string, value: string, decl: SettingDecl) => Promise<void> }) {
  const [typed, setTyped] = useState<Record<string, string>>({});
  if (!decls.length) return null;
  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {decls.map((d) => {
        const shown = typed[d.name] ?? values[d.name] ?? "";
        const save = (v: string) => {
          if (settingValue(d, v) === null) return;
          setTyped((x) => {
            const rest = { ...x };
            delete rest[d.name];
            return rest;
          });
          void onSave(d.name, v, d);
        };
        return (
          <label key={d.name} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-40 shrink-0 text-zinc-600 dark:text-zinc-300">{d.label}</span>
            {d.type === "toggle" ? (
              <input type="checkbox" checked={shown === "true"} onChange={(e) => save(e.target.checked ? "true" : "")} />
            ) : d.type === "select" ? (
              <select className="input py-1 text-sm" value={shown} onChange={(e) => save(e.target.value)}>
                <option value="" />
                {d.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input className="input py-1 text-sm" type={d.type === "number" ? "number" : "text"} value={shown} onChange={(e) => setTyped((x) => ({ ...x, [d.name]: e.target.value }))} onBlur={(e) => save(e.target.value)} />
            )}
          </label>
        );
      })}
    </div>
  );
}

/** Timers of widgets that have reported and are quiet since (their result goes to the chat's agent when they have been quiet long enough). */
const quiet = new Map<string, ReturnType<typeof setTimeout>>();
/** Something is told once (a widget that breaks again and again says it once). */
const told = new Set<string>();
function tellOnce(id: string, send: () => Promise<unknown>): Promise<unknown> {
  if (told.has(id) || told.size > 100) return Promise.resolve();
  told.add(id);
  return send();
}

/**
 * A view whose template has mistakes (while it isn't being edited — the editor shows them itself): said, with what they are, and the AI asked to
 * repair it — it reads the template, changes it, and can go back to an earlier version (every change is kept).
 */
function TemplateTrouble({ errors, view, dbId, dbTitle, reload }: { errors: { line: number; message: string }[]; view: string; dbId: number; dbTitle: string; reload: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const fix = async () => {
    setBusy(true);
    const list = errors.slice(0, 20).map((e) => `line ${e.line}: ${e.message}`).join("\n");
    const r = await askWorkspace(
      [{ role: "user", text: `The view “${view}” of the database “${dbTitle}” (id ${dbId}) shows these mistakes of its template:
${list}

Repair its template (workspace_database_schema to read it, workspace_view_template_docs for the language, workspace_update_database update_view template to save it). If a recent change broke it, workspace_view_versions lists the templates before and workspace_restore_view brings one back. Keep what the view does and how it looks.` }],
      dbId,
    );
    setBusy(false);
    toast(r.ok ? t("The AI repaired the view.") : r.error, { tone: r.ok ? "ok" : "error" });
    reload();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 print:hidden dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <details className="min-w-0 flex-1">
        <summary className="cursor-pointer">{t("This view has {n} mistakes in its template.", { n: errors.length })}</summary>
        <ul className="mt-1 list-disc pl-5 text-xs">
          {errors.slice(0, 20).map((e, i) => (
            <li key={i}>{t("line {n}", { n: e.line })}: {e.message}</li>
          ))}
        </ul>
      </details>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void fix()}>
        {busy ? t("The AI is on it …") : `✨ ${t("Repair with the AI")}`}
      </button>
    </div>
  );
}
