import { createHash } from "node:crypto";
import { getSqlite } from "@/db";
import { currentAccountId } from "@/db/accounts";
import { onceDone } from "@/lib/once-done";
import { isInstalled } from "@/plugins/state";
import { makePersonResolver } from "@/plugins/people/resolve";

/**
 * Your bank account's bookings (the kernel's — docs/zeff-kernel.md: shared data, like the mail): read from a statement (the Revolut plugin)
 * or fetched from a bank connection (lib/bank/sync.ts), each kept once, with whom it went to or came from (a person of the People plugin)
 * when known. What they pay is the plugins' business — Cases matches them (case_id, todo_id, matched_at are its columns on them),
 * Finances finds what recurs. Server only.
 */

export type Booking = { date: string; amount: number; currency: string; text: string; counterparty: string; iban: string; reference: string };
export type Transaction = Booking & { id: string; account: string; caseId: number | null; todoId: number | null; /** Whom it went to or came from (a person of the People plugin), when known. */ personId: number | null };

/** The bookings' table (made once, the person column added to one from before). */
export function bookingsDb() {
  const d = getSqlite();
  d.exec(`
    create table if not exists bank_transactions (id text primary key, account text not null, date text not null, amount real not null, currency text not null default 'EUR', text text not null default '', counterparty text not null default '', iban text not null default '', reference text not null default '', imported_at text not null, case_id integer, todo_id integer, matched_at text);
    create index if not exists bank_transactions_date on bank_transactions (date);
  `);
  // (Who the other side is came later: added to a table from before — and filled once for the bookings kept before.)
  if (!withPerson.has(currentAccountId())) {
    withPerson.add(currentAccountId());
    if (!(d.prepare("pragma table_info(bank_transactions)").all() as { name: string }[]).some((c) => c.name === "person_id")) d.exec("alter table bank_transactions add column person_id integer");
    d.exec("create index if not exists bank_transactions_person on bank_transactions (person_id)");
    void onceDone("bank.personId@1", () => fillBookingPeople(), (n) => n !== null).catch(() => undefined);
  }
  return d;
}
/** Done for these accounts' databases (each its own — two accounts run side by side). */
const withPerson = new Set<string>();

/**
 * The bookings whose other side isn't known yet, given their person: the owner of the account (an IBAN of someone's details),
 * else the one person the counterparty's name is (people/resolve.ts). How many were found; null without the People plugin.
 */
export function fillBookingPeople(): number | null {
  if (!isInstalled("people")) return null;
  const d = bookingsDb();
  const r = makePersonResolver();
  const update = d.prepare("update bank_transactions set person_id = ? where id = ?");
  let n = 0;
  d.transaction(() => {
    for (const b of d.prepare("select id, iban, counterparty from bank_transactions where person_id is null").all() as { id: string; iban: string; counterparty: string }[]) {
      const id = r.byIban(b.iban) ?? r.person(b.counterparty);
      if (id) n += update.run(id, b.id).changes;
    }
  })();
  return n;
}

export type TRow = { id: string; account: string; date: string; amount: number; currency: string; text: string; counterparty: string; iban: string; reference: string; case_id: number | null; todo_id: number | null; person_id?: number | null };
export const toTx = (r: TRow): Transaction => ({ id: r.id, account: r.account, date: r.date, amount: r.amount, currency: r.currency, text: r.text, counterparty: r.counterparty, iban: r.iban, reference: r.reference, caseId: r.case_id, todoId: r.todo_id, personId: r.person_id ?? null });

/** Bookings kept — the same booking (account, day, amount, text, and which of its like it is) once, however often it is read. */
export function addBookings(bookings: Booking[], account: string): { added: number; total: number } {
  const seen = new Map<string, number>();
  const insert = bookingsDb().prepare("insert or ignore into bank_transactions (id, account, date, amount, currency, text, counterparty, iban, reference, imported_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  let added = 0;
  for (const b of bookings) {
    const sig = [account, b.date, b.amount.toFixed(2), b.text].join("|");
    const n = (seen.get(sig) ?? 0) + 1;
    seen.set(sig, n);
    const id = createHash("sha1").update(`${sig}|${n}`).digest("hex").slice(0, 20);
    added += insert.run(id, account, b.date, b.amount, b.currency, b.text.slice(0, 300), b.counterparty.slice(0, 120), b.iban, b.reference.slice(0, 300), new Date().toISOString()).changes;
  }
  // Whom they went to (or came from): the new ones — and the older ones of someone known since.
  if (added) fillBookingPeople();
  return { added, total: bookings.length };
}

export const listTransactions = (limit = 500): Transaction[] => (bookingsDb().prepare("select * from bank_transactions order by date desc, id limit ?").all(limit) as TRow[]).map(toTx);
