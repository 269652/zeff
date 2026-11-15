"use client";

import { useEffect, useState } from "react";
import { TodoSources } from "@/components/boards/TodoSources";
import type { TodoSource } from "@/lib/todos/shared";
import { sourceCardsAction } from "../actions/flows";

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
