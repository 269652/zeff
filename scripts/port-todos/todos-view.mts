/**
 * The Todos screen as the plugin's app view (views/todos.html), in the view language and with the built-in page's look: a sidebar (Briefing / Tickets / Recap / Today,
 * the heading, when the briefing ran, Run now) beside the content — on the Briefing a card with *Your todos / Done / Worker / Activity*, the omnibar, the groups by urgency
 * and the todos you wait on; each todo a row with a round tick box, its words and its line of badges (ticket, kind, due day, repeat, a worker's report, an agent's
 * question, the last error, where it came from), its quick panels (note, time, instruction, reply, GiroCode) and the buttons that show on hover. Its data is the lambda
 * `todos.screen` (data.x). Called by scripts/port-todos.mts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const part = (name: string): string => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), `${name}.part.html`), "utf8");

/** The sidebar's tabs: the parts of the screen. */
const tabs = `<tabs bind="part" look=line options='[["todos","Briefing"],["tickets","Tickets"],["recap","Recap"],["today","Today"]]'/>`;

export function todosViewTemplate(): string {
  const r = part("row");
  const [panel, activity, omni, runbar, recap, today] = ["panel", "activity", "omni", "runbar", "recap", "today"].map(part);
  const tickets = part("tickets").replace("ROW", r);
  const recapSide = part("recap-side");
  return `<state name="part" value="todos" keep=true/><state name="scope" value="open" keep=true/><state name="filter" value=""/><state name="limit" value="50"/><state name="chips" value="[]"/><state name="omniq" value=""/><state name="feedfilter" value="all"/><state name="att" value=""/><state name="recapday" value=""/><state name="dueedit" value=""/><state name="dueval" value=""/><state name="newtext" value="" keep=true/><state name="newdue" value=""/><state name="newticket" value=""/><state name="panel" value=""/><state name="quick" value=""/><state name="acts" value=""/><state name="replytext" value=""/><state name="askq" value="" keep=true/><state name="jql" value=""/><state name="aq" value=""/><state name="busy" value=""/><state name="instr" value="" keep=true/><state name="opedit" value=""/><state name="optext" value=""/><state name="noteedit" value=""/><state name="notetext" value=""/><state name="tf_name" value=""/><state name="tf_iban" value=""/><state name="tf_bic" value=""/><state name="tf_amount" value=""/><state name="tf_purpose" value=""/><state name="textedit" value=""/><state name="edittext" value=""/><state name="newnote" value="" keep=true/><state name="mins" value=""/><state name="timenote" value=""/>
<data name="x" lambda="todos.screen" with="scope={{ state.scope }}, filter={{ state.filter }}, chips={{ state.chips }}, limit={{ state.limit }}" debounce="300" hold="filter,chips,limit" preload="scope=open|done|worker" when="{{ state.part == 'todos' and state.scope != 'activity' }}"/>
<data name="hits" lambda="todos.hits" with="q={{ state.omniq }}" debounce="150" when="{{ state.omniq }}"/>
<data name="feed" lambda="todos.feed" with="filter={{ state.feedfilter }}" when="{{ state.part == 'todos' and state.scope == 'activity' }}"/>
<data name="seen" flow="todos-ext.seen" with="id={{ data.feed.max }}" when="{{ state.scope == 'activity' and data.feed.max }}"/>
<data name="lage" lambda="todos.lage" with="att={{ state.att }}" every="5" when="{{ state.part == 'todos' or state.part == 'tickets' }}"/>
<data name="day" lambda="todos.day" with="day={{ state.recapday }}" every="5" when="{{ state.part == 'recap' }}"/>
<data name="today" lambda="todos.heute" when="{{ state.part == 'today' }}"/>
<data name="men" lambda="todos.mention" with="text={{ state.newnote }}" debounce=250 when="{{ state.panel and state.newnote }}"/>
<data name="p" lambda="todos.panel" with="id={{ state.panel }}" when="{{ state.panel }}"/>
<data name="qp" lambda="todos.panel" with="id={{ state.quick }}" when="{{ state.quick }}"/>
<data name="asks" lambda="todos.asks" with="id={{ state.panel }}" every="3" when="{{ state.panel }}"/>
<state name="abusy" value=""/>
<data name="pick" lambda="documents.attach-list" with="q={{ state.aq }}" when="{{ state.panel }}" debounce="250"/>
<on event="attached" action="reload"/>
<data name="listseen" flow="todos-ext.list-seen" when="{{ state.part == 'todos' and state.scope == 'open' and data.x }}"/>
<on event="todos-changed" action="reload"/>
<sidebarframe store="zeff-todos-sidebar">
<sidebar>
${tabs}
{{#if state.part == 'recap'}}
${recapSide}
{{#else}}
${runbar}
{{/if}}
</sidebar>
{{#if state.part == 'todos'}}
{{#if state.scope != 'activity' and not data.x and not data.x_last}}<line look=empty>Loading …</line>{{#else}}
<card flush=phone>
<segmented bind="scope" label="Todos" options='[["open","Your todos","{{ data.x ? data.x.counts.open : data.x_last.counts.open }}"],["done","Done","{{ data.x ? data.x.counts.done : data.x_last.counts.done }}"],["worker","Worker","{{ data.x ? data.x.counts.worker : data.x_last.counts.worker }}"],["activity","Activity"]]'/>
{{#if state.scope == 'activity'}}
${activity}
{{#else}}
${omni}
{{#if data.st.confirm}}
<callout tone=warn>
<text>{{ data.st.confirm }}</text>
<button run="todos-ext.status" with="id={{ data.st.id }}, status=done, early=true" into="st" emit="todos-changed" label="Mark it done" variant=primary/>
</callout>
{{/if}}
{{#if data.st.error}}{{#if not data.st.confirm}}<line look=error>{{ data.st.error }}</line>{{/if}}{{/if}}
{{#if state.scope == 'open'}}
{{#if data.x.groups}}
<line look=groups>
{{#each data.x.groups}}
<div-group>
<caption dot="{{ color }}" n="{{ count }}" tone="{{ overdue ? 'bad' : 'plain' }}">{{ label }}</caption>
<checklist>
{{#each items}}
${r}
{{/each}}
</checklist>
</div-group>
{{/each}}
</line>
{{#else}}
<line look=empty>{{ data.x.empty }}</line>
{{/if}}
{{#if data.x.nWaiting}}
<fold look=group store="boards-waiting" label="Waiting on others ({{ data.x.nWaiting }})">
<checklist spacing=loose>
{{#each data.x.waiting}}
${r}
{{/each}}
</checklist>
</fold>
{{/if}}
{{#else}}
{{#if state.scope == 'worker'}}<line look=small>Todos the workers make themselves — they close them themselves too. They aren't in your list.</line>{{/if}}
{{#if data.x.rows}}
<checklist>
{{#each data.x.rows}}
${r}
{{/each}}
</checklist>
{{#if data.x.more}}<button action="state" state="limit" value="{{ data.x.nextLimit }}" label="{{ data.x.moreLabel }}" variant=quiet/>{{/if}}
{{#else}}
<line look=empty>{{ data.x.empty }}</line>
{{/if}}
{{/if}}
{{/if}}
</card>
{{/if}}
{{/if}}
{{#if state.part == 'tickets'}}
${tickets}
{{/if}}
{{#if state.part == 'recap'}}
${recap}
{{/if}}
{{#if state.part == 'today'}}
${today}
{{/if}}
</sidebarframe>
${panel}
`.replace(/<\/?div-group>/g, (m) => (m.startsWith("</") ? "</line>" : '<line look="block">'));
}
