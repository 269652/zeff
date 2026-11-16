import { applyReportRuleTagsToEntries, applyTypeRulesToEntries, reapplyMeetingJobRules } from "@/lib/entries";
import { createEntryType, deleteEntryType, entryTypeUsage, listEntryTypes, updateEntryTypes } from "@/lib/entry-types";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { listJobs } from "@/lib/jobs";
import { getMeetingDefaultJob, getMeetingExcludeRules, getMeetingJobRules, getReportRules, getReportSettings, updateReportSettings } from "@/lib/report";
import { newRuleId, RULE_FIELDS, ruleFieldLabels, type ReportRule, type RuleField } from "@/lib/report-shared";
import { getTypeRules } from "@/lib/type-rules";
import { isInstalled } from "@/plugins/state";
import { createTag, deleteTag, listTags, listTagsWithCounts, renameTag } from "@/lib/tags";
import { defaultParallelMode, setDefaultParallelMode, type ParallelMode } from "@/lib/entry-parallel";
import { listProjects } from "@/lib/projects";

/**
 * The rules of time tracking as lists and as small edits: the entry type rules, the report rewriting rules, the meeting → job rules with their default job,
 * the meeting exclude rules and the entry types — what Settings → Time tracking edits, with the same checks and sentences. A change is one step
 * (add, remove, move) so the screen needs no draft of its own.
 */
export function rulesScreen() {
  const settings = getReportSettings();
  const types = listEntryTypes();
  const usage = entryTypeUsage();
  const jobs = listJobs().map((j) => [j.number, `${j.number} · ${j.name}`] as [string, string]);
  const typeName = (k: string) => types.find((x) => x.key === k)?.label ?? k;
  const jobName = (n: string) => jobs.find(([x]) => x === n)?.[1] ?? n;
  const labels = ruleFieldLabels(t);
  const clause = (c: { field: RuleField; value: string }) => `${labels[c.field]} ${c.field === "type" ? typeName(c.value) : c.field === "job" ? jobName(c.value) : `“${c.value}”`}`;
  const meetingDefault = getMeetingDefaultJob(settings);
  return {
    meetings: isInstalled("outlook-calendar"),
    jobOptions: jobs,
    jobOptionsAny: [["", t("any job")] as [string, string], ...jobs],
    typeOptions: types.map((x) => [x.key, x.label] as [string, string]),
    fieldOptions: RULE_FIELDS.map((f) => [f, labels[f]] as [string, string]),
    tagNames: listTags().map((x) => x.name),
    projectNames: listProjects({ includeInactive: true }).map((p) => p.title),
    typeRules: getTypeRules().map((r, i) => ({ i, job: r.jobNumber ? jobName(r.jobNumber) : t("any job"), text: r.description ? `“${r.description}”` : t("any description"), type: typeName(r.type), jobNumber: r.jobNumber, description: r.description, typeKey: r.type })),
    reportRules: getReportRules(settings).map((r, i) => ({
      i,
      when: r.conditions.length ? r.conditions.map(clause).join(` ${t("and")} `) : t("every entry"),
      template: r.template,
      tags: (r.tags ?? []).map((x) => `#${x}`).join(" "),
      tagsText: (r.tags ?? []).join(", "),
      f1: r.conditions[0]?.field ?? "type", v1: r.conditions[0]?.value ?? "",
      f2: r.conditions[1]?.field ?? "type", v2: r.conditions[1]?.value ?? "",
      f3: r.conditions[2]?.field ?? "type", v3: r.conditions[2]?.value ?? "",
    })),
    meetingRules: getMeetingJobRules(settings).map((r, i) => ({ i, match: r.match, job: jobName(r.jobNumber), jobNumber: r.jobNumber, group: !!r.group, groupFlag: r.group ? "true" : "false" })),
    meetingDefaultJob: meetingDefault ?? "",
    excludeRules: getMeetingExcludeRules(settings).map((value, i) => ({ i, value })),
    tagList: listTagsWithCounts().map((x) => ({ id: x.id, name: x.name, count: x.entryCount })),
    tagsHead: t("All tags ({n})", { n: listTagsWithCounts().length }),
    parallelMode: defaultParallelMode(),
    parallelOptions: [["combine", t("Book all on group")], ["divide", t("Divide time on subtasks")], ["sequential", t("Book sequential")]] as [string, string][],
    parallelWhat: {
      combine: t("One spanning entry for the stretch (its hours = what the tasks span) books it all; the tasks stay as they are and book nothing themselves."),
      divide: t("The group's time is shared between the tasks (3 h over two → 1.5 + 1.5); each task keeps its real hours."),
      sequential: t("Each task books what it worked, one after the other (the hours add up); the group itself books nothing."),
    }[defaultParallelMode() as "combine" | "divide" | "sequential"] ?? "",
    entryTypes: types.map((x) => ({ key: x.key, label: x.label, color: x.color, builtin: x.builtin, used: usage[x.key] ?? 0 })),
  };
}

const text = (v: unknown) => (v == null ? "" : String(v).trim());
const move = <T>(list: T[], i: number, by: -1 | 1): T[] => {
  const j = i + by;
  if (i < 0 || j < 0 || i >= list.length || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

/** One change to one list of rules; returns the sentence the built-in's save would say. */
export function ruleOp(i: Record<string, unknown>): { message: string } {
  const what = text(i.what);
  const op = text(i.op);
  const at = Number(i.index);
  const apply = i.apply === true || i.apply === "true" || i.apply === "1";
  const settings = getReportSettings();
  const known = () => new Set(listJobs({ includeInactive: true }).map((j) => j.number));

  if (what === "types") {
    let rules = getTypeRules();
    if (op === "add" || op === "update") {
      const rule = { id: op === "update" ? (rules[at]?.id ?? newRuleId()) : newRuleId(), jobNumber: text(i.jobNumber), description: text(i.description), type: text(i.type) as never };
      if (!rule.jobNumber && !rule.description) throw new Error(t("A rule needs a job or a description."));
      if (rule.jobNumber && !known().has(rule.jobNumber)) throw new Error(t("Unknown job {job}.", { job: rule.jobNumber }));
      rules = op === "update" ? rules.map((r, j) => (j === at ? rule : r)) : [...rules, rule];
    } else if (op === "remove") rules = rules.filter((_, j) => j !== at);
    else if (op === "up" || op === "down") rules = move(rules, at, op === "up" ? -1 : 1);
    updateReportSettings({ typeRules: rules });
    const n = rules.length;
    if (!apply) return { message: n === 1 ? t("Saved 1 type rule.") : t("Saved {n} type rules.", { n }) };
    const applied = applyTypeRulesToEntries();
    return { message: `${n === 1 ? t("Saved 1 type rule") : t("Saved {n} type rules", { n })}; ${applied === 1 ? t("re-typed 1 existing entry.") : t("re-typed {n} existing entries.", { n: applied })}` };
  }

  if (what === "report") {
    let rules: ReportRule[] = getReportRules(settings);
    if (op === "add" || op === "update") {
      const conditions = [1, 2, 3].flatMap((n) => (text(i[`f${n}`]) && text(i[`v${n}`]) ? [{ field: text(i[`f${n}`]) as RuleField, value: text(i[`v${n}`]) }] : []));
      const rule = { id: op === "update" ? (rules[at]?.id ?? newRuleId()) : newRuleId(), conditions, template: text(i.template), tags: text(i.tags).split(",").map((x) => x.trim().replace(/^#/, "")).filter(Boolean) };
      rules = op === "update" ? rules.map((r, j) => (j === at ? rule : r)) : [...rules, rule];
    } else if (op === "remove") rules = rules.filter((_, j) => j !== at);
    else if (op === "up" || op === "down") rules = move(rules, at, op === "up" ? -1 : 1);
    updateReportSettings({ rules });
    const tagged = apply ? applyReportRuleTagsToEntries() : null;
    return { message: tagged === null ? t("Report rules saved.") : tagged === 1 ? t("Report rules saved; tagged 1 existing entry.") : t("Report rules saved; tagged {n} existing entries.", { n: tagged }) };
  }

  if (what === "meetings") {
    let rules = getMeetingJobRules(settings);
    let defaultJob: string | null = getMeetingDefaultJob(settings);
    if (op === "add" || op === "update") {
      if (!text(i.match)) throw new Error(t("A rule needs a part of the meeting's title."));
      const rule = { match: text(i.match), jobNumber: text(i.jobNumber), ...(i.group === true || i.group === "true" ? { group: true } : {}) };
      rules = op === "update" ? rules.map((r, j) => (j === at ? rule : r)) : [...rules, rule];
    } else if (op === "remove") rules = rules.filter((_, j) => j !== at);
    else if (op === "up" || op === "down") rules = move(rules, at, op === "up" ? -1 : 1);
    else if (op === "default") defaultJob = text(i.jobNumber) || null;
    if (rules.some((r) => !known().has(r.jobNumber))) throw new Error(t("Unknown job {job}.", { job: rules.find((r) => !known().has(r.jobNumber))!.jobNumber }));
    if (defaultJob && !known().has(defaultJob)) throw new Error(t("Unknown job {job}.", { job: defaultJob }));
    updateReportSettings({ meetingJobRules: rules, meetingDefaultJob: defaultJob });
    if (!apply) return { message: rules.length === 1 ? t("Saved 1 meeting rule.") : t("Saved {n} meeting rules.", { n: rules.length }) };
    const moves = reapplyMeetingJobRules(rules);
    const saved = rules.length === 1 ? t("Saved 1 meeting rule") : t("Saved {n} meeting rules", { n: rules.length });
    const moved = moves.length === 1 ? t("moved 1 imported meeting") : t("moved {n} imported meetings", { n: moves.length });
    const shown = moves.slice(0, 5).map((m) => `${formatDate(m.date, { weekday: false })} “${m.description}” → ${m.to}`).join("; ");
    return { message: `${saved}; ${moved}` + (moves.length ? `: ${shown}${moves.length > 5 ? "; …" : ""}.` : ".") };
  }

  if (what === "exclude") {
    let rules = getMeetingExcludeRules(settings);
    if (op === "add") rules = [...rules.filter((r) => r.toLowerCase() !== text(i.value).toLowerCase()), text(i.value)].filter(Boolean);
    else if (op === "update") rules = rules.map((r, j) => (j === at ? text(i.value) : r)).filter(Boolean);
    else if (op === "remove") rules = rules.filter((_, j) => j !== at);
    updateReportSettings({ meetingExcludeRules: rules });
    return { message: rules.length === 1 ? t("Saved 1 exclude rule.") : t("Saved {n} exclude rules.", { n: rules.length }) };
  }

  if (what === "entry-type") {
    if (op === "add") {
      const created = createEntryType({ label: text(i.label), color: text(i.color) || "#6366f1" });
      return { message: t("Added type {label}.", { label: created.label }) };
    }
    if (op === "update") {
      const n = updateEntryTypes([{ key: text(i.key), label: text(i.label), color: text(i.color) }]);
      return { message: n === 1 ? t("Saved 1 type.") : t("Saved {n} types.", { n }) };
    }
    if (op === "remove") {
      deleteEntryType(text(i.key));
      return { message: t("Type deleted.") };
    }
  }
  if (what === "tag") {
    if (op === "add") return { message: t("Added tag #{name}.", { name: createTag(text(i.name), text(i.color) || null).name }) };
    if (op === "rename") return { message: t("Saved #{name}.", { name: renameTag(Number(i.id), text(i.name), text(i.color) || null).name }) };
    if (op === "remove") {
      deleteTag(Number(i.id));
      return { message: "" };
    }
  }
  if (what === "parallel") {
    if (!["combine", "divide", "sequential"].includes(text(i.mode))) throw new Error(t("Unknown way of booking."));
    setDefaultParallelMode(text(i.mode) as ParallelMode);
    return { message: t("Saved.") };
  }
  throw new Error("what: types, report, meetings, exclude, entry-type, tag or parallel");
}
