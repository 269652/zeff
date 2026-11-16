import { findNode, insertNode, moveNode, removeNode, slotOf, updateNode, type Slot } from "@/plugins/studio/tree";
import { normalizeNodes, walkNodes, type FlowNode } from "./types";

/**
 * Edits to a flow's (or capability's) nodes by node id — the AI changes one node, not the whole program. Ids are the anchors.
 * Every op is checked; the result is normalized as a whole; problems come back with the op's number ("op 2: …"). Pure.
 *
 *   { op: "insert", node, slot?: { parent, branch }, index? }   (no slot: the end of the top list)
 *   { op: "replace", id, node }          { op: "update", id, set: { field: value } }
 *   { op: "remove", id }                 { op: "move", id, by: -1 | 1 }
 */
export type NodePatch =
  | { op: "insert"; node: unknown; slot?: Slot; index?: number }
  | { op: "replace"; id: string; node: unknown }
  | { op: "update"; id: string; set: Record<string, unknown> }
  | { op: "remove"; id: string }
  | { op: "move"; id: string; by: -1 | 1 };

const count = (nodes: FlowNode[]) => {
  let n = 0;
  walkNodes(nodes, () => n++);
  return n;
};

export function applyPatch(nodes: FlowNode[], ops: NodePatch[]): { nodes: FlowNode[]; problems: string[] } {
  let cur = structuredClone(nodes);
  const problems: string[] = [];
  ops.forEach((p, i) => {
    const at = `op ${i + 1} (${p.op})`;
    const one = (raw: unknown): FlowNode | null => {
      const made = normalizeNodes([raw]);
      if (made.length !== 1) {
        problems.push(`${at}: not a node I know — it needs a kind (${"action, set, if, …"}) and that kind's fields.`);
        return null;
      }
      return made[0];
    };
    if (p.op === "insert") {
      const n = one(p.node);
      if (!n) return;
      if (findNode(cur, n.id)) return void problems.push(`${at}: the id “${n.id}” is taken.`);
      const slot = p.slot ?? { parent: null, branch: "root" };
      const before = count(cur);
      const next = insertNode(cur, slot, p.index ?? 1e9, n);
      if (count(next) === before) return void problems.push(`${at}: there is no place “${slot.parent ?? "top"}/${slot.branch}”.`);
      cur = next;
    } else if (p.op === "replace") {
      const where = slotOf(cur, p.id);
      const n = one(p.node);
      if (!where || !n) return void (where || problems.push(`${at}: there is no node “${p.id}”.`));
      const without = removeNode(cur, p.id);
      if (findNode(without, n.id)) return void problems.push(`${at}: the id “${n.id}” is taken.`);
      cur = insertNode(without, where.slot, where.index, n);
    } else if (p.op === "update") {
      if (!findNode(cur, p.id)) return void problems.push(`${at}: there is no node “${p.id}”.`);
      const next = updateNode(cur, p.id, p.set as Partial<FlowNode>);
      const again = normalizeNodes(structuredClone(next));
      if (count(again) !== count(next)) return void problems.push(`${at}: the change makes “${p.id}” (or a node inside it) invalid.`);
      cur = again;
    } else if (p.op === "remove") {
      if (!findNode(cur, p.id)) return void problems.push(`${at}: there is no node “${p.id}”.`);
      cur = removeNode(cur, p.id);
    } else if (p.op === "move") {
      if (!findNode(cur, p.id)) return void problems.push(`${at}: there is no node “${p.id}”.`);
      cur = moveNode(cur, p.id, p.by === 1 ? 1 : -1);
    } else problems.push(`${at}: unknown op.`);
  });
  return { nodes: problems.length ? nodes : cur, problems };
}
