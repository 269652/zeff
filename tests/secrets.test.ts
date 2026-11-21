import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const DEF = [{ name: "JIRA_PERSONAL_TOKEN", plugin: "Jira", label: "Token", what: "", secret: true }];

test("a secret is stored encrypted and read back; .env is the fallback; empty removes it", async () => {
  const { getSecret, setSecret, listSecrets, deleteSecret } = await import("@/lib/secrets/store");
  assert.equal(getSecret("JIRA_PERSONAL_TOKEN"), "");
  process.env.JIRA_PERSONAL_TOKEN = "from-env";
  assert.equal(getSecret("JIRA_PERSONAL_TOKEN"), "from-env");
  setSecret("JIRA_PERSONAL_TOKEN", "  abc123  ");
  assert.equal(getSecret("JIRA_PERSONAL_TOKEN"), "abc123");
  const row = listSecrets(DEF)[0];
  assert.ok(row.stored && row.value === null, "a secret's value is never listed");
  const { getSqlite } = await import("@/db");
  const raw = (getSqlite().prepare("select value from secrets where name = 'JIRA_PERSONAL_TOKEN'").get() as { value: string }).value;
  assert.ok(!raw.includes("abc123"), "kept encrypted");
  setSecret("JIRA_PERSONAL_TOKEN", "");
  assert.equal(getSecret("JIRA_PERSONAL_TOKEN"), "from-env");
  deleteSecret("JIRA_PERSONAL_TOKEN");
  delete process.env.JIRA_PERSONAL_TOKEN;
});

test("moving to a database of their own keeps the values and empties the account's table", async () => {
  const { getSecret, setSecret, moveSecrets, secretMode } = await import("@/lib/secrets/store");
  const { getSqlite } = await import("@/db");
  setSecret("JIRA_URL", "https://jira.example.com");
  moveSecrets("separate");
  assert.equal(secretMode(), "separate");
  assert.equal(getSecret("JIRA_URL"), "https://jira.example.com");
  assert.equal((getSqlite().prepare("select count(*) as n from secrets").get() as { n: number }).n, 0);
  moveSecrets("account");
  assert.equal(secretMode(), "account");
  assert.equal(getSecret("JIRA_URL"), "https://jira.example.com");
});

test("a plugin's declared secrets are listed, and only those are copied from .env", async () => {
  const { importFromEnvFile, getSecret } = await import("@/lib/secrets/store");
  const { setupTempData: _ } = await import("./helpers");
  void _;
  const file = `${process.cwd()}/data-test-env-${process.pid}`;
  fs.writeFileSync(file, 'JIRA_PERSONAL_TOKEN="tok"\nOTHER_THING=x\n# JIRA_URL=no\n');
  try {
    const done = importFromEnvFile(DEF, file);
    assert.deepEqual(done, ["JIRA_PERSONAL_TOKEN"]);
    assert.equal(getSecret("JIRA_PERSONAL_TOKEN"), "tok");
  } finally {
    fs.rmSync(file, { force: true });
  }
});
