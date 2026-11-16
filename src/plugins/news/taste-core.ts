/**
 * Your taste, written down — the pure parts: its shape, the instructions of the AI that keeps it (a page of System → Prompts), the shape of its answer, the prompt, the
 * description without an AI and how items are matched against it. No Zeff code beyond them, so the News plugin bundles it (scripts/port-news.mts). Client-safe.
 */
import { analyze, cosine } from "./keyphrase";

export type Signal = { id: number; kind: "like" | "save" | "dislike"; title: string; summary: string; tags: string[]; at: string };
export type Taste = { text: string; likes: string[]; avoids: string[]; queries: string[]; updatedAt: string | null; pending: Signal[]; edited: boolean };


/** Its instructions — a page of System → Prompts. */
export const TASTE_INSTRUCTIONS = "Du führst eine kurze Beschreibung davon, was eine Person gern liest — ihr Nachrichten-Geschmack. Sie wächst mit jedem Artikel, den die Person mit 👍 oder Merken markiert (oder mit 👎 ablehnt).\nSchreibe die Beschreibung fort: neue Vorlieben aufnehmen, Vages schärfen, Widersprüche auflösen, Muster erkennen (Themen, Tonfall, Tiefe, Regionen, Quellenarten) — nicht jeden Artikel einzeln erwähnen. Höchstens 900 Zeichen, Fließtext, Du-Form. Was die Person selbst geschrieben hat, bleibt erhalten, außer es widerspricht den Signalen.\nGib außerdem likes (bis 16 konkrete Begriffe, deutsch und englisch), avoids (bis 8) und queries (bis 6 Suchanfragen, 2–5 Wörter, auch Nachbarthemen) heraus. Nutze nur, was unten steht.";


export type Update = { description?: string; likes?: string[]; avoids?: string[]; queries?: string[] };

export const TASTE_SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string", description: "Die fortgeschriebene Beschreibung, was die Person gern liest — höchstens 900 Zeichen, Fließtext in der Du-Form." },
    likes: { type: "array", items: { type: "string" }, description: "Bis zu 16 konkrete Fachbegriffe/Themen/Namen, die die Person mag — jeweils auf Deutsch UND Englisch (Artikel sind oft englisch), keine allgemeinen Wörter wie Technologie oder Gesundheit." },
    avoids: { type: "array", items: { type: "string" }, description: "Bis zu 8 Begriffe/Themen, die sie meiden will." },
    queries: { type: "array", items: { type: "string" }, description: "Bis zu 6 konkrete Suchanfragen (2–5 Wörter) nach Forschung/Berichten zu den Themen — keine Produkt-, Shopping- oder Werbe-Begriffe." },
  },
  required: ["description", "likes", "avoids", "queries"],
};


export function tastePrompt(current: Taste, signals: Signal[], profile: string[], instructions: string = TASTE_INSTRUCTIONS): string {
  const line = (s: Signal) => `- ${s.title}${s.tags.length ? ` [${s.tags.join(", ")}]` : ""}${s.summary ? ` — ${s.summary.slice(0, 160)}` : ""}`;
  const of = (k: Signal["kind"]) => signals.filter((s) => s.kind === k);
  return [
    instructions,
    "",
    `Bisherige Beschreibung: ${current.text || "(noch keine)"}`,
    `Bisherige Begriffe, die sie mag: ${current.likes.join(", ") || "(keine)"}; meiden: ${current.avoids.join(", ") || "(keine)"}`,
    "",
    "Neue Signale:",
    ...(of("like").length ? ["👍 gefällt:", ...of("like").map(line)] : []),
    ...(of("save").length ? ["🔖 gemerkt:", ...of("save").map(line)] : []),
    ...(of("dislike").length ? ["👎 abgelehnt:", ...of("dislike").map(line)] : []),
    "",
    "Was sonst über die Person bekannt ist:",
    ...(profile.length ? profile.map((p) => `- ${p}`) : ["- (nichts)"]),
  ].join("\n");
}

/** The description without an AI: the tags of what was liked and saved, most often first (and what was rejected). */
export function fallbackTaste(current: Taste, signals: Signal[]): Update {
  const count = (kind: Signal["kind"][]) => {
    const m = new Map<string, number>();
    for (const s of signals.filter((x) => kind.includes(x.kind))) for (const t of s.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  };
  const liked = [...new Set([...count(["like", "save"]), ...current.likes])].slice(0, 12);
  const avoid = [...new Set([...count(["dislike"]), ...current.avoids])].slice(0, 8);
  const text = [liked.length ? `Du liest gern über ${liked.slice(0, 8).join(", ")}.` : "", avoid.length ? `Eher nicht: ${avoid.slice(0, 5).join(", ")}.` : ""].filter(Boolean).join(" ");
  return { description: current.edited && current.text ? `${current.text}${liked.length ? ` Außerdem: ${liked.slice(0, 5).join(", ")}.` : ""}`.slice(0, 900) : text, likes: liked, avoids: avoid, queries: liked.slice(0, 6) };
}


/** Items scored against the description: closeness (TF-IDF) to it, the terms you like in them, the ones you avoid against them. Pure. */
export function matchTaste(taste: Pick<Taste, "text" | "likes" | "avoids">, items: { id: number; title: string; summary: string; terms?: string[] }[]): { id: number; score: number }[] {
  if (!items.length || !(taste.text || taste.likes.length)) return [];
  const docs = [{ id: -1, title: taste.likes.join(" "), summary: taste.text }, ...items.map((i) => ({ id: i.id, title: i.title, summary: i.summary }))];
  const a = analyze(docs);
  const target = a.vectors.get(-1) ?? new Map();
  const likes = taste.likes.map((l) => l.toLowerCase()).filter((l) => l.length >= 3);
  const avoids = taste.avoids.map((l) => l.toLowerCase()).filter((l) => l.length >= 3);
  return items
    .map((i) => {
      const text = `${i.title} ${i.summary} ${(i.terms ?? []).join(" ")}`.toLowerCase();
      let s = cosine(a.vectors.get(i.id) ?? new Map(), target);
      let hits = 0;
      for (const l of likes) if (text.includes(l)) hits++;
      s += Math.min(0.2, hits * 0.05) * (hits >= 2 ? 1 : 0.5);
      for (const l of avoids) if (text.includes(l)) s -= 0.15;
      return { id: i.id, score: s };
    })
    .sort((x, y) => y.score - x.score);
}

