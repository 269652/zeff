import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "@/plugins/workspace/flows/actions";

/** What the Documents plugin lets lambdas and flows read (while it is built in): your letters that are read, with their text. Server only. */
export const DOCUMENTS_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "documents.texts",
    group: "documents",
    label: "Your letters' texts",
    summary: "The documents that are read (OCR and summary done): name, summary, the start of their text (up to chars, 6000 by default), when they came.",
    input: [{ name: "chars", type: "number", default: 6000 }],
    output: "{ docs: [{ id, name, summary, text, at }] }",
    run: async (i) => {
      const { getSqlite } = await import("@/db");
      const chars = Math.max(100, Math.min(20000, Number(i.chars) || 6000));
      try {
        return { docs: getSqlite().prepare("select id, name, summary, substr(text, 1, ?) text, created_at at from documents where status = 'ready'").all(chars) };
      } catch {
        return { docs: [] }; // (never ran here)
      }
    },
  },
];

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("documents", DOCUMENTS_FLOW_ACTIONS);
