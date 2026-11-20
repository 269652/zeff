"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useT } from "@/components/I18nProvider";

/**
 * Full screen for an app (a database, a board): the page's sidebar goes, the page has the whole width under Zeff's
 * header (which stays, as on the apps' old pages). Kept in this browser; Escape (or the button again) brings them back. The CSS is html[data-focus] in globals.css.
 * A link opens a page so too: ?focus=1 (an app from the header menu) — for that visit, not kept.
 */

const KEY = "zeff-focus";
const listeners = new Set<() => void>();
const byLink = (): boolean => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("focus") === "1";
const read = (): boolean => {
  try {
    return byLink() || localStorage.getItem(KEY) === "1";
  } catch {
    return byLink();
  }
};
const set = (on: boolean) => {
  // (Leaving a page opened full screen by its link: the link's ?focus=1 goes, so it stays left.)
  if (!on && byLink()) {
    const u = new URL(window.location.href);
    u.searchParams.delete("focus");
    window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
  }
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // no storage: only for now
  }
  document.documentElement.toggleAttribute("data-focus", on);
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** Full screen without the page's bar (an app's own screen): a small ⤡ in the corner that leaves it (Escape does too). */
export function FocusExit() {
  const t = useT();
  const on = useSyncExternalStore(subscribe, read, () => false);
  if (!on) return null;
  return (
    <button type="button" className="icon-btn fixed right-3 bottom-3 z-40 border border-zinc-200 bg-white/90 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/90 print:hidden" onClick={() => set(false)} title={t("Leave full screen (Esc)")} aria-label={t("Leave full screen (Esc)")}>
      ⤡
    </button>
  );
}

export function FocusToggle() {
  const t = useT();
  const on = useSyncExternalStore(subscribe, read, () => false);
  // The page as it was left (full screen or not), and Escape to leave it.
  useEffect(() => {
    document.documentElement.toggleAttribute("data-focus", on);
    if (!on) return;
    // (Not while a modal is open — on screen: the menu drawer is always there, moved out of view — Escape is its.)
    const modalOpen = () =>
      [...document.querySelectorAll('[aria-modal="true"]')].some((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
      });
    const key = (e: KeyboardEvent) => e.key === "Escape" && !modalOpen() && set(false);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [on]);
  useEffect(() => () => document.documentElement.removeAttribute("data-focus"), []);
  return (
    <button type="button" className="btn btn-sm" aria-pressed={on} onClick={() => set(!on)} title={on ? t("Leave full screen (Esc)") : t("Full screen")}>
      {on ? "⤡" : "⤢"}
    </button>
  );
}
