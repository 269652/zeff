import { discoverFeeds, isPublicUrl, type DiscoverDeps, type FoundFeed } from "./discover";
import { fillPrompt, promptText } from "@/lib/prompts";
import { newsFetch } from "./http";
import { AGGREGATORS, OUTLET_INSTRUCTIONS, OUTLET_SCHEMA, publishersOf } from "./finder-core";
export { OUTLET_INSTRUCTIONS, publishersOf };
import { topicFeedUrl, type NewsPrefs } from "./shared";

/**
 * The feed finder: give it a topic and it searches the internet for feeds worth reading, and says why.
 *   1. Who writes about it: a Google News search for the topic — its results name their publishers (host and name).
 *   2. Who an AI would suggest (optional, LLM plugin): outlets, blogs and newsletters for the topic and for you, by domain —
 *      the AI runs closed, so it only names places; Zeff does the looking.
 *   3. Each publisher's website is searched for its feeds (discoverFeeds), every candidate fetched and parsed.
 * What is returned are feeds that answered with items just now — never a guess.
 */
export type Suggestion = { feed: FoundFeed; topic: string; domain: string; via: "news" | "ai"; why: string };

export type FinderDeps = DiscoverDeps & {
  /** The AI's suggestions for a topic: outlets by domain (default: the LLM plugin, if installed). */
  ask?: (prompt: string) => Promise<{ outlets?: { name?: string; domain?: string; why?: string }[] }>;
  /** Hosts you have feeds from already (they aren't suggested again). */
  have?: Set<string>;
  /** What is known about you (interests, what you work on) — for the AI. */
  profile?: string[];
  language?: NewsPrefs["language"];
  maxAgeDays?: number;
  /** How many publishers to search (default 14) and suggestions to return (default 20). */
  publishers?: number;
  limit?: number;
};

export function outletPrompt(topic: string, profile: string[], have: string[]): string {
  return [
    fillPrompt("news-outlets", OUTLET_INSTRUCTIONS, { topic: topic }),
    `Was über die Person bekannt ist: ${profile.length ? profile.slice(0, 25).join(", ") : "(nichts)"}`,
    `Diese Quellen hat sie schon: ${have.length ? have.slice(0, 40).join(", ") : "(keine)"}`,
  ].join("\n");
}

async function defaultAsk(prompt: string): Promise<{ outlets?: { name?: string; domain?: string; why?: string }[] }> {
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("llm")) return {};
  const { runAi } = await import("@/lib/ai");
  return (await runAi<{ outlets?: { name?: string; domain?: string; why?: string }[] }>(prompt, OUTLET_SCHEMA, { task: "news-feeds", timeoutMs: 3 * 60000, maxBudgetUsd: 0.2 })).output;
}

/** Runs `fn` over `list`, `n` at a time. */
async function pool<T>(list: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) await fn(list[i++]); }));
}

export async function findFeeds(topic: string, deps: FinderDeps = {}): Promise<Suggestion[]> {
  const q = topic.trim();
  if (q.length < 2) return [];
  const get = deps.get;
  const have = deps.have ?? new Set<string>();
  const language = deps.language ?? "de";
  const candidates = new Map<string, { host: string; name: string; via: "news" | "ai"; why: string; weight: number }>();

  // 1. Who writes about it.
  const langs: ("de" | "en")[] = language === "any" ? ["de", "en"] : [language];
  for (const lang of langs) {
    try {
      const xml = (await (get ?? (async (u: string) => ({ text: await (await newsFetch(u)).text(), url: u })))(topicFeedUrl(q, lang, deps.maxAgeDays ?? 30))).text;
      for (const p of publishersOf(xml)) if (!candidates.has(p.host)) candidates.set(p.host, { host: p.host, name: p.name, via: "news", why: "", weight: p.count });
    } catch {
      // that search didn't answer
    }
  }

  // 2. Who an AI would suggest (it only names places).
  try {
    const answer = await (deps.ask ?? defaultAsk)(outletPrompt(q, deps.profile ?? [], [...have]));
    for (const o of answer.outlets ?? []) {
      const host = String(o.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
      if (!host || !host.includes(".") || !isPublicUrl(`https://${host}`) || AGGREGATORS.test(host)) continue;
      const cur = candidates.get(host);
      candidates.set(host, { host, name: o.name?.trim() || cur?.name || host, via: "ai", why: (o.why ?? "").slice(0, 200), weight: (cur?.weight ?? 0) + 3 });
    }
  } catch {
    // no AI: the news route alone
  }

  // 3. Their feeds.
  const hosts = [...candidates.values()].filter((c) => !have.has(c.host)).sort((a, b) => b.weight - a.weight).slice(0, deps.publishers ?? 14);
  const out: Suggestion[] = [];
  await pool(hosts, 4, async (c) => {
    const feeds = await discoverFeeds(`https://${c.host}`, { get });
    const best = feeds.find((f) => f.items >= 3 && Date.now() - Date.parse(f.newest) < 90 * 864e5);
    if (best) out.push({ feed: best, topic: q, domain: c.host, via: c.via, why: c.why || `Schreibt über „${q}“ (${c.name})` });
  });
  const rank = (s: Suggestion) => (s.via === "ai" ? 1000 : 0) + s.feed.items + Math.max(0, 30 - (Date.now() - Date.parse(s.feed.newest)) / 864e5);
  return out.sort((a, b) => rank(b) - rank(a)).slice(0, deps.limit ?? 20);
}
