// Misst, wie lange <data>-Quellen (Flows) brauchen. Beispiel:
//   PERF_ACCOUNT=privat npx tsx scripts/perf-flows.mts "learn.courses n=0, learn.map course=3"
// DATABASE_PATH und ZEFF_PLUGINS_DIR wie beim Server setzen (auf einer Kopie der Daten!). PERF_SHOW=1 zeigt die Antwort.
await import("../src/plugins/contributions");
const { runFlow } = await import("../src/plugins/workspace/flows/engine");
const { withAccount, activeAccountId } = await import("../src/db/accounts");
await withAccount(process.env.PERF_ACCOUNT || activeAccountId(), async () => {
  for (const spec of process.argv.slice(2).join(" ").split(",").map((s) => s.trim()).filter(Boolean)) {
    const name = spec.split(/\s+/)[0];
    const input = Object.fromEntries([...spec.slice(name.length).matchAll(/(\w+)=(.*?)(?=\s\w+=|$)/g)].map((m) => [m[1], m[2]]));
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      let r: { status?: string; error?: unknown; output?: unknown };
      try { r = (await runFlow(name, input, { trigger: { kind: "button" } })) as never; } catch (e) { r = { status: "throw", error: String(e) }; }
      console.log(`${name} ${JSON.stringify(input)} run${i + 1}: ${Math.round(performance.now() - t0)}ms ${r.status} ${r.error ?? ""} out=${JSON.stringify(r.output ?? null).length}b`);
      if (i === 0 && process.env.PERF_SHOW) console.log(JSON.stringify(r.output ?? null).slice(0, 700));
    }
  }
});
process.exit(0);
