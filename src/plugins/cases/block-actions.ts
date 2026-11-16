"use server";

import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { caseBundle, caseOp, type CaseBundle, type CaseOperation } from "./blocks";
import { localDay } from "@/lib/dates";
import { pluginAction, type Result } from "@/lib/action-result";

/** What a case's page calls: its bundle, an operation. None throws at the page. */

const run = pluginAction("cases", () => t("The Cases plugin is not installed (Menu → Plugins)."));

const caseId = async (rowId: number): Promise<number> => {
  const id = await (await import("./database")).caseOfRow(Number(rowId));
  if (!id) throw new Error(t("This row is not a case."));
  return id;
};

/** Everything the case's page shows. */
export async function caseBundleAction(rowId: number): Promise<Result<{ case: CaseBundle }>> {
  return run(async () => ({ case: await caseBundle(await caseId(rowId)) }));
}

/** An operation on the case; the cases database reads the cases again after it (its rows follow). */
export async function caseOpAction(rowId: number, op: CaseOperation): Promise<Result<{ message?: string }>> {
  return run(async () => {
    const r = await caseOp(await caseId(rowId), op);
    const db = await (await import("./database")).casesDatabase();
    if (db) (await import("@/plugins/workspace/pipeline")).startPipeline(db, { ai: false });
    return r;
  });
}

import type { CasesOverview } from "./core";
import { financesThere } from "@/lib/finances/there";
export type { CasesOverview };

/** The cases database's overview (its "Overview" view): the money in figures, the running cases by what is due first, each with where it pays to. */
export async function casesOverviewAction(): Promise<Result<{ overview: CasesOverview }>> {
  return run(async () => {
    (await import("./detect")).detectCases();
    // The statements that came in as documents (your Drive folder; the Revolut plugin), read; the payments matched.
    await (await import("@/lib/bank/statements")).importStatementDocuments();
    (await import("./bank")).matchPayments();
    const { listCases } = await import("./store");
    const { personAccount } = await import("./payments");
    const parties = await import("./parties");
    // Every running case's creditor and collector, as its summary names them.
    parties.assignAllParties();
    const db = await (await import("./database")).casesDatabase();
    const rows: Record<string, number> = {};
    if (db) for (const r of (await import("@/plugins/workspace/store")).rawRows(db)) rows[String(r.cells.srcref ?? "")] = r.id;
    const names: Record<number, string> = {};
    if (isInstalled("people")) for (const p of (await import("@/plugins/people/store")).listPeople()) names[p.id] = p.name;
    const all = listCases();
    const { paymentsOf } = await import("./bank");
    // (what the pure core works the overview out of — core.ts; the port's lambda the same)
    const payments = Object.fromEntries(all.map((c) => [c.id, paymentsOf(c.id)]));
    const partyNames = Object.fromEntries(
      all.map((c) => {
        const p = parties.partiesOf(c.id);
        return [c.id, { creditor: p.creditor?.name, collector: p.collector?.name }];
      }),
    );
    const accounts = Object.fromEntries(all.filter((c) => c.personId && !c.compiled?.iban).map((c) => [c.personId!, personAccount(c.personId!)]));
    const debtsDb = financesThere() ? (await import("@/plugins/finances/debts")).debtsDbId() : null;
    const { overviewOf } = await import("./core");
    return { overview: overviewOf({ cases: all, payments, parties: partyNames, names, accounts, rows, today: localDay(), in30: localDay(new Date(Date.now() + 30 * 864e5)), debtsDb }) };
  });
}

export type BankStatus = { /** Statements can be imported (the Revolut plugin). */ statements: boolean; configured: boolean; connected: boolean; appId: string; aspsp: string; country: string; validUntil: string | null; lastSync: string | null; transactions: number; /** The debt overview: the debts database (null: there is none — no Finances plugin; the link is hidden). */ debtsHref: string | null };

/** How the bank connection stands (the key is never sent to the page). */
export async function bankStatusAction(): Promise<Result<{ bank: BankStatus }>> {
  return run(async () => {
    const sync = await import("./bank-sync");
    const s = sync.bankSettings();
    const { listTransactions } = await import("./bank");
    const debts = financesThere() ? await (await import("@/plugins/finances/database")).debtsDatabase() : null;
    return { bank: { debtsHref: debts ? `/workspace/${debts}` : null, statements: await (await import("@/lib/bank/statements")).statementsReadable(), configured: !!(s?.appId && s.privateKey), connected: sync.bankConnected(), appId: s?.appId ?? "", aspsp: s?.aspsp ?? "Revolut", country: s?.country ?? "DE", validUntil: s?.validUntil ?? null, lastSync: s?.lastSync ?? null, transactions: listTransactions(100000).length } };
  });
}

/** The application's id and key (empty key: the one kept stays), the bank and its country. */
export async function saveBankSettingsAction(v: { appId: string; privateKey?: string; aspsp: string; country: string }): Promise<Result> {
  return run(async () => {
    (await import("./bank-sync")).saveBankSettings({ appId: String(v.appId ?? ""), privateKey: v.privateKey ? String(v.privateKey) : undefined, aspsp: String(v.aspsp ?? "Revolut"), country: String(v.country ?? "DE") });
    return {};
  });
}

/** Where to sign in at your bank — it comes back to Zeff's /api/bank/callback. */
export async function startBankAuthAction(): Promise<Result<{ url: string }>> {
  return run(async () => {
    const { headers } = await import("next/headers");
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
    return { url: (await (await import("./bank-sync")).startBankAuth(`${origin}/api/bank/callback`)).url };
  });
}

/** The bookings fetched now, matched, the late instalments warned of. */
export async function syncBankAction(): Promise<Result<{ message: string }>> {
  return run(async () => {
    const r = await (await import("./bank-sync")).syncBank();
    const bank = await import("./bank");
    const m = bank.matchPayments();
    const w = bank.overdueWarnings(localDay());
    return { message: t("{added} new bookings of {total} — {matched} payments matched, {warned} warnings", { added: r.added, total: r.total, matched: m.matched, warned: w }) };
  });
}
