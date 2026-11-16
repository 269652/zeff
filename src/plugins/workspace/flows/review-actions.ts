import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "./actions";
import type { FieldSpec } from "./types";

/**
 * The kernel's actions for the Workspace's AI reviews and what runs after them, for plugins' flows: boards get their review set up, every database with its
 * review on is reviewed, the AI blocks and the pipelines with AI steps are written again — what the briefing's steps do, nothing here knows which plugin
 * asks. Needs the flow's `ai` permission. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });

export const REVIEW_ACTIONS: FlowAction[] = [
  {
    name: "workspace.ensure-reviews",
    group: "workspace",
    label: "Boards get their review",
    summary: "Every board of the Workspace without a pipeline of its own (the Jira boards, your own boards) gets the briefing's fields (attention, lead, summary) and the AI review of the cards that changed lately — once; the fields out of its views.",
    input: [],
    output: "{ ok }",
    writes: true,
    run: async (_i, ctx) => {
      if (ctx.dryRun) return { ok: true };
      await (await import("@/plugins/workspace/lage-fields")).ensureBoardReviews();
      return { ok: true };
    },
  },
  {
    name: "workspace.review-databases",
    group: "workspace",
    label: "Review the databases",
    summary: "Every database with the AI review on, reviewed one after the other (only the cards that changed, or all with force): { reviewed, unchanged, failed, error } summed up.",
    input: [f("force", "boolean", { help: "All cards again, not only those that changed" })],
    output: "{ reviewed, unchanged, failed, error }",
    needs: ["ai"],
    writes: true,
    run: async (i, ctx) => {
      ctx.may("ai");
      if (ctx.dryRun) return { reviewed: 0, unchanged: 0, failed: 0, error: "" };
      const results = await (await import("@/plugins/workspace/review")).reviewDatabases({ force: i.force === true || i.force === "true" });
      const sum = (k: "reviewed" | "unchanged" | "failed") => results.reduce((n, r) => n + r[k], 0);
      return { reviewed: sum("reviewed"), unchanged: sum("unchanged"), failed: sum("failed"), error: results.find((r) => r.error)?.error ?? "" };
    },
  },
  {
    name: "workspace.refresh-ai-blocks",
    group: "workspace",
    label: "Write the AI blocks again",
    summary: "The AI blocks set to go with the briefing (a database's overall picture among them) written again: { pages, written, failed }.",
    input: [],
    output: "{ pages, written, failed }",
    needs: ["ai"],
    writes: true,
    run: async (_i, ctx) => {
      ctx.may("ai");
      if (ctx.dryRun) return { pages: 0, written: 0, failed: 0 };
      return (await import("@/plugins/workspace/ai-block")).refreshAiBlocks();
    },
  },
  {
    name: "workspace.run-pipelines",
    group: "workspace",
    label: "Run the pipelines",
    summary: "The databases with a pipeline read their sources again — with ai: their AI steps too (the fields of the rows that changed, the summaries).",
    input: [f("ai", "boolean")],
    output: "{ ok }",
    needs: ["ai"],
    writes: true,
    run: async (i, ctx) => {
      const ai = i.ai === true || i.ai === "true";
      if (ai) ctx.may("ai");
      if (ctx.dryRun) return { ok: true };
      await (await import("@/plugins/workspace/pipeline")).runPipelines({ ai });
      return { ok: true };
    },
  },
];

// The kernel's own: always there (read with the other flow actions — flows/actions.ts flowActions()).
extensionPoint<FlowAction[]>("workspace.flowActions").contribute("core:reviews", REVIEW_ACTIONS);
