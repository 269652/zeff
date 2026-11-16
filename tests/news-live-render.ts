import type { VNode } from "@/plugins/workspace/view-template";

/**
 * A view as the browser draws it: rendered, its <data lambda=…> asked (each with the `with` the render gave, strings as the page sends them), rendered again with the
 * answers — until nothing new is asked. What `renderView` reports in the end is what the person sees as template errors. `state`: what the page's state is (the view's
 * <state> defaults come first; these are set over them).
 */
export type Drawn = { errors: { line?: number; message: string }[]; nodes: VNode[]; data: Record<string, unknown>; asked: string[] };

type N = Extract<VNode, object>;
const flat = (nodes: VNode[]): N[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [n, ...flat(n.c)]));

export async function drawLive(template: string, state: Record<string, string> = {}, base: { rows?: never[]; app?: Record<string, unknown> } = {}): Promise<Drawn> {
  await import("@/plugins/contributions");
  const { invokeLambda } = await import("@/plugins/workspace/lambdas/run");
  const { parseWith } = await import("@/plugins/workspace/flows/with");
  const { renderView } = await import("@/plugins/workspace/view-template");
  const data: Record<string, unknown> = {};
  const asked: string[] = [];
  const done = new Set<string>();
  let out = renderView(template, { rows: [], props: [], titleName: "Title", app: base.app ?? {}, db: { id: 1, title: "View" }, state, data });
  for (let round = 0; round < 6; round++) {
    const todo = flat(out.nodes as VNode[]).filter((n) => n.t === "data" && n.a.lambda && !(n.a.when !== undefined && !n.a.when.trim()));
    let fresh = false;
    for (const d of todo) {
      const key = `${d.a.name}|${d.a.lambda}|${d.a.with ?? ""}`;
      if (done.has(key)) continue;
      done.add(key);
      fresh = true;
      asked.push(key);
      const r = await invokeLambda(d.a.lambda, parseWith(d.a.with));
      if (!r.ok) {
        data[d.a.name] = undefined;
        data[`${d.a.name}_status`] = "error";
        data[`${d.a.name}_error`] = r.error;
        throw new Error(`<data name="${d.a.name}" lambda="${d.a.lambda}"> failed: ${r.error}`);
      }
      data[d.a.name] = r.result;
      data[`${d.a.name}_status`] = "ok";
    }
    out = renderView(template, { rows: [], props: [], titleName: "Title", app: base.app ?? {}, db: { id: 1, title: "View" }, state: { ...out.state, ...state }, data });
    if (!fresh) break;
  }
  return { errors: out.errors, nodes: out.nodes as VNode[], data, asked };
}

export { flat };
