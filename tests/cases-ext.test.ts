import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";

setupTempData();

/**
 * Cases' port, stage 1 (zeff-plugins/plugins/cases-ext): its stores are the built-in's own tables (adopted — the same rows), its lambda
 * cases.overview works the overview out of them and the kernel's reads with the built-in's own core — the same as the built-in's, figure
 * for figure; its screen (views/overview.html) draws without an error.
 */

const skip = skipWithoutRepo("cases-ext");

async function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-cases-ext-"));
  process.env.ZEFF_PLUGINS_DIR = dir;
  fs.cpSync(repoPlugin("cases-ext"), path.join(dir, "cases-ext"), { recursive: true });
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos", "people", "cases"]) setInstalled(id as never, true);
  await import("@/plugins/contributions");
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  reg.setEnabled("cases-ext", true);
  return { reg };
}

test("the port's overview is the built-in's, out of the same rows: open after payments, who it is owed to, where to pay, the figures", { skip }, async () => {
  await world();
  const store = await import("@/plugins/cases/store");
  const people = await import("@/plugins/people/store");
  const parties = await import("@/plugins/cases/parties");
  const ledger = await import("@/lib/money/ledger");
  const day = (n: number) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE");
  const summary = (v: Record<string, unknown>) => ({ title: "", party: "", summary: "", total: null, open: null, installment: null, nextDue: null, nextWhat: "", iban: "", bic: "", payee: "", purpose: "", done: false, at: `${day(-20)}T10:00:00.000Z`, sources: 1, ...v });
  const bank = people.createPerson({ name: "Musterbank AG" });
  const anna = people.createPerson({ name: "Anna Berg" });
  const a = store.ensureCase("AZ 1/26", "AZ 1/26", day(-10)).id;
  store.updateCase(a, { compiled: summary({ title: "Kredit", open: 1200, installment: 100, nextDue: day(5), nextWhat: "Rate", iban: "DE89370400440532013000", payee: "Musterbank AG", purpose: "AZ 1/26" }) as never });
  parties.setParty(a, "creditor", bank, "manual");
  const p = ledger.recordPayment({ key: "hand:1", date: day(-3), amount: 200, label: "by hand", source: "hand" });
  ledger.allocate(p.id, `case:${a}`, 200);
  const b = store.ensureCase("K 77/25", "K 77/25", day(-30)).id;
  store.updateCase(b, { personId: anna, compiled: summary({ title: "Miete", open: 50, nextDue: day(-2), nextWhat: "Nachzahlung" }) as never });
  const c = store.ensureCase("X 3/26", "X 3/26", day(-1)).id; // not summed up yet
  const done = store.ensureCase("D 9/24", "D 9/24", day(-100)).id;
  store.updateCase(done, { compiled: summary({ title: "Alt", done: true }) as never });
  void c;

  // The built-in's overview, as its view shows it.
  const { casesOverviewAction } = await import("@/plugins/cases/block-actions");
  const r = await casesOverviewAction();
  assert.ok(r.ok, !r.ok ? r.error : "");
  const { casesAppData } = await import("@/plugins/cases/view-data");
  const { t } = await import("@/lib/i18n/server");
  const builtin = JSON.parse(JSON.stringify(casesAppData(r.overview, { t, today: day(0), paying: "", locale: "en" }))) as Record<string, unknown> & { cases: Record<string, unknown>[] };
  delete builtin.overview;

  // The port's: its lambda.
  const { getLambda } = await import("@/plugins/workspace/lambdas/store");
  const { runLambda } = await import("@/plugins/workspace/lambdas/run");
  const l = getLambda("cases.overview");
  assert.ok(l, "the plugin's lambda is there");
  const run = await runLambda(l!, {});
  assert.ok(run.ok, run.ok ? "" : run.error);
  const port = run.result as Record<string, unknown> & { cases: Record<string, unknown>[] };
  for (const x of port.cases) {
    assert.equal(x.key, String(x.id));
    delete x.key;
  }
  assert.deepEqual(port, builtin);
  assert.deepEqual(port.cases.map((x) => x.label), ["K 77/25", "AZ 1/26", "X 3/26"], "by what is due first; the done one not");
  const kredit = port.cases.find((x) => x.label === "AZ 1/26")!;
  assert.equal(kredit.open, 1000, "1200 open less the 200 paid since");
  assert.equal(kredit.name, "Musterbank AG", "its creditor");
  assert.equal(port.overdue, 1);
});

test("the port's overview screen draws without an error, a case's GiroCode the kit's", { skip }, async () => {
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("cases-ext"), "views", "overview.html"), "utf8");
  const app = { loading: false, open: 1050, dueSoon: 100, running: 2, overdue: 1, debtsUrl: "/workspace/9", cases: [{ id: 1, key: "1", rowId: 5, label: "AZ 1/26", name: "Musterbank AG", sub: "Kredit", open: 1000, hasDue: true, due: "20.11.2026", overdue: false, nextWhat: "Rate", summed: true, payment: { name: "Musterbank AG", iban: "DE89370400440532013000", bic: "", purpose: "AZ 1/26", amount: 100 }, paying: false }] };
  const bank = { statements: true, configured: true, connected: true, appId: "app-1", aspsp: "Revolut", country: "DE", validUntil: "2027-01-01T00:00:00Z", lastSync: "2026-11-14T10:00:00Z", transactions: 42, callback: "http://127.0.0.1:9333/api/bank/callback" };
  for (const state of [{}, { paying: "1" }, { bankopen: "1" }]) {
    const r = renderView(template, { rows: [], props: [], titleName: "Name", state, app: {}, data: { app, bank }, db: { id: 1, title: "Cases" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] });
    assert.deepEqual(r.errors, [], JSON.stringify(state));
    const find = (nodes: unknown[], tag: string): { a: Record<string, string> }[] => (nodes as ({ t: string; a: Record<string, string>; c: unknown[] } | string)[]).flatMap((n) => (typeof n === "string" ? [] : [...(n.t === tag ? [n] : []), ...find(n.c, tag)]));
    assert.equal(find(r.nodes, "part").length, 0, "no part left");
    assert.equal(find(r.nodes, "girocode").length, "paying" in state ? 1 : 0);
    if ("bankopen" in state) assert.ok(find(r.nodes, "button").some((b) => b.a.do === "bank.save"), "the bank settings open");
  }
  const loading = renderView(template, { rows: [], props: [], titleName: "Name", state: {}, app: {}, data: {}, db: { id: 1, title: "Cases" }, now: new Date(), locale: "de-DE" } as never, { parts: [], actions: [] });
  assert.deepEqual(loading.errors, []);
});

test("finding the cases: the port's flow makes the same cases and sources as the built-in, out of the same mails, letters and todos", { skip }, async () => {
  await world();
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("documents", true);
  const { getDb, getSqlite, schema } = await import("@/db");
  const db = getDb();
  const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
  getSqlite().exec("delete from case_sources; delete from case_parties; delete from cases");
  const people = await import("@/plugins/people/store");
  const ogv = people.createPerson({ name: "Ulla Nathanael", emails: ["ogv.nathanael@gvjustiz.de"] });
  const mail = (key: string, subject: string, preview: string, days: number, from = "ogv.nathanael@gvjustiz.de") =>
    db.insert(schema.emails).values({ key, convId: `c-${key}`, syncedAt: ago(0), folder: "Posteingang", fromName: "x", fromEmail: from, subject, preview, receivedAt: ago(days) } as never).run();
  mail("dm1", "Mein Zeichen: DR II 810/26", "Das Verfahren 810/26 kann in Raten gezahlt werden.", 70);
  mail("dm2", "11 DR II 1121/26", "Hier ist ein neues Verfahren eingegangen.", 28);
  mail("dm3", "Re: Re: 11 DR II 1121/26", "Ich bin nicht im Dienst.", 2);
  mail("dm4", "Angebote KW 43/26", "Nur diese Woche 3/4 Preis!", 3, "news@shop.example");
  db.insert(schema.documents).values({ name: "Mein Zeichen DR II 810 26.pdf", sha256: "dd1", kind: "pdf", status: "ready", file: "dd1.pdf", summary: "Schreiben", text: "E-Mail: ogv.nathanael@gvjustiz.de\n11 DR II 810/26 Bitte angeben!", createdAt: ago(30), updatedAt: ago(30) } as never).run();
  db.insert(schema.todos).values({ ticket: "", text: "Restforderung 11,52 € (Az. DR II 810/26) heute überweisen", kind: "other", owner: "me", status: "open", source: "Mail", createdAt: ago(1), updatedAt: ago(1), refs: "[]" } as never).run();

  const snapshot = () => ({
    cases: (getSqlite().prepare("select key, label, status, person_id, last_at from cases order by key").all() as { key: string; label: string; status: string; person_id: number | null; last_at: string }[]).map((c) => ({ ...c, last_at: c.last_at.slice(0, 16) })),
    sources: getSqlite().prepare("select c.key, s.ref, s.kind, substr(s.at, 1, 16) at, s.title from case_sources s join cases c on c.id = s.case_id order by c.key, s.ref").all(),
  });

  // The port: its package's flow, allowed what it asks.
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("cases-ext"), "cases.package.json"), "utf8"));
  await (await import("@/plugins/workspace/package-life")).installTracked(pkg, null, { allow: true });
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const r = await runFlow("cases.detect");
  assert.equal(r.status, "done", r.error ?? "");
  assert.deepEqual(r.output, { created: 2, linked: 0 });
  const port = snapshot();
  assert.deepEqual(port.cases.map((c) => [c.key, c.person_id]), [["DR II 1121/26", ogv], ["DR II 810/26", ogv]]);
  const again = await runFlow("cases.detect");
  assert.deepEqual(again.output, { created: 0, linked: 0 }, "again: nothing new");

  // The built-in, on the same sources.
  getSqlite().exec("delete from case_sources; delete from cases");
  const { detectCases } = await import("@/plugins/cases/detect");
  assert.deepEqual(detectCases(), { created: 2, linked: 0 });
  assert.deepEqual(snapshot(), port);
});

test("summing the cases up: the port's flow keeps the same summary, moved on by the same payments, and the same parties as the built-in", { skip }, async () => {
  await world();
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["llm", "documents"]) setInstalled(id as never, true);
  const { getDb, getSqlite, schema } = await import("@/db");
  getSqlite().exec("delete from case_sources; delete from case_parties; delete from cases");
  const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
  const day = (n: number) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE");
  getDb().insert(schema.emails).values({ key: "sm1", convId: "c-sm1", syncedAt: ago(0), folder: "Posteingang", fromName: "Inkasso", fromEmail: "x@inkasso.example", subject: "Az. KR 55/26 Ratenplan", preview: "Bitte zahlen Sie 100 € monatlich.", receivedAt: ago(5) } as never).run();
  const store = await import("@/plugins/cases/store");
  const people = await import("@/plugins/people/store");
  const anna = people.createPerson({ name: "Anna Berg" });
  const answer = { title: "Kredit — Ratenplan", party: "Musterbank", creditor: "Musterbank AG", creditor_kind: "organization", collector: "Inkasso Nord", collector_kind: "organization", summary: "Ein Ratenplan läuft.", total: 1500, open: 1200, installment: 100, installment_day: 15, next_due: day(-10), next_what: "Rate 100 €", iban: "DE89370400440532013000", bic: "COBADEFFXXX", payee: "Musterbank AG (Bank X)", purpose: "KR 55/26", done: false };
  const ledger = await import("@/lib/money/ledger");

  /** A fresh case with one source and one payment of an instalment since — the same for both. */
  const fresh = () => {
    getSqlite().exec("delete from case_sources; delete from case_parties; delete from cases");
    const id = store.ensureCase("KR 55/26", "KR 55/26", ago(5)).id;
    store.updateCase(id, { personId: anna });
    store.addSource(id, { ref: "mail:sm1", kind: "mail", at: ago(5), title: "Az. KR 55/26 Ratenplan" });
    const p = ledger.recordPayment({ key: `hand:${id}:${Math.random()}`, date: day(0), amount: 100, label: "by hand", source: "hand" });
    ledger.allocate(p.id, `case:${id}`, 100);
    return id;
  };
  const snapshot = (id: number) => {
    const c = store.getCase(id)!;
    const { at: _at, ...s } = c.compiled as unknown as Record<string, unknown>;
    void _at;
    const parties = (getSqlite().prepare("select role, p.name, source from case_parties cp join people p on p.id = cp.person_id where case_id = ? order by role").all(id) as Record<string, unknown>[]);
    return { s, parties };
  };

  // The built-in: its compile with the answer.
  const { compileCases } = await import("@/plugins/cases/compile");
  const a = fresh();
  const prompts: string[] = [];
  assert.deepEqual(await compileCases({ ask: async (p) => (prompts.push(p), answer) }), { compiled: 1 });
  const builtin = snapshot(a);

  // The port: its package's flow — the AI answering the same (the AI action stood in for).
  const { extensionPoint } = await import("@/lib/plugin-kit/extension-point");
  const asked: string[] = [];
  const { AI_ACTIONS } = await import("@/plugins/workspace/flows/ai-actions");
  extensionPoint("workspace.flowActions").contribute("core:ai", [...AI_ACTIONS.filter((x) => x.name !== "ai.json"), { name: "ai.json", group: "ai", label: "AI (test)", summary: "", input: [], output: "", run: async (i: Record<string, unknown>) => (asked.push(String(i.prompt)), answer) }] as never);
  try {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("cases-ext"), "cases.package.json"), "utf8"));
  const life = await import("@/plugins/workspace/package-life");
  const { flowByName } = await import("@/plugins/workspace/flows/store");
  if (!flowByName("cases.summarize")) await life.installTracked(pkg, null, { allow: true });
  const b = fresh();
  for (const p of people.listPeople().filter((x) => x.name !== "Anna Berg" && x.name !== "Ulla Nathanael")) people.deletePerson?.(p.id);
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const r = await runFlow("cases.summarize");
  assert.equal(r.status, "done", r.error ?? "");
  assert.deepEqual(asked, prompts.map((p) => p), "the AI read the same");
  assert.deepEqual(snapshot(b), builtin);
  assert.equal((store.getCase(b)!.compiled as { nextDue: string }).nextDue > day(-10), true, "moved on by the instalment paid since");
  } finally {
    extensionPoint("workspace.flowActions").contribute("core:ai", AI_ACTIONS as never);
  }
});

test("a payment to a case moves its summary on — the port's flow on the ledger's event, the same as the built-in", { skip }, async () => {
  await world();
  const { getSqlite } = await import("@/db");
  const store = await import("@/plugins/cases/store");
  const ledger = await import("@/lib/money/ledger");
  const day = (n: number) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE");
  const summary = { title: "Kredit", party: "", summary: "", total: 1000, open: 600, installment: 100, installmentDay: 1, nextDue: day(3), nextWhat: "Rate", iban: "", bic: "", payee: "", purpose: "", done: false, at: `${day(-5)}T10:00:00.000Z`, sources: 1, creditor: "" };
  const settle = async (viaPort: boolean) => {
    getSqlite().exec("delete from case_sources; delete from case_parties; delete from cases");
    const id = store.ensureCase("SET 1/26", "SET 1/26", day(-5)).id;
    store.updateCase(id, { compiled: summary as never });
    const p = ledger.recordPayment({ key: `hand:set:${viaPort}:${Math.random()}`, date: day(0), amount: 100, label: "by hand", source: "hand" });
    if (viaPort) {
      // (the port alone: its flow on the event, the built-in's recompute not run)
      const { runFlow } = await import("@/plugins/workspace/flows/engine");
      getSqlite().prepare("insert into ledger_allocations (payment_id, ref, amount, created_at) values (?, ?, ?, ?)").run(p.id, `case:${id}`, 100, new Date().toISOString());
      const r = await runFlow("cases.settle", { ref: `case:${id}` });
      assert.equal(r.status, "done", r.error ?? "");
    } else ledger.allocate(p.id, `case:${id}`, 100);
    const { at: _at, ...rest } = store.getCase(id)!.compiled as unknown as Record<string, unknown>;
    void _at;
    return rest;
  };
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("cases-ext"), "cases.package.json"), "utf8"));
  const { flowByName } = await import("@/plugins/workspace/flows/store");
  if (!flowByName("cases.settle")) await (await import("@/plugins/workspace/package-life")).installTracked(pkg, null, { allow: true });
  assert.deepEqual(flowByName("cases.settle")!.triggers, [{ kind: "event", event: "ledger.changed", name: "case" }]);
  const builtin = await settle(false);
  assert.notEqual(builtin.nextDue, day(3), "the built-in moved it on");
  assert.deepEqual(await settle(true), builtin);
});

test("matching the bank's bookings: the port's flow matches, books, confirms and ticks off the same as the built-in", { skip }, async () => {
  await world();
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["todos", "people", "cases"]) setInstalled(id as never, true);
  const { getDb, getSqlite, schema } = await import("@/db");
  const IBAN = "DE89370400440532013000";
  const day = (n: number) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE");
  const store = await import("@/plugins/cases/store");
  const ledger = await import("@/lib/money/ledger");
  const bank = await import("@/plugins/cases/bank");

  /** The same start for both: two cases, a transfer todo, a payment ticked off by hand, five bookings. */
  const fresh = () => {
    getSqlite().exec("delete from case_sources; delete from case_parties; delete from cases; delete from bank_transactions; delete from ledger_allocations; delete from ledger_payments; delete from todos");
    const summary = (v: Record<string, unknown>) => ({ title: "", party: "", summary: "", total: null, open: null, installment: null, nextDue: day(5), nextWhat: "", iban: "", bic: "", payee: "", purpose: "", done: false, at: `${day(-20)}T10:00:00.000Z`, sources: 1, creditor: "", ...v });
    const a = store.ensureCase("MB 1/26", "MB 1/26", day(-20)).id;
    store.updateCase(a, { compiled: summary({ title: "Kredit", open: 900, installment: 100, iban: IBAN, payee: "Musterbank AG" }) as never });
    const b = store.ensureCase("ST 2/26", "ST 2/26", day(-20)).id;
    store.updateCase(b, { compiled: summary({ title: "Steuer", open: 250, payee: "Finanzamt Mitte" }) as never });
    const now = new Date().toISOString();
    const todo = Number(getDb().insert(schema.todos).values({ ticket: "", text: "Steuer ST 2/26 überweisen", kind: "other", owner: "me", status: "open", source: "Mail", refs: "[]", ops: JSON.stringify([{ type: "bank-transfer", name: "Finanzamt Mitte", iban: "DE02120300000000202051", bic: "", amount: "250.00", purpose: "ST 2/26" }]), createdAt: now, updatedAt: now } as never).run().lastInsertRowid);
    const hand = ledger.recordPayment({ key: "hand:mb", date: day(-3), amount: 100, label: "by hand", source: "hand" });
    ledger.allocate(hand.id, `case:${a}`, 100);
    bank.addBookings(
      [
        { date: day(-2), amount: -100, currency: "EUR", text: "Rate MB 1/26", counterparty: "Musterbank AG", iban: IBAN, reference: "MB 1/26" }, // the one ticked off: confirmed
        { date: day(-1), amount: -100, currency: "EUR", text: "Rate MB 1/26", counterparty: "Musterbank AG", iban: IBAN, reference: "MB 1/26" }, // read twice (within two days of a bank payment? no — a new instalment)
        { date: day(-1), amount: -250, currency: "EUR", text: "Steuer", counterparty: "Finanzamt Mitte", iban: "DE02120300000000202051", reference: "ST 2/26" }, // the todo's transfer and its case
        { date: day(-1), amount: -12.5, currency: "EUR", text: "Kaffee", counterparty: "Café", iban: "", reference: "" }, // evidence: nothing to settle
        { date: day(-1), amount: 500, currency: "EUR", text: "Gehalt", counterparty: "Firma", iban: "", reference: "" }, // money in: not matched
      ],
      "Konto",
    );
    return { a, b, todo };
  };
  const snapshot = () => ({
    bank: getSqlite().prepare("select date, amount, text, case_id is not null c, todo_id is not null t, matched_at is not null m from bank_transactions order by date, amount").all(),
    payments: getSqlite().prepare("select p.date, p.amount, p.source, p.tx is not null tx, p.label, a.ref from ledger_payments p join ledger_allocations a on a.payment_id = p.id order by p.date, p.amount, p.source").all().map((r) => ({ ...(r as object), ref: String((r as { ref: string }).ref).replace(/\d+$/, "N") })),
    todos: getSqlite().prepare("select status, note from todos order by id").all(),
    cases: getSqlite().prepare("select key, compiled from cases order by key").all().map((r) => ({ key: (r as { key: string }).key, nextDue: JSON.parse((r as { compiled: string }).compiled).nextDue })),
  });

  fresh();
  bank.matchPayments();
  const builtin = snapshot();
  assert.equal(builtin.todos[0] && (builtin.todos[0] as { status: string }).status, "done", "the todo paid");

  // The port: its package's flow (the built-in's recompute on the ledger runs alike — both apply their case's figures).
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("cases-ext"), "cases.package.json"), "utf8"));
  const { flowByName } = await import("@/plugins/workspace/flows/store");
  if (!flowByName("cases.match")) await (await import("@/plugins/workspace/package-life")).installTracked(pkg, null, { allow: true });
  fresh();
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const r = await runFlow("cases.match");
  assert.equal(r.status, "done", r.error ?? "");
  assert.deepEqual(snapshot(), builtin);
});

test("warning before a plan lapses: the port's flow makes the same todo, once, as the built-in", { skip }, async () => {
  await world();
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("todos" as never, true);
  const { getSqlite } = await import("@/db");
  const store = await import("@/plugins/cases/store");
  const day = (n: number) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE");
  const bank = await import("@/plugins/cases/bank");
  const ledger = await import("@/lib/money/ledger");
  const fresh = () => {
    // (the tables made, as the plugins make them on first use)
    store.casesDb();
    bank.listTransactions(1);
    ledger.allocationsOf("case:0");
    getSqlite().exec("delete from case_sources; delete from case_parties; delete from case_warnings; delete from cases; delete from todos; delete from ledger_allocations; delete from ledger_payments");
    const id = store.ensureCase("WR 4/26", "WR 4/26", day(-30)).id;
    store.updateCase(id, { compiled: { title: "Ratenplan", party: "Bank", summary: "", total: 900, open: 600, installment: 150, nextDue: day(-12), nextWhat: "Rate", iban: "DE89370400440532013000", bic: "COBADEFFXXX", payee: "Musterbank", purpose: "WR 4/26", done: false, at: `${day(-30)}T10:00:00.000Z`, sources: 1, creditor: "" } as never });
  };
  const snapshot = () => ({ todos: getSqlite().prepare("select text, due, ops from todos order by id").all(), warnings: getSqlite().prepare("select due from case_warnings").all() });
  fresh();
  const { overdueWarnings } = bank;
  assert.equal(overdueWarnings(day(0)), 1);
  assert.equal(overdueWarnings(day(0)), 0, "once");
  const builtin = snapshot();
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("cases-ext"), "cases.package.json"), "utf8"));
  const { flowByName } = await import("@/plugins/workspace/flows/store");
  if (!flowByName("cases.warn")) await (await import("@/plugins/workspace/package-life")).installTracked(pkg, null, { allow: true });
  fresh();
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const r = await runFlow("cases.warn");
  assert.equal(r.status, "done", r.error ?? "");
  assert.deepEqual((await runFlow("cases.warn")).output, { warned: 0 }, "once");
  assert.deepEqual(snapshot(), builtin);
});

test("a case's own page: the port's lambda gives the built-in's page data; its template draws without a part", { skip }, async () => {
  await world();
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["todos", "people", "workspace"]) setInstalled(id as never, true);
  const { getSqlite } = await import("@/db");
  const store = await import("@/plugins/cases/store");
  const people = await import("@/plugins/people/store");
  const parties = await import("@/plugins/cases/parties");
  store.casesDb();
  getSqlite().exec("delete from case_sources; delete from case_parties; delete from cases");
  const day = (n: number) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE");
  const id = store.ensureCase("PG 7/26", "PG 7/26", day(-3)).id;
  const bank = people.createPerson({ name: "Pagebank AG" });
  store.updateCase(id, { note: "Anrufen", compiled: { title: "Kredit", party: "Pagebank", summary: "Läuft.", total: 900, open: 600, installment: 100, nextDue: day(5), nextWhat: "Rate", iban: "DE89370400440532013000", bic: "", payee: "Pagebank AG", purpose: "PG 7/26", done: false, at: `${day(-10)}T10:00:00.000Z`, sources: 1, creditor: "Pagebank AG" } as never });
  parties.setParty(id, "creditor", bank, "manual");
  store.addSource(id, { ref: "mail:pg1", kind: "mail", at: day(-3), title: "Ratenplan" });
  // (a row of the cases database standing for it)
  const ws = await import("@/plugins/workspace/store");
  const dbId = ws.createPage({ kind: "database", title: "Cases", schema: { titleName: "Name", properties: [{ id: "srcref", name: "Ref", type: "text" }], views: [] } as never });
  const row = ws.createPage({ parentId: dbId, title: "Kredit", props: { srcref: `case:${id}` } } as never);
  const { caseBundleAction } = await import("@/plugins/cases/block-actions");
  const r = await caseBundleAction(row);
  assert.ok(r.ok, r.ok ? "" : r.error);
  const { caseAppData } = await import("@/plugins/cases/view-data");
  const { t } = await import("@/lib/i18n/server");
  const builtin = JSON.parse(JSON.stringify(caseAppData(r.case, { t, busy: false, locale: "en" }))) as Record<string, unknown>;
  delete builtin.bundle;
  const { getLambda } = await import("@/plugins/workspace/lambdas/store");
  const { runLambda } = await import("@/plugins/workspace/lambdas/run");
  const run = await runLambda(getLambda("cases.case")!, { row });
  assert.ok(run.ok, run.ok ? "" : run.error);
  const port = run.result as Record<string, unknown>;
  for (const k of ["caseId", "rowId", "refs", "statusValue", "noteText", "payAmount", "partyIds", "peopleOptions", "bundlePayment"]) delete port[k];
  assert.deepEqual({ ...port, hasSources: builtin.hasSources }, builtin);
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(repoPlugin("cases-ext"), "views", "case.html"), "utf8");
  for (const data of [{}, { app: { ...run.result as object } }]) {
    const v = renderView(template, { rows: [], props: [], titleName: "Name", state: {}, app: {}, data, db: { id: dbId, title: "Cases" }, now: new Date(), locale: "de-DE", current: { id: row, title: "Kredit", icon: "", cells: {}, createdAt: "", updatedAt: "" } } as never, { parts: [], actions: [] });
    assert.deepEqual(v.errors, [], JSON.stringify(Object.keys(data)));
  }
});

test("the cases database's rows: the port's source stands in for the built-in's — the same records, and switching keeps the database", { skip }, async () => {
  await world();
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["todos", "people", "workspace"]) setInstalled(id as never, true);
  const { getSqlite } = await import("@/db");
  const store = await import("@/plugins/cases/store");
  const people = await import("@/plugins/people/store");
  const ledger = await import("@/lib/money/ledger");
  store.casesDb();
  getSqlite().exec("delete from case_sources; delete from case_parties; delete from cases");
  const day = (n: number) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE");
  const ole = people.createPerson({ name: "Ole Sand" });
  const a = store.ensureCase("RC 1/26", "RC 1/26", day(-4)).id;
  store.updateCase(a, { personId: ole, note: "Brief schreiben", compiled: { title: "Kredit", party: "Recbank", summary: "", total: 800, open: 500, installment: 50, nextDue: day(9), nextWhat: "Rate", iban: "DE89370400440532013000", bic: "", payee: "", purpose: "", done: false, at: `${day(-10)}T10:00:00.000Z`, sources: 1 } as never });
  const p = ledger.recordPayment({ key: "hand:rc", date: day(-1), amount: 100, label: "by hand", source: "hand" });
  ledger.allocate(p.id, `case:${a}`, 100);
  const b = store.ensureCase("RC 2/26", "RC 2/26", day(-8)).id;
  store.updateCase(b, { status: "closed" } as never);
  store.ensureCase("RC 3/26", "RC 3/26", day(-2));

  // The built-in's records (without its finding first: the port's flow cases.detect does that).
  const { caseRecords } = await import("@/plugins/cases/workspace-source");
  const builtin = JSON.parse(JSON.stringify(await caseRecords()));
  const { allSources } = await import("@/plugins/workspace/source-point");
  assert.equal(allSources().filter((s) => s.id === "cases").length, 1, "the built-in's reads while it is on — the port's doesn't stand beside it");
  const { externalSources } = await import("@/plugins/workspace/ext-functions");
  const src = externalSources().find((s) => s.id === "cases");
  assert.ok(src, "the port's source has the built-in's id");
  const port = JSON.parse(JSON.stringify(await src!.read()));
  assert.deepEqual(port, builtin);
  assert.equal(port.find((r: { key: string }) => r.key === "RC 1/26").typed.find((f: { id: string }) => f.id === "caseopen").value, 400, "500 open less the 100 paid");

  // Switching: the built-in off, the database's overview and case page the plugin's screens, its source the port's.
  const { createExtSourceDatabase } = await import("@/plugins/workspace/derived");
  const db = await createExtSourceDatabase("cases", "Cases");
  const { setPref } = await import("@/lib/prefs");
  setPref("workspace.casesDb", db);
  const ws = await import("@/plugins/workspace/store");
  const { newView } = await import("@/plugins/workspace/model");
  const cur = ws.getDatabase(db)!.schema;
  ws.updateSchema(db, { ...cur, dataType: "cases", views: [{ ...newView("Overview", "table"), type: "app", app: "cases" }, ...cur.views] });
  const { switchCasesToPlugin } = await import("@/plugins/cases/to-plugin");
  const r = await switchCasesToPlugin();
  assert.equal(r.db, db);
  const { isInstalled } = await import("@/plugins/state");
  assert.equal(isInstalled("cases"), false);
  const after = ws.getDatabase(db)!.schema;
  assert.ok(after.views.some((v) => v.type === "app" && v.app === "template" && /cases\.overview/.test(v.template ?? "")), "the overview: the plugin's screen");
  assert.ok(after.rowTemplate && after.rowTemplate.length > 100, "a case's page: the plugin's");
  const { rowViewFor } = await import("@/plugins/workspace/row-views");
  assert.equal(rowViewFor(after)?.id, "detail", "a row's page draws the plugin's template now");
  const now = allSources().filter((s) => s.id === "cases");
  assert.equal(now.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(await now[0].read())), builtin, "the database reads on — the port's records");
  const { flowByName } = await import("@/plugins/workspace/flows/store");
  assert.ok(flowByName("cases.detect"), "its flows are there");
});

test("with the built-in off, its port keeps the cases: People and the first look still see them, new bookings are matched by the port's flows", { skip }, async () => {
  await world();
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["todos", "people", "workspace"]) setInstalled(id as never, true);
  const { getDb, getSqlite, schema } = await import("@/db");
  const store = await import("@/plugins/cases/store");
  const people = await import("@/plugins/people/store");
  const bank = await import("@/plugins/cases/bank");
  const day = (n: number) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE");
  store.casesDb();
  (await import("@/lib/bank/bookings")).bookingsDb();
  getSqlite().exec("delete from case_sources; delete from case_parties; delete from cases; delete from bank_transactions; delete from todos");
  const pkg = JSON.parse(fs.readFileSync(path.join(repoPlugin("cases-ext"), "cases.package.json"), "utf8"));
  const { flowByName } = await import("@/plugins/workspace/flows/store");
  if (!flowByName("cases.match")) await (await import("@/plugins/workspace/package-life")).installTracked(pkg, null, { allow: true });
  const pia = people.createPerson({ name: "Pia Lind" });
  const c = store.ensureCase("PL 4/26", "PL 4/26", day(-5)).id;
  store.updateCase(c, { personId: pia, compiled: { title: "Miete", party: "", summary: "", total: null, open: 300, installment: null, nextDue: day(3), nextWhat: "Nachzahlung", iban: "", bic: "", payee: "Hausverwaltung", purpose: "PL 4/26", done: false, at: `${day(-9)}T10:00:00.000Z`, sources: 1 } as never });
  const now = new Date().toISOString();
  const todo = Number(getDb().insert(schema.todos).values({ ticket: "", text: "Miete PL 4/26 überweisen", kind: "other", owner: "me", status: "open", source: "Mail", refs: "[]", ops: JSON.stringify([{ type: "bank-transfer", name: "Hausverwaltung", iban: "DE02120300000000202051", bic: "", amount: "300.00", purpose: "PL 4/26" }]), createdAt: now, updatedAt: now } as never).run().lastInsertRowid);

  setInstalled("revolut", true);
  setInstalled("finances", true);
  setInstalled("cases", false);
  const { isInstalled } = await import("@/plugins/state");
  assert.ok(isInstalled("revolut") && isInstalled("finances"), "what builds on Cases stays — its port is on");
  assert.ok(!isInstalled("cases"));
  const there = await import("@/lib/cases/there");
  assert.equal(there.casesKeeper(), "port");
  assert.ok(there.casesThere());
  const { firstLook } = await import("@/lib/first-look");
  const look = await firstLook();
  assert.ok(JSON.stringify(look).includes("case:" + c), "the first look still has the case coming due");

  bank.addBookings([{ date: day(-1), amount: -300, currency: "EUR", text: "Miete", counterparty: "Hausverwaltung", iban: "DE02120300000000202051", reference: "PL 4/26" }], "Konto");
  const r = await there.casesAfterBookings(day(0));
  assert.equal(r.matched, 1, "matched by the port's flow");
  assert.equal((getSqlite().prepare("select status from todos where id = ?").get(todo) as { status: string }).status, "done", "the todo paid");
});
