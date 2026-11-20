import { getPref, setPref } from "@/lib/prefs";
import { getPage, movePage, updatePage } from "./store";

/**
 * The screen of a package as an app of its own at the top of the Workspace (as Jira is) — not a page deep in System among the flows behind its buttons.
 * The database of the screen moves out of the package's page once (`done` is the pref that remembers it, so a place you chose later stays), takes the
 * name of the app and is a favorite; the package's page, which holds the flows, stays where it is and says what it is. Server only.
 */
export function surfaceApp(dbId: number, opts: { name: string; holder: string; done: string }): void {
  if (getPref<number | null>(opts.done, null) === dbId) return;
  const db = getPage(dbId);
  if (!db || db.archivedAt) return;
  const holder = db.parentId ? getPage(db.parentId) : null;
  if (holder) {
    movePage(dbId, null);
    if (holder.title === opts.name) updatePage(holder.id, { title: opts.holder });
  }
  updatePage(dbId, { title: opts.name, favorite: true });
  setPref(opts.done, dbId);
}
