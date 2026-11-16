/**
 * "What you should know" (the know plugin): the AI's short summary on top of a brief — a few points, each resting on numbered
 * lines of the brief (its people, open loops, latest events, related things) and linked to them; a point without a valid line is
 * dropped. Kept per brief (a meeting "event:<id>", a row "row:<id>", a ref) with the brief's hash: the AI is asked again only when
 * what the brief says changed — no call when nothing did. Made before your meetings with the briefing (prepareMeetingBriefs,
 * hooked into the People matching step; a switch turns it off) and when you ask on a panel. Your verdict on one goes to the
 * learning ledger. The brief is already cut to what may be seen; the LLM layer leaves secret lines out of every prompt. Server only.
 */
import { memoMigrate, memoPeek, memoSet } from "@/lib/ai/memo";
import { recordFeedback } from "@/lib/learning/ledger";
import { getPref, setPref } from "@/lib/prefs";
import { fillPrompt } from "@/lib/prompts";
import { isInstalled } from "@/plugins/state";
import { briefFor, meetingBrief, upcomingMeetings, type HealthLike } from "./brief";
import { briefEmpty, type Brief, type BriefSummary } from "./shared";
import { KNOW_SUMMARY_INSTRUCTIONS, SCHEMA, day, meetingKey, summaryLines } from "./summary-lines";
export { KNOW_SUMMARY_INSTRUCTIONS, meetingKey, summaryLines };

/** What the AI answers. */
type Answer = { points?: { text?: string; sources?: number[] }[] };
/** An AI: the prompt and the schema in, its JSON out (null: none). */
export type SummaryAi = (prompt: string, schema: object) => Promise<Answer | null>;

const AUTO = "know.autoSummary";
/** Whether the summaries are made before your meetings by themselves (with the briefing) — on until you switch it off. */
export const autoSummary = (): boolean => getPref<boolean>(AUTO, true) !== false;
export const setAutoSummary = (on: boolean): void => setPref(AUTO, on);

/** How far ahead the briefing makes the summaries of meetings, and at most how many a run. */
const AHEAD_MINUTES = 180;
const PER_RUN = 6;

/** The summaries made: in the AI memo (lib/ai/memo; the old table know_summaries moved in once) — by key, at the brief's hash. */
const SCOPE = "know-summary";
const migrate = () => memoMigrate(SCOPE, "know_summaries", "select 'know-summary' as scope, key as ref, hash, points as value, at from know_summaries");

/** The summary kept for `key` — `current` when it was made from this hash (null hash: any). null: none made yet. */
export function cachedSummary(key: string, hash: string | null): BriefSummary | null {
  migrate();
  const r = memoPeek<BriefSummary["points"]>(SCOPE, key);
  if (!r) return null;
  const points = Array.isArray(r.value) ? r.value : [];
  return { points, hash: r.hash, at: r.at, current: hash == null || r.hash === hash };
}

/** The default AI: the LLM layer's task "know-summary". */
const llmAi: SummaryAi = async (prompt, schema) => {
  const { runAi } = await import("@/lib/ai");
  return (await runAi<Answer>(prompt, schema, { task: "know-summary", timeoutMs: 180000 })).output ?? null;
};

/**
 * The summary of a brief, made by the AI only when none is kept for this brief as it is now (`force`: again anyway). null for a
 * brief with nothing to say (no call) or when the AI gave nothing usable.
 */
export async function summarizeBrief(key: string, b: Brief, opts: { ai?: SummaryAi; force?: boolean } = {}): Promise<BriefSummary | null> {
  if (briefEmpty(b)) return null;
  const had = cachedSummary(key, b.hash);
  if (had?.current && !opts.force) return had;
  const lines = summaryLines(b);
  const what = b.meeting ? `den Termin „${b.meeting.title}“ (${day(b.meeting.start)})` : `„${b.label}“`;
  const prompt = `${fillPrompt("know-summary", KNOW_SUMMARY_INSTRUCTIONS, { what })}\n${JSON.stringify(SCHEMA)}\n\n${lines.map((l, i) => `[${i + 1}] ${l.text}`).join("\n")}`;
  const answer = await (opts.ai ?? llmAi)(prompt, SCHEMA);
  const points = (answer?.points ?? []).flatMap((p) => {
    const text = String(p.text ?? "").trim().slice(0, 400);
    const sources = [...new Set((Array.isArray(p.sources) ? p.sources : []).map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= lines.length).map((n) => lines[n - 1].link);
    return text && sources.length ? [{ text, sources }] : [];
  });
  if (!points.length) return had;
  const at = new Date().toISOString();
  memoSet(SCOPE, key, b.hash, points, at);
  return { points, hash: b.hash, at, current: true };
}

/**
 * Before your meetings (run with the briefing — the People matching step): the summaries of the meetings with people in the next
 * hours made where none is kept for them as they are now. Off with the switch, without the LLM plugin (unless an AI is given —
 * tests) or this plugin. How many were made.
 */
export async function prepareMeetingBriefs(opts: { now?: Date; ai?: SummaryAi; health?: HealthLike[] | null } = {}): Promise<{ made: number }> {
  if (!isInstalled("know") || !autoSummary() || (!opts.ai && !isInstalled("llm"))) return { made: 0 };
  let made = 0;
  for (const m of upcomingMeetings({ now: opts.now, withinMinutes: AHEAD_MINUTES }).slice(0, PER_RUN)) {
    const b = await meetingBrief(m.id, { now: opts.now, occurrence: m.occurrence ?? undefined, health: opts.health });
    if (!b) continue;
    const key = meetingKey(m.id, m.occurrence);
    if (cachedSummary(key, b.hash)?.current) continue;
    try {
      if (await summarizeBrief(key, b, { ai: opts.ai })) made++;
    } catch (e) {
      console.error("[know] meeting summary:", e);
    }
  }
  return { made };
}

/** Your verdict on a summary (helpful or not) — kept in the learning ledger (step "know-summary"). */
export function rateSummary(key: string, verdict: "accepted" | "rejected"): void {
  recordFeedback({ step: "know-summary", itemRef: key, verdict, kind: key.split(":")[0] });
}

/** The brief for a key as the panels and the MCP ask for it: a meeting, a row, or refs. */
export async function briefOfKey(q: { event?: number; occurrence?: string; row?: number; refs?: string[] }, now = new Date()): Promise<{ key: string; brief: Brief } | null> {
  if (q.event) {
    const b = await meetingBrief(q.event, { now, occurrence: q.occurrence });
    return b ? { key: meetingKey(q.event, q.occurrence), brief: b } : null;
  }
  if (q.row) {
    const { rowEvent, rowRefs } = await import("./brief");
    // An appointment's row (the calendar database): its meeting's brief.
    const ev = rowEvent(q.row);
    if (ev) return briefOfKey({ event: ev.id, occurrence: ev.occurrence }, now);
    const { labelOf } = await import("@/plugins/timeline/refs");
    return { key: `row:${q.row}`, brief: await briefFor(rowRefs(q.row), { now, label: labelOf(`page:${q.row}`) }) };
  }
  const refs = (q.refs ?? []).filter(Boolean);
  return refs.length ? { key: `ref:${refs.join(",")}`, brief: await briefFor(refs, { now }) } : null;
}
