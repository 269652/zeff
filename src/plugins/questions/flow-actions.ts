import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "../workspace/flows/actions";
import type { FieldSpec } from "../workspace/flows/types";

/**
 * Zeff's query layer over its own data (views.ts: named read-only views — time entries, bank, calendar, todos, messages, Workspace databases —
 * each with its typed filters, groupings and measures; checked before anything runs, held to the sensitivity labels) for plugins' lambdas and flows:
 * the views as an AI reads them, and queries checked and run. What the Questions plugin plans and phrases over; nothing here knows it. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const viaOf = (v: unknown): "chat" | "mcp" => (v === "mcp" ? "mcp" : "chat");

export const QUESTION_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "data.views",
    group: "data",
    label: "The views over Zeff's own data",
    summary:
      "The named read-only views a question about numbers and dates can use, as an AI reads them: name, description, filters (type, allowed values, required), groupings (dims; dynamic: a database's properties), measures — and the Workspace databases for the view `workspace` (id, title, properties), today, the aggregates and the time groupings. Held to what the asker may read (via: chat | mcp).",
    input: [f("via", "text", { help: "chat | mcp" })],
    output: "{ views, databases, today, aggregates, timeDims }",
    run: async (i) => {
      const { AGGREGATES, TIME_DIMS, listViews } = await import("./views");
      const { workspaceDatabases } = await import("./builtin-views");
      const { isoDay } = await import("@/lib/text");
      const ctx = { via: viaOf(i.via) };
      const views = listViews(ctx);
      return {
        views: views.map((v) => ({ name: v.name, description: v.description, filters: v.filters, dims: v.dims, measures: v.measures, dynamic: !!v.dynamic })),
        databases: views.some((v) => v.name === "workspace") ? workspaceDatabases(60, ctx) : [],
        today: isoDay(new Date()),
        aggregates: [...AGGREGATES],
        timeDims: [...TIME_DIMS],
      };
    },
  },
  {
    name: "data.query",
    group: "data",
    label: "Check and run queries over Zeff's own data",
    summary: "Queries ({ view, filters, groupBy, aggregate, measure, order, limit } — up to 3) checked against their views, then run: { ok: true, results } — or { ok: false, error } naming what is wrong with the first that isn't (a Workspace database's property names are only known when it runs). Results: the query, how it was computed, the total, the groups and the rows behind them with their links.",
    input: [f("queries", "json", { required: true }), f("via", "text", { help: "chat | mcp" })],
    output: "{ ok, results } or { ok: false, error }",
    run: async (i) => {
      const { runQuery, validateQuery } = await import("./views");
      const { errorMessage } = await import("@/lib/errors");
      const ctx = { via: viaOf(i.via) };
      const queries = (Array.isArray(i.queries) ? i.queries : []).slice(0, 3);
      if (!queries.length) return { ok: false, error: "No queries." };
      for (const q of queries) {
        const v = validateQuery(q, ctx);
        if (!v.ok) return { ok: false, error: v.error };
      }
      try {
        const results = [];
        for (const q of queries) results.push(await runQuery(q, ctx));
        return { ok: true, results: JSON.parse(JSON.stringify(results)) };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },
  },
  {
    name: "data.answer",
    group: "data",
    label: "Answer a question from Zeff's own data, if it is one",
    summary: "A question about numbers and dates answered from the person's own data, the way the knowledge chat does: { answer: { answer, sources, entities, searchedFor, model, durationMs, structured } } — or { answer: null } when it is a question about text, the structured questions aren't there or the AI failed.",
    input: [f("question", "text", { required: true }), f("history", "json")],
    output: "{ answer }",
    needs: ["ai"],
    run: async (i, ctx) => {
      ctx.may("ai");
      const { chatAnswer } = await import("./ask");
      const history = (Array.isArray(i.history) ? i.history : []).slice(-8).map((h: { role?: unknown; text?: unknown }) => ({ role: h?.role === "assistant" ? "assistant" : "user", text: String(h?.text ?? "").slice(0, 4000) }));
      return { answer: JSON.parse(JSON.stringify(await chatAnswer(String(i.question ?? "").trim(), history))) };
    },
  },
];

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("questions", QUESTION_FLOW_ACTIONS);
