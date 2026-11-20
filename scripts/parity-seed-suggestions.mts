/** Dev helper: two agents' suggested bookings in a test server's database (DATABASE_PATH, ZEFF_TEST_SERVER) — the report's "Suggested entries" card filled. */
if (!process.env.DATABASE_PATH || !process.env.ZEFF_TEST_SERVER) throw new Error("Only for a test server's database (DATABASE_PATH + ZEFF_TEST_SERVER).");
const { suggestEntry, openSuggestions } = await import("@/lib/work/suggestions");
if (!openSuggestions().length) {
  suggestEntry({ date: "2026-11-20", hours: 1.5, description: "Fix the flaky login timeout test and add a retry around the token refresh so the nightly run stays green", ticket: "ACME-114", jobNumber: "AB123-000001-00", reportedBy: "Zeff" });
  suggestEntry({ date: "2026-11-19", hours: 0.75, description: "Review of the portal SSO pull request", ticket: "CON-7", reportedBy: "Copilot" });
}
console.log("suggestions:", openSuggestions().length);
