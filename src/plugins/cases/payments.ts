import { getCase } from "./store";
import { paymentOf, type CasePayment } from "./core";

/**
 * Payments (the Cases plugin), by rule — no AI: the open todos that ask you to pay get a transfer action (the GiroCode a
 * click away) when the account is known — in the todo, or of a person it names or whose case it is; a case not summed up
 * yet pays to its person's account. Server only.
 */

// (payment todos getting their transfer: the kernel's now — lib/todos/attach-payments.ts)
export { attachPayments } from "@/lib/todos/attach-payments";

export type { CasePayment } from "./core";

export { personAccount } from "@/plugins/people/account";
import { personAccount } from "@/plugins/people/account";

/** Where a case pays to: what its summary says, else its person's account — the instalment (else what is open) as amount (core.ts). */
export function casePayment(caseId: number): CasePayment | null {
  const c = getCase(caseId);
  if (!c) return null;
  return paymentOf(c, !c.compiled?.iban && c.personId ? personAccount(c.personId) : null);
}
