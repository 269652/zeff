"use client";

import { useEffect, useState } from "react";
import { ContextList, ContextSummaryToggle, ContextToggle, TodoSources, useContextItems } from "@/components/boards/TodoSources";
import type { TodoSource, TodoUserNote } from "@/lib/todos/shared";
import type { ContextSummary } from "@/lib/context-summary";
import { sourceCardsAction, todoContextsAction } from "../actions/flows";
import { LinkedPanel } from "./linked-panel";
import { AreaToggle } from "@/components/boards/TodoSources";
import { HoverCard } from "@/components/HoverCard";
import { BookIcon } from "@/components/icons";
import { TodoKnowledgeList, TodoKnowledgePreview } from "@/plugins/knowledge/TodoKnowledge";
import type { TodoKnowledge } from "@/plugins/knowledge/shared";
import { useT } from "@/components/I18nProvider";

/** <sources refs='["mail:…","doc:12"]' open=true/> — mails, letters, appointments as cards, as a todo's sources are shown. */
export function SourcesBlock({ refs, open }: { refs: string; open: boolean }) {
  const [list, setList] = useState<TodoSource[] | null>(null);
  useEffect(() => {
    let live = true;
    let wanted: string[] = [];
    try {
      const v = JSON.parse(refs) as unknown;
      wanted = (Array.isArray(v) ? v : []).map(String).slice(0, 200);
    } catch {
      wanted = refs.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 200);
    }
    void sourceCardsAction(wanted).then((r) => live && setList(r.ok ? r.sources : []));
    return () => {
      live = false;
    };
  }, [refs]);
  if (list === null) return <p className="text-sm text-zinc-400">…</p>;
  return list.length ? <TodoSources list={list} startOpen={open} /> : null;
}

type TodoContext = { sources: TodoSource[]; notes: TodoUserNote[]; knowledge: TodoKnowledge | null };

// The contexts asked for at about the same time (every row of a list) are fetched together, once.
let queue: { id: number; done: (c: TodoContext | null) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const loadContext = (id: number) =>
  new Promise<TodoContext | null>((done) => {
    queue.push({ id, done });
    timer ??= setTimeout(() => {
      const batch = queue;
      queue = [];
      timer = null;
      void todoContextsAction(batch.map((b) => b.id)).then(
        (r) => batch.forEach((b) => b.done(r.ok ? (r.contexts[b.id] ?? null) : null)),
        () => batch.forEach((b) => b.done(null)),
      );
    }, 40);
  });

/**
 * <sources todo="12" summary='…'/> — a todo's context as the Todos page shows it under the todo: "Context (n)" with its kinds (hover: the newest), and opened, its
 * cards (comments, messages, mails, merge requests, your notes and the runs' reports — each one dismissable) and what it settles (LinkedPanel). The summary draws
 * the toggle until the context itself is there. In a row of toggles it opens below them all.
 */
export function TodoContextBlock({ todo, summary, show = "context" }: { todo: number; summary?: string; /** knowledge: the knowledge picked for the todo instead ("Knowledge (n)"). */ show?: "context" | "knowledge" }) {
  const [ctx, setCtx] = useState<TodoContext | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void loadContext(todo).then((c) => live && setCtx(c));
    return () => {
      live = false;
    };
  }, [todo, summary, tick]);
  const first: ContextSummary | null = (() => {
    try {
      const v = summary ? (JSON.parse(summary) as ContextSummary) : null;
      return v && typeof v.n === "number" ? v : null;
    } catch {
      return null;
    }
  })();
  if (show === "knowledge") return ctx?.knowledge ? <KnowledgeToggle todo={todo} k={ctx.knowledge} /> : null;
  if (!ctx) return first && first.n > 0 ? <ContextSummaryToggle summary={first} onOpen={() => setTick((n) => n + 1)} loading /> : null;
  return <LoadedContext todo={todo} ctx={ctx} />;
}

/** "Knowledge (n)": what the knowledge base has on the todo — hover it for a preview, open it for the pages, entities and links. */
function KnowledgeToggle({ todo, k }: { todo: number; k: TodoKnowledge }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const n = k.pages.length + k.entities.length + (k.links?.length ?? 0) + (k.repo ? 1 : 0);
  const toggle = (
    <AreaToggle open={open} onToggle={() => setOpen(!open)} label={t("Knowledge ({n})", { n })} tone="emerald">
      <BookIcon className="size-3.5" />
    </AreaToggle>
  );
  return (
    <>
      {open ? (
        toggle
      ) : (
        <HoverCard width={560} card={<TodoKnowledgePreview k={k} todoId={todo} />}>
          {toggle}
        </HoverCard>
      )}
      {open && (
        <span className="order-[9998] mt-0.5 block basis-full">
          <TodoKnowledgeList k={k} todoId={todo} />
        </span>
      )}
    </>
  );
}

function LoadedContext({ todo, ctx }: { todo: number; ctx: TodoContext }) {
  const [open, setOpen] = useState(false);
  const { items, unread, markSeen } = useContextItems(ctx.sources, ctx.notes, todo);
  if (!items.length) return null;
  return (
    <>
      <ContextToggle
        items={items}
        unread={unread}
        open={open}
        onToggle={() => {
          if (!open) markSeen();
          setOpen(!open);
        }}
      />
      {open && (
        <span className="order-last mt-0.5 flex basis-full flex-col gap-1.5">
          <ContextList items={items} todoId={todo} />
          <LinkedPanel target={{ todoId: todo }} />
        </span>
      )}
    </>
  );
}
