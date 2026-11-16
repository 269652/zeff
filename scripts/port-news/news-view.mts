/**
 * News' page as the plugin's app view (contributes.appViews → views/news.html): the built-in's own template (view-template.meta.ts) taken as it is and converted — its
 * data comes from the lambda `news.screen` (`<data>`, data.news.*), its parts made of the kit's own elements: the cards (a grid with the picture, the source, the
 * headline, the summary, and buttons that read it here — a dialog —, open it, vote, save or hide it through the flow `news.act`), refreshing and the agent's button
 * (flows), asking your news (a flow, its answer shown), "more" for the next cards. Left out so far: the stories strip, listening to the overview, the masonry and focus
 * mode, Discover's button, the topic chips. Called by scripts/port-news.mts.
 */
import { translator } from "../../src/lib/i18n/shared";
import { NEWS_VIEW } from "../../src/plugins/news/view-template.meta";

export function newsViewTemplate(): string {
  const t = translator("en");
  let s = NEWS_VIEW.defaultTemplate(t);

  // 1) the data: the lambda's, not the page's app.*
  s = s.replace(/(^|[^\w.])app\./g, "$1data.news.");
  s = s.replace(
    '<state name="view" value="foryou"/><state name="source" value=""/><state name="category" value=""/>',
    `<state name="view" value="foryou"/><state name="source" value=""/><state name="category" value=""/><state name="limit" value="24"/><state name="reading" value=""/><state name="ask" value=""/><state name="like" value=""/>
<data name="news" lambda="news.screen" with="view={{ state.view }}, source={{ state.source }}, category={{ state.category }}, limit={{ state.limit }}, like={{ state.like }}"/>
<data name="item" lambda="news.item" with="id={{ state.reading }}" when="{{ state.reading }}"/>
<on event="news-changed" action="reload"/>
<on event="pickview" action="state" state="limit" value="24"/>
<on event="pickcat" action="state" state="limit" value="24"/>
<on event="all" action="state" state="limit" value="24"/>`,
  );

  // 2) the parts
  const rep = (name: string, body: string) => {
    const re = new RegExp(`<part name="${name.replace(/\./g, "\\.")}"[^>]*/>`, "g");
    s = s.replace(re, body);
  };
  rep("news.refresh", `<button run="news.fetch-round" done="Fetched." emit="news-changed" label="↻ ${t("Refresh")}" variant=primary wide=true/>`);
  rep("news.discover", `<button run="news.discover" done="Discover is up to date." emit="news-changed" label="✨ ${t("Discover")}" wide=true/>`);
  rep("news.funnel", `<button run="news.funnel" with="rounds=10" done="The agent has looked." emit="news-changed" label="${t("Let the agent look now")}"/>`);
  rep("news.stories", "");
  rep("news.listen", "");
  rep("news.fetching", `<button run="news.fetch-round" done="Fetched." emit="news-changed" label="↻ ${t("Refresh")}" variant=primary/>`);
  rep(
    "news.ask",
    `<box>
<row gap=2 wrap=false><col fill=true><input bind="ask" label="${t("Ask your news")}"/></col><button run="news.ask" with="question={{ state.ask }}" into="answer" label="${t("Ask")}" disabled="{{ not state.ask }}"/></row>
{{#if data.answer.answer}}<text>{{ data.answer.answer }}</text><row gap=1 wrap=true>{{#each data.answer.sources}}<small><a href="{{ url }}">[{{ n }}] {{ sourceName }}</a></small>{{/each}}</row>{{/if}}
</box>`,
  );
  rep(
    "news.feed",
    `{{#if data.news.like}}<row gap=2 align=center><small><muted>${t("More like this")}</muted></small><button action="state" state="like" value="" emit="news-changed" label="${t("Back")}" variant=quiet/></row>{{/if}}
<grid cols=3 gap=3 min=280>
{{#each data.news.items}}
<box>
<col gap=2>
{{#if image}}<img src="{{ image }}" alt="{{ title }}"/>{{/if}}
<small><muted>{{ sourceName }} · {{ ago }}{{#if top}} · ★{{/if}}</muted></small>
<b>{{ title }}</b>
{{#if summary}}<text tone=muted>{{ summary }}</text>{{/if}}
{{#if gateWhy}}<small><muted>{{ gateWhy }}</muted></small>{{/if}}
<row gap=1 wrap=true>{{#each tagList}}<chip>{{ tag }}</chip>{{/each}}</row>
<row gap=1 wrap=true>
<button action="state" state="reading" value="{{ id }}" label="${t("Read here")}" variant=quiet/>
<a href="{{ url }}">${t("Open")}</a>
<button run="news.more-like" with="id={{ id }}" done="More like this found." then="like={{ id }}" emit="news-changed" label="≈ ${t("More")}" variant=quiet/>
<button run="news.act" with="op=vote, id={{ id }}, value={{ liked ? 0 : 1 }}" emit="news-changed" label="👍" variant="{{ liked ? 'primary' : 'quiet' }}"/>
<button run="news.act" with="op=vote, id={{ id }}, value={{ disliked ? 0 : -1 }}" emit="news-changed" label="👎" variant="{{ disliked ? 'primary' : 'quiet' }}"/>
<button run="news.act" with="op=state, id={{ id }}, state={{ saved ? 'new' : 'saved' }}" emit="news-changed" label="🔖" variant="{{ saved ? 'primary' : 'quiet' }}"/>
<button run="news.act" with="op=state, id={{ id }}, state={{ state == 'hidden' ? 'new' : 'hidden' }}" emit="news-changed" label="{{ state == 'hidden' ? '↩' : '✕' }}" variant=quiet/>
</row>
</col>
</box>
{{/each}}
</grid>
{{#if data.news.hasMore}}<row gap=2 justify=center><button action="state" state="limit" value="{{ data.news.nextLimit }}" label="${t("More")}"/></row>{{/if}}
<dialog bind="reading" title="{{ data.item.title }}">
{{#if data.item.found}}
<col gap=3>
<small><muted>{{ data.item.source }}</muted></small>
{{#if data.item.image}}<img src="{{ data.item.image }}" alt="{{ data.item.title }}"/>{{/if}}
{{#each data.item.paragraphs}}<text>{{ t }}</text>{{/each}}
<row gap=2><a href="{{ data.item.url }}">${t("Open the page")}</a></row>
</col>
{{/if}}
</dialog>`,
  );
  if (/<part /.test(s)) throw new Error("news view: a part of the built-in's template has no replacement: " + (/<part [^>]*>/.exec(s)?.[0] ?? ""));
  return s;
}
