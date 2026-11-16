import { getPref, setPref } from "@/lib/prefs";
import { fillPrompt, promptText } from "@/lib/prompts";
import { DIGEST_INSTRUCTIONS, DIGEST_SCHEMA } from "./digest-prompt";
export { DIGEST_INSTRUCTIONS };
import { getContent, getPrefs, listItems } from "./store";

/**
 * The AI briefing (optional, LLM plugin) — like a notebook over your news: from the best unread items it writes what matters
 * today in a few sentences, groups the items into themes with a short synthesis each (every claim cites its items by number,
 * which become links), and picks the few to read first with a reason that fits you. Titles, short texts and your interests
 * go to the AI; it can only use what is in front of it.
 */
export type Theme = { title: string; summary: string; ids: number[] };
export type Digest = { at: string; overview: string; picks: { id: number; why: string }[]; themes: Theme[] };
type Answer = { overview?: string; picks?: { n?: number; why?: string }[]; themes?: { title?: string; summary?: string; items?: number[] }[] };



export const getDigest = (): Digest | null => {
  const d = getPref<Partial<Digest> | null>("news:digest", null);
  return d && d.at ? { at: d.at, overview: d.overview ?? "", picks: d.picks ?? [], themes: d.themes ?? [] } : null;
};

export function digestPrompt(interests: string[], items: { n: number; source: string; title: string; summary: string }[]): string {
  return [
    promptText("news-digest", DIGEST_INSTRUCTIONS),
    `Interessen: ${interests.length ? interests.join(", ") : "(keine angegeben)"}`,
    "",
    "Meldungen:",
    ...items.map((i) => `${i.n}. [${i.source}] ${i.title}${i.summary ? ` — ${i.summary.slice(0, 260)}` : ""}`),
  ].join("\n");
}

/** Makes (and keeps) the briefing of the top unread items. `ask` is the AI call (tests give their own). */
export async function buildDigest(deps: { ask?: (prompt: string) => Promise<Answer> } = {}): Promise<Digest | null> {
  const prefs = getPrefs();
  const items = listItems({ view: "foryou", limit: 40, maxAgeDays: Math.min(prefs.maxAgeDays, 2) }).filter((i) => i.state === "new");
  if (!items.length) return null;
  const ask =
    deps.ask ??
    (async (prompt: string) => {
      const { runAi } = await import("@/lib/ai");
      return (await runAi<Answer>(prompt, DIGEST_SCHEMA, { task: "news-digest", timeoutMs: 5 * 60000, maxBudgetUsd: 0.4 })).output;
    });
  // The opening of the article, where it has been read, is better to go on than a one-line summary.
  const numbered = items.map((it, i) => ({ n: i + 1, source: it.sourceName, title: it.title, summary: (it.hasContent ? getContent(it.id)?.content.slice(0, 300) : "") || it.summary }));
  const a = await ask(digestPrompt(prefs.interests.map((i) => i.term), numbered));
  const at = (n: number | undefined) => items[(n ?? 0) - 1];
  const picks = (a.picks ?? []).flatMap((p) => {
    const it = at(p.n);
    return it && p.why ? [{ id: it.id, why: String(p.why).slice(0, 240) }] : [];
  });
  const themes = (a.themes ?? []).flatMap((th): Theme[] => {
    const ids = [...new Set((th.items ?? []).flatMap((n) => (at(n) ? [at(n)!.id] : [])))];
    return th.title && th.summary && ids.length ? [{ title: String(th.title).slice(0, 80), summary: String(th.summary).slice(0, 500), ids }] : [];
  });
  const digest: Digest = { at: new Date().toISOString(), overview: String(a.overview ?? "").slice(0, 900), picks: picks.slice(0, 5), themes: themes.slice(0, 6) };
  setPref("news:digest", digest);
  return digest;
}
