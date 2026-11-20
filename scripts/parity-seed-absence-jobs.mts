/** Dev helper: an absence job (Settings → absence jobs) for vacation, sick days and holidays in a test server's database (DATABASE_PATH, ZEFF_TEST_SERVER). */
if (!process.env.DATABASE_PATH || !process.env.ZEFF_TEST_SERVER) throw new Error("Only for a test server's database (DATABASE_PATH + ZEFF_TEST_SERVER).");
const { createJob, getJobByNumber } = await import("@/lib/jobs");
const sch = await import("@/lib/schedule");
const job = getJobByNumber("ABW-000000-00") ?? createJob({ number: "ABW-000000-00", name: "Abwesenheit", description: "Urlaub, Krankheit, Feiertage" });
sch.setAbsenceJobs({ vacation: job.number, sick: job.number, holiday: job.number });
console.log("absence jobs:", JSON.stringify(sch.getAbsenceJobs()));
