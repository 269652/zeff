import { errorMessage } from "@/lib/errors";
import { isInstalled } from "@/plugins/state";
import { getPerson, rememberEntity } from "./store";

/** What the knowledge (the knowledge server) knows of a person — read by the person's page (the plugin's lambda through `people.wiki-of`, the built-in's block). Server only. */

export type KnowledgeOfPerson = {
  summary: string;
  related: { name: string; rels: string[] }[];
  pages: { id: string; title: string; space: string; href: string }[];
  graph: string | null;
  error: string | null;
  /** The knowledge keeps them as several entries: a merge to confirm. */
  merge?: { id: number; names: string[] } | null;
};

export async function personWiki(id: number, host: { host?: string | null; proto?: string | null } = {}): Promise<KnowledgeOfPerson | null> {
  {
    const p = getPerson(id);
    if (!p || !isInstalled("knowledge")) return null;
    try {
      const { knowledgePerson, knowledgePersons, knowledgeBrowserUrl } = await import("@/plugins/knowledge/client");
      const { knowledgeEntitiesOf } = await import("./identity");
      // Every entity that is them — the knowledge may keep someone twice, under a name the profile has only as an alias
      // (or the other way round), or by their address. The kept one first; without the list, the kept one or the name.
      const persons = await knowledgePersons().catch(() => null);
      const matched = knowledgeEntitiesOf(p, persons ?? []);
      // Several: one entry to make of them (you confirm it on the card) — the list not read, what waits stays.
      const { knowledgeMergeOf, proposeKnowledgeMerge } = await import("./knowledge-sync");
      const merge = persons ? proposeKnowledgeMerge(p.id, matched) : knowledgeMergeOf(p.id);
      const ids = [...new Set([...(p.entityId ? [p.entityId] : []), ...matched.map((e) => e.id)])].slice(0, 3);
      let entities = (await Promise.all(ids.map((eid) => knowledgePerson({ id: eid })))).filter((e) => !!e);
      if (!entities.length) for (const n of [p.name, ...p.aliases]) if ((entities = [await knowledgePerson({ name: n })].filter((e) => !!e)).length) break;
      const entity = entities[0];
      if (!entity) return { summary: "", related: [], pages: [], graph: null, error: null };
      if (entity.id !== p.entityId) rememberEntity(p.id, entity.id);
      const base = knowledgeBrowserUrl(host.host ?? null, host.proto ?? null);
      const related = new Map<number, { name: string; rels: string[] }>();
      const pages = new Map<string, KnowledgeOfPerson["pages"][number]>();
      const own = new Set(entities.map((e) => e.id));
      for (const e of entities) {
        for (const r of e.relations ?? []) {
          if (own.has(r.other.id)) continue;
          const g = related.get(r.other.id) ?? { name: r.other.name, rels: [] };
          const text = r.fact || `${r.dir === "out" ? "→" : "←"} ${r.rel}`;
          if (!g.rels.includes(text) && g.rels.length < 3) g.rels.push(text);
          related.set(r.other.id, g);
        }
        for (const pg of e.pages) if (!pages.has(pg.id)) pages.set(pg.id, { id: pg.id, title: pg.title, space: pg.space, href: `${base}/seite/${encodeURIComponent(pg.id)}` });
      }
      return {
        summary: [...new Set(entities.map((e) => (e.summary ?? "").trim()).filter(Boolean))].join("\n\n"),
        related: [...related.values()].slice(0, 15),
        pages: [...pages.values()].slice(0, 30),
        graph: `${base}/graph?e=${entity.id}`,
        error: null,
        merge: merge ? { id: merge.id, names: merge.names } : null,
      };
    } catch (e) {
      return { summary: "", related: [], pages: [], graph: null, error: errorMessage(e) };
    }
  }
}

