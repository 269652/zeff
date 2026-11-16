/**
 * News' page as the plugin's app view (contributes.appViews → views/news.html): the built-in's own template (view-template.meta.ts) taken as it is and converted — its
 * data comes from the lambda `news.screen` (`<data>`, data.news.*), its parts made of the kit's own elements: the cards (a grid with the picture, the source, the
 * headline, the summary, and buttons that read it here — a dialog —, open it, vote, save or hide it through the flow `news.act`), refreshing and the agent's button
 * (flows), asking your news (a flow, its answer shown), "more" for the next cards, the stories strip (the kit's <stories>), listening to the overview (<speak>), masonry or
 * stream (<grid masonry>), the topic chips with their dive banner and "story so far", the "you're all caught up" line, "N new" and what was seen (<visible>).
 * Left out on purpose: the blurred side columns of the stream, the scroll-triggered background search (Discover's button and the sync do it), endless scrolling (a "More" button).
 * Called by scripts/port-news.mts.
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
    `<state name="view" value="foryou"/><state name="source" value=""/><state name="category" value=""/><state name="limit" value="24"/><state name="reading" value=""/><state name="ask" value=""/><state name="like" value=""/><state name="topic" value=""/><state name="story" value=""/><state name="seenids" value=""/><state name="stream" value="1" keep=true/>
<data name="news" lambda="news.screen" with="view={{ state.view }}, source={{ state.source }}, category={{ state.category }}, limit={{ state.limit }}, like={{ state.like }}, topic={{ state.topic }}"/>
<data name="fresh" lambda="news.fresh" with="since={{ data.news.loadedAt }}" when="{{ data.news.loadedAt }}" every=60/>
<data name="item" lambda="news.item" with="id={{ state.reading }}" when="{{ state.reading }}"/>
<on event="news-changed" action="reload"/>
<on event="pickview" action="state" state="limit" value="24"/>
<on event="pickview" action="state" state="topic" value=""/>
<on event="pickview" action="state" state="like" value=""/>
<on event="topic-changed" action="state" state="limit" value="24"/>
<on event="storyshown" run="news.act" with="op=seen, ids={{ state.story }}"/>
<on event="storylike" run="news.act" with="op=vote, id={{ state.story }}, value=1" emit="news-changed"/>
<on event="storysave" run="news.act" with="op=state, id={{ state.story }}, state=saved" emit="news-changed"/>
<on event="cardseen" run="news.act" with="op=seen, ids={{ state.seenids }}"/>
<on when="{{ data.news.items and not data.news.hasMore and not data.news.topic and data.news.view != 'discover' }}" run="news.auto-find" emit="news-changed"/>
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
  rep("news.stories", `{{#if data.news.stories}}<stories groups="data.news.stories" bind="story" emit="storyshown" actions="storylike|🤍|${t("More like this")}; storysave|🔖|${t("Save for later")}" read="reading"/>{{/if}}`);
  rep("news.listen", `<speak text="{{ data.news.overview.spoken }}" label="${t("Listen to the briefing")}" lang="{{ data.news.voice }}"/>`);
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
{{#if data.fresh.count}}<row gap=2 justify=center><button emit="news-changed" label="↑ {{ data.fresh.count }} ${t("new — show")}" variant=primary/></row>{{/if}}
{{#if data.news.topic}}
<box tone=accent>
<row gap=2 align=center wrap=true><b>{{#if data.news.topicIsStory}}🧵 {{ data.news.topicLabel }}{{#else}}# {{ data.news.topicLabel }}{{/if}}</b><grow/>
<button run="news.ask" with="question={{ data.news.topicAsk }}" into="sofar" label="📖 ${t("Story so far")}" variant=quiet/>
<button action="state" state="topic" value="" emit="topic-changed" label="✕ ${t("Stop")}" variant=quiet/></row>
{{#if data.sofar.answer}}<text>{{ data.sofar.answer }}</text><row gap=1 wrap=true>{{#each data.sofar.sources}}<small><a href="{{ url }}">[{{ n }}] {{ sourceName }}</a></small>{{/each}}</row>{{/if}}
</box>
{{/if}}
<row gap=2 justify=end><button action="state" state="stream" value="{{ state.stream == '1' ? '0' : '1' }}" label="{{ state.stream == '1' ? '${t("Grid")}' : '${t("Stream")}' }}" variant="{{ state.stream == '1' ? 'primary' : 'plain' }}" tip="{{ state.stream == '1' ? '${t("Cards in columns")}' : '${t("One column to read, like a phone feed")}' }}"/></row>
<grid masonry=true cols="{{ state.stream == '1' ? 1 : 3 }}" min="{{ state.stream == '1' ? 520 : 260 }}" gap=3>
{{#each data.news.items}}
{{#if caught}}<divider label="✓ ${t("You're all caught up")} — ${t("Below: what you have seen already")}"/>{{/if}}
<box>
<col gap=2>
<visible value="{{ id }}" bind="seenids" emit="cardseen"/>
{{#if image}}<img src="{{ image }}" alt="{{ title }}"/>{{/if}}
<small><muted>{{ sourceName }} · {{ ago }}{{#if outlets}} · 📣 {{ outlets }}{{/if}}{{#if top}} · ★{{/if}}</muted></small>
<b>{{ title }}</b>
{{#if summary}}<text tone=muted>{{ summary }}</text>{{/if}}
{{#if gateWhy}}<small><muted>{{ gateWhy }}</muted></small>{{#else}}{{#if why}}<small><muted>{{ why }}</muted></small>{{/if}}{{/if}}
<row gap=1 wrap=true>{{#each tagList}}<button action="state" state="topic" value="{{ tag }}" emit="topic-changed" label="{{ tag }}" variant=quiet tip="${t("Follow this topic")}"/>{{/each}}</row>
<row gap=1 wrap=true>
<button action="state" state="reading" value="{{ id }}" label="${t("Read here")}" variant=quiet/>
<a href="{{ url }}">${t("Open")}</a>
<button run="news.more-like" with="id={{ id }}" done="More like this found." then="like={{ id }}" emit="news-changed" label="≈ ${t("More")}" variant=quiet/>
{{#if thread}}<button action="state" state="topic" value="{{ thread }}" emit="topic-changed" label="🧵 ${t("Follow the thread")}" variant=quiet/>{{/if}}
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
