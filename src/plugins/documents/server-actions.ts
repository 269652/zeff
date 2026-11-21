"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { type DocView } from "./shared";
import { pluginAction } from "@/lib/action-result";

/** The Documents plugin's server actions (each answers an ActionState unless it says otherwise). */

const off = () => (isInstalled("documents") ? null : t("The Documents plugin is not installed (Menu → Plugins)."));
const inPlugin = pluginAction("documents", () => t("The Documents plugin is not installed (Menu → Plugins)."));

const run = (fn: () => Promise<string | void> | string | void): Promise<ActionState> =>
  inPlugin(async () => {
    const message = await fn();
    revalidateAll();
    return { message: message || undefined };
  });

/** A document attached to a todo, by hand: it shows in its context, and goes into what the AI reads about it. */
export async function attachDocumentAction(todoId: number, docId: number): Promise<ActionState> {
  return run(async () => {
    const { getDocument } = await import("./store");
    const { addTodoContext } = await import("@/lib/todos/store");
    const doc = getDocument(Number(docId));
    if (!doc) throw new Error(t("This document doesn't exist (any more)."));
    if (!addTodoContext(Number(todoId), [doc.ref], "", "Document")) throw new Error(t("This todo doesn't exist (any more)."));
    return t("“{name}” attached.", { name: doc.name });
  });
}

/** The documents, newest first (the attach picker loads them when it opens). */
export async function listDocumentsAction(): Promise<DocView[]> {
  if (off()) return [];
  return (await import("./store")).listDocuments();
}

/**
 * The first picture added to a note installs the Documents plugin (it keeps the pictures; off by default) — nothing to set up
 * before. Answers ok once it is there.
 */
export async function ensureDocumentsAction(): Promise<ActionState> {
  try {
    const { isInstalled, setInstalled } = await import("@/plugins/state");
    if (isInstalled("documents")) return { ok: true };
    setInstalled("documents", true);
    await (await import("@/lib/programs-with-plugin")).installProgramsFor(["documents"]);
    revalidateAll();
    return { ok: true, message: t("The Documents plugin is installed — it keeps the pictures of your notes.") };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export type DocHit = { id: number; ref: string; name: string; kind: string; size: number; abstract: string };

/** The note editor's autocomplete (typing ![title]( ): documents by what you typed — pictures first, then the best match, newest first. */
export async function searchDocumentsAction(q: string): Promise<DocHit[]> {
  if (off()) return [];
  const words = String(q ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 6);
  const { listDocuments } = await import("./store");
  const docs = listDocuments().filter((d) => d.status !== "failed");
  const scored = docs.map((d, i) => {
    const hay = `${d.name} ${d.abstract} ${d.concepts.join(" ")}`.toLowerCase();
    return { d, i, hits: words.filter((w) => hay.includes(w)).length };
  });
  return scored
    .filter((x) => !words.length || x.hits > 0)
    .sort((a, b) => Number(b.d.kind === "image") - Number(a.d.kind === "image") || b.hits - a.hits || a.i - b.i)
    .slice(0, 8)
    .map(({ d }) => ({ id: d.id, ref: d.ref, name: d.name, kind: d.kind, size: d.size, abstract: d.abstract.slice(0, 120) }));
}
