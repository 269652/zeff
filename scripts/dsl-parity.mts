/**
 * Parity of a lambda and its server-DSL flow: the same events through both, against the same database — the real lambda (its own
 * process, the sandbox, the kernel's pref.get with its adoptable-preference check) and the flow (the interpreter, core.pref.get with
 * the flow's grant) — and what each gives back, compared.
 *
 *   DATABASE_PATH=<a COPY of data/zeff.db> npx tsx scripts/dsl-parity.mts
 *
 * Never run it against the live database: it makes a flow page and sets a lambda up in it (the test passes a temp one).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FIX = path.join(process.cwd(), "tests", "fixtures", "server-dsl");

export type ParityCase = { event: Record<string, unknown>; seed?: unknown };
export type ParityRow = { event: Record<string, unknown>; lambda: unknown; flow: unknown; same: boolean };

/** The recipient-marking lambda of the Finances port and its flow, over these events (each with the preference as it is before). */
export async function accountMarkParity(cases: ParityCase[]): Promise<ParityRow[]> {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "studio"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  const { builtinLambdasPoint } = await import("@/plugins/workspace/lambdas/store");
  const { invokeLambda } = await import("@/plugins/workspace/lambdas/run");
  const { createFlow } = await import("@/plugins/workspace/flows/store");
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const { setPref, getPref } = await import("@/lib/prefs");

  // The real lambda, registered as the Finances plugin's (its pref.get is checked against that plugin's adoptable preferences).
  const dir = path.join(FIX);
  builtinLambdasPoint.provide("dsl-parity", () => [{ plugin: "ext:finances-ext", impl: { dir } }]);
  const flowDef = JSON.parse(fs.readFileSync(path.join(FIX, "finances.account-mark.flow.json"), "utf8"));
  const flow = createFlow({ ...flowDef, name: `dsl.account-mark.${Date.now().toString(36)}` });

  const rows: ParityRow[] = [];
  for (const c of cases) {
    setPref("finances.ownAccounts", c.seed ?? null);
    const l = await invokeLambda("finances.account-mark", c.event);
    const lambda = l.ok ? l.result : { error: l.error.replace(/^Error: /, "") };
    setPref("finances.ownAccounts", c.seed ?? null);
    const f = await runFlow(flow, { key: c.event.key as string, kind: c.event.kind as string });
    const flowOut = f.status === "done" ? f.output : { error: f.error };
    rows.push({ event: c.event, lambda, flow: flowOut, same: JSON.stringify(lambda) === JSON.stringify(flowOut) || (!!(lambda as { error?: string }).error && String((flowOut as { error?: string }).error).includes((lambda as { error: string }).error)) });
  }
  // (and the flow keeps what the lambda only returns)
  setPref("finances.ownAccounts", { DE00: "own" });
  await runFlow(flow, { key: "DE11", kind: "credit", save: true });
  const kept = getPref("finances.ownAccounts", null);
  rows.push({ event: { key: "DE11", kind: "credit", save: true }, lambda: { value: { DE00: "own", DE11: "credit" } }, flow: kept, same: JSON.stringify(kept) === JSON.stringify({ DE00: "own", DE11: "credit" }) });
  return rows;
}

const CASES: ParityCase[] = [
  { event: { key: "DE89 3704 0044", kind: "own" }, seed: null },
  { event: { key: "  DE89  ", kind: "credit" }, seed: { "DE89": "own", ACME: "credit" } },
  { event: { key: "ACME", kind: "none" }, seed: { "DE89": "own", ACME: "credit" } },
  { event: { key: "ACME", kind: "weird" }, seed: { ACME: "own" } },
  { event: { key: "ACME" }, seed: { ACME: "own", B: "credit" } },
  { event: { key: "", kind: "own" }, seed: { ACME: "own" } },
  { event: { key: "   ", kind: "own" }, seed: null },
  { event: { kind: "own" }, seed: {} },
  { event: { key: 42, kind: "own" }, seed: { "42": "credit", z: "own" } },
  { event: { key: "NEW", kind: "credit" }, seed: { a: "own", b: "credit" } },
];

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!process.env.DATABASE_PATH) throw new Error("Set DATABASE_PATH to a COPY of the database.");
  const rows = await accountMarkParity(CASES);
  for (const r of rows) console.log(r.same ? "same" : "DIFF", JSON.stringify(r.event), "→", JSON.stringify(r.lambda), r.same ? "" : `\n     flow: ${JSON.stringify(r.flow)}`);
  const bad = rows.filter((r) => !r.same).length;
  console.log(`${rows.length - bad}/${rows.length} the same`);
  process.exit(bad ? 1 : 0);
}

export { CASES };
