import { connection } from "next/server";
import { foreignRequest, refused } from "@/lib/request-guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/workspace/data { kind: "flow" | "lambda" | "do", name, input, row?, peek? } — what a view's <data> asks for.
 *
 * Why not the server actions: Next runs one browser's server actions one after the other, so every <data> of a page (and every other
 * action it fires — the sync menu, the asks) waited for the one before it: a waterfall. Requests to a route run side by side.
 *
 *  - peek: the last answer kept for this (data_cache — lib/data-cache.ts), at once, nothing computed → { hit, at, answer }.
 *  - otherwise: computed now (the same flow / lambda / action as before — same checks, same answer shape), kept for the next
 *    peek. The same thing asked twice at once is computed once. A `do` (it may change things) is never kept.
 * Only from Zeff's own page.
 */
export async function POST(req: Request) {
  await connection();
  const why = foreignRequest(req);
  if (why) return refused(why);
  const b = ((await req.json().catch(() => null)) ?? {}) as { kind?: unknown; name?: unknown; input?: unknown; row?: unknown; peek?: unknown };
  const kind = b.kind === "lambda" || b.kind === "do" ? b.kind : "flow";
  const name = String(b.name ?? "");
  const input = b.input && typeof b.input === "object" && !Array.isArray(b.input) ? (b.input as Record<string, unknown>) : {};
  const row = Number(b.row) > 0 ? Number(b.row) : undefined;
  if (!name) return Response.json({ ok: false, error: "No name." }, { status: 400 });
  const cache = await import("@/lib/data-cache");
  const key = cache.answerKey(kind, name, input, row);
  if (b.peek === true) {
    if (kind === "do") return Response.json({ hit: false });
    const kept = cache.peekAnswer(key);
    return Response.json(kept ? { hit: true, at: kept.at, answer: kept.answer } : { hit: false });
  }
  const actions = await import("@/plugins/workspace/actions/flows");
  const compute = (): Promise<unknown> => (kind === "do" ? actions.runUserAction(name, { ...(row ? { row } : {}), ...input }, { auto: true }).then((r) => (r.ok ? { ok: true as const, status: "done" as const, output: r.output, error: null } : r)) : kind === "lambda" ? actions.runLambdaAction(name, input) : actions.runFlowAction(name, input, { row }));
  const answer = (await (kind === "do" ? compute() : cache.inflight(key, compute))) as { ok?: boolean; status?: string };
  if (kind !== "do" && answer?.ok && answer.status === "done") cache.rememberAnswer(key, answer);
  return Response.json(answer);
}
