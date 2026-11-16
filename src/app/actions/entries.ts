"use server";

import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { setDefaultTags } from "@/lib/default-tags";
import { revalidateAll, type ActionState } from "@/app/action-helpers";

// ---------------------------------------------------------------------------
// Time entries
// ---------------------------------------------------------------------------

/** Default tags of a ticket (Jira tab): added to every entry booked on it. */
export async function setTicketTagsAction(ticket: string, tags: string[]): Promise<ActionState> {
  try {
    if (!ticket.trim()) return { ok: false, error: t("Missing ticket.") };
    const saved = setDefaultTags({ ticket }, tags);
    revalidateAll();
    return { ok: true, message: saved.length ? saved.map((tag) => `#${tag}`).join(" ") : t("No default tags.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

