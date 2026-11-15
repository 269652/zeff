import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "./actions";
import type { FieldSpec } from "./types";

/**
 * Rows changed many at once — what a view does with the rows ticked in it (<check>, state.picked): their fields set by name, the way a
 * person types them (a choice by its name, made when new; a date as written), or the rows moved to the trash. Any database: each row's
 * own is checked (`write`). A view's button does them as you (flows/user-actions.ts), a flow with its write permission. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
/** The row ids of a list, a JSON list ("[3,4]") or a text ("3, 4"). */
export function rowIds(v: unknown, max = 500): number[] {
  let xs: unknown[] = [];
  if (Array.isArray(v)) xs = v;
  else if (typeof v === "string" && v.trim().startsWith("[")) {
    try {
      const j = JSON.parse(v) as unknown;
      xs = Array.isArray(j) ? j : [];
    } catch {
      xs = [];
    }
  } else xs = String(v ?? "").split(",");
  return [...new Set(xs.map((x) => Number(typeof x === "string" ? x.trim() : x)).filter((n) => Number.isInteger(n) && n > 0))].slice(0, max);
}
const text = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : v === null || v === undefined ? "" : JSON.stringify(v));

export const ROWS_ACTIONS: FlowAction[] = [
  {
    name: "rows.update",
    group: "data",
    label: "Change rows",
    summary: 'Fields set on these rows, by name, as a person types them (several at once — the rows ticked in a view): rows (ids), values {"Status": "Done"} — a choice by its name (made when new), a date as written, "yes"/"no" for a checkbox; the title by its name or "title".',
    input: [f("rows", "list", { required: true }), f("values", "json", { required: true })],
    output: "{ changed }",
    writes: true,
    needs: ["write"],
    run: async (i, ctx) => {
      const store = await import("../store");
      const { setFields } = await import("../api");
      const values = Object.fromEntries(Object.entries(i.values && typeof i.values === "object" && !Array.isArray(i.values) ? (i.values as Record<string, unknown>) : {}).map(([k, x]) => [k, typeof x === "boolean" ? (x ? "yes" : "no") : Array.isArray(x) ? x.map(text).join(", ") : text(x)]));
      if (!Object.keys(values).length) throw new Error("rows.update: values names no field.");
      let changed = 0;
      for (const id of rowIds(i.rows)) {
        const page = store.getPage(id);
        if (!page?.dbId) continue;
        ctx.canWrite(page.dbId);
        setFields(page.dbId, id, values);
        changed++;
      }
      return { changed, what: changed === 1 ? "1 row changed" : `${changed} rows changed` };
    },
  },
  {
    name: "rows.archive",
    group: "data",
    label: "Move rows to the trash",
    summary: "These rows moved to the trash (they can be brought back) — several at once.",
    input: [f("rows", "list", { required: true })],
    output: "{ archived }",
    writes: true,
    needs: ["write"],
    run: async (i, ctx) => {
      const store = await import("../store");
      let archived = 0;
      for (const id of rowIds(i.rows)) {
        const page = store.getPage(id);
        if (!page?.dbId || page.archivedAt) continue;
        ctx.canWrite(page.dbId);
        store.archivePage(id);
        archived++;
      }
      return { archived, what: archived === 1 ? "1 row moved to the trash" : `${archived} rows moved to the trash` };
    },
  },
];

// The kernel's own: always there (read with the other flow actions — flows/actions.ts flowActions()).
extensionPoint<FlowAction[]>("workspace.flowActions").contribute("core:rows", ROWS_ACTIONS);
