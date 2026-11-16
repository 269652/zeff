/**
 * Server timing for a view's data sources: with ZEFF_PERF=1 every <data> answer logs what it was and how long it took
 * ("[perf] flow learn.courses 412ms cache=miss"). Off by default; costs nothing then.
 */
export const PERF = process.env.ZEFF_PERF === "1";

export async function timed<T>(label: string, fn: () => Promise<T>, note: () => string = () => ""): Promise<T> {
  if (!PERF) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    console.log(`[perf] ${label} ${Math.round(performance.now() - t0)}ms ${note()}`.trim());
  }
}
