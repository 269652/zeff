import type { VNode } from "./card-template";

/**
 * What a view's first screen still waits for: the <data> drawn that haven't answered yet (failed or waiting counts as answered, a kept
 * answer too; a <data when=""> is off). Until none is left the view shows the loading screen, not its static parts around empty data.
 */
export function dataAwaited(nodes: VNode[], data: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (ns: VNode[]) => {
    for (const n of ns) {
      if (typeof n === "string") continue;
      if (n.t === "data" && n.a.name) {
        const off = n.a.when !== undefined && !n.a.when.trim();
        const status = data[`${n.a.name}_status`];
        const answered = status === "ok" || status === "stale" || status === "error" || status === "waiting" || (status === "loading" && data[n.a.name] != null);
        if (!off && !answered) out.push(n.a.name);
      }
      walk(n.c);
    }
  };
  walk(nodes);
  return out;
}
