"use server";

import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { revalidateAll } from "@/app/action-helpers";

// ---------------------------------------------------------------------------
// Report settings
// ---------------------------------------------------------------------------

/**
 * Exclude / Include toggle on the import page: excluding adds the meeting's title as an
 * exclude rule (unless one already matches it); including removes every rule matching it.
 * Returns the resulting rules so the page can re-check its other meetings.
 */
export async function setMeetingExcludedAction(
  title: string,
  exclude: boolean,
): Promise<{ ok: boolean; error?: string; rules?: string[] }> {
  const { getMeetingExcludeRules, getReportSettings, updateReportSettings } = await import("@/lib/report");
  const { isExcludedMeeting } = await import("@/lib/calendar/meetings");
  const name = (title ?? "").trim();
  if (!name) return { ok: false, error: t("The meeting has no title.") };
  try {
    const rules = getMeetingExcludeRules(getReportSettings());
    const next = exclude
      ? isExcludedMeeting(name, rules) ? rules : [...rules, name]
      : rules.filter((r) => !isExcludedMeeting(name, [r]));
    updateReportSettings({ meetingExcludeRules: next });
    revalidateAll();
    return { ok: true, rules: next };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

