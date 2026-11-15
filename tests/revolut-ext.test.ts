import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";

setupTempData();

/**
 * Revolut's port (zeff-plugins/plugins/revolut-ext): its lambda fills the kernel's service bank.statement with the built-in's own core —
 * the same bookings and account as the built-in, for Revolut's exports (English, German) and another bank's CSV; switched, the kernel reads
 * statements through it (an import, a statement among the documents and its note), paying by RevTag stays a todo action.
 */

const skip = skipWithoutRepo("revolut-ext");
const day = (n: number) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE");

const STATEMENTS: [string, string][] = [
  [
    "account-statement_2026-10.csv",
    "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n" +
      `TRANSFER,Current,${day(-3)} 09:00:00,${day(-3)} 09:00:01,To Nathanael Dienstkonto,-11.52,0.00,EUR,COMPLETED,100.00\n` +
      `CARD_PAYMENT,Current,${day(-2)} 10:00:00,${day(-2)} 10:00:01,Rewe,-23.10,0.00,EUR,COMPLETED,76.90\n` +
      `TRANSFER,Current,${day(-1)} 08:00:00,,To Someone,-5.00,0.00,EUR,PENDING,71.90\n`,
  ],
  [
    "revolut-de.csv",
    "Art,Produkt,Datum des Beginns,Datum des Abschlusses,Beschreibung,Betrag,Gebühr,Währung,Status,Kontostand\n" +
      "Transfer,Giro,2026-03-24 12:21:49,2026-03-24 12:21:50,To Ulrike Nathanael,-64.06,0.00,EUR,ABGESCHLOSSEN,2654.40\n" +
      "Transfer,Giro,2026-03-25 12:21:49,2026-03-25 12:21:50,From Firma,2100.00,0.00,EUR,ABGESCHLOSSEN,4754.40\n",
  ],
  ["sparkasse.csv", "Buchungstag;Empfänger;Verwendungszweck;IBAN;Betrag\n15.10.2026;Nathanael Dienstkonto;DR II 1121/26;DE89 3704 0044 0532 0130 00;-300,00\n16.10.2026;Bäcker;Brötchen;;-3,20\n"],
];

async function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-revolut-ext-"));
  process.env.ZEFF_PLUGINS_DIR = dir;
  fs.cpSync(repoPlugin("revolut-ext"), path.join(dir, "revolut-ext"), { recursive: true });
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["people", "todos", "cases", "revolut", "documents"]) setInstalled(id as never, true);
  await import("@/plugins/contributions");
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  return { reg };
}

test("the port reads a statement as the built-in does: the same bookings and account, booking for booking; none from a CSV that is no statement", { skip }, async () => {
  const { reg } = await world();
  const { readStatement } = await import("@/lib/bank/statements");
  const builtin = [];
  for (const [name, csv] of STATEMENTS) builtin.push(await readStatement(csv, name));
  assert.equal(builtin[0].bookings.length, 2, "the pending one waits");
  reg.setEnabled("revolut-ext", true);
  const { serviceProvider } = await import("@/plugins/workspace/ext-services");
  assert.equal(serviceProvider("bank.statement")?.plugin, "revolut-ext");
  for (const [i, [name, csv]] of STATEMENTS.entries()) assert.deepEqual(JSON.parse(JSON.stringify(await readStatement(csv, name))), JSON.parse(JSON.stringify(builtin[i])), name);
  await assert.rejects(() => readStatement("foo,bar\n1,2\n", "list.csv"));
  reg.setEnabled("revolut-ext", false);
});

test("switched: the kernel reads statements through the port — an import keeps its bookings once, a statement document is read and kept as its note; paying by RevTag stays", { skip }, async () => {
  const { reg } = await world();
  const { switchRevolutToPlugin } = await import("@/plugins/revolut/to-plugin");
  await switchRevolutToPlugin();
  const { isInstalled, onlyThroughPort } = await import("@/plugins/state");
  assert.ok(reg.isEnabled("revolut-ext"));
  assert.ok(isInstalled("revolut") && onlyThroughPort("revolut"), "there through its port: the RevTag todo action stays");
  const statements = await import("@/lib/bank/statements");
  assert.ok(await statements.statementsReadable());
  const [name, csv] = STATEMENTS[2];
  const r = await statements.importStatement(csv, name);
  assert.deepEqual(r, { added: 2, total: 2 });
  assert.equal((await statements.importStatement(csv, name)).added, 0, "not twice");
  const note = await statements.statementNote("account-statement_2026-10.csv", STATEMENTS[0][1]);
  assert.match(note ?? "", /^Kontoauszug \(Revolut\), 2 Buchungen vom /);
  assert.equal(await statements.statementNote("Einkaufsliste.csv", "Ding,Menge\nMilch,1\n"), null);
  const { addDocument } = await import("@/plugins/documents/store");
  addDocument("account-statement_2026-11.csv", Buffer.from(STATEMENTS[1][1]), "text/csv");
  const docs = await statements.importStatementDocuments();
  assert.equal(docs.documents, 1);
  assert.equal(docs.added, 2);
  // The kernel's action, as the cases' bank bar does it.
  const { flowAction } = await import("@/plugins/workspace/flows/actions");
  const a = flowAction("bank.import");
  assert.ok(a, "bank.import is the kernel's");
});
