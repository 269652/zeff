"use server";

import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { int, revalidateAll, type ActionState } from "@/app/action-helpers";
import { contextInputOf, contextFilesOf, contextPastedOf } from "./context-form";

/**
 * Pictures pasted as links (a GitLab or Jira screenshot): download them, to keep with the item
 * as its own files — straight from the web, or through the automation Chrome for sites you're
 * signed in to there. Read-only.
 */
export async function fetchImagesAction(urls: string[]): Promise<import("@/lib/contexts-shared").FetchedImage[]> {
  if (!Array.isArray(urls)) return [];
  const { fetchRemoteImages } = await import("@/lib/remote-images");
  return fetchRemoteImages(urls.map(String));
}

/** "Add context": a new item (with its files), linked to the entry when there is one. */
export async function createContextAction(entryId: number | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { createContext } = await import("@/lib/contexts");
    await createContext(contextInputOf(fd), contextFilesOf(fd), entryId ?? undefined, contextPastedOf(fd));
    revalidateAll();
    return { ok: true, message: t("Context added.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateContextAction(contextId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { updateContext } = await import("@/lib/contexts");
    await updateContext(contextId, contextInputOf(fd), contextFilesOf(fd), contextPastedOf(fd));
    revalidateAll();
    return { ok: true, message: t("Context saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteContextAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  const { deleteContext } = await import("@/lib/contexts");
  deleteContext(id);
  revalidateAll();
}

export async function deleteContextFileAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  const { deleteContextFile } = await import("@/lib/contexts");
  deleteContextFile(id);
  revalidateAll();
}

export async function unlinkContextAction(fd: FormData): Promise<void> {
  const entryId = int(fd, "entryId");
  const contextId = int(fd, "contextId");
  if (entryId === undefined || contextId === undefined) return;
  const { unlinkContext } = await import("@/lib/contexts");
  unlinkContext(entryId, contextId);
  revalidateAll();
}

/**
 * "Sync to Jira": post the items to their Jira tickets (a comment each, edited when they
 * changed since) and attach their files. A write to Jira — only ever run from that button.
 */
export async function syncContextsToJiraAction(contextIds: number[]): Promise<ActionState> {
  try {
    const { syncContextsToJira } = await import("@/lib/jira/context-sync");
    const r = await syncContextsToJira(contextIds);
    revalidateAll();
    const parts = [
      r.posted.length && t("{n} posted", { n: r.posted.length }),
      r.updated.length && t("{n} updated", { n: r.updated.length }),
      r.unchanged.length && t("{n} already up to date", { n: r.unchanged.length }),
      r.files.length && (r.files.length === 1 ? t("1 file attached") : t("{n} files attached", { n: r.files.length })),
      r.skipped.length && t("{n} without a ticket", { n: r.skipped.length }),
    ].filter(Boolean);
    const summary = parts.length ? `${parts.join(", ")}.` : t("Nothing to sync.");
    return r.errors.length
      ? { ok: false, error: t("{summary} Failed: {errors}", { summary, errors: r.errors.join("; ") }) }
      : { ok: true, message: t("Jira: {summary}", { summary }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
