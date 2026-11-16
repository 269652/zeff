"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useOverlayFocus } from "@/components/Overlay";
import type { VNode } from "../view-template";
import type { BlockEnv } from "./view-blocks";

/**
 * Two small blocks of the view language that read like a phone: <stories> (a strip of round pictures — each a run of reports played full screen, one after
 * another, like stories) and <speak> (a text read aloud by the browser's voice). Nothing here knows what the reports are: the view's data says (a title, a text, a
 * picture, a line above, an address), and what a report is told to do (shown, liked, saved) goes out as the view's own state and events.
 */

type Node = Extract<VNode, object>;
export type StoryItem = { id: string; title: string; text?: string; image?: string; meta?: string; url?: string; why?: string; seen?: boolean };
export type StoryGroup = { key: string; label: string; kind?: string; items: StoryItem[] };

/** How long one report stays before the next comes (held down, it waits). */
const SHOW_MS = 8000;

const tint = (name: string) => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `linear-gradient(160deg, hsl(${h} 55% 32%), hsl(${(h + 50) % 360} 60% 14%))`;
};

const parseGroups = (s: string | undefined): StoryGroup[] => {
  try {
    const x = JSON.parse(s ?? "[]") as unknown;
    return Array.isArray(x) ? (x as StoryGroup[]).filter((g) => g && Array.isArray(g.items) && g.items.length) : [];
  } catch {
    return [];
  }
};

/** attr actions="event|icon|label; …": what the buttons under a report do (its id in the state `bind`, then the event). */
const parseActions = (s: string | undefined) =>
  (s ?? "")
    .split(";")
    .map((x) => x.split("|").map((y) => y.trim()))
    .filter((x) => x[0])
    .map(([event, icon, label]) => ({ event, icon: icon || "•", label: label || event }));

export function Stories({ a, env }: { a: Record<string, string>; env: BlockEnv }) {
  const t = useT();
  const groups = parseGroups(a.groups);
  const [open, setOpen] = useState<number | null>(null);
  const [seen, setSeen] = useState<Set<string>>(() => new Set(groups.flatMap((g) => g.items.filter((i) => i.seen).map((i) => i.id))));
  if (!groups.length) return null;
  const images = a.images !== "false";
  return (
    <>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pt-1 pb-2" role="list" aria-label={a.title || t("Stories")}>
        {groups.map((g, k) => {
          const fresh = g.items.some((i) => !seen.has(i.id));
          const pic = images ? g.items.find((i) => i.image)?.image : "";
          return (
            <div key={g.key} role="listitem" className="contents">
              <button type="button" onClick={() => setOpen(k)} className="group flex w-20 shrink-0 flex-col items-center gap-1 text-center" title={`${g.label} · ${g.items.length}`}>
                <span className={`rounded-full p-[3px] ${fresh ? (g.kind === "top" ? "bg-gradient-to-tr from-amber-400 via-rose-500 to-fuchsia-600" : "bg-gradient-to-tr from-sky-400 via-indigo-500 to-fuchsia-500") : "bg-zinc-300 dark:bg-zinc-700"}`}>
                  <span className="block rounded-full bg-white p-[2px] dark:bg-zinc-950">
                    {pic ? (
                      // eslint-disable-next-line @next/next/no-img-element -- pictures of other sites, shown as they are
                      <img src={pic} alt="" referrerPolicy="no-referrer" className="h-16 w-16 rounded-full object-cover transition-transform group-hover:scale-105" />
                    ) : (
                      <span className="flex h-16 w-16 items-center justify-center rounded-full text-2xl text-white" style={{ background: tint(g.label) }}>
                        {g.kind === "top" ? "★" : g.kind === "best" ? "✦" : "🧵"}
                      </span>
                    )}
                  </span>
                </span>
                <span className={`line-clamp-2 w-full text-[11px] leading-tight ${fresh ? "font-medium" : "text-zinc-500"}`}>{g.label}</span>
              </button>
            </div>
          );
        })}
      </div>
      {open !== null && <Player a={a} env={env} groups={groups} start={open} images={images} onSeen={(id) => setSeen((s) => (s.has(id) ? s : new Set(s).add(id)))} onClose={() => setOpen(null)} />}
    </>
  );
}

/** A run of reports played full screen: bars show where you are, a report moves on by itself, a tap on the right is the next, on the left the one before. ←/→, Space (wait), Esc (close). */
function Player({ a, env, groups, start, images, onSeen, onClose }: { a: Record<string, string>; env: BlockEnv; groups: StoryGroup[]; start: number; images: boolean; onSeen: (id: string) => void; onClose: () => void }) {
  const t = useT();
  const actions = parseActions(a.actions);
  const [pos, setPos] = useState({ g: start, i: Math.max(0, groups[start].items.findIndex((x) => !x.seen)) });
  const [progress, setProgress] = useState(0);
  const [held, setHeld] = useState(false);
  const downAt = useRef(0);
  const dialog = useRef<HTMLDivElement>(null);
  useOverlayFocus(dialog, true);
  const group = groups[pos.g];
  const item = group.items[pos.i];

  const next = useCallback(() => {
    setProgress(0);
    setPos((p) => (p.i + 1 < groups[p.g].items.length ? { g: p.g, i: p.i + 1 } : p.g + 1 < groups.length ? { g: p.g + 1, i: 0 } : (onClose(), p)));
  }, [groups, onClose]);
  const prev = useCallback(() => {
    setProgress(0);
    setPos((p) => (p.i > 0 ? { g: p.g, i: p.i - 1 } : p.g > 0 ? { g: p.g - 1, i: groups[p.g - 1].items.length - 1 } : p));
  }, [groups]);

  // Seen once it is on screen: its id into the state, then the view's event.
  useEffect(() => {
    onSeen(item.id);
    if (a.bind) env.setState(a.bind, item.id);
    if (a.emit) env.emitLater?.(a.emit);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per report
  }, [item.id]);

  useEffect(() => {
    if (held) return;
    const from = performance.now() - progress * SHOW_MS;
    let raf = 0;
    const tick = (now: number) => {
      const p = (now - from) / SHOW_MS;
      if (p >= 1) return next();
      setProgress(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restarts per report and when let go, from where it was
  }, [held, pos.g, pos.i, next]);

  const act = (event: string) => {
    if (a.bind) env.setState(a.bind, item.id);
    env.emitLater?.(event);
  };
  const read = () => {
    if (!a.read) return;
    env.setState(a.read, item.id);
    onClose();
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === " ") (e.preventDefault(), setHeld((h) => !h));
    };
    window.addEventListener("keydown", key);
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      html.style.overflow = before;
    };
  }, [next, prev, onClose]);

  const pic = images && item.image ? item.image : "";
  return (
    <div ref={dialog} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-0 backdrop-blur sm:p-4" role="dialog" aria-modal aria-label={group.label} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="relative h-full w-full max-w-md overflow-hidden bg-zinc-900 text-white shadow-2xl select-none sm:h-[min(92vh,860px)] sm:rounded-2xl"
        style={pic ? undefined : { background: tint(item.meta || group.label) }}
        onPointerDown={() => {
          downAt.current = Date.now();
          setHeld(true);
        }}
        onPointerUp={(e) => {
          setHeld(false);
          if (Date.now() - downAt.current > 300) return;
          if ((e.target as HTMLElement).closest("button,a")) return;
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX - r.left < r.width / 3) prev();
          else next();
        }}
        onPointerLeave={() => setHeld(false)}
      >
        {pic && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- the picture blurred behind, and whole in front */}
            <img src={pic} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
            {/* eslint-disable-next-line @next/next/no-img-element -- pictures of other sites, shown as they are */}
            <img key={item.id} src={pic} alt="" referrerPolicy="no-referrer" className="absolute inset-x-0 top-[12%] max-h-[48%] w-full object-cover" />
          </>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/90" />
        <div className="absolute inset-x-3 top-3 flex gap-1">
          {group.items.map((x, k) => (
            <span key={x.id} className="h-0.5 flex-1 overflow-hidden rounded bg-white/30">
              <span className="block h-full bg-white" style={{ width: `${k < pos.i ? 100 : k === pos.i ? progress * 100 : 0}%` }} />
            </span>
          ))}
        </div>
        <div className="absolute inset-x-3 top-6 flex items-center gap-2 text-sm">
          <span className="truncate font-semibold">{group.kind === "top" ? "★ " : group.kind === "story" ? "🧵 " : ""}{group.label}</span>
          <span className="text-white/60">{pos.g + 1}/{groups.length}</span>
          <span className="flex-1" />
          {held && <span className="text-xs text-white/70">❚❚</span>}
          <button type="button" className="rounded-full px-2 text-xl leading-none text-white/80 hover:text-white" onClick={onClose} aria-label={t("Close")}>
            ×
          </button>
        </div>
        <div className="absolute inset-x-0 bottom-0 space-y-3 p-5">
          {item.meta && <p className="text-xs text-white/70">{item.meta}</p>}
          <h2 className="text-2xl leading-tight font-semibold">{item.title}</h2>
          {item.text && <p className="line-clamp-5 text-sm leading-relaxed text-white/85">{item.text}</p>}
          {item.why && <p className="inline-block rounded-full bg-amber-400/90 px-2.5 py-1 text-xs text-amber-950">{item.why}</p>}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {item.url && (
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white/90" onClick={() => setHeld(true)}>
                {t("Open article")} ↗
              </a>
            )}
            {a.read && (
              <button type="button" className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25" onClick={read}>
                {t("Read here")}
              </button>
            )}
            <span className="flex-1" />
            {actions.map((x) => (
              <button key={x.event} type="button" className="rounded-full bg-white/15 px-3 py-2 text-lg hover:bg-white/25" title={x.label} aria-label={x.label} onClick={() => act(x.event)}>
                {x.icon}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A text read aloud by the browser's voice (a button that starts and stops it). Nothing is sent anywhere: the voice is the browser's own. */
export function Speak({ n }: { n: Node }) {
  const t = useT();
  const [on, setOn] = useState(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  useEffect(() => () => void (typeof window !== "undefined" && "speechSynthesis" in window && window.speechSynthesis.cancel()), []);
  if (!supported || !n.a.text?.trim()) return null;
  const toggle = () => {
    const synth = window.speechSynthesis;
    if (on) {
      synth.cancel();
      setOn(false);
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(n.a.text);
    if (n.a.lang) u.lang = n.a.lang;
    u.onend = () => setOn(false);
    u.onerror = () => setOn(false);
    setOn(true);
    synth.speak(u);
  };
  return (
    <button type="button" className="btn btn-sm print:hidden" onClick={toggle} aria-pressed={on} title={n.a.label || t("Listen")}>
      {on ? "⏹" : "🔊"} {n.a.label || t("Listen")}
    </button>
  );
}

/** What has been on screen for a moment, collected per state name: the ids wait a little (one batch, not one event per card) and then go out together. */
const batches = new Map<string, { ids: string[]; timer: ReturnType<typeof setTimeout> | null }>();

/**
 * <visible value="{{ id }}" bind="seen" emit="shown"/>: once this place has been on screen for a moment (after = ms, default 1500) its value joins the comma list in state.<bind>
 * and the event goes out (batched: the cards of a screenful are reported together). Draws nothing. Put one in each card of a feed to know what was seen.
 */
export function Visible({ a, env }: { a: Record<string, string>; env: BlockEnv }) {
  const ref = useRef<HTMLSpanElement>(null);
  const envRef = useRef(env);
  envRef.current = env;
  const { value, bind, emit } = a;
  const after = Math.max(200, Math.min(10000, Number(a.after) || 1500));
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !value || !bind || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver((entries) => {
      const on = entries.some((e) => e.isIntersecting);
      if (!on) return void (timer && clearTimeout(timer));
      if (done.current) return;
      timer = setTimeout(() => {
        done.current = true;
        const b = batches.get(bind) ?? { ids: [], timer: null };
        batches.set(bind, b);
        if (!b.ids.includes(value)) b.ids.push(value);
        if (b.timer) clearTimeout(b.timer);
        b.timer = setTimeout(() => {
          const ids = b.ids.splice(0);
          b.timer = null;
          if (!ids.length) return;
          envRef.current.setState(bind, ids.join(","));
          if (emit) envRef.current.emitLater?.(emit);
        }, 1500);
      }, after);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [value, bind, emit, after]);
  return <span ref={ref} aria-hidden className="block h-0 w-0" />;
}
