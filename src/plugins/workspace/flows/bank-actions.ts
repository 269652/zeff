import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "./actions";
import type { FieldSpec } from "./types";

/**
 * The kernel's bank actions (lib/bank — the bank connection is a driver, the bookings shared data): how the connection stands, its settings
 * saved, signing in at your bank, the bookings fetched. What the Cases view's bank bar did through code of its own, a port's bank bar does
 * through these (<data do>, <button do>). Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const text = (v: unknown) => (typeof v === "string" ? v : "");

/** Zeff's own address as the page was asked for (the bank comes back to /api/bank/callback there). */
async function origin(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  } catch {
    return `http://127.0.0.1:${process.env.PORT ?? 9333}`;
  }
}

export const BANK_ACTIONS: FlowAction[] = [
  {
    name: "bank.status",
    group: "bank",
    label: "How the bank connection stands",
    summary: "Whether statements can be read (the Revolut plugin), the bank connection set up and connected, its bank and country, how long access lasts, when bookings were last fetched, how many are kept, where the bank comes back to. The key is never given.",
    input: [],
    output: "{ statements, configured, connected, appId, aspsp, country, validUntil, lastSync, transactions, callback }",
    run: async () => {
      const sync = await import("@/lib/bank/sync");
      const s = sync.bankSettings();
      const { bookingsDb } = await import("@/lib/bank/bookings");
      const transactions = (bookingsDb().prepare("select count(*) n from bank_transactions").get() as { n: number }).n;
      return { statements: await (await import("@/lib/bank/statements")).statementsReadable(), configured: !!(s?.appId && s.privateKey), connected: sync.bankConnected(), appId: s?.appId ?? "", aspsp: s?.aspsp ?? "Revolut", country: s?.country ?? "DE", validUntil: s?.validUntil ?? null, lastSync: s?.lastSync ?? null, transactions, callback: `${await origin()}/api/bank/callback` };
    },
  },
  {
    name: "bank.save",
    group: "bank",
    label: "Save the bank connection",
    summary: "The Enable Banking application's id and private key (PEM — empty: the one kept stays), the bank and its country. A new key or bank: sign in at the bank again.",
    input: [f("appId", "text", { required: true }), f("privateKey", "text"), f("aspsp", "text"), f("country", "text")],
    output: "{ what }",
    writes: true,
    run: async (i) => {
      (await import("@/lib/bank/sync")).saveBankSettings({ appId: text(i.appId), privateKey: text(i.privateKey) || undefined, aspsp: text(i.aspsp) || "Revolut", country: text(i.country) || "DE" });
      return { what: (await import("@/lib/i18n/server")).t("Saved.") };
    },
  },
  {
    name: "bank.auth",
    group: "bank",
    label: "Sign in at your bank",
    summary: "Where to sign in at your bank and allow access (90 days) — it comes back to Zeff's /api/bank/callback.",
    input: [],
    output: "{ href }",
    writes: true,
    run: async () => ({ href: (await (await import("@/lib/bank/sync")).startBankAuth(`${await origin()}/api/bank/callback`)).url }),
  },
  {
    name: "bank.bookings",
    group: "bank",
    label: "The bank's bookings between two days",
    summary: "The bookings kept in the bank (a statement read, the bank connection): date, amount (out < 0), text, counterparty, iban, reference, person_id (whom it went to, when known) — from (inclusive) to (exclusive), YYYY-MM-DD. [] when none were read.",
    input: [f("from", "text", { required: true }), f("to", "text", { required: true })],
    output: "{ bookings: [{ date, amount, text, counterparty, reference }] }",
    run: async (i) => {
      const { bookingsDb } = await import("@/lib/bank/bookings");
      try {
        const rows = bookingsDb().prepare("select date, amount, text, counterparty, iban, reference, person_id from bank_transactions where date >= ? and date < ? order by date, id").all(text(i.from), text(i.to));
        return { bookings: rows };
      } catch {
        return { bookings: [] };
      }
    },
  },
  {
    name: "bank.sync",
    group: "bank",
    label: "Fetch the bookings",
    summary: "Every connected account's bookings since the last fetch (a week back from it; 90 days the first time), each kept once.",
    input: [],
    output: "{ added, total, what }",
    writes: true,
    run: async () => {
      const r = await (await import("@/lib/bank/sync")).syncBank();
      const { t } = await import("@/lib/i18n/server");
      return { ...r, what: t("{added} new bookings of {total}", { added: r.added, total: r.total }) };
    },
  },
  {
    name: "bank.import",
    group: "bank",
    label: "Read a statement",
    summary: "A statement (CSV — Revolut's export or your bank's) read by whoever reads statements (the Revolut plugin): its bookings kept, each once (a pending one not yet). Which account: from the file's name or its content.",
    input: [f("csv", "text", { required: true }), f("name", "text")],
    output: "{ added, total, what }",
    writes: true,
    run: async (i) => {
      const r = await (await import("@/lib/bank/statements")).importStatement(text(i.csv), text(i.name));
      // The knowledge reads the new months (and your income in them) — synced and compiled in the background.
      const { isInstalled } = await import("@/plugins/state");
      if (r.added && isInstalled("knowledge")) void import("@/plugins/knowledge/client").then((k) => k.knowledgeSync()).catch(() => {});
      const { t } = await import("@/lib/i18n/server");
      return { ...r, what: t("{added} new bookings of {total}", { added: r.added, total: r.total }) };
    },
  },
];

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("core:bank", BANK_ACTIONS);
