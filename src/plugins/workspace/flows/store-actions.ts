import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { ActionCtx, FlowAction } from "./actions";
import type { FieldSpec } from "./types";

/**
 * The kernel's store actions (lib/ext/stores.ts — capability E): a plugin's own data read and written by key. A flow needs the permission
 * `store: ["<plugin>.<store>"]` (a plugin's package asks for it, you allow it when installing); a plugin's lambdas read their own plugin's
 * stores (lambdas/run.ts). Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string | number | boolean | null>) : {});

function allowed(store: unknown, ctx: ActionCtx): string {
  const s = String(store ?? "").trim();
  if (!(ctx.perms.store ?? []).includes(s)) throw new Error(`This flow may not use the store “${s}” — grant it under the flow's permissions (store).`);
  return s;
}

export const STORE_ACTIONS: FlowAction[] = [
  {
    name: "store.query",
    group: "data",
    label: "Read a plugin's store",
    summary: 'Rows of a plugin\'s store ("<plugin>.<store>"): those whose columns equal where\'s values (null: empty), by order ("col", "-col": newest first), at most limit (500).',
    input: [f("store", "text", { required: true }), f("where", "json"), f("order", "text"), f("limit", "number", { default: 100 }), f("offset", "number")],
    output: "{ rows, total }",
    run: async (i, ctx) => (await import("@/lib/ext/stores")).storeQuery(allowed(i.store, ctx), { where: obj(i.where), order: typeof i.order === "string" ? i.order : undefined, limit: Number(i.limit) || undefined, offset: Number(i.offset) || undefined }),
  },
  {
    name: "store.put",
    group: "data",
    label: "Write to a plugin's store",
    summary: "Rows written to a plugin's store, each by its key: added, or the row with that key changed in the columns it names.",
    input: [f("store", "text", { required: true }), f("rows", "json", { required: true }), f("back", "boolean", { help: "Give the rows back as they are now (an id the table gave a new row in them)" })],
    output: "{ written, rows? }",
    writes: true,
    run: async (i, ctx) => {
      const store = allowed(i.store, ctx);
      const rows = Array.isArray(i.rows) ? (i.rows as Record<string, unknown>[]) : i.rows && typeof i.rows === "object" ? [i.rows as Record<string, unknown>] : [];
      if (ctx.dryRun) return { written: 0, dryRun: rows.length };
      return (await import("@/lib/ext/stores")).storePut(store, rows, { back: i.back === true || i.back === "true" });
    },
  },
  {
    name: "store.delete",
    group: "data",
    label: "Remove from a plugin's store",
    summary: "The rows of a plugin's store whose columns equal where's values removed (where must name something).",
    input: [f("store", "text", { required: true }), f("where", "json", { required: true })],
    output: "{ deleted }",
    writes: true,
    run: async (i, ctx) => {
      const store = allowed(i.store, ctx);
      if (ctx.dryRun) return { deleted: 0, dryRun: true };
      return (await import("@/lib/ext/stores")).storeDelete(store, obj(i.where));
    },
  },
];

// The kernel's own: always there (read with the other flow actions — flows/actions.ts flowActions()).
extensionPoint<FlowAction[]>("workspace.flowActions").contribute("core:stores", STORE_ACTIONS);
