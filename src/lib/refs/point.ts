import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { RefCard } from "./shared";

/**
 * Who draws the hover card of a reference, by its kind: Jira a ticket's, People a person's, Todos a todo's, the Workspace a page's,
 * GitLab a merge request's. A plugin adds its kinds by contributing here (server.ts); an unknown kind has no card — its link stays
 * a plain link. Cheap reads of what Zeff keeps, never an AI or a web request. Server only.
 */
export type RefCardProvider = {
  /** The kind it knows ("ticket", "person" …). */
  kind: string;
  /** The card of one reference (its id as the text names it: "PROJ-12", "37", a person's id); null: nothing known. */
  card: (id: string, ctx: { t: typeof import("@/lib/i18n/server").t; lang: string }) => RefCard | null | Promise<RefCard | null>;
};

export const refCardProviders = extensionPoint<RefCardProvider[]>("refs.cards");

/** The cards of these references (at most 40 at once), by "kind:id" — what is unknown is left out. */
export async function refCards(refs: { kind: string; id: string }[]): Promise<Record<string, RefCard>> {
  await import("@/plugins/contributions");
  const { t, getLanguage } = await import("@/lib/i18n/server");
  const lang = getLanguage();
  const byKind = new Map<string, RefCardProvider>();
  for (const c of refCardProviders.list()) for (const p of c.impl) if (!byKind.has(p.kind)) byKind.set(p.kind, p);
  const out: Record<string, RefCard> = {};
  const wanted = [...new Map(refs.slice(0, 40).map((r) => [`${r.kind}:${r.id}`, r])).values()];
  await Promise.all(
    wanted.map(async ({ kind, id }) => {
      const p = byKind.get(String(kind));
      if (!p || !String(id ?? "").trim()) return;
      try {
        const card = await p.card(String(id).trim(), { t, lang });
        if (card) out[`${kind}:${id}`] = { ...card, kind, id: String(id) };
      } catch (e) {
        console.error(`[refs] the ${kind} card of ${id} failed:`, e instanceof Error ? e.message : e);
      }
    }),
  );
  return out;
}
