"use server";

import { headers } from "next/headers";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { personBundle, personOfRow, personOp, type PersonBundle, type PersonOperation } from "./blocks";
import { personWiki, type KnowledgeOfPerson } from "./wiki";
import { currentAccountId } from "@/db/accounts";
import { pluginAction, type Result } from "@/lib/action-result";

/** What the blocks of a person's page call: the bundle of what is known, an operation, what the knowledge knows. None throws at the page. */

const run = pluginAction("people", () => t("The People plugin is not installed (Menu → Plugins)."));

const personId = (rowId: number): number => {
  const id = personOfRow(Number(rowId));
  if (!id) throw new Error(t("This row is not a person."));
  return id;
};

/** Everything the blocks of this row's page show. */
export async function personBundleAction(rowId: number): Promise<Result<{ person: PersonBundle }>> {
  return run(async () => ({ person: await personBundle(personId(rowId)) }));
}

/** An operation of a block; after it the people database reads the profiles again (its rows follow). */
export async function personOpAction(rowId: number, op: PersonOperation): Promise<Result<{ gone?: boolean; href?: string; message?: string }>> {
  return run(async () => {
    const r = await personOp(personId(rowId), op);
    let href: string | undefined;
    if (isInstalled("workspace")) {
      const { peopleDatabase, personHref } = await import("@/plugins/workspace/people-database");
      const db = peopleDatabase();
      if (db) (await import("@/plugins/workspace/pipeline")).startPipeline(db, { ai: false });
      if (r.gone) href = r.keep ? personHref(r.keep) : db ? `/workspace/${db}` : "/workspace";
    }
    return { gone: r.gone, href, message: r.message };
  });
}

export type { KnowledgeOfPerson } from "./wiki";

// Per account (a person's id is its account's database's): one account's knowledge of person 12 is never the other's.
const wikiCache = new Map<string, { at: number; wiki: KnowledgeOfPerson | null }>();
const wikiKey = (id: number) => `${currentAccountId()}:${id}`;

/** What the knowledge (the knowledge server) knows of them: by the entity kept with the profile, else by name or alias — kept five minutes, and not waited for longer than a few seconds. */
export async function personWikiAction(rowId: number): Promise<Result<{ wiki: KnowledgeOfPerson | null }>> {
  return run(async () => {
    const id = personId(rowId);
    const hit = wikiCache.get(wikiKey(id));
    if (hit && Date.now() - hit.at < 5 * 60000) return { wiki: hit.wiki };
    const h = await headers();
    const wiki = await Promise.race([
      personWiki(id, { host: h.get("x-forwarded-host") ?? h.get("host"), proto: h.get("x-forwarded-proto") }),
      new Promise<KnowledgeOfPerson>((resolve) => setTimeout(() => resolve({ summary: "", related: [], pages: [], graph: null, error: t("The knowledge server did not answer in time.") }), 4000)),
    ]);
    if (!wiki?.error) wikiCache.set(wikiKey(id), { at: Date.now(), wiki });
    return { wiki };
  });
}

/** The knowledge's entries of them made one (`merge`), or the proposal dismissed. */
export async function personKnowledgeMergeAction(rowId: number, mergeId: number, op: "merge" | "dismiss"): Promise<Result<{ entityId?: number }>> {
  return run(async () => {
    const id = personId(rowId);
    const { acceptKnowledgeMerge, knowledgeMergeOf, rejectKnowledgeMerge } = await import("./knowledge-sync");
    if (knowledgeMergeOf(id)?.id !== Number(mergeId)) throw new Error(t("This proposal is no longer open."));
    wikiCache.delete(wikiKey(id));
    if (op === "dismiss") {
      rejectKnowledgeMerge(Number(mergeId));
      return {};
    }
    const m = await acceptKnowledgeMerge(Number(mergeId));
    return { entityId: m?.keepId };
  });
}

/** The overview of the people database (its "People" view). */
export async function peopleOverviewAction(): Promise<Result<{ overview: import("./tools").PeopleOverview }>> {
  return run(async () => ({ overview: await (await import("./tools")).peopleOverview() }));
}

/** A tool of the overview; the people database reads the profiles again after it. */
export async function peopleToolAction(tool: import("./tools").PeopleTool): Promise<Result<{ message?: string; draft?: string }>> {
  return run(async () => {
    const r = await (await import("./tools")).peopleTool(tool);
    if (isInstalled("workspace")) {
      const db = (await import("@/plugins/workspace/people-database")).peopleDatabase();
      if (db) (await import("@/plugins/workspace/pipeline")).startPipeline(db, { ai: false });
    }
    return r;
  });
}
