/**
 * After e2e/todos-parity-seed.mts (scripts/test-server.mjs --seed e2e/todos-parity-seed.mts --seed e2e/ref-cards-seed.mts): the tickets as a Jira
 * sync keeps them (summary, status, assignee, the last comment), two people, and a todo whose words name a ticket, another todo and a person —
 * what the references' hover cards show.
 */
if (!process.env.DATABASE_PATH || !process.env.ZEFF_TEST_SERVER) throw new Error("Only for a test server's database (DATABASE_PATH + ZEFF_TEST_SERVER).");

const { setInstalled } = await import("@/plugins/state");
for (const id of ["jira", "people"] as const) {
  try {
    setInstalled(id as never, true);
  } catch {
    // not in this version
  }
}
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const { upsertTickets } = await import("@/lib/jira/store");
upsertTickets([
  { key: "PROJ-101", summary: "Login fails with SSO", description: "After the redirect from the identity provider the login loops back to the start page.", status: "In Progress", statusCategory: "inprogress", issueType: "Bug", priority: "High", assignee: "Anna Berg", url: "https://jira.example.org/browse/PROJ-101", openedAt: ago(200), updatedAt: ago(3) },
  { key: "PROJ-102", summary: "Export to CSV", description: "Rows as CSV, with the archived ones optional.", status: "In Review", statusCategory: "inprogress", issueType: "Story", priority: "Medium", assignee: "Thomas Kurz", url: "https://jira.example.org/browse/PROJ-102", openedAt: ago(400), updatedAt: ago(8) },
  { key: "PROJ-103", summary: "Dark mode for the settings", status: "To Do", statusCategory: "todo", issueType: "Story", priority: "Low", assignee: "Me", url: "https://jira.example.org/browse/PROJ-103", openedAt: ago(500), updatedAt: ago(30) },
  { key: "PROJ-104", summary: "Payment webhook retries", status: "Testing", statusCategory: "inprogress", issueType: "Task", priority: "Medium", assignee: "Me", url: "https://jira.example.org/browse/PROJ-104", openedAt: ago(600), updatedAt: ago(50) },
]);
const { keepComments } = await import("@/lib/jira/comments");
keepComments([
  { id: "10001", ticket: "PROJ-101", author: "Anna Berg", at: ago(5), body: "The SSO login loops after the redirect — can you review the fix in the MR?" },
  { id: "10003", ticket: "PROJ-102", author: "Anna Berg", at: ago(9), body: "Should the CSV export include archived rows? The customer asks." },
]);
const { createPerson } = await import("@/plugins/people/store");
createPerson({ name: "Anna Berg", aliases: ["Anna"], note: "Product owner of the login and the export." });
createPerson({ name: "Thomas Kurz", aliases: ["Thomas"], note: "Backend developer; reviews the export." });

const { getSqlite } = await import("@/db");
const sq = getSqlite();
const first = sq.prepare("select id from todos where text = 'Review the SSO login fix'").get() as { id: number } | undefined;
const now = new Date().toISOString();
sq.prepare("insert into todos (ticket, text, kind, owner, status, refs, user_notes, created_at, updated_at) values ('PROJ-102', ?, 'other', 'me', 'open', '[]', ?, ?, ?)").run(
  `Ask Anna whether PROJ-101 blocks T-${first?.id ?? 1}`,
  JSON.stringify([{ at: now, text: "@Thomas knows the CSV part — see PROJ-102." }]),
  now,
  now,
);
console.log("ref cards seeded");
