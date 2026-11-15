import fs from "node:fs";
import { getSqlite } from "@/db";
import { ibanValid } from "@/lib/girocode";
import { addBookings, type Booking } from "./bookings";

/**
 * Bank statements (CSV) as the kernel keeps them: read by whoever reads them — a plugin that fills the kernel's service `bank.statement`
 * (Revolut's port, zeff-plugins/plugins/revolut-ext), else the built-in Revolut while it is on — and their bookings kept in the bank
 * (bookings.ts). A file you import, or one that comes in as a document (your Drive folder) by itself; a statement among the documents is
 * kept as a note of what it is, not its bookings. Server only.
 */

export type Statement = { account: string; bookings: Booking[] };

/** Whether a statement can be read now: a plugin fills the service, or the built-in Revolut is on. */
export async function statementsReadable(): Promise<boolean> {
  const { serviceProvider } = await import("@/plugins/workspace/ext-services");
  if (serviceProvider("bank.statement")) return true;
  return (await import("@/plugins/state")).isInstalled("revolut");
}

/** A statement read — its bookings (a pending one not yet) and its account. Throws when it is none (no date or amount column) or no one reads statements. */
export async function readStatement(csv: string, name = ""): Promise<Statement> {
  const { serviceProvider, runService } = await import("@/plugins/workspace/ext-services");
  if (serviceProvider("bank.statement")) return (await runService("bank.statement", { csv, name })) as Statement;
  if ((await import("@/plugins/state")).isInstalled("revolut")) {
    const { parseStatement, accountOf } = await import("@/plugins/revolut/core");
    return { account: accountOf(name, csv), bookings: parseStatement(csv) };
  }
  throw new Error("No plugin reads bank statements — install Revolut (Menu → Plugins).");
}

/** A statement read and kept: how many bookings were new, of how many. */
export async function importStatement(csv: string, name = ""): Promise<{ added: number; total: number }> {
  const s = await readStatement(csv, name);
  return addBookings(s.bookings, s.account);
}

/** A booking as a service answered it, checked (what isn't one left out). */
export function bookingOf(v: unknown): Booking | null {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!o) return null;
  const text = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
  const date = text(o.date, 10);
  const amount = Number(o.amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount)) return null;
  const iban = text(o.iban, 40).replace(/\s+/g, "").toUpperCase();
  return { date, amount, currency: text(o.currency, 8) || "EUR", text: text(o.text, 500), counterparty: text(o.counterparty, 200), iban: ibanValid(iban) ? iban : "", reference: text(o.reference, 300) };
}

const deDay = (day: string) => day.split("-").reverse().join(".");

/**
 * A statement among the documents (a CSV with a date and an amount column): a note of what it is, kept as the document's text in place
 * of its bookings — they would reach the knowledge, the people and the cases as if they were letters. Its bookings are read from the
 * file (importStatementDocuments). Null: no statement, or no one reads statements.
 */
export async function statementNote(name: string, text: string): Promise<string | null> {
  if (!/\.csv$/i.test(name) && !/^[^\n]*[,;][^\n]*\n/.test(text)) return null;
  if (!(await statementsReadable())) return null;
  let s: Statement;
  try {
    s = await readStatement(text, name);
  } catch {
    return null; // no date and amount: no statement
  }
  const days = s.bookings.map((b) => b.date);
  if (days.length < 2) return null;
  days.sort();
  // In German, like the rest of what Zeff keeps of your letters.
  return `Kontoauszug${s.account === "Revolut" ? " (Revolut)" : ""}, ${days.length.toLocaleString("de-DE")} Buchungen vom ${deDay(days[0])} bis ${deDay(days.at(-1)!)}. Die Buchungen liest die Bank (Vorgänge) aus der Datei; sie werden nicht als Text übernommen.`;
}

/**
 * The statements among the documents (a CSV from your Drive folder, one you dropped in): read by themselves, each once — a CSV is one
 * when it has a date and an amount column. Nothing while no one reads statements.
 */
export async function importStatementDocuments(): Promise<{ documents: number; added: number }> {
  if (!(await statementsReadable())) return { documents: 0, added: 0 };
  const d = getSqlite();
  d.exec("create table if not exists bank_documents (doc_id integer primary key, added integer not null, at text not null)");
  const done = new Set((d.prepare("select doc_id from bank_documents").all() as { doc_id: number }[]).map((r) => r.doc_id));
  let rows: { id: number; name: string; mime: string }[] = [];
  try {
    rows = d.prepare("select id, name, mime from documents where lower(name) like '%.csv' or mime = 'text/csv'").all() as typeof rows;
  } catch {
    return { documents: 0, added: 0 }; // the Documents plugin never ran
  }
  const { documentFile } = await import("@/plugins/documents/store");
  let documents = 0;
  let added = 0;
  for (const doc of rows.filter((r) => !done.has(r.id))) {
    const file = documentFile(doc.id);
    let n = 0;
    if (file) {
      const csv = fs.readFileSync(file.path, "utf8");
      let s: Statement | null = null;
      try {
        s = await readStatement(csv, doc.name);
      } catch {
        s = null; // no date and amount: no statement
      }
      if (s?.bookings.length) {
        n = addBookings(s.bookings, s.account).added;
        documents++;
        added += n;
      }
    }
    d.prepare("insert or replace into bank_documents (doc_id, added, at) values (?, ?, ?)").run(doc.id, n, new Date().toISOString());
  }
  return { documents, added };
}
