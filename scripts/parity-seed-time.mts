/**
 * Time tracking with every state filled — for the old/new pixel comparison of the report (run by scripts/test-server.mjs --seed, the same file in the
 * old and the new checkout): jobs (one inactive), projects, about three months of bookings around "today" 2026-11-20 (a Friday), tickets, tags, a group
 * entry with parallel work, two overlapping entries, absences (a vacation week, a sick day, a public holiday), a default break, flex time, type,
 * report and meeting rules. Deterministic (a fixed pseudo-random sequence), dated absolutely: both servers show the same figures on the same day.
 */
if (!process.env.DATABASE_PATH || !process.env.ZEFF_TEST_SERVER) throw new Error("Only for a test server's database (DATABASE_PATH + ZEFF_TEST_SERVER).");

const { setInstalled } = await import("@/plugins/state");
for (const id of ["zeiterfassung", "weekly-report", "monthly-report"]) {
  try {
    setInstalled(id as never, true);
  } catch {
    // not a plugin id in this checkout
  }
}
const { createJob, updateJob } = await import("@/lib/jobs");
const { createProject } = await import("@/lib/projects");
const { createEntry, listEntries } = await import("@/lib/entries");
const sched = await import("@/lib/schedule");
const { updateReportSettings } = await import("@/lib/report");
const { createTag } = await import("@/lib/tags");
const { setPauses } = await import("@/lib/pauses");

if (listEntries({}).length > 0) {
  console.log("parity seed: already there");
  process.exit(0);
}

let s = 20261120;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];

sched.updateWorkSchedule({ mon: 8, tue: 8, wed: 8, thu: 8, fri: 6, sat: 0, sun: 0 });
const jobs = [
  createJob({ number: "AB123-000001-00", name: "ACME Support", customer: "ACME GmbH", description: "Second-level support" }),
  createJob({ number: "AB123-000002-00", name: "ACME Relaunch", customer: "ACME GmbH", description: "The new web shop" }),
  createJob({ number: "INT-000010-00", name: "Internal", customer: "", description: "Meetings, admin, learning" }),
  createJob({ number: "CD456-000003-00", name: "Contoso Portal", customer: "Contoso AG" }),
];
const old = createJob({ number: "XY999-000009-00", name: "Legacy Migration", customer: "Fabrikam" });
updateJob(old.id, { active: false });
const flex = createJob({ number: "GLZ-000000-00", name: "Gleitzeit" });
sched.updateFlexTime({ jobNumber: flex.number, comment: "Überstundenabbau" });
const proj = createProject({ title: "Checkout Redesign", description: "New checkout for the shop", customer: "ACME GmbH", jobNumber: jobs[1].number, startDate: "2026-09-01", endDate: "2026-12-31" });
createProject({ title: "Portal Onboarding", customer: "Contoso AG", jobNumber: jobs[3].number, startDate: "2026-10-01" });
createProject({ title: "Archive Cleanup", customer: "Fabrikam", active: false });

createTag("mob", "#7c3aed");
createTag("review", "#0891b2");
createTag("bug", "#dc2626");

sched.updateDefaultPauses("12:00-12:30", false);
updateReportSettings({
  typeRules: [
    { id: "t1", jobNumber: "INT-000010-00", description: "", type: "internal" },
    { id: "t2", jobNumber: "", description: "Daily", type: "meeting" },
  ],
  rules: [
    { id: "r1", conditions: [{ field: "type", value: "meeting" }], template: "Meetings", tags: ["meeting"] } as never,
    { id: "r2", conditions: [{ field: "ticket", value: "ACME" }], template: "{ticket}: {desc}" } as never,
  ],
  meetingJobRules: [
    { match: "Daily", jobNumber: "INT-000010-00" },
    { match: "ACME", jobNumber: "AB123-000001-00", group: true },
  ],
  meetingDefaultJob: "INT-000010-00",
  meetingExcludeRules: ["Lunch", "Focus time"],
});

// Absences: a vacation week, a sick day, a public holiday, half a day off.
sched.createAbsence({ startDate: "2026-10-12", endDate: "2026-10-16", type: "vacation", note: "Autumn holidays" });
sched.createAbsence({ startDate: "2026-11-10", endDate: "2026-11-10", type: "sick" });
sched.createAbsence({ startDate: "2026-10-03", endDate: "2026-10-03", type: "holiday", note: "Tag der Deutschen Einheit" });
sched.createAbsence({ startDate: "2026-11-27", endDate: "2026-11-27", type: "other", hours: 4, note: "Doctor" });
sched.createAbsence({ startDate: "2026-12-24", endDate: "2026-12-31", type: "vacation", note: "Christmas" });

const ACME = ["ACME-101", "ACME-114", "ACME-122", "ACME-131", "ACME-140"];
const PORTAL = ["CON-7", "CON-12", "CON-19"];
const absent = new Set(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-11-10", "2026-10-03"]);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const book = (date: string, hours: number, jobNumber: string, description: string, extra: Record<string, unknown> = {}) =>
  createEntry({ date, hours, jobNumber, description, reportedBy: "web", ...extra } as never, "web");

for (let d = new Date(2026, 8, 1); iso(d) <= "2026-11-20"; d.setDate(d.getDate() + 1)) {
  const day = iso(d);
  const wd = d.getDay();
  if (wd === 0 || wd === 6 || absent.has(day)) continue;
  const target = wd === 5 ? 6 : 8;
  // A few days short (the shortfalls), today half booked.
  const short = day === "2026-11-18" ? 2.5 : day === "2026-11-20" ? 3.5 : day === "2026-10-28" ? 1 : 0;
  let left = target - short;
  book(day, 0.25, "INT-000010-00", "Daily Standup", { type: "meeting", start: "09:30" });
  left -= 0.25;
  if (wd === 3) {
    book(day, 1, "AB123-000001-00", "ACME Sprint Review", { type: "meeting", tags: ["review"] });
    left -= 1;
  }
  while (left > 0.01) {
    const h = Math.min(left, pick([0.5, 1, 1.5, 2, 2.5, 3]));
    const r = rnd();
    if (r < 0.45) book(day, h, "AB123-000001-00", pick(["Fix login timeout", "Analyse export bug", "Customer call follow-up", "Update deployment docs"]), { ticket: pick(ACME), tags: r < 0.1 ? ["bug"] : [] });
    else if (r < 0.7) book(day, h, "AB123-000002-00", pick(["Checkout form validation", "Payment provider spike", "Cart page styling"]), { ticket: pick(ACME) });
    else if (r < 0.88) book(day, h, "CD456-000003-00", pick(["Portal SSO setup", "Onboarding wizard", "Accessibility fixes"]), { ticket: pick(PORTAL) });
    else book(day, h, "INT-000010-00", pick(["Team planning", "Code review", "Learning: Rust"]), { type: "internal", tags: r > 0.95 ? ["review"] : [] });
    left = Math.round((left - h) * 100) / 100;
  }
}
// A project booking and a mob day (a group entry with work collected under it) this week; two entries on top of each other.
book("2026-11-19", 1, "AB123-000002-00", "Checkout: address step", { ticket: "ACME-140" });
createEntry({ date: "2026-11-17", hours: 1.5, projectId: proj.id, description: "Checkout: payment step", reportedBy: "web" } as never, "web");
book("2026-11-16", 2, "AB123-000001-00", "Mob programming: search", { isGroup: true, start: "13:00", tags: ["mob"] });
book("2026-11-16", 1, "AB123-000001-00", "Search ranking", { ticket: "ACME-122", start: "13:00" });
book("2026-11-16", 1, "AB123-000001-00", "Search filters", { ticket: "ACME-131", start: "14:00" });
book("2026-11-19", 1, "CD456-000003-00", "Portal SSO pairing", { ticket: "CON-7", start: "10:00" });
book("2026-11-19", 1, "CD456-000003-00", "Portal SSO review", { ticket: "CON-12", start: "10:00" });
// A break other than the default on Wednesday.
setPauses(["2026-11-18"], "12:30-13:15");
console.log(`parity seed: ${listEntries({}).length} entries`);

// The new checkout: the report is the plugin zeiterfassung-ext (ZEFF_PLUGINS_DIR) — switched to as the Plugins page does.
try {
  const sw = await import("@/plugins/zeiterfassung/to-plugin" as string);
  if (process.env.ZEFF_PLUGINS_DIR && sw.switchZeiterfassungToPlugin) console.log("parity seed: report page", JSON.stringify(await sw.switchZeiterfassungToPlugin()));
} catch (e) {
  console.log("parity seed: no plugin switch", String(e).slice(0, 200));
}
