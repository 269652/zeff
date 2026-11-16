import { listDefaultTagMaps } from "@/lib/default-tags";
import { formatHours } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { listJobs } from "@/lib/jobs";
import { getJobHours, listEntries } from "@/lib/entries";
import { listEntryTypes } from "@/lib/entry-types";
import { getProject, listProjects } from "@/lib/projects";
import { formatDate } from "@/lib/format";
import { typeMapOf } from "@/lib/entry-types-shared";
import { getJob } from "@/lib/jobs";
import { todayIso } from "@/lib/week";
import { fullAction, jobsSlotData } from "./time-slots";

/**
 * The jobs and the projects as lists, ready to draw: what src/app/jobs/page.tsx and src/app/projects/page.tsx show (the same functions, the same
 * words) as plain data — the numbers jobs are booked on with their hours, entries and default tags, and the projects under them. Read only.
 */
export async function jobsScreen() {
  const jobs = listJobs({ includeInactive: true });
  const projects = listProjects({ includeInactive: true });
  const tags = listDefaultTagMaps();
  // What the booking systems add (their places as data): buttons above the table and a column of their own.
  const slots = await jobsSlotData(jobs);
  const columns = slots.flatMap((x) => (x.slot.column ? [x.slot.column] : []));
  return {
    jobsHead: t("All jobs ({n})", { n: jobs.length }),
    toolbar: slots.flatMap((x) => (x.slot.toolbar ?? []).map(fullAction)),
    columnTitle: columns.map((c) => c.title).join(" · "),
    projectsHead: t("All projects ({n})", { n: projects.length }),
    jobs: jobs.map((j) => ({
      id: j.id,
      number: j.number,
      name: j.name,
      customer: j.customer ?? "",
      description: j.description ?? "",
      tags: (tags.jobs[j.number] ?? []).map((x) => `#${x}`).join(" "),
      mark: columns.map((c) => c.cells[j.id]?.text ?? "").filter(Boolean).join(" "),
      markTitle: columns.map((c) => c.cells[j.id]?.title ?? "").filter(Boolean).join(" · "),
      hours: formatHours(j.totalHours),
      entries: j.entryCount,
      active: j.active,
      status: j.active ? t("active") : t("inactive"),
      toggle: j.active ? t("Deactivate") : t("Activate"),
    })),
    projects: projects.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description ?? "",
      customer: p.customer ?? "",
      job: p.job ? `${p.job.number} ${p.job.name}` : t("No job yet"),
      jobNumber: p.job?.number ?? "",
      tags: (tags.projects[p.id] ?? []).map((x) => `#${x}`).join(" "),
      booked: p.firstDate ? (p.firstDate === p.lastDate ? p.firstDate : `${p.firstDate} – ${p.lastDate}`) : "",
      hours: formatHours(p.totalHours),
      entries: p.entryCount,
      active: p.active,
      status: p.active ? t("active") : t("inactive"),
      toggle: p.active ? t("Deactivate") : t("Activate"),
    })),
    jobOptions: listJobs().map((j) => [j.number, `${j.number} ${j.name}`] as [string, string]),
    figures: { jobs: jobs.length, projects: projects.length, hours: jobs.reduce((a, j) => a + j.totalHours, 0) },
  };
}

/** One job's or project's own page: what it has booked, its entries, and for a project the days to book on it at once. */
export function jobDetail(input: { kind?: string; id?: unknown }) {
  const id = Number(input.id);
  if (!Number.isInteger(id)) return { found: false };
  const isProject = input.kind === "project";
  const types = typeMapOf(listEntryTypes());
  const entries = (list: ReturnType<typeof listEntries>) =>
    list.map((e) => ({ id: e.id, date: e.date, dateText: formatDate(e.date), description: e.description, ticket: e.ticket ?? "", type: types[e.type]?.label ?? e.type, hours: formatHours(e.hours) }));
  if (isProject) {
    const p = getProject(id);
    if (!p) return { found: false };
    const list = listEntries({ projectId: id, limit: 500 });
    return {
      found: true,
      kind: "project",
      id,
      title: p.title,
      inactive: !p.active,
      sub: t("{hours}h booked in {n} entries", { hours: formatHours(p.totalHours), n: p.entryCount }),
      job: p.job ? `${p.job.number} ${p.job.name}` : t("No job yet"),
      noJobWarning: !p.job && p.entryCount > 0 ? t("The Chrono export skips these entries until you pick the project's job below.") : "",
      deleteConfirm: p.entryCount ? t("Delete project {title}? Its {n} entries stay booked on the job, just without the project.", { title: p.title, n: p.entryCount }) : t("Delete project {title}?", { title: p.title }),
      today: todayIso(),
      typeOptions: listEntryTypes().map((x) => [x.key, x.label] as [string, string]),
      entries: entries(list),
    };
  }
  const j = getJob(id);
  if (!j) return { found: false };
  const list = listEntries({ jobId: id, limit: 200 });
  return {
    found: true,
    kind: "job",
    id,
    title: `${j.number} ${j.name}`,
    inactive: !j.active,
    sub: t("{hours}h booked in {n} entries", { hours: formatHours(getJobHours(id)), n: list.length }),
    deleteConfirm: t("Delete job {number}? This only works if no time is booked on it.", { number: j.number }),
    entries: entries(list),
  };
}
