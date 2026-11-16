import { listDefaultTagMaps } from "@/lib/default-tags";
import { formatHours } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { listJobs } from "@/lib/jobs";
import { listProjects } from "@/lib/projects";

/**
 * The jobs and the projects as lists, ready to draw: what src/app/jobs/page.tsx and src/app/projects/page.tsx show (the same functions, the same
 * words) as plain data — the numbers jobs are booked on with their hours, entries and default tags, and the projects under them. Read only.
 */
export function jobsScreen() {
  const jobs = listJobs({ includeInactive: true });
  const projects = listProjects({ includeInactive: true });
  const tags = listDefaultTagMaps();
  return {
    jobsHead: t("All jobs ({n})", { n: jobs.length }),
    projectsHead: t("All projects ({n})", { n: projects.length }),
    jobs: jobs.map((j) => ({
      id: j.id,
      number: j.number,
      name: j.name,
      customer: j.customer ?? "",
      description: j.description ?? "",
      tags: (tags.jobs[j.number] ?? []).map((x) => `#${x}`).join(" "),
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
