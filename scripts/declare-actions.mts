/**
 * Declares the kernel's flow actions as capability rows in the database (src/plugins/workspace/flows/declare.ts): idempotent,
 * never overwrites a row, reports drift. Dry by default.
 *
 *   DATABASE_PATH=<db> npx tsx scripts/declare-actions.mts [--apply]
 */
const apply = process.argv.includes("--apply");
if (apply && !process.env.DATABASE_PATH) throw new Error("--apply needs DATABASE_PATH (a copy first!).");
const { setInstalled } = await import("@/plugins/state");
for (const id of ["workspace", "studio"]) setInstalled(id, true);
await import("@/plugins/contributions");
const { declareKernelActions } = await import("@/plugins/workspace/flows/declare");
const r = declareKernelActions({ dry: !apply });
console.log(`${apply ? "declared" : "would declare"} ${r.declared.length}; drift ${r.drift.length}; orphans ${r.orphans.length}; by class`, r.byClass);
if (r.drift.length) console.log("drift:", r.drift.join(", "));
