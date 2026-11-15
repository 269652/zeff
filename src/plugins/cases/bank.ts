import { addManualTodo, addTodoUserNote, listTodos, setTodoDue, setTodoOps, setTodoStatus } from "@/lib/todos/store";
import { settleEvidence } from "@/lib/todos/settle";
import * as ledger from "@/lib/money/ledger";
import { t } from "@/lib/i18n/server";
import { detailsOf } from "@/plugins/people/details";
import { getPerson } from "@/plugins/people/store";
import { isInstalled } from "@/plugins/state";
import { partiesOf } from "./parties";
import { caseTitle, type Case } from "./shared";
import { getCase, listCases } from "./store";
import { standingOf } from "./core";
import { lateWarnings, matchPlan } from "./core-bank";
import { currentAccountId } from "@/db/accounts";
import { localDay } from "@/lib/dates";

/**
 * The bank (the Cases plugin): your account's bookings — read from a statement (the Revolut plugin) or fetched from a
 * bank connection (bank-sync) — matched to what you owe. A payment out that fits a todo's
 * transfer (the amount, and the recipient, the account or the case number) settles the todo with a note and counts for
 * its case; a case's open amount follows. An instalment ten days late, with nothing paid, makes a todo before the plan
 * lapses. And one overview of every debt, with the months ahead against your income. Server only.
 */

// ---------------------------------------------------------------------------
// Kept (the bookings themselves are the kernel's — lib/bank/bookings.ts; the cases' own tables here)
// ---------------------------------------------------------------------------

export { addBookings, fillBookingPeople, listTransactions, type Booking, type Transaction } from "@/lib/bank/bookings";
import { bookingsDb, toTx, type TRow } from "@/lib/bank/bookings";

/** The bookings' table, and the cases' payments (before the ledger) and warnings beside it. */
function db() {
  const d = bookingsDb();
  d.exec(`
    create table if not exists case_payments (case_id integer not null references cases(id) on delete cascade, tx_id text not null unique, amount real not null, date text not null);
    create table if not exists case_warnings (case_id integer not null, due text not null, todo_id integer, at text not null, primary key (case_id, due));
  `);
  return d;
}

/** Done for these accounts' databases (each its own — two accounts run side by side). */
const migrated = new Set<string>();
/** The payments the cases kept before the ledger (case_payments): moved into it once — a booking's, a todo's ("todo:<id>"), by hand. */
function migrateCasePayments(): void {
  if (migrated.has(currentAccountId())) return;
  migrated.add(currentAccountId());
  const rows = db().prepare("select case_id caseId, tx_id txId, amount, date from case_payments").all() as { caseId: number; txId: string; amount: number; date: string }[];
  for (const r of rows) {
    const todo = r.txId.startsWith("todo:");
    const hand = r.txId.startsWith("hand:");
    const key = todo || hand ? r.txId : `tx:${r.txId}`;
    if (ledger.paymentByKey(key)) continue;
    const p = ledger.recordPayment({ key, date: r.date, amount: r.amount, label: todo ? `T-${r.txId.slice(5)}` : hand ? t("by hand") : `${t("Booking")} ${deDay(r.date)}`, source: todo ? "todo" : hand ? "hand" : "bank", tx: todo || hand ? null : r.txId });
    ledger.allocate(p.id, `case:${r.caseId}`, r.amount);
  }
  if (rows.length) db().prepare("delete from case_payments").run();
}

/** A case's payments (the ledger's allocations to it), oldest first — `txId`: the payment's key ("tx:…", "todo:…", "hand:…"). */
export const paymentsOf = (caseId: number): { amount: number; date: string; txId: string; label: string; source: string; tx: string | null }[] => {
  db();
  migrateCasePayments();
  return ledger.allocationsOf(`case:${caseId}`).map((a) => ({ amount: a.amount, date: a.date, txId: a.key, label: a.label, source: a.source, tx: a.tx }));
};

/** What is paid on a case since its summary was made, and what is open now. */
export function caseStanding(caseId: number): { paidSince: number; open: number | null; last: { date: string; amount: number } | null } {
  // (the pure core's — the port works it out the same way: core.ts)
  return standingOf(getCase(caseId), paymentsOf(caseId));
}

/** What is open on a case now — what its letters say, less what was paid since (a booking, a payment todo ticked off). Null: not said. */
export const openOf = (c: Pick<Case, "id" | "compiled">): number | null => (c.compiled?.open == null ? null : caseStanding(c.id).open);

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const deDay = (day: string) => day.split("-").reverse().join(".");

/**
 * The payments out not matched yet, matched: to an open todo's transfer (the amount, and the recipient, the account or the case
 * number) — the todo is done, with a note — and to its case; else to a case by its account or name and its instalment or open
 * amount. How many were matched.
 */
export function matchPayments(): { matched: number } {
  const d = db();
  const open = (d.prepare("select * from bank_transactions where amount < 0 and case_id is null and todo_id is null and matched_at is null order by date, id").all() as TRow[]).map(toTx);
  if (!open.length) return { matched: 0 };
  const cases = listCases().filter((c) => c.status === "open");
  for (const c of cases) paymentsOf(c.id); // (the payments kept before the ledger: moved into it first)
  // (the plan: the pure core's — the port's flow applies the same: core-bank.ts matchPlan)
  const plan = matchPlan({
    bookings: open,
    todos: isInstalled("todos") ? listTodosWithTransfer() : [],
    keys: Object.fromEntries(listCases({ all: true }).map((c) => [c.key, c.id])),
    cases: cases.map((c) => ({ id: c.id, key: c.key, compiled: c.compiled })),
    paid: Object.fromEntries(cases.map((c) => [c.id, ledger.allocationsOf(`case:${c.id}`).map((a) => ({ paymentId: a.paymentId, date: a.date, amount: a.amount, source: a.source, tx: a.tx }))])),
    since60: localDay(new Date(Date.now() - 60 * 864e5)),
    booking: t("Booking"),
  });
  let matched = plan.matched;
  const now = () => new Date().toISOString();
  for (const st of plan.steps) {
    if (st.kind === "twin") {
      ledger.confirmByBank(st.paymentId, st.tx, st.label);
      d.prepare("update bank_transactions set case_id = ?, matched_at = ? where id = ?").run(st.caseId, now(), st.tx);
    } else if (st.kind === "read") d.prepare("update bank_transactions set case_id = ?, matched_at = ? where id = ?").run(st.caseId, now(), st.tx);
    else if (st.kind === "evidence") {
      // No todo and no case took it (a transfer you made without a todo): what it pays anyway — kept as matched when it settled something.
      if (settleEvidence(st.evidence).length) {
        d.prepare("update bank_transactions set matched_at = ? where id = ?").run(now(), st.tx);
        matched++;
      }
    } else {
      d.prepare("update bank_transactions set case_id = ?, todo_id = ?, matched_at = ? where id = ?").run(st.caseId, st.todoId, now(), st.tx);
      if (st.caseId && st.payment) {
        const p = ledger.recordPayment({ ...st.payment, source: "bank", tx: st.tx });
        ledger.allocate(p.id, `case:${st.caseId}`, Math.abs(st.payment.amount));
      }
      if (st.todoId && st.todoNote) settleTodo(st.todoId, st.todoNote);
    }
  }
  return { matched };
}

type TransferOp = { name: string; iban: string; amount: string; purpose: string };

/** The open todos with a transfer on them. */
function listTodosWithTransfer(): { id: number; op: TransferOp; done: boolean }[] {
  return listTodos({ status: "open" }).flatMap((t) => t.ops.filter((o) => o.type === "bank-transfer").map((o) => ({ id: t.id, op: o as unknown as TransferOp, done: false })));
}

function settleTodo(id: number, note: string): void {
  addTodoUserNote(id, note);
  setTodoStatus(id, "done", note);
}

// ---------------------------------------------------------------------------
// Warning before a plan lapses
// ---------------------------------------------------------------------------

/** The instalments ten days late, with nothing paid since they were due: a todo each (once), with the transfer on it. How many. */
export function overdueWarnings(today: string): number {
  if (!isInstalled("todos")) return 0;
  const d = db();
  const cases = listCases().filter((x) => x.status === "open" && !x.compiled?.done);
  // (which: the pure core's — the port's flow makes the same: core-bank.ts lateWarnings)
  const plan = lateWarnings({
    cases: cases.map((c) => ({ id: c.id, label: c.label, status: c.status, title: caseTitle(c), compiled: c.compiled })),
    paid: Object.fromEntries(cases.map((c) => [c.id, paymentsOf(c.id)])),
    warned: d.prepare("select case_id caseId, due from case_warnings").all() as { caseId: number; due: string }[],
    today,
  });
  for (const w of plan) {
    const todo = addManualTodo({ ticket: "", text: w.text });
    setTodoDue(todo.id, today);
    if (w.op && !todo.ops.some((o) => o.type === "bank-transfer")) setTodoOps(todo.id, [...todo.ops, w.op], undefined, true);
    d.prepare("insert into case_warnings (case_id, due, todo_id, at) values (?, ?, ?, ?)").run(w.caseId, w.due, todo.id, new Date().toISOString());
  }
  return plan.length;
}

// ---------------------------------------------------------------------------
// The overview of the debts
// ---------------------------------------------------------------------------

export type DebtRow = { caseId: number; creditor: string; /** Who collects it (a bailiff, a collection agency) — "" none. */ collector: string; /** The creditor's contact. */ creditorId: number | null; /** A debt you wrote down yourself (no case number). */ manual: boolean; caseNumber: string; person: string; total: number | null; open: number | null; installment: number | null; nextDue: string | null; nextWhat: string; last: { date: string; amount: number } | null; contact: string; iban: string };
export type DebtOverview = { rows: DebtRow[]; totals: { total: number; open: number; installments: number }; months: { month: string; installments: number; left: number | null }[]; income: number | null };

/** Every running case as a debt — and the next six months: the instalments due in each, what is left of your income. */
export function debtOverview(opts: { income?: number | null; today?: string } = {}): DebtOverview {
  const today = opts.today ?? localDay();
  const people = isInstalled("people");
  const rows: DebtRow[] = listCases()
    .filter((c) => c.status === "open" && !c.compiled?.done)
    .map((c) => {
      const s = c.compiled;
      const parties = partiesOf(c.id);
      // Whom to reach: who collects it, else the creditor, else the case's person.
      const contactId = parties.collector?.personId ?? parties.creditor?.personId ?? c.personId;
      const p = contactId && people ? getPerson(contactId) : null;
      const details = p ? detailsOf(p.id) : [];
      const contact = [p?.name, ...(p?.emails ?? []), ...details.filter((x) => x.key === "phone" || x.key === "address").map((x) => x.value)].filter(Boolean).join(" · ");
      const standing = caseStanding(c.id);
      return { caseId: c.id, creditor: parties.creditor?.name || s?.creditor || s?.party || caseTitle(c), collector: parties.collector?.name ?? "", creditorId: parties.creditor?.personId ?? null, manual: !!s?.manual, caseNumber: s?.manual ? "" : c.label, person: p?.name ?? "", total: s?.total ?? null, open: standing.open, installment: s?.installment ?? null, nextDue: s?.nextDue ?? null, nextWhat: s?.nextWhat ?? "", last: standing.last, contact, iban: s?.iban ?? "" };
    })
    .sort((a, b) => (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999"));
  const totals = { total: rows.reduce((s, r) => s + (r.total ?? 0), 0), open: rows.reduce((s, r) => s + (r.open ?? 0), 0), installments: rows.reduce((s, r) => s + (r.installment ?? 0), 0) };
  const income = opts.income ?? null;
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    const month = d.toISOString().slice(0, 7);
    // The instalments still running that month: what is open isn't paid off before it.
    const installments = rows.filter((r) => r.installment != null && (r.open == null || r.open > r.installment * i)).reduce((s, r) => s + r.installment!, 0);
    return { month, installments, left: income != null ? Math.round((income - installments) * 100) / 100 : null };
  });
  return { rows, totals, months, income };
}
