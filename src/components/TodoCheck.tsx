"use client";

import { useEffect, useRef, useState } from "react";

/** How long a tick waits before it counts: time to take a slip back (the todo would vanish from its list). */
const GRACE_MS = 3500;

/**
 * A todo's checkbox — the one control that ticks a todo wherever it is (a list in a page, Today, a widget, a board, a card's checklist).
 * `className` is its look there (default: the page's list); `onChange` gets whether it is ticked now. Not editable text in an editor.
 * Ticked at once, done a moment later: a tick shows at once and counts after GRACE_MS — untick it before and nothing happened. What you
 * clicked shows until the todo's own state changes (then that counts). Unticking a done todo counts at once.
 */
export function TodoCheck({ checked, onChange, disabled, label, title, className = "ws-todo-check" }: { checked?: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; title?: string; className?: string }) {
  // What was clicked, and against which state it was clicked (a new state from outside replaces it).
  const [mine, setMine] = useState<{ v: boolean; base: boolean | undefined } | null>(null);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; fire: () => void } | null>(null);
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  // (leaving the page while a tick waits: it counts — the click was meant)
  useEffect(
    () => () => {
      const p = pending.current;
      if (!p) return;
      clearTimeout(p.timer);
      p.fire();
    },
    [],
  );
  const cancel = () => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
  };
  const value = checked === undefined ? undefined : mine && mine.base === checked ? mine.v : checked;
  return (
    <input
      type="checkbox"
      className={className}
      checked={value}
      disabled={disabled}
      title={title}
      onChange={(e) => {
        const v = e.target.checked;
        if (pending.current) {
          // (unticked while the tick waited: nothing happened)
          cancel();
          setMine(null);
          return;
        }
        if (checked !== undefined) setMine({ v, base: checked });
        if (!v) return void latest.current(false);
        const fire = () => {
          pending.current = null;
          latest.current(true);
        };
        pending.current = { timer: setTimeout(fire, GRACE_MS), fire };
      }}
      aria-label={label}
      contentEditable={false}
    />
  );
}
