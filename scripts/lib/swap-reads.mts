/**
 * The generators' last step: a plugin's lambdas and flows call the kernel's plain reads by name (people.names, todos.texts …). Each of
 * them has an exact SQL replacement as a capability (src/plugins/workspace/flows/declare.ts READ_REPLACEMENTS: read.<name>), so the
 * kernel's code for it can go. This rewrites a generated plugin folder to call `read.<name>` and to carry the table grants the
 * replacement needs: `"sql": [...]` (and `"sqlMaxRows"` where the answer can be big) in each lambda.json, `permissions.sql` in each flow.
 * Idempotent: a folder already swapped is left as it is.
 */
import fs from "node:fs";
import path from "node:path";

export const SWAPS: Record<string, { tables: string[]; maxRows?: number }> = {
  "todos.texts": { tables: ["todos"] },
  "todos.by-ids": { tables: ["todos"] },
  "messages.count": { tables: ["emails"] },
  "people.names": { tables: ["people"] },
  "people.emails": { tables: ["people"] },
  "mail.messages": { tables: ["emails"], maxRows: 50000 },
  "documents.texts": { tables: ["documents"] },
};

const NAMES = Object.keys(SWAPS).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
// zeff.call("people.names" …) / context.zeff.call('people.names' …)
const CALL = new RegExp(`(zeff\\.call\\(\\s*)(["'])(${NAMES})\\2`, "g");

type Used = { tables: Set<string>; maxRows: number };
const swapText = (code: string, used: Used): string =>
  code.replace(CALL, (_m, head: string, q: string, name: string) => {
    for (const t of SWAPS[name].tables) used.tables.add(t);
    used.maxRows = Math.max(used.maxRows, SWAPS[name].maxRows ?? 0);
    return `${head}${q}read.${name}${q}`;
  });

/** Rewrites one generated plugin folder; returns what changed (file names). */
export function swapPlugin(dir: string): string[] {
  const changed: string[] = [];
  const lambdas = path.join(dir, "lambdas");
  if (fs.existsSync(lambdas)) {
    for (const name of fs.readdirSync(lambdas)) {
      const folder = path.join(lambdas, name);
      const manifestFile = path.join(folder, "lambda.json");
      if (!fs.statSync(folder).isDirectory() || !fs.existsSync(manifestFile)) continue;
      const used: Used = { tables: new Set(), maxRows: 0 };
      for (const f of fs.readdirSync(folder).filter((x) => /\.mjs$/.test(x))) {
        const file = path.join(folder, f);
        const before = fs.readFileSync(file, "utf8");
        const after = swapText(before, used);
        if (after !== before) (fs.writeFileSync(file, after), changed.push(path.relative(dir, file)));
      }
      const m = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as { zeff?: string[]; sql?: string[]; sqlMaxRows?: number };
      const zeff = (m.zeff ?? []).map((z) => (SWAPS[z] ? `read.${z}` : z));
      for (const z of m.zeff ?? []) if (SWAPS[z]) for (const t of SWAPS[z].tables) used.tables.add(t), (used.maxRows = Math.max(used.maxRows, SWAPS[z].maxRows ?? 0));
      if (JSON.stringify(zeff) !== JSON.stringify(m.zeff ?? []) || (used.tables.size && !(m.sql ?? []).length)) {
        m.zeff = zeff;
        m.sql = [...new Set([...(m.sql ?? []), ...used.tables])].sort();
        if (used.maxRows > 5000) m.sqlMaxRows = used.maxRows;
        fs.writeFileSync(manifestFile, JSON.stringify(m, null, 2) + "\n");
        changed.push(path.relative(dir, manifestFile));
      }
    }
  }
  // Flows (packages): an action node of a swapped read → read.<name>, and the flow's permissions carry the tables.
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => /\.package\.json$/.test(x)) : []) {
    const file = path.join(dir, f);
    const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    let touched = false;
    const visit = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(visit);
      if (!v || typeof v !== "object") return;
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.nodes) && typeof o.name === "string") {
        const used: Used = { tables: new Set(), maxRows: 0 };
        const swapNodes = (nodes: unknown): void => {
          if (Array.isArray(nodes)) return nodes.forEach(swapNodes);
          if (!nodes || typeof nodes !== "object") return;
          const n = nodes as Record<string, unknown>;
          if (n.kind === "action" && typeof n.action === "string" && SWAPS[n.action]) {
            for (const t of SWAPS[n.action].tables) used.tables.add(t);
            used.maxRows = Math.max(used.maxRows, SWAPS[n.action].maxRows ?? 0);
            n.action = `read.${n.action}`;
            touched = true;
          }
          for (const x of Object.values(n)) swapNodes(x);
        };
        swapNodes(o.nodes);
        if (used.tables.size) {
          const p = (o.permissions && typeof o.permissions === "object" ? o.permissions : {}) as Record<string, unknown>;
          p.sql = [...new Set([...((p.sql as string[] | undefined) ?? []), ...used.tables])].sort();
          if (used.maxRows > 5000) p.sqlMaxRows = used.maxRows;
          o.permissions = p;
        }
      }
      for (const x of Object.values(o)) visit(x);
    };
    visit(pkg);
    if (touched) (fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n"), changed.push(f));
  }
  return changed;
}

// Run on a plugins folder from the shell: npx tsx scripts/lib/swap-reads.mts ../zeff-plugins/plugins/cases-ext
import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  for (const d of process.argv.slice(2)) console.log(d, swapPlugin(path.resolve(d)));
}
