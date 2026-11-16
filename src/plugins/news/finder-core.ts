/**
 * The feed finder's pure parts: which hosts only aggregate, the publishers a Google News feed names, the instructions for the AI that suggests outlets (a page of
 * System → Prompts) and the shape of its answer. No Zeff code, so the News plugin bundles it (scripts/port-news.mts). Client-safe.
 */
/** Hosts that only aggregate: their "feed" is a search page again, not a publisher. */
export const AGGREGATORS = /(^|\.)(news\.google\.|google\.|msn\.|yahoo\.|bing\.|flipboard\.|newsbreak\.|ground\.news|dailyhunt|smartnews|apple\.news|facebook\.|twitter\.|x\.com|instagram\.|youtube\.|reddit\.|t\.co|linkedin\.)/i;

/** The publishers a Google News feed names: <source url="https://host">Name</source>, most often first. */
export function publishersOf(xml: string): { host: string; name: string; count: number }[] {
  const by = new Map<string, { host: string; name: string; count: number }>();
  for (const m of xml.matchAll(/<source\b[^>]*url=["']([^"']+)["'][^>]*>([\s\S]*?)<\/source>/gi)) {
    let host = "";
    try {
      host = new URL(m[1]).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    if (!host || AGGREGATORS.test(host)) continue;
    const cur = by.get(host);
    if (cur) cur.count++;
    else by.set(host, { host, name: m[2].replace(/<!\[CDATA\[|\]\]>/g, "").trim(), count: 1 });
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

export const OUTLET_SCHEMA = {
  type: "object",
  properties: {
    outlets: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, domain: { type: "string", description: "Nur die Domain, z. B. quantamagazine.org" }, why: { type: "string", description: "Ein kurzer Satz: warum für diese Person." } }, required: ["name", "domain"] },
    },
  },
  required: ["outlets"],
};

/** Its instructions — a page of System → Prompts ({{topic}}). */
export const OUTLET_INSTRUCTIONS = "Du hilfst einer Person, gute Nachrichtenquellen zu finden. Nenne bis zu 10 konkrete, real existierende Medien, Blogs oder Newsletter,\ndie regelmäßig über das Thema „{{topic}}“ berichten und einen öffentlichen RSS-/Atom-Feed haben (Fachmedien und Einzelautoren sind willkommen, nicht nur große Nachrichtenseiten).\nNenne nur Quellen, die du sicher kennst — erfinde keine Domains. Gib die Domain an, nicht die Feed-Adresse.";

