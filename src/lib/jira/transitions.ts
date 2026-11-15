/** A ticket's transitions as mcp-atlassian lists them, and the names compared — pure (the Jira port bundles it: scripts/port-jira.mts). */
export function transitionsOf(payload: unknown): { id: string; name: string; to: string | null }[] {
  const list = Array.isArray(payload) ? payload : ((payload as { transitions?: unknown[] })?.transitions ?? []);
  return list.flatMap((item) => {
    const x = (item ?? {}) as { id?: string | number; name?: string; to_status?: string | { name?: string }; to?: { name?: string } };
    const to = typeof x.to_status === "string" ? x.to_status : (x.to_status?.name ?? x.to?.name ?? null);
    return x.id !== undefined && x.name ? [{ id: String(x.id), name: x.name, to }] : [];
  });
}

export const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/\(→[^)]*\)/g, "")
    .replace(/[^a-z0-9äöüß]+/g, " ")
    .trim();
