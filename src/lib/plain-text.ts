/** Plain text for prompts — pure, so the plugins' ports can bundle it. */
/** Jira wiki markup and whitespace thinned out, cut to `max`. */
export function plain(s: string | null | undefined, max: number): string {
  const t = (s ?? "")
    .replace(/\{(code|noformat|quote|panel)[^}]*\}/g, "")
    .replace(/!([^!\s|]+)(\|[^!]*)?!/g, "[Bild]")
    .replace(/\[~([^\]]+)\]/g, "@$1")
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
