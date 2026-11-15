import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "./actions";
import type { FieldSpec } from "./types";

/**
 * What a driver lambda uses to hold a session with Zeff's code (lambdas/session.ts): the next call asked of it, and its answer. Meant for the
 * lambda's own "zeff" list — not for flows. Server only.
 */
const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });

export const SESSION_ACTIONS: FlowAction[] = [
  {
    name: "session.next",
    group: "connectors",
    label: "The next call of a driver session",
    summary: "What Zeff's code asked of this driver session next: { id, tool, args }, { done: true } when it is over, { idle: true } when nothing came yet (ask again).",
    input: [f("sessionId", "text", { required: true })],
    output: "{ id, tool, args } | { done } | { idle }",
    run: async (i) => {
      const { nextCall } = await import("../lambdas/session");
      const n = await nextCall(String(i.sessionId ?? ""));
      return n === "done" ? { done: true } : n === null ? { idle: true } : n;
    },
  },
  {
    name: "session.reply",
    group: "connectors",
    label: "The answer to a call of a driver session",
    summary: "The driver's answer to a call: id, ok, value (or error).",
    input: [f("sessionId", "text", { required: true }), f("id", "number", { required: true }), f("ok", "boolean"), f("value", "json"), f("error", "text")],
    output: "{ ok }",
    run: async (i) => {
      const { replyCall } = await import("../lambdas/session");
      replyCall(String(i.sessionId ?? ""), Number(i.id), { ok: i.ok !== false && i.ok !== "false", value: i.value, error: i.error ? String(i.error) : undefined });
      return { ok: true };
    },
  },
];

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("core:session", SESSION_ACTIONS);
