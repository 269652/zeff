/**
 * The News plugin's pure core — the feed reader, the scoring, the profile's terms, the defaults — no Zeff code beyond them, so the News plugin bundles it
 * (scripts/port-news.mts). Client-safe.
 */
export { decodeBody, decodeEntities, feedTitle, parseFeed, stripHtml, type FeedItem } from "./feed";
export { BIG_STORY, DEFAULT_PREFS, normalizeUrl, scoreItem, titleKey, tokens, topicFeedUrl, type NewsPrefs, type ProfileTerm, type ScoreContext } from "./shared";
export { termsOf } from "./profile-terms";
export { diversify } from "./shared";
export { FUNNEL_INSTRUCTIONS, FUNNEL_SCHEMA } from "./funnel-prompt";
export { DIGEST_INSTRUCTIONS, DIGEST_SCHEMA } from "./digest-prompt";
export { analyze } from "./keyphrase";
export { clusterStories } from "./cluster";
export { fetchArticle, extractArticle } from "./reader";
export { NEWS_BROWSER_UA } from "./http";
export { snippetOf } from "./shared";
export { TAGGING_INSTRUCTIONS, TAGGING_SCHEMA } from "./retag-prompt";
export { ASK_INSTRUCTIONS, ASK_SCHEMA } from "./ask-prompt";
export { TASTE_INSTRUCTIONS, TASTE_SCHEMA, fallbackTaste, matchTaste, tastePrompt } from "./taste-core";
export { discoverFeeds, isPublicUrl } from "./discover";
export { AGGREGATORS, OUTLET_INSTRUCTIONS, OUTLET_SCHEMA, publishersOf } from "./finder-core";
export { PLAN_INSTRUCTIONS, PLAN_SCHEMA } from "./discover-prompt";
export { SIMILAR_INSTRUCTIONS, SIMILAR_SCHEMA } from "./similar-prompt";
export { cosine } from "./keyphrase";
export { ALL_FEEDS, STARTER_NAMES, CATEGORY_ORDER, categoriesOf } from "./catalog";
export { pickFromCatalog } from "./catalog-pick";
export { formatInterests, parseInterests, parseMutes } from "./shared";
