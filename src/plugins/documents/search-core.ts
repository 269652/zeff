/** The words of a full-text query (at most eight, each at least two characters) — pure: the built-in's search and the Documents plugin's port (scripts/port-documents.mts) share it. */
export const wordsOf = (q: string): string[] =>
  q
    .toLowerCase()
    .split(/[^\p{L}\p{N}@.\-/]+/u)
    .map((w) => w.replace(/^[.\-/]+|[.\-/]+$/g, ""))
    .filter((w) => w.length >= 2)
    .slice(0, 8);

/** The SQL that finds the documents holding every word: where-clause over name, text, summary and concepts — one `?` per word. */
export const matchWhere = (words: string[]): string => {
  const hay = "lower(coalesce(name,'') || ' ' || coalesce(text,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(concepts,''))";
  return words.map(() => `instr(${hay}, ?) > 0`).join(" and ");
};
