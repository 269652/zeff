import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "../workspace/flows/actions";
import type { FieldSpec } from "../workspace/flows/types";

/**
 * What Zeff knows about the people and things of a meeting, a row or some refs ("what you should know": the brief put together from the people, their open
 * promises, the timeline, related things — held to the sensitivity labels), the meetings of the next hours, and the AI answers Zeff keeps by their input
 * (the AI memo) — for plugins' lambdas and flows. What the Know plugin summarizes; nothing here knows it. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const text = (v: unknown): string => (v == null ? "" : String(v));
const SCOPE = /^[a-z][a-z0-9-]{1,40}$/;

export const KNOW_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "brief.get",
    group: "data",
    label: "What you should know about a meeting, a row or some refs",
    summary: "The brief of a meeting (event, occurrence = its day), a Workspace row (row) or refs (person:<id>, mail:<key> …): its people, open promises, latest events, related things, how much was left out for its sensitivity, and a hash of what it says — { key, brief } ({ key: \"\", brief: null }: nothing to say).",
    input: [f("event", "number"), f("occurrence", "text"), f("row", "number"), f("refs", "list")],
    output: "{ key, brief }",
    run: async (i) => {
      const { briefOfKey } = await import("./summary");
      const got = await briefOfKey({
        event: Number(i.event) > 0 ? Math.floor(Number(i.event)) : undefined,
        occurrence: /^\d{4}-\d{2}-\d{2}/.test(text(i.occurrence)) ? text(i.occurrence).slice(0, 10) : undefined,
        row: Number(i.row) > 0 ? Math.floor(Number(i.row)) : undefined,
        refs: (Array.isArray(i.refs) ? i.refs : []).map((r) => text(r).slice(0, 200)).slice(0, 20),
      });
      return got ? { key: got.key, brief: JSON.parse(JSON.stringify(got.brief)) } : { key: "", brief: null };
    },
  },
  {
    name: "meetings.upcoming",
    group: "calendar",
    label: "The meetings with people in the next hours",
    summary: "The meetings starting within the next minutes (default 180) that have people to say something about, at most limit (default 6): id, occurrence (a series' day), title, start.",
    input: [f("withinMinutes", "number", { default: 180 }), f("limit", "number", { default: 6 })],
    output: "{ meetings: [{ id, occurrence, title, start }] }",
    run: async (i) => {
      const { upcomingMeetings } = await import("./brief");
      return { meetings: upcomingMeetings({ withinMinutes: Math.min(1440, Math.max(5, Number(i.withinMinutes) || 180)) }).slice(0, Math.min(20, Math.max(1, Number(i.limit) || 6))).map((m) => ({ id: m.id, occurrence: m.occurrence, title: m.title, start: m.start })) };
    },
  },
  {
    name: "ai.memo-get",
    group: "ai",
    label: "An AI answer Zeff kept",
    summary: "The answer kept for a scope and a ref (the AI memo: made from an input, kept with its hash): { found, value, hash, at } — the AI is asked again only when the input's hash changed.",
    input: [f("scope", "text", { required: true }), f("ref", "text", { required: true })],
    output: "{ found, value, hash, at }",
    run: async (i) => {
      if (!SCOPE.test(text(i.scope))) throw new Error("scope: lower-case words with dashes.");
      const { memoPeek } = await import("@/lib/ai/memo");
      const r = memoPeek<unknown>(text(i.scope), text(i.ref));
      return r ? { found: true, value: r.value, hash: r.hash, at: r.at } : { found: false, value: null, hash: "", at: "" };
    },
  },
  {
    name: "ai.memo-set",
    group: "ai",
    label: "Keep an AI answer",
    summary: "An AI answer kept by its scope and ref with the hash of the input it was made from (and when).",
    input: [f("scope", "text", { required: true }), f("ref", "text", { required: true }), f("hash", "text", { required: true }), f("value", "json"), f("at", "text")],
    output: "{ ok }",
    writes: true,
    run: async (i) => {
      if (!SCOPE.test(text(i.scope))) throw new Error("scope: lower-case words with dashes.");
      const { memoSet } = await import("@/lib/ai/memo");
      memoSet(text(i.scope), text(i.ref), text(i.hash), i.value ?? null, text(i.at) || new Date().toISOString());
      return { ok: true };
    },
  },
];

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("know", KNOW_FLOW_ACTIONS);
