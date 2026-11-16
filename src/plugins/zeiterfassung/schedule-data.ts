import { formatHours } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { getJobByNumber, listJobs } from "@/lib/jobs";
import { getFlexTime, getWorkSchedule, listAbsences, scheduleHours } from "@/lib/schedule";
import { absenceLabels, WEEKDAY_KEYS, weekdayLabels, type AbsenceType } from "@/lib/schedule-shared";
import { todayIso } from "@/lib/week";

/**
 * The time-tracking settings that are about the schedule, as plain data: the weekly hours, the default break, the flex-time job and the absences —
 * what src/app/settings/time/page.tsx shows for them (the same functions, the same words). Read only.
 */
export function scheduleScreen() {
  const schedule = getWorkSchedule();
  const hours = scheduleHours(schedule);
  const weekTotal = hours.reduce((a, b) => a + b, 0);
  const flex = getFlexTime(schedule);
  const jobs = listJobs().map((j) => [j.number, `${j.number} ${j.name}`] as [string, string]);
  // The flex-time job stays pickable even once it's deactivated.
  const flexJob = flex.jobNumber && !jobs.some(([n]) => n === flex.jobNumber) ? getJobByNumber(flex.jobNumber) : undefined;
  const labels = absenceLabels(t);
  return {
    today: todayIso(),
    hoursHead: t("Weekly hours · {hours} h/week", { hours: formatHours(weekTotal) }),
    days: WEEKDAY_KEYS.map((key, i) => ({ key, label: weekdayLabels(t)[i], hours: hours[i] })),
    defaultPauses: schedule.defaultPauses ?? "",
    flexJob: flex.jobNumber ?? "",
    flexComment: flex.comment,
    flexJobOptions: [["", t("Off")] as [string, string], ...(flexJob ? [[flexJob.number, t("{name} (inactive)", { name: flexJob.name })] as [string, string]] : []), ...jobs],
    absenceTypes: (Object.keys(labels) as AbsenceType[]).map((k) => [k, labels[k]] as [string, string]),
    absences: listAbsences().map((a) => ({
      id: a.id,
      from: a.startDate,
      to: a.endDate,
      type: labels[a.type as AbsenceType],
      hours: a.hours == null ? t("full day") : formatHours(a.hours),
      note: a.note ?? "",
      confirm: t("Delete the absence {type} ({from} to {to})? Targets, Chrono and Punch change with it.", { type: labels[a.type as AbsenceType], from: a.startDate, to: a.endDate }),
    })),
    figures: { weekTotal, absences: listAbsences().length },
  };
}
