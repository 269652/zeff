import { ibanValid } from "@/lib/girocode";
import type { Booking } from "@/lib/bank/bookings";

/**
 * Revolut's pure core: a statement (the CSV export — or any bank's CSV with a date, an amount and a text) read into bookings, the
 * account it is of. No Zeff in here: the built-in uses it, and its port
 * (zeff-plugins/plugins/revolut-ext) has it bundled into its lambda (scripts/port-revolut.mts) — the same bookings.
 */

/** The cells of a CSV line (quotes, doubled quotes inside them). */
function cells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) out.push(cur.trim()), (cur = "");
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** The columns a statement may have, by what they are called (Revolut, German banks, English ones) — the first found wins. */
const COLUMNS = {
  date: ["completed date", "datum des abschlusses", "buchungstag", "buchungsdatum", "datum", "date", "booking date", "started date", "datum des beginns", "valutadatum", "wertstellung"],
  amount: ["amount", "betrag", "betrag (eur)", "umsatz", "betrag in eur"],
  text: ["description", "beschreibung", "buchungstext", "text", "details"],
  counterparty: ["empfänger", "zahlungsempfänger", "auftraggeber", "name", "counterparty", "beguenstigter/zahlungspflichtiger", "begünstigter/zahlungspflichtiger", "zahlungsempfänger*in"],
  reference: ["verwendungszweck", "reference", "referenz", "payment reference"],
  iban: ["iban", "kontonummer/iban", "iban des empfängers"],
  currency: ["currency", "währung", "waehrung"],
  state: ["state", "status"],
} as const;

/** "-11.52", "-300,00", "1.234,56", "1,234.56" → a number (NaN when it is none). */
function amountOf(s: string): number {
  const v = s.replace(/[€\s]|EUR/gi, "");
  if (/,\d{1,2}$/.test(v)) return Number(v.replace(/\./g, "").replace(",", "."));
  return Number(v.replace(/,/g, ""));
}

/** "2026-10-17 09:12:05", "17.10.2026", "17.10.26" → "2026-10-17" (empty when it is none). */
function dayOf(s: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(s);
  if (de) return `${de[3].length === 2 ? `20${de[3]}` : de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`;
  return "";
}

/** Revolut writes the other side into the description: "To Wagner Dienstkonto", "Transfer to …", "From …". */
const fromText = (text: string) => /^(?:transfer\s+)?(?:to|from|an|von)\s+(.+)$/i.exec(text.trim())?.[1]?.trim() ?? "";

/** The bookings of a statement (CSV, comma or semicolon) — the ones not yet completed (Revolut's PENDING) left for later. */
export function parseStatement(csv: string): Booking[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const head = cells(lines[0], sep).map((h) => h.toLowerCase().replace(/^"|"$/g, ""));
  const col = (names: readonly string[]) => names.map((n) => head.indexOf(n)).find((i) => i >= 0) ?? -1;
  const at = { date: col(COLUMNS.date), amount: col(COLUMNS.amount), text: col(COLUMNS.text), counterparty: col(COLUMNS.counterparty), reference: col(COLUMNS.reference), iban: col(COLUMNS.iban), currency: col(COLUMNS.currency), state: col(COLUMNS.state) };
  if (at.date < 0 || at.amount < 0) throw new Error("The statement needs a date and an amount column.");
  const out: Booking[] = [];
  for (const line of lines.slice(1)) {
    const c = cells(line, sep);
    const get = (i: number) => (i >= 0 ? (c[i] ?? "") : "");
    const state = get(at.state).toUpperCase();
    if (state && !["COMPLETED", "ABGESCHLOSSEN", "GEBUCHT", "BOOKED"].includes(state)) continue;
    const date = dayOf(get(at.date)) || dayOf(get(col(["started date", "datum des beginns"])));
    const amount = amountOf(get(at.amount));
    if (!date || !Number.isFinite(amount)) continue;
    const text = get(at.text) || get(at.reference) || get(at.counterparty);
    const iban = get(at.iban).replace(/\s+/g, "").toUpperCase();
    out.push({ date, amount, currency: get(at.currency) || "EUR", text, counterparty: get(at.counterparty) || fromText(text), iban: ibanValid(iban) ? iban : "", reference: at.reference !== at.text ? get(at.reference) : "" });
  }
  return out;
}

/** The account a statement is of: Revolut by its file name ("account-statement_…") or its columns, else the file's name. */
export const accountOf = (name: string, csv: string): string =>
  /revolut|^account-statement_/i.test(name) || /^(Art,Produkt|Type,Product),/.test(csv.replace(/^﻿/, "")) ? "Revolut" : name.replace(/\.csv$/i, "").slice(0, 40) || "Bank";
