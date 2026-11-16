/**
 * A Date from how mcp-atlassian writes them: "2026-10-06 09:22:02 Mitteleuropäische
 * Sommerzeit" (local — the zone in words), "2026-09-08T12:30:39.090+0200",
 * "2026-09-07T17:31:47.347000+02:00". Null when it's none of these. Pure (the Jira briefing's port bundles it).
 */
export function dateOf(s?: string | null): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?\s*(Z|[+-]\d{2}:?\d{2})?/.exec(s ?? "");
  if (!m) return null;
  const zone = !m[4] || m[4] === "Z" ? (m[4] ?? "") : m[4].replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
  const d = new Date(`${m[1]}T${m[2]}${m[3] ? `.${m[3].slice(0, 3)}` : ""}${zone}`);
  return Number.isNaN(d.getTime()) ? null : d;
}
