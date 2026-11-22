import type { RefCardProvider } from "@/lib/refs/point";
import { isInstalled } from "@/plugins/state";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** Which person: their id ("12"), else a name or alias as a text names them ("Anna", "@anna.schmidt"). */
async function personId(id: string): Promise<number | null> {
  if (/^\d+$/.test(id)) return Number(id);
  const name = id.replace(/^@/, "").trim().toLowerCase();
  if (!name) return null;
  const { peopleIndex } = await import("./store");
  const { mentionMatcher } = await import("./mentions");
  return mentionMatcher(await peopleIndex())?.who.get(name)?.id ?? null;
}

/** A person's card (a name in a todo, an @-tag in a note): who they are, when you were last in touch, what is open between you — the People card's data. */
export const PERSON_REF_CARD: RefCardProvider = {
  kind: "person",
  card: async (id, { t }) => {
    const pid = await personId(id);
    if (pid === null) return null;
    const { personCardAction } = await import("./server-actions");
    const d = await personCardAction(pid);
    if (!d) return null;
    const href = isInstalled("workspace") ? (await import("@/plugins/workspace/people-database")).personHrefs()[d.id] : undefined;
    const last = d.messages[0];
    return {
      kind: "person",
      id: String(d.id),
      title: d.name,
      avatar: initials(d.name),
      subtitle: d.role ?? (d.relations[0] || undefined),
      eyebrow: d.aliases.length ? t("also: {names}", { names: d.aliases.slice(0, 3).join(", ") }) : undefined,
      badges: d.away ? [{ label: t("Away until {date}", { date: d.away.until }), tone: "warn" }] : [],
      facts: [
        ...(last ? [{ label: t("Last contact"), value: `${last.at.slice(0, 10)} · ${last.who}` }] : []),
        ...d.details.slice(0, 2).map((x) => ({ label: x.key === "phone" ? t("Phone") : x.key === "address" ? t("Address") : x.key === "iban" ? "IBAN" : x.key, value: x.value })),
        ...d.dates.slice(0, 1).map((x) => ({ label: x.label, value: x.when })),
      ],
      ...(d.summary?.connection ? { excerpt: d.summary.connection.slice(0, 300) } : d.note ? { excerpt: d.note.slice(0, 300) } : last ? { excerpt: last.text, excerptLabel: t("Latest message") } : {}),
      ...(d.owed.length
        ? { itemsLabel: t("Open commitments"), items: d.owed.slice(0, 4).map((o) => ({ label: `${o.direction === "mine" ? t("I owe") : t("They owe")}: ${o.text}${o.due ? ` · ${o.due}` : ""}`, tone: o.direction === "mine" ? ("warn" as const) : ("info" as const) })) }
        : d.todos.length
          ? { itemsLabel: t("Open todos"), items: d.todos.slice(0, 4).map((x) => ({ label: `${x.ref} ${x.text}`, href: `/t/${x.id}` })) }
          : {}),
      links: href ? [{ label: t("Open their page"), href }] : [],
    };
  },
};
