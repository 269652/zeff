import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "../workspace/flows/actions";
import type { FieldSpec } from "../workspace/flows/types";

/**
 * The kernel's reads (and, below, writes) of the booked time for plugins' lambdas and flows: the month and the week as the reports show them — figures,
 * words, calendar — worked out from the bookings, the schedule and the report rules. Time tracking's core (jobs, projects, bookings) stays the kernel's;
 * a plugin draws its screens over these. Nothing here knows a plugin. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const text = (v: unknown): string => (v == null ? "" : String(v));

export const TIME_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "time.month",
    group: "time",
    label: "A month of booked time, as the report shows it",
    summary:
      "The monthly report's figures and words for a month (input month: 2026-09, default the current; by: only what one reporter booked): the booked/target card, hours due in past weeks, the entries card, the calendar (a row per week, a cell per day with its hours, shortfall, absence), hours per job and week with their totals, by type and by tag, what each job's time went to (named by the report rules), the copy text and the entries.",
    input: [f("month", "text"), f("by", "text")],
    output: "{ key, label, weeksText, prev, next, current, isCurrent, by, reporters, booked, past, entries, calendar, jobRows, foot, typeItems, tagItems, summaries, summaryText, entryList, … }",
    run: async (i) => {
      const { monthScreen } = await import("./month-data");
      return monthScreen({ month: text(i.month), by: text(i.by) });
    },
  },
];

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("zeiterfassung", TIME_FLOW_ACTIONS);
