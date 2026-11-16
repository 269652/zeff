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

test("the port's view data is the built-in's: the debts overview's figures, lists and words, from the same debts database", { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-finances-ext-view-"));
  process.env.ZEFF_PLUGINS_DIR = dir;
  fs.cpSync(repoPlugin("finances-ext"), path.join(dir, "finances-ext"), { recursive: true });
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "people", "todos", "cases", "finances"]) setInstalled(id as never, true);
  await import("@/plugins/contributions");
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  reg.setEnabled("finances-ext", true);

  const { ensureDebtsDatabase } = await import("@/plugins/finances/database");
  assert.ok(await ensureDebtsDatabase());
  const { createDebt } = await import("@/plugins/finances/own");
  createDebt({ title: "Kredit Müller", creditorName: "Müller", amount: 1200, due: day(5), installment: 100 });
  createDebt({ title: "Ohne Plan", creditorName: "Onkel Paul", amount: 300, due: null, installment: null });
  createDebt({ dir: "owed", title: "Geliehen Anna", creditorName: "Anna", amount: 150, due: day(20), installment: 50 });
  // A debt of a case: its letters say 900 open, a payment of 100 since.
  const store = await import("@/plugins/cases/store");
  const c = store.ensureCase("VD 1/26", "VD 1/26", day(-8)).id;
  store.updateCase(c, { compiled: { title: "Kredit Bank", party: "Bank", summary: "", total: 900, open: 900, installment: 100, nextDue: day(4), nextWhat: "Rate", iban: "DE89370400440532013000", bic: "", payee: "Bank AG", purpose: "VD 1/26", done: false, at: `${day(-10)}T10:00:00.000Z`, sources: 1 } as never });
  const ledger = await import("@/lib/money/ledger");
  const p = ledger.recordPayment({ key: "hand:vd", date: day(-2), amount: 100, label: "by hand", source: "hand" });
  ledger.allocate(p.id, `case:${c}`, 100);

  const { financesOverviewAction } = await import("@/plugins/finances/server-actions");
  const { debtsAppData } = await import("@/plugins/finances/view-data");
  const { t } = await import("@/lib/i18n/server");
  const { getLambda } = await import("@/plugins/workspace/lambdas/store");
  const { runLambda } = await import("@/plugins/workspace/lambdas/run");
  const l = getLambda("finances.debts-app");
  assert.ok(l, "the plugin's lambda is there");
  for (const dir2 of ["owe", "owed"] as const) {
    const r = await financesOverviewAction(dir2);
    assert.ok(r.ok, r.ok ? "" : r.error);
    const builtin = JSON.parse(JSON.stringify(debtsAppData(r.overview, { t, withFixed: true, today: day(0) }))) as Record<string, unknown>;
    delete builtin.overview;
    const run = await runLambda(l!, { dir: dir2, withFixed: true });
    assert.ok(run.ok, run.ok ? "" : run.error);
    const port = JSON.parse(JSON.stringify(run.result)) as Record<string, unknown>;
    delete port.overview;
    // (what the port's template needs beyond the built-in's data)
    delete port.balance;
    delete port.monthlyRows;
    delete port.suggestions; // (the promises the plugin suggests as debts — the built-in's page gets them elsewhere)
    port.debts = (port.debts as Record<string, unknown>[]).map((x) => { const { due: _a, dueText: _b, day: _c, payment: _d, ...rest } = x; return rest; });
    assert.deepEqual(port, builtin, dir2);
  }

  // The screen: the built's template made of the kit alone draws with this data — no part left, the dialogs there.
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("finances-ext"), "views", "debts.html"), "utf8");
  const owe = JSON.parse(JSON.stringify(((await runLambda(l!, { dir: "owe", withFixed: true })) as unknown as { result: unknown }).result)) as { debts: { id: number; manual: boolean; payment: unknown }[] };
  const own = owe.debts.find((d) => d.manual)!;
  const paid = owe.debts.find((d) => !d.manual && d.payment)!;
  assert.ok(own && paid, "an own debt and a case's with an account");
  const find = (nodes: unknown[], tag: string): { a: Record<string, string> }[] => (nodes as ({ t: string; a: Record<string, string>; c: unknown[] } | string)[]).flatMap((n) => (typeof n === "string" ? [] : [...(n.t === tag ? [n] : []), ...find(n.c ?? [], tag)]));
  // (the plugin's lambda gives each debt its creditor's id; the built-in's data has none — null for the template)
  const withCreditor = (app: unknown) => { const o = app as { debts?: Record<string, unknown>[] }; return { ...o, debts: (o.debts ?? []).map((d) => ({ creditorId: null, ...d })) }; };
  const draw = (state: Record<string, string>, app: unknown) => renderView(template, { rows: [], props: [], titleName: "Name", state, app: {}, data: { app: withCreditor(app) }, db: { id: 1, title: "Debts" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] });
  for (const state of [{}, { edit: String(own.id) }, { paying: String(paid.id) }, { addopen: "1" }, { incomeedit: "1" }] as Record<string, string>[]) {
    const r = draw(state, owe);
    assert.deepEqual(r.errors, [], JSON.stringify(state));
    assert.equal(find(r.nodes, "part").length, 0, "no part left");
    if ("paying" in state) assert.equal(find(r.nodes, "girocode").length, 1, "the GiroCode of the debt to pay");
    if ("edit" in state) assert.ok(find(r.nodes, "button").some((b) => b.a.do === "db.set-cells"), "the debt's figures can be saved");
    if ("addopen" in state) assert.ok(find(r.nodes, "button").some((b) => b.a.run === "finances.add-debt"), "the form runs the flow");
  }
  assert.ok(find(draw({}, owe).nodes, "button").some((b) => b.a.do === "db.archive"), "an own debt can be removed");
  assert.deepEqual(renderView(template, { rows: [], props: [], titleName: "Name", state: {}, app: {}, data: {}, db: { id: 1, title: "Debts" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] }).errors, [], "loading");
});
