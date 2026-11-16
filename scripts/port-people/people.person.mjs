import { personPageData, tFor } from "./lib.mjs";

/**
 * What a person's page shows (the plugin's detail page views/person.html reads it as data.page.* and data.wiki.*): the built-in's own personPageData
 * (src/plugins/people/row-data.ts, bundled) over the kernel's bundle of what Zeff knows of them (`people.page-data`) and, separately — it may take a few seconds —
 * what the knowledge server knows of them (`people.wiki-of`). event: { row, part: "page" | "wiki" }.
 */
export async function handler(event, context) {
  const t = tFor(context.language);
  const row = Number(event?.row) || 0;
  if (event?.part === "wiki") {
    const w = (await context.zeff.call("people.wiki-of", { row })).wiki;
    const d = personPageData({ person: { id: 1, name: "", aliases: [], emails: [], jira: [], whatsapp: "", note: "", starred: false, compiled: null, dates: [], details: [], claims: [], links: [], relations: { out: [], in: [] }, contacts: [], todos: [], pages: [], tickets: [], others: [], documents: [], cases: [], events: null, pulse: null }, error: null, loading: false, wiki: w }, { t, locale: context.language });
    const pick = ({ wiki, showWiki, wikiLoading, wikiError, wikiEmpty, wikiFull, wikiMerge, hasWikiMerge, wikiPagesTitle }) => ({ wiki: wiki ?? { summary: "", related: [], pages: [], graph: "", error: "", merge: null }, showWiki, wikiLoading, wikiError, wikiEmpty, wikiFull, wikiMerge, hasWikiMerge, wikiPagesTitle });
    return pick(d);
  }
  const bundle = (await context.zeff.call("people.page-data", { row })).person;
  const d = personPageData({ person: bundle, error: bundle ? null : t("This row is not a person."), loading: false, wiki: null }, { t, locale: context.language });
  if (!d.ready) return { ready: false, error: d.error ?? "", row };
  // (the whole bundle and the knowledge part are not what the page reads from here)
  const { person, wiki, showWiki, wikiLoading, wikiError, wikiEmpty, wikiFull, wikiMerge, hasWikiMerge, wikiPagesTitle, ...rest } = d;
  const option = (x) => String(x).replace(/[,:]/g, " ").replace(/\s+/g, " ").trim();
  return { ...rest, row, relationOptions: [`:${t("to you")}`, ...rest.others.map((o) => `${o.id}:${option(o.name)}`)].join(", ") };
}
