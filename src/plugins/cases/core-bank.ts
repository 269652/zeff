import { caseRefs } from "@/lib/todos/similar";
import type { CaseSummary } from "./shared";

/**
 * Cases' pure core for matching the bank's bookings (bank.ts matchPayments): each payment out not matched yet — to an open todo's transfer
 * (the amount, and the recipient, the account or the case number) and to its case; else to a case by its account, number or payee and its
 * instalment or open amount; a payment already ticked off or said by hand days before (the ledger's twin) confirmed by the booking; one
 * read twice counted once; a transfer without todo or case kept as evidence of what it pays anyway. Worked out booking by booking as the
 * built-in does (a todo used is used; a payment planned counts for the next). The built-in and its port (cases-ext, the flow cases.match)
 * apply the same plan. Client-safe.
 */

export type Booking = { id: string; account: string; date: string; amount: number; text: string; counterparty: string; iban: string; reference: string };
export type TransferTodo = { id: number; op: { name: string; iban: string; amount: string; purpose: string } };
/** A payment to a case as the ledger has it: `paymentId`, its source, whether a booking confirmed it (tx). */
export type CasePaid = { paymentId: number; date: string; amount: number; source: string; tx: string | null };

export type MatchStep =
  /** The ledger's twin (ticked off or said by hand) confirmed by this booking; the booking kept as its case's. */
  | { kind: "twin"; tx: string; caseId: number; paymentId: number; label: string }
  /** The same booking read twice: kept as its case's, nothing paid again. */
  | { kind: "read"; tx: string; caseId: number }
  /** A todo's transfer and/or a case paid by it: the booking kept as theirs, the case's payment booked, the todo done with a note. */
  | { kind: "match"; tx: string; caseId: number | null; todoId: number | null; payment: { key: string; date: string; amount: number; label: string } | null; todoNote: string | null }
  /** Neither: what it pays anyway (a promise, a debt of yours — lib/todos/settle.ts); kept as matched when it settled something. */
  | { kind: "evidence"; tx: string; evidence: { key: string; label: string; text: string; refs: string[]; ops: never[]; todoId: null; amount: number; payee: { name: string; iban: string }; date: string } };

const TWIN_DAYS = 10;
/** The words of a name worth comparing (four letters and more). */
const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
/** Whether a booking's other side is this recipient: a word of the name in what the booking says. */
const namesIt = (tx: Booking, name: string) => {
  const said = new Set(words(`${tx.counterparty} ${tx.text}`));
  return words(name).some((w) => said.has(w));
};
const sameAmount = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) < 0.005;
const euro = (v: number) => `${Math.abs(v).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`;
export const deDay = (day: string) => day.split("-").reverse().join(".");

export function matchPlan(v: {
  /** The payments out not matched yet, oldest first. */
  bookings: Booking[];
  /** The open todos with a transfer on them (none without the Todos plugin). */
  todos: TransferTodo[];
  /** Every case's id by its number (any status: a todo names one set aside too). */
  keys: Record<string, number>;
  /** The open cases, with their summaries. */
  cases: { id: number; key: string; compiled: CaseSummary | null }[];
  /** Each open case's payments. */
  paid: Record<number, CasePaid[]>;
  /** The day 60 days back: a booking without todo or case older than it isn't evidence any more. */
  since60: string;
  /** "Booking" in the user's language. */
  booking: string;
}): { steps: MatchStep[]; matched: number } {
  const steps: MatchStep[] = [];
  const used = new Set<number>();
  const paid: Record<number, CasePaid[]> = Object.fromEntries(Object.entries(v.paid).map(([k, list]) => [k, list.map((p) => ({ ...p }))]));
  let matched = 0;
  for (const tx of v.bookings) {
    const refs = caseRefs(`${tx.reference} ${tx.text}`);
    const todo = v.todos.find((x) => !used.has(x.id) && sameAmount(tx.amount, Number(x.op.amount)) && (namesIt(tx, x.op.name) || (tx.iban && tx.iban === x.op.iban.replace(/\s+/g, "")) || caseRefs(x.op.purpose).some((r) => refs.includes(r))));
    let caseId: number | null = null;
    if (todo) caseId = caseRefs(todo.op.purpose).map((r) => v.keys[r.replace(/^\d{1,2} /, "")]).find((id): id is number => !!id) ?? null;
    if (!caseId) {
      const c = v.cases.find((c) => {
        const s = c.compiled;
        if (!s) return false;
        const who = (s.iban && tx.iban === s.iban.replace(/\s+/g, "")) || refs.some((r) => r.replace(/^\d{1,2} /, "") === c.key) || (s.payee && namesIt(tx, s.payee));
        return who && [s.installment, s.open].some((x) => x != null && sameAmount(tx.amount, x));
      });
      caseId = c?.id ?? null;
    }
    const label = `${v.booking} ${deDay(tx.date)}`;
    if (caseId) {
      const mine = paid[caseId] ?? [];
      // (the ledger's twin: ticked off or by hand, not confirmed by a booking yet, the same amount within ten days)
      const day = Date.parse(`${tx.date.slice(0, 10)}T12:00:00`);
      const twin = mine.find((p) => p.tx === null && p.source !== "bank" && Math.abs(p.amount - Math.abs(tx.amount)) < 0.005 && Math.abs(Date.parse(`${p.date}T12:00:00`) - day) <= TWIN_DAYS * 864e5);
      const read = mine.some((p) => p.source === "bank" && sameAmount(p.amount, tx.amount) && Math.abs(Date.parse(p.date) - Date.parse(tx.date)) <= 2 * 864e5);
      if (twin || read) {
        if (twin) {
          twin.tx = tx.id;
          steps.push({ kind: "twin", tx: tx.id, caseId, paymentId: twin.paymentId, label });
        } else steps.push({ kind: "read", tx: tx.id, caseId });
        continue;
      }
    }
    if (!todo && !caseId) {
      if (tx.date >= v.since60) steps.push({ kind: "evidence", tx: tx.id, evidence: { key: `tx:${tx.id}`, label, text: `${tx.text} ${tx.reference}`.trim(), refs: [], ops: [], todoId: null, amount: Math.abs(tx.amount), payee: { name: tx.counterparty, iban: tx.iban }, date: tx.date } });
      continue;
    }
    const payment = caseId ? { key: `tx:${tx.id}`, date: tx.date, amount: tx.amount, label } : null;
    if (caseId) (paid[caseId] ??= []).push({ paymentId: -1, date: tx.date.slice(0, 10), amount: Math.round(Math.abs(tx.amount) * 100) / 100, source: "bank", tx: tx.id });
    if (todo) used.add(todo.id);
    steps.push({ kind: "match", tx: tx.id, caseId, todoId: todo?.id ?? null, payment, todoNote: todo ? `✓ Bezahlt laut Kontoauszug (${tx.account}, ${deDay(tx.date)}): ${euro(tx.amount)} an ${tx.counterparty || todo.op.name}.` : null });
    matched++;
  }
  return { steps, matched };
}

/** Days an instalment may be late before a warning. */
export const LATE_DAYS = 10;

/**
 * The instalments ten days late, with nothing paid since they were due (bank.ts overdueWarnings): a todo each — once per case and due —
 * with the transfer on it when the account is known. In German, like the todos Zeff makes from your mails.
 */
export function lateWarnings(v: { cases: { id: number; label: string; status: string; title: string; compiled: CaseSummary | null }[]; paid: Record<number, { date: string }[]>; warned: { caseId: number; due: string }[]; today: string }): { caseId: number; due: string; text: string; op: { type: "bank-transfer"; name: string; iban: string; bic: string; amount: string; purpose: string } | null }[] {
  const out: ReturnType<typeof lateWarnings> = [];
  for (const c of v.cases.filter((x) => x.status === "open" && !x.compiled?.done)) {
    const s = c.compiled;
    if (!s?.nextDue || s.installment == null) continue;
    const late = Math.round((Date.parse(v.today) - Date.parse(s.nextDue)) / 864e5);
    if (late < LATE_DAYS) continue;
    if ((v.paid[c.id] ?? []).some((p) => p.date >= s.nextDue!)) continue;
    if (v.warned.some((w) => w.caseId === c.id && w.due === s.nextDue)) continue;
    const text = `Rate ${euro(s.installment)} (Az. ${c.label}) seit ${late} Tagen überfällig — überweisen, bevor der Ratenplan verfällt (${c.title})`;
    out.push({ caseId: c.id, due: s.nextDue, text, op: s.iban ? { type: "bank-transfer", name: s.payee || s.party, iban: s.iban, bic: s.bic, amount: s.installment.toFixed(2), purpose: s.purpose || c.label } : null });
  }
  return out;
}
