import { isEnabled } from "@/lib/ext/registry";
import { isInstalled } from "@/plugins/state";

/**
 * Your cases as shared data of the kernel: they live in the same tables whether the built-in Cases keeps them or its port
 * (zeff-plugins/plugins/cases-ext, whose stores adopt them — lib/ext/stores.ts ADOPTABLE). What reads them — People's blocks and pulse,
 * the first look, Finances, the bank — asks here whether there are cases at all, and after new bank bookings asks the one who keeps them
 * to match them. Server only.
 */

export const CASES_PORT = "cases-ext";

const portOn = (): boolean => {
  try {
    return isEnabled(CASES_PORT);
  } catch {
    return false;
  }
};

/** Whether there are cases: the built-in on, or its port. */
export const casesThere = (): boolean => isInstalled("cases") || portOn();

/** Who keeps them: the built-in, its port, or no one. */
export const casesKeeper = (): "builtin" | "port" | null => (isInstalled("cases") ? "builtin" : portOn() ? "port" : null);

/** The port's flows run one after the other, now (those its package has): what each gave back, by name. A failing one doesn't stop the next. */
export async function casesPortFlows(names: string[]): Promise<Record<string, unknown>> {
  const { flowByName } = await import("@/plugins/workspace/flows/store");
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const out: Record<string, unknown> = {};
  for (const name of names) {
    if (!flowByName(name)) continue;
    try {
      const r = await runFlow(name, {});
      if (r.status === "done") out[name] = r.output;
      else console.error(`[cases] ${name}: ${r.error ?? r.status}`);
    } catch (e) {
      console.error(`[cases] ${name}:`, e);
    }
  }
  return out;
}

/**
 * New bank bookings came in (a statement read, the bank synced): the payments matched to the cases, late instalments warned of — by the
 * built-in, or by its port's flows (cases.match, cases.warn) when it keeps them. What it did.
 */
export async function casesAfterBookings(today: string): Promise<{ matched: number; warned: number }> {
  const keeper = casesKeeper();
  if (keeper === "builtin") {
    const bank = await import("@/plugins/cases/bank");
    const m = bank.matchPayments();
    return { matched: m.matched, warned: bank.overdueWarnings(today) };
  }
  if (keeper !== "port") return { matched: 0, warned: 0 };
  const r = await casesPortFlows(["cases.match", "cases.warn"]);
  const n = (v: unknown, k: string) => {
    const x = v && typeof v === "object" ? Number((v as Record<string, unknown>)[k]) : NaN;
    return Number.isFinite(x) ? x : 0;
  };
  return { matched: n(r["cases.match"], "matched"), warned: n(r["cases.warn"], "warned") };
}
