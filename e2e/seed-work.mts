/**
 * Code sessions in a test server's database, every state the Code screen shows (scripts/test-server.mjs --seed e2e/seed-work.mts): two repos, three
 * tickets, sessions running (live, asking: a permission with an edit, a question, a plan; a Copilot one asking), queued, done (a long conversation with
 * folded steps, your messages, a !command, changes in its folder), failed, interrupted, cancelled and archived — with their logs. Made with the app's own
 * functions; the same seed for the old screens and the plugin's, so screenshots of both can be compared.
 *
 * WORK_SEED_DIR: a folder with two git repos `repos/shop-web` (a base commit in `repos/shop-web.base`, changes on top) and `repos/billing-api`.
 * The live sessions' state (what they ask) can't be made in a database — it is a live driver's, in the server's memory: the seed writes it to
 * `<data>/fake-live.json` for a test-only driver (`WORK_FAKE_LIVE`, preloaded into the server) to show.
 */
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DATABASE_PATH;
if (!dbPath || !process.env.ZEFF_TEST_SERVER) throw new Error("Only for a test server's database (DATABASE_PATH + ZEFF_TEST_SERVER).");
const dir = process.env.WORK_SEED_DIR;
if (!dir) throw new Error("WORK_SEED_DIR (the folder with the seed's git repos) is needed.");
const shop = path.join(dir, "repos", "shop-web");
const billing = path.join(dir, "repos", "billing-api");
const shopBase = fs.readFileSync(path.join(dir, "repos", "shop-web.base"), "utf8").trim();

const { setInstalled } = await import("@/plugins/state");
for (const id of ["todos", "jira", "work"] as const) setInstalled(id, true);
const { upsertTickets } = await import("@/lib/jira/store");
const { addManualTodo, addTodoInstruction } = await import("@/lib/todos/store");
const { createRun, updateRun } = await import("@/lib/work/store");
const { logPath, inPath } = await import("@/lib/work/log");
const { setSessionArchived } = await import("@/lib/work/session-admin");
const { saveRepo } = await import("@/lib/repos");

saveRepo({ name: "shop-web", path: shop, gitlabProject: null, boards: [], tickets: ["SHOP-412", "SHOP-398"], instructions: "", delivery: "mr" });
saveRepo({ name: "billing-api", path: billing, gitlabProject: null, boards: [], tickets: ["BILL-77"], instructions: "", delivery: "direct" });
upsertTickets([
  { key: "SHOP-412", summary: "Checkout button stays disabled after applying a coupon", status: "In Progress", statusCategory: "inprogress", issueType: "Bug", assignee: "Erika Mustermann", url: "https://jira.example.com/browse/SHOP-412" },
  { key: "SHOP-398", summary: "Paginate the order history", status: "In Review", statusCategory: "inprogress", issueType: "Story", assignee: "Erika Mustermann", url: "https://jira.example.com/browse/SHOP-398" },
  { key: "BILL-77", summary: "Invoice PDF misses the VAT line", status: "To Do", statusCategory: "todo", issueType: "Bug", assignee: null, url: "https://jira.example.com/browse/BILL-77" },
]);

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const todo = (ticket: string, text: string) => {
  const r = addManualTodo({ ticket, text }) as { id?: number; todo?: { id: number } };
  const id = r.id ?? r.todo?.id;
  if (!id) throw new Error(`no todo: ${JSON.stringify(r)}`);
  return id;
};
type Line = Record<string, unknown>;
const log = (id: number, lines: Line[], live = false) => {
  fs.mkdirSync(path.dirname(logPath(id)), { recursive: true });
  fs.writeFileSync(logPath(id), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  if (live) fs.writeFileSync(inPath(id), "");
};
const run = (v: { ticket: string; todo: number; provider?: string; repo?: string | null; mode?: string; ask?: string }, patch: Record<string, unknown>) => {
  const r = createRun({ ticket: v.ticket, todoId: v.todo, mode: v.mode ?? "code", provider: v.provider ?? "claude", model: null, permissionMode: null, repo: v.repo ?? null, prompt: v.ask ?? "" });
  updateRun(r.id, patch as never);
  if (v.ask) addTodoInstruction(v.todo, v.ask, r.id);
  return r.id;
};

// The stream a Claude worker writes (JSON lines), in short.
const init = (cwd: string, mode = "default") => ({ type: "system", subtype: "init", model: "claude-opus-4-5", cwd, permissionMode: mode, mcp_servers: [] });
const you = (text: string) => ({ type: "user", isReplay: true, message: { content: text } });
const say = (text: string) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
let tid = 0;
const tool = (name: string, input: Record<string, unknown>, out?: string, error = false): Line[] => {
  const id = `tu${++tid}`;
  return [{ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } }, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: out ?? "", is_error: error }] } }];
};
const result = (cost: number, turns: number, ok = true) => ({ type: "result", subtype: ok ? "success" : "error_max_turns", is_error: !ok, total_cost_usd: cost, num_turns: turns, duration_ms: turns * 30000 });

const fake: { claude: Record<string, unknown>; copilot: Record<string, unknown> } = { claude: {}, copilot: {} };

// 1. A live Claude session on SHOP-412: an earlier turn done, now asking to edit a file (yellow: waits for you).
const t1 = todo("SHOP-412", "Fix the disabled checkout button after a coupon");
const r1a = run({ ticket: "SHOP-412", todo: t1, repo: shop, ask: "The checkout button stays disabled after applying a coupon. Find out why." }, { status: "done", cwd: shop, branch: "fix/SHOP-412-coupon-button", baseSha: shopBase, startedAt: ago(95), finishedAt: ago(80), costUsd: 0.42, durationMs: 14 * 60000 + 12000, turns: 9, summary: "The button's `busy` flag is never reset after `onApply` resolves." });
log(r1a, [
  you("The checkout button stays disabled after applying a coupon. Find out why."),
  init(shop),
  say("I'll look at the coupon form first."),
  ...tool("Grep", { pattern: "setBusy", path: "src" }, "src/checkout/CouponForm.tsx:3\nsrc/checkout/CouponForm.tsx:5"),
  ...tool("Read", { file_path: "src/checkout/CouponForm.tsx" }, "export function CouponForm …"),
  say("Found it: `setBusy(true)` runs before `onApply`, but nothing sets it back to `false` — so after the first coupon the button stays disabled.\n\n- `apply` never resets `busy`\n- an error in `onApply` would leave it stuck as well"),
  result(0.42, 9),
], true);
const r1 = run({ ticket: "SHOP-412", todo: t1, repo: shop, ask: "Fix it, with a test." }, { status: "running", provider: "faketest", cwd: shop, branch: "fix/SHOP-412-coupon-button", baseSha: shopBase, startedAt: ago(20), sessionId: "s-412" });
log(r1, [
  you("Fix it, with a test."),
  init(shop),
  say("I'll reset `busy` in a `finally`, then add a test."),
  ...tool("Read", { file_path: "src/checkout/CouponForm.tsx" }, "…"),
  ...tool("Bash", { command: "npm test -- coupon" }, "> shop-web@1.0.0 test\n> node --test\n\n✖ 1 failing"),
  you("Keep the old behaviour for errors, please."),
  { type: "user", isReplay: true, message: { content: "<bash-input>git status --short</bash-input><bash-stdout> M src/checkout/CouponForm.tsx\n?? src/checkout/coupon.test.ts</bash-stdout>" } },
  say("Understood — the button comes back after success and after an error."),
  { type: "control_request", request_id: "req-1", request: { subtype: "can_use_tool", tool_name: "Edit", input: { file_path: "src/checkout/CouponForm.tsx" } } },
], true);
fake.claude[r1] = {
  busy: false,
  mode: "default",
  model: "",
  effort: "",
  queued: 0,
  costUsd: 0.18,
  asks: [
    {
      requestId: "req-1",
      tool: "Edit",
      input: { file_path: "src/checkout/CouponForm.tsx", old_string: "    setBusy(true);\n    await onApply(code);\n  };", new_string: "    setBusy(true);\n    try {\n      await onApply(code);\n    } finally {\n      setBusy(false);\n    }\n  };" },
      description: "Reset busy after applying",
      reason: null,
      suggestions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
      at: ago(1),
    },
  ],
};

// 2. Done on SHOP-398: a long conversation — more than four steps (folded), a failed command, your message in between, the answer in Markdown; changes in its folder.
const t2 = todo("SHOP-398", "Paginate the order history");
const r2 = run({ ticket: "SHOP-398", todo: t2, repo: shop, ask: "Add pagination to the order history: 20 orders a page, with next and previous." }, { status: "done", cwd: shop, branch: "feature/SHOP-398-pagination", baseSha: shopBase, startedAt: ago(190), finishedAt: ago(170), costUsd: 1.27, durationMs: 21 * 60000 + 4000, turns: 23, summary: "Pagination added: 20 orders per page, next/previous, tested." });
log(r2, [
  you("Add pagination to the order history: 20 orders a page, with next and previous."),
  init(shop),
  say("Let me find the order history first."),
  ...tool("Glob", { pattern: "src/**/order*" }, "src/orders/history.tsx"),
  ...tool("Read", { file_path: "src/orders/history.tsx" }, "…"),
  ...tool("Grep", { pattern: "fetchOrders", path: "src" }, "src/orders/api.ts:12"),
  ...tool("Read", { file_path: "src/orders/api.ts" }, "…"),
  ...tool("Edit", { file_path: "src/orders/api.ts", old_string: "export const fetchOrders = () => get('/orders');", new_string: "export const fetchOrders = (page = 1) => get(`/orders?page=${page}&size=20`);" }, "ok"),
  ...tool("Bash", { command: "npm run typecheck" }, "src/orders/history.tsx(14,7): error TS2554: Expected 1 arguments, but got 0.", true),
  say("The page has to be passed through — fixing the call site."),
  ...tool("Edit", { file_path: "src/orders/history.tsx", old_string: "fetchOrders()", new_string: "fetchOrders(page)" }, "ok"),
  ...tool("Bash", { command: "npm test" }, "> node --test\n\n✔ 14 passing"),
  say("## Done\n\nThe order history now shows **20 orders a page**:\n\n1. `fetchOrders(page)` asks the API for one page\n2. *Previous* and *Next* under the list\n3. The page is kept in the address (`?page=2`)\n\n```ts\nexport const fetchOrders = (page = 1) => get(`/orders?page=${page}&size=20`);\n```"),
  result(1.27, 23),
]);
updateRun(r2, { gitSummary: " src/orders/api.ts     | 2 +-\n src/orders/history.tsx | 9 +++++++--\n 2 files changed, 8 insertions(+), 3 deletions(-)" } as never);

// 3. Failed on BILL-77 (yesterday): its error.
const t3 = todo("BILL-77", "Explain why the invoice PDF misses the VAT line");
const r3 = run({ ticket: "BILL-77", todo: t3, repo: billing, ask: "Why is the VAT line missing on the invoice PDF?" }, { status: "failed", cwd: billing, branch: "main", startedAt: ago(26 * 60), finishedAt: ago(26 * 60 - 3), error: "The worker stopped: Claude CLI exited with code 1 (rate limit reached).", costUsd: 0.05, durationMs: 180000, turns: 2 });
log(r3, [you("Why is the VAT line missing on the invoice PDF?"), init(billing), say("Looking at the PDF template."), ...tool("Read", { file_path: "templates/invoice.hbs" }, "…")]);

// 4. Queued (no ticket): waits for the running session.
const t4 = todo("", "Update the dependencies");
run({ ticket: "", todo: t4, repo: shop, ask: "Update all dependencies to their latest minor versions and run the tests." }, { status: "queued", queuedAt: ago(4), afterRun: r1 });

// 5. Interrupted on SHOP-412 (yesterday).
const t5 = todo("SHOP-412", "Refactor the coupon service");
const r5 = run({ ticket: "SHOP-412", todo: t5, repo: shop, ask: "Refactor the coupon service into smaller functions." }, { status: "interrupted", cwd: shop, branch: "refactor/coupon-service", startedAt: ago(27 * 60), finishedAt: ago(26 * 60 + 40), durationMs: 20 * 60000, turns: 6, costUsd: 0.31 });
log(r5, [you("Refactor the coupon service into smaller functions."), init(shop), say("Splitting `applyCoupon` into validate, price and persist."), ...tool("Read", { file_path: "src/coupons/service.ts" }, "…")]);

// 6. A live Copilot session asking for a permission (no ticket).
const t6 = todo("", "Review the README for outdated steps");
const r6 = run({ ticket: "", todo: t6, provider: "copilot", repo: billing, ask: "Review the README and fix outdated setup steps." }, { status: "running", provider: "faketest", cwd: billing, branch: "main", startedAt: ago(9) });
fs.mkdirSync(path.dirname(logPath(r6)), { recursive: true });
fs.writeFileSync(logPath(r6), "● Reading README.md\n● Checking package.json scripts\nThe setup section still mentions `yarn`; the repo uses npm.\n");
fake.copilot[r6] = {
  mode: "agent",
  modes: [
    { id: "agent", name: "Agent" },
    { id: "plan", name: "Plan" },
    { id: "autopilot", name: "Autopilot" },
  ],
  busy: true,
  permission: { title: "Run shell command", detail: "npm install --save-dev prettier", options: [{ id: "o1", name: "Allow once", kind: "allow_once" }, { id: "o2", name: "Allow always", kind: "allow_always" }, { id: "o3", name: "Deny", kind: "reject_once" }] },
  waiting: null,
  // (what Copilot CLI's ACP server offers: images in a prompt, its models and reasoning efforts as session config options)
  features: ["images", "files", "model", "effort"],
  models: [
    { value: "auto", label: "Auto" },
    { value: "claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
    { value: "gpt-6.2-sol", label: "GPT-6.2 Sol" },
  ],
  model: "claude-sonnet-5.5",
  efforts: ["low", "medium", "high", "xhigh", "max"],
  effort: "medium",
};

// 7. Cancelled, ten days ago.
const t7 = todo("", "Write the release notes for 2.4");
const r7 = run({ ticket: "", todo: t7, repo: null, mode: "draft", ask: "Write release notes for 2.4 from the merged MRs." }, { status: "cancelled", startedAt: ago(10 * 1440), finishedAt: ago(10 * 1440 - 2) });
log(r7, [you("Write release notes for 2.4 from the merged MRs."), say("Collecting the merged merge requests …")]);

// 8. A live session asking a question (SHOP-398, two days ago).
const t8 = todo("SHOP-398", "Choose a chart library for the order stats");
const r8 = run({ ticket: "SHOP-398", todo: t8, repo: shop, ask: "We need charts for the order stats. Which library?" }, { status: "running", provider: "faketest", cwd: shop, branch: "main", startedAt: ago(2 * 1440 + 30) });
log(r8, [you("We need charts for the order stats. Which library?"), init(shop, "plan"), say("Two fit what the shop already uses. One question first."), { type: "control_request", request_id: "req-q", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input: { questions: [{ question: "Which matters more?" }] } } }], true);
fake.claude[r8] = {
  busy: false,
  mode: "plan",
  model: "sonnet",
  effort: "high",
  queued: 0,
  costUsd: 0.07,
  asks: [
    {
      requestId: "req-q",
      tool: "AskUserQuestion",
      input: { questions: [{ question: "Which matters more?", header: "Charts", multiSelect: false, options: [{ label: "Bundle size", description: "uPlot: 45 KB, canvas" }, { label: "Ready-made charts", description: "Recharts: React components, SVG" }] }] },
      description: null,
      reason: null,
      suggestions: [],
      at: ago(5),
    },
  ],
};

// 9. A live session with its plan (BILL-77, today).
const t9 = todo("BILL-77", "Add the VAT line to the invoice PDF");
const r9 = run({ ticket: "BILL-77", todo: t9, repo: billing, ask: "Add the VAT line to the invoice PDF." }, { status: "running", provider: "faketest", cwd: billing, branch: "fix/BILL-77-vat", startedAt: ago(45) });
log(r9, [you("Add the VAT line to the invoice PDF."), init(billing, "plan"), say("I looked at the template and the totals."), ...tool("Read", { file_path: "templates/invoice.hbs" }, "…"), ...tool("Read", { file_path: "src/totals.ts" }, "…")], true);
fake.claude[r9] = {
  busy: false,
  mode: "plan",
  model: "",
  effort: "",
  queued: 1,
  costUsd: 0.11,
  asks: [
    {
      requestId: "req-p",
      tool: "ExitPlanMode",
      input: { plan: "## Plan\n\n1. Add `vat` to `totals()` (19 % of the net amount)\n2. Show it in `invoice.hbs` above the gross total\n3. A test for an invoice with two items" },
      description: null,
      reason: null,
      suggestions: [],
      at: ago(2),
    },
  ],
};

// 10. Archived (shown with "Show archived").
const t10 = todo("", "Spike: server-side rendering of the shop");
const r10 = run({ ticket: "", todo: t10, repo: shop, ask: "Try server-side rendering for the product pages." }, { status: "done", cwd: shop, startedAt: ago(30 * 1440), finishedAt: ago(30 * 1440 - 30), costUsd: 2.1, durationMs: 1800000, turns: 40, summary: "SSR works but doubles the build time." });
log(r10, [you("Try server-side rendering for the product pages."), say("SSR works but doubles the build time."), result(2.1, 40)]);
setSessionArchived(t10, true);

fs.writeFileSync(path.join(path.dirname(dbPath), "fake-live.json"), JSON.stringify(fake, null, 2));
console.log(`seeded Code sessions: runs ${[r1a, r1, r2, r3, r5, r6, r7, r8, r9, r10].join(", ")}`);
