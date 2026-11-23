import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import { integrationServer, integrationServerIds } from "@/lib/integrations/server";
import type { PluginId } from "@/plugins/catalog";
import { installedPlugins } from "@/plugins/state";
import type { EntryWithJob } from "@/lib/entries";
import type { JobWithStats } from "@/lib/jobs";
import type { MonthInfo } from "@/lib/month";
import type { CloseItem, WeekClose } from "@/lib/week-close";
import type { WeekInfo } from "@/lib/week";

/**
 * The places of the time report that other plugins fill — the booking systems (Chrono, Punch) first — as data, so any screen can draw them: a card beside
 * the booked card, buttons in the heads, marks on entries and days, the system's approvals in the month's calendar, a column of the jobs, steps of
 * closing the week. A plugin contributes a TimeSlot under its own id (extension point "zeiterfassung.slots"); an integration that is mounted
 * into Zeff may hand the same (IntegrationServer.slots). Nothing here knows a plugin. Server only.
 */

type Tone = "plain" | "good" | "warn" | "bad" | "muted";
/** A figure card, like the booked card. */
export type SlotCard = { label: string; value: string; sub?: string; tone?: Tone; href?: string };
/** A button: it runs a flow of the plugin (with: "a=1, b=2"), or opens an address. */
export type SlotAction = { label: string; flow?: string; with?: string; href?: string; confirm?: string; tip?: string };
/** A mark on an entry, a day or a job: a short text, its tone, and whether it says "approved" (the hours read green). */
export type SlotMark = { text: string; tone?: Tone; title?: string; approved?: boolean };

export type WeekSlotData = { cards?: SlotCard[]; actions?: SlotAction[]; exports?: SlotAction[]; entries?: Record<number, SlotMark>; days?: (SlotMark | null)[] };
export type MonthSlotData = {
  /** The system's name and, per day of the month, the hours it has approved (null: the week was not pulled). */
  approvals?: { system: string; days: ({ approved: number } | null)[] };
  actions?: SlotAction[];
  /** The oldest pull among the month's weeks. */
  oldestPull?: string | null;
  entries?: Record<number, SlotMark>;
};
/** Whether a past week is in a booking system, as that system last said it ("unknown": not read from it yet). */
export type WeekSyncData = { system: string; state: "in" | "out" | "unknown"; title: string };
export type JobsSlotData = { toolbar?: SlotAction[]; column?: { title: string; cells: Record<number, SlotMark> } };

export type TimeSlot = {
  week?: (ctx: { week: WeekInfo; entries: EntryWithJob[]; by?: string }) => WeekSlotData | Promise<WeekSlotData>;
  month?: (ctx: { month: MonthInfo; entries: EntryWithJob[] }) => MonthSlotData | Promise<MonthSlotData>;
  /** For the "not in the booking systems" card: is this past week in the system (as of its last read)? */
  pastWeek?: (ctx: { week: WeekInfo; entries: EntryWithJob[] }) => WeekSyncData | null | Promise<WeekSyncData | null>;
  jobs?: (jobs: JobWithStats[]) => JobsSlotData | Promise<JobsSlotData>;
  weekClose?: (ctx: { week: WeekInfo; now: Date; over: boolean; entries: EntryWithJob[]; query: string }) => CloseItem[] | Promise<CloseItem[]>;
  /**
   * What its own buttons do (a SlotAction made by slotRun): `op` names the button, `input` holds its values (texts). Its answer is said
   * where the button is; ok false is a refusal. Run by the kernel's time.slot-run (the report's flow zeiterfassung.slot-run).
   */
  run?: (op: string, input: Record<string, string>) => Promise<{ ok: boolean; message: string }>;
};

export const timeSlots = extensionPoint<TimeSlot>("zeiterfassung.slots");

/** The report's flow that runs a contributor's own button (TimeSlot.run): the package's zeiterfassung.slot-run over the kernel's time.slot-run. */
export const SLOT_RUN_FLOW = "zeiterfassung.slot-run";
/** The values a slot button may hand its contributor (each a text; the flow passes these through). */
export const SLOT_RUN_INPUTS = ["week", "month", "date", "id", "key"] as const;

/** A button that runs the contributor's own TimeSlot.run(op, args) — no flow of its own needed. */
export const slotRun = (
  plugin: string,
  op: string,
  label: string,
  args: Partial<Record<(typeof SLOT_RUN_INPUTS)[number], string>> = {},
  extra: Pick<SlotAction, "confirm" | "tip"> = {},
): SlotAction => ({
  label,
  flow: SLOT_RUN_FLOW,
  // (with= is "a=1, b=2": a value keeps no comma or equals sign)
  with: [`plugin=${plugin}`, `op=${op}`, ...Object.entries(args).map(([k, v]) => `${k}=${String(v ?? "").replace(/[,=]/g, " ")}`)].join(", "),
  ...extra,
});

/** A contributor's own button run (TimeSlot.run) — the installed one of that id; its answer, a refusal (ok false) thrown. */
export async function runSlot(plugin: string, op: string, input: Record<string, string>): Promise<string> {
  const c = timeSlots.list().find((x) => String(x.plugin) === plugin);
  if (!c?.impl.run) throw new Error(`“${plugin}” has no buttons of its own here (is it installed?).`);
  const r = await c.impl.run(op, input);
  if (!r.ok) throw new Error(r.message);
  return r.message;
}

/** What every installed contributor says for a place, each by its id; one that fails is left out (and said in the log). */
async function ask<T>(pick: (s: TimeSlot) => (() => T | Promise<T>) | undefined): Promise<{ id: string; slot: T }[]> {
  const out: { id: string; slot: T }[] = [];
  for (const c of timeSlots.list()) {
    const f = pick(c.impl);
    if (!f) continue;
    try {
      out.push({ id: String(c.plugin), slot: await f() });
    } catch (e) {
      console.error(`[zeiterfassung.slots] ${c.plugin}:`, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

export const weekSlotData = (ctx: Parameters<NonNullable<TimeSlot["week"]>>[0]) => ask<WeekSlotData>((s) => s.week && (() => s.week!(ctx)));
export const monthSlotData = (ctx: Parameters<NonNullable<TimeSlot["month"]>>[0]) => ask<MonthSlotData>((s) => s.month && (() => s.month!(ctx)));
export const pastWeekSlotData = (ctx: Parameters<NonNullable<TimeSlot["pastWeek"]>>[0]) => ask<WeekSyncData | null>((s) => s.pastWeek && (() => s.pastWeek!(ctx)));
export const jobsSlotData = (jobs: JobWithStats[]) => ask<JobsSlotData>((s) => s.jobs && (() => s.jobs!(jobs)));
export const closeSlotItems = async (ctx: Parameters<NonNullable<TimeSlot["weekClose"]>>[0]): Promise<CloseItem[]> => (await ask<CloseItem[]>((s) => s.weekClose && (() => s.weekClose!(ctx)))).flatMap((x) => x.slot);

/** A button or a card as the view reads it: every field there (a template can't ask for what is missing). */
export const fullAction = (a: SlotAction): Required<SlotAction> => ({ flow: "", with: "", href: "", confirm: "", tip: "", ...a });
export const fullCard = (c: SlotCard): Required<SlotCard> => ({ sub: "", tone: "plain", href: "", ...c });

export const closeWith = (close: WeekClose, extra: CloseItem[]): WeekClose => {
  const items = [...close.items, ...extra];
  return { ...close, items, done: items.every((i) => i.state === "ok") };
};

// A mounted integration (Chrono, Punch …) may hand its places as data too (IntegrationServer.slots): they are contributions like any plugin's.
timeSlots.provide("integrations", () =>
  integrationServerIds().flatMap((id) => {
    const slots = integrationServer(id)?.slots;
    return slots && installedPlugins().has(id as PluginId) ? [{ plugin: id as PluginId, impl: slots }] : [];
  }),
);
