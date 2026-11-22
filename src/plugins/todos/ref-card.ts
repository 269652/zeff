import type { RefCardProvider } from "@/lib/refs/point";

/** Another todo's card ("T-37" in a text): its words, whether it is open, when due, its ticket, the last note on it. */
export const TODO_REF_CARD: RefCardProvider = {
  kind: "todo",
  card: async (id, { t }) => {
    const n = Number(String(id).replace(/^T-/i, ""));
    if (!Number.isInteger(n) || n <= 0) return null;
    const { getTodo } = await import("@/lib/todos/store");
    const x = getTodo(n);
    if (!x) return null;
    const note = [...(x.userNotes ?? [])].reverse().find((u) => u.text?.trim());
    const status = x.status === "done" ? { label: t("Done"), tone: "good" as const } : x.status === "dismissed" ? { label: t("Dismissed"), tone: "muted" as const } : x.owner === "other" ? { label: t("Waiting for others"), tone: "info" as const } : { label: t("Open"), tone: "plain" as const };
    const today = new Date().toISOString().slice(0, 10);
    return {
      kind: "todo",
      id: String(x.id),
      eyebrow: x.ref,
      title: x.text.length > 200 ? `${x.text.slice(0, 200)}…` : x.text,
      badges: [status, ...(x.due ? [{ label: t("due {date}", { date: x.due }), tone: x.status === "open" && x.due <= today ? ("bad" as const) : ("muted" as const) }] : []), ...(x.flaggedAt && x.status === "open" ? [{ label: t("important"), tone: "warn" as const }] : [])],
      facts: [...(x.ticket ? [{ label: t("Ticket"), value: x.ticket }] : []), ...(x.doneAt ? [{ label: t("Done"), value: x.doneAt.slice(0, 10) }] : [])],
      ...(note ? { excerpt: note.text.slice(0, 300), excerptLabel: [t("Last note"), note.by, note.at?.slice(0, 10)].filter(Boolean).join(" · ") } : x.note ? { excerpt: x.note.slice(0, 300) } : {}),
      links: [{ label: t("Show {ref}", { ref: x.ref }), href: `/t/${x.id}` }],
    };
  },
};
