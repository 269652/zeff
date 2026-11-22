import type { RefCardProvider } from "@/lib/refs/point";

const shown = (v: unknown): string => (v === null || v === undefined || v === "" ? "" : Array.isArray(v) ? v.map(shown).filter(Boolean).join(", ") : typeof v === "object" ? "" : typeof v === "boolean" ? (v ? "✓" : "") : String(v));

/** A page's card, or a database row's (a page named in a text, a row an app links): its icon and title, where it is, a few of its fields, how its text begins. */
export const PAGE_REF_CARD: RefCardProvider = {
  kind: "page",
  card: async (id, { t }) => {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return null;
    const { getPage, getDatabase, rowsOf } = await import("./store");
    const p = getPage(n);
    if (!p || p.archivedAt) return null;
    const { docText } = await import("./doc");
    const text = docText(p.content as never).replace(/\s+/g, " ").trim();
    const parent = p.dbId ? getDatabase(p.dbId)?.page : p.parentId ? getPage(p.parentId) : null;
    let facts: { label: string; value: string }[] = [];
    if (p.dbId) {
      const d = rowsOf(p.dbId);
      const row = d?.rows.find((r) => r.id === p.id);
      if (d && row) {
        const { rowObject } = await import("./flows/rows");
        const o = rowObject(d.schema, row);
        facts = Object.entries(o)
          .filter(([k]) => k !== "id" && k !== "title")
          .map(([label, v]) => ({ label, value: shown(v) }))
          .filter((f) => f.value && f.value.length < 120)
          .slice(0, 5);
      }
    }
    return {
      kind: "page",
      id: String(p.id),
      icon: p.icon || (p.kind === "database" ? "🗂️" : "📄"),
      title: p.title || t("Untitled"),
      eyebrow: parent ? `${parent.icon ? `${parent.icon} ` : ""}${parent.title}` : p.kind === "database" ? t("Database") : t("Page"),
      facts,
      ...(text ? { excerpt: text.slice(0, 300) } : {}),
      links: [{ label: t("Open"), href: `/workspace/${p.id}` }],
    };
  },
};
