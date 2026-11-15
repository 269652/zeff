import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";

setupTempData();

/**
 * Finances' port, slice 1 (zeff-plugins/plugins/finances-ext): the debt Kennzahlen answered by its lambda finances.metric are the built-in's,
 * figure for figure — out of the same debts database (your own rows, a plan, one without, one owed to you).
 */

const skip = skipWithoutRepo("finances-ext");
const day = (n: number) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE");

test("the port's debt Kennzahlen are the built-in's, from the same debts database", { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-finances-ext-"));
  process.env.ZEFF_PLUGINS_DIR = dir;
  fs.cpSync(repoPlugin("finances-ext"), path.join(dir, "finances-ext"), { recursive: true });
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "people", "cases", "finances"]) setInstalled(id as never, true);
  await import("@/plugins/contributions");
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  reg.setEnabled("finances-ext", true);

  const { ensureDebtsDatabase } = await import("@/plugins/finances/database");
  assert.ok(await ensureDebtsDatabase(), "the debts database is there");
  const { createDebt } = await import("@/plugins/finances/own");
  createDebt({ title: "Kredit Müller", creditorName: "Müller", amount: 1200, due: day(5), installment: 100 }); // a plan: 12 instalments
  createDebt({ title: "Rechnung Strom", creditorName: "Stadtwerke", amount: 80, due: day(-3), installment: null }); // once, overdue
  createDebt({ title: "Ohne Plan", creditorName: "Onkel Paul", amount: 300, due: null, installment: null }); // no plan
  createDebt({ dir: "owed", title: "Geliehen Anna", creditorName: "Anna", amount: 150, due: day(20), installment: 50 }); // owed to you, a plan

  const { FINANCES_METRICS } = await import("@/plugins/finances/metrics");
  const builtin = (label: string) => FINANCES_METRICS.find((m) => m.label === label)!.read();
  const { getLambda } = await import("@/plugins/workspace/lambdas/store");
  const { runLambda } = await import("@/plugins/workspace/lambdas/run");
  const l = getLambda("finances.metric");
  assert.ok(l, "the plugin's lambda is there");
  const port = async (which: string) => {
    const r = await runLambda(l!, { which });
    assert.ok(r.ok, r.ok ? "" : r.error);
    return r.result;
  };
  const pairs: [string, string][] = [
    ["Schuldenstand", "owe-open"],
    ["Offene Schulden", "owe-count"],
    ["Tilgungsrate", "rates"],
    ["Schuldenfrei in", "free-in"],
    ["Schulden ohne Plan", "owe-unplanned"],
    ["Forderungen", "owed-open"],
    ["Offene Forderungen", "owed-count"],
    ["Rückzahlungen", "owed-rates"],
    ["Alles zurück in", "owed-free-in"],
    ["Forderungen ohne Plan", "owed-unplanned"],
  ];
  for (const [label, which] of pairs) assert.equal(await port(which), await builtin(label), `${label} (${which})`);
  // The money Kennzahlen: your income by hand, three whole months of bookings (one a transfer to a credit card you marked, one moved and back).
  const { setManualIncome } = await import("@/plugins/finances/income");
  setManualIncome(3000);
  const { addBookings } = await import("@/lib/bank/bookings");
  const month = (back: number, d: number) => { const t = new Date(); return new Date(Date.UTC(t.getFullYear(), t.getMonth() - back, d)).toISOString().slice(0, 10); };
  for (const back of [1, 2, 3]) {
    addBookings(
      [
        { date: month(back, 3), amount: -450, currency: "EUR", text: "Miete", counterparty: "Vermieter GmbH", iban: "", reference: "" },
        { date: month(back, 9), amount: -60, currency: "EUR", text: "Rewe", counterparty: "", iban: "", reference: "" },
        { date: month(back, 12), amount: -200, currency: "EUR", text: "Kreditkarte", counterparty: "Visa Karte", iban: "", reference: "" },
        { date: month(back, 15), amount: -100, currency: "EUR", text: "Sparkonto", counterparty: "Tagesgeld", iban: "", reference: "" },
        { date: month(back, 16), amount: 100, currency: "EUR", text: "Sparkonto", counterparty: "Tagesgeld", iban: "", reference: "" },
      ],
      "Konto",
    );
  }
  const { markAccount } = await import("@/plugins/finances/accounts");
  markAccount("visa", "credit");
  for (const [label, which] of [["Nettoeinkommen", "income"], ["Ausgaben", "spending"], ["Auf Kreditkonten", "credit"], ["Frei im Monat", "free-monthly"], ["Sparquote", "savings-rate"], ["Schuldendienstquote", "debt-service-rate"]] as const) {
    assert.equal(await port(which), await builtin(label), `${label} (${which})`);
  }
  assert.equal(await port("income"), 3000);
  assert.equal(await port("spending"), 510, "rent 450 + shop 60; the card marked as credit and the moved money left out");
  assert.equal(await port("credit"), 200);
  assert.equal(await port("owe-open"), 1580, "1200 + 80 + 300");
  assert.equal(await port("owe-count"), 3);
  assert.equal(await port("rates"), 100);

  // The stored Kennzahl: the plugin's metric asks the lambda (its last answer, the first time none yet).
  const { storedMetricValue } = await import("@/plugins/workspace/ext-points");
  const decl = reg.getPlugin("finances-ext")!.manifest.contributes.metrics.find((m) => m.id === "owe-open")!;
  assert.equal(decl.lambda, "finances.metric");
  storedMetricValue("finances-ext", decl, 0);
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (storedMetricValue("finances-ext", decl, Date.now()) === 1580) return;
  }
  assert.fail("the metric didn't get its answer from the lambda");
});
