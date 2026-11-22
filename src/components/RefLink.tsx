"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { HoverCard } from "@/components/HoverCard";
import { useT } from "@/components/I18nProvider";
import { refCardsAction } from "@/app/actions/ref-cards";
import type { RefCard, RefTone } from "@/lib/refs/shared";

/**
 * A reference named inline — a ticket key, a person, another todo, a page, a merge request — as its link, and on hover (or keyboard
 * focus) its card: fetched when the pointer first comes (one kernel read, refs.card, several references in one request), kept for the
 * session. A reference nobody knows (no provider for its kind, nothing found) stays a plain link. Touch: a tap is the link's.
 */

// ── The cards loaded so far (this tab, this session): undefined not asked yet, null nothing known. ──
const cards = new Map<string, RefCard | null>();
const listeners = new Set<() => void>();
let queue: { kind: string; id: string }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const keyOf = (kind: string, id: string) => `${kind}:${id}`;

function flush() {
  timer = null;
  const batch = queue;
  queue = [];
  if (!batch.length) return;
  refCardsAction(batch)
    .then((got) => {
      for (const r of batch) cards.set(keyOf(r.kind, r.id), got[keyOf(r.kind, r.id)] ?? null);
    })
    .catch(() => {
      // (asked again the next time it is hovered)
      for (const r of batch) cards.delete(keyOf(r.kind, r.id));
    })
    .finally(() => listeners.forEach((l) => l()));
}

/** Ask for a reference's card (once: the same one asked again, or while it loads, is not asked twice); those asked together go in one request. */
export function loadRefCard(kind: string, id: string) {
  const k = keyOf(kind, id);
  if (cards.has(k) || queue.some((r) => keyOf(r.kind, r.id) === k)) return;
  queue.push({ kind, id });
  if (!timer) timer = setTimeout(flush, 15);
}
function useRefCard(kind: string, id: string): RefCard | null | undefined {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => (cards.has(keyOf(kind, id)) ? cards.get(keyOf(kind, id)) : undefined),
    () => undefined,
  );
}

const BADGE: Record<RefTone, string> = {
  plain: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  muted: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  bad: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};
const ITEM: Record<RefTone, string> = { plain: "", muted: "text-zinc-500", info: "text-sky-700 dark:text-sky-400", good: "text-emerald-700 dark:text-emerald-400", warn: "text-amber-700 dark:text-amber-400", bad: "text-red-600 dark:text-red-400" };

const ext = (href: string, external?: boolean) => (external || /^https?:/i.test(href) ? { target: "_blank", rel: "noreferrer" } : {});

/** What a reference's card shows: one look for every kind. */
export function RefCardView({ card, loading }: { card: RefCard | null | undefined; loading?: string }) {
  const t = useT();
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-800 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      {!card ? (
        <p className="text-zinc-400">{loading ?? t("Loading …")}</p>
      ) : (
        <>
          <div className="flex items-start gap-2">
            {(card.avatar || card.icon) && (
              <span aria-hidden className={card.avatar ? "flex size-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[11px] font-semibold text-teal-800 dark:bg-teal-950 dark:text-teal-300" : "shrink-0 text-lg leading-6"}>
                {card.avatar || card.icon}
              </span>
            )}
            <div className="min-w-0 flex-1">
              {(card.eyebrow || !!card.badges?.length) && (
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[11px] text-zinc-500">{card.eyebrow}</span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {card.badges?.map((b, i) => (
                      <span key={i} className={`rounded-full px-1.5 py-px text-[11px] font-medium ${BADGE[b.tone ?? "plain"]}`}>
                        {b.label}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              <p className="text-sm leading-snug font-medium break-words">{card.title}</p>
              {card.subtitle && <p className="text-zinc-500 dark:text-zinc-400">{card.subtitle}</p>}
            </div>
          </div>
          {card.note && <p className="text-zinc-500">{card.note}</p>}
          {!!card.facts?.length && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              {card.facts.map((f, i) => (
                <div key={i} className="contents">
                  <dt className="text-zinc-500">{f.label}</dt>
                  <dd className="min-w-0 truncate" title={f.value}>
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {card.excerpt && (
            <div className="space-y-0.5 rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/50">
              {card.excerptLabel && <p className="text-[11px] text-zinc-400">{card.excerptLabel}</p>}
              <p className="line-clamp-5 whitespace-pre-line text-zinc-600 dark:text-zinc-300">{card.excerpt}</p>
            </div>
          )}
          {!!card.items?.length && (
            <div className="space-y-0.5">
              {card.itemsLabel && <p className="text-[11px] font-semibold text-zinc-500 uppercase">{card.itemsLabel}</p>}
              {card.items.map((x, i) =>
                x.href ? (
                  <a key={i} href={x.href} className={`line-clamp-1 hover:underline ${ITEM[x.tone ?? "plain"]}`}>
                    {x.label}
                  </a>
                ) : (
                  <p key={i} className={`line-clamp-2 ${ITEM[x.tone ?? "plain"]}`}>
                    {x.label}
                  </p>
                ),
              )}
            </div>
          )}
          {!!card.links?.length && (
            <p className="flex flex-wrap gap-x-3">
              {card.links.map((l, i) => (
                <a key={i} href={l.href} {...ext(l.href, l.external)} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  {l.label}
                </a>
              ))}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The reference itself: `children` as a link to `href` (none: to where its card says, once loaded), with its card on hover.
 * `className`: how the link looks (the text it stands in decides).
 */
export function RefLink({ kind, id, href, className = "", title, children }: { kind: string; id: string; href?: string; className?: string; title?: string; children: ReactNode }) {
  const t = useT();
  const card = useRefCard(kind, id);
  const to = href || card?.links?.[0]?.href || "";
  const link = to ? (
    <a href={to} {...ext(to, !href && card?.links?.[0]?.external)} className={className} title={card ? undefined : title} onClick={(e) => e.stopPropagation()}>
      {children}
    </a>
  ) : (
    <span tabIndex={0} className={className} title={card ? undefined : title}>
      {children}
    </span>
  );
  // Nothing known about it: the plain link.
  if (card === null) return link;
  return (
    <HoverCard width={360} column={false} touch={false} delay={250} label={card?.title ?? title ?? t("Details")} onOpen={() => loadRefCard(kind, id)} card={<RefCardView card={card} />}>
      {link}
    </HoverCard>
  );
}
