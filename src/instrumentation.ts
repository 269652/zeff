/**
 * Runs once when a Zeff server starts (Node.js only, not while building): the start guard, then what instrumentation-node.ts
 * does — context items become one item per linked source (see unifySources), work runs are picked up again, and the periodic
 * syncs start.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  // The start guard (lib/kernel/boot-guard.ts): after two starts in a row that didn't come up, safe mode is on by itself.
  const boot = await import("./lib/kernel/boot-guard").catch(() => null);
  try {
    const r = boot?.beginBoot();
    if (r?.safeModeOn) console.warn(`[safe mode] on by itself: ${r.failures} failed starts in a row${r.stoppedIn ? ` (stopped while ${r.stoppedIn})` : ""}`);
  } catch (e) {
    console.error("[safe mode] the start guard failed", e);
  }
  // Everything else in one import (instrumentation-node.ts — why one, not one per part: there): a failure loading it is said, and
  // counts as a start that didn't get through (the start guard's step names it).
  boot?.bootStep("loading the server's parts");
  let node: typeof import("./instrumentation-node");
  try {
    node = await import("./instrumentation-node");
  } catch (e) {
    console.error("[start] loading the server's parts failed", e);
    return;
  }
  await node.startServer(boot);
}
