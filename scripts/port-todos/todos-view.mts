/**
 * The Todos screen as the plugin's app view (views/todos.html): the built-in Todos tab's list in the view language — its tabs (Your todos / Done / Worker), the filter,
 * the groups by urgency, the todos you wait on, and a todo's row (tick, flag, words, ticket, kind, due day, repeat, set aside, worker's report, an agent's question,
 * the last error, where it came from) with what a click does (each a flow of the package over the kernel's engine) — and adding a todo. Its data is the lambda
 * `todos.screen` (data.x). Called by scripts/port-todos.mts.
 */

/** One todo's row — the same in every list. `scope`: whether the buttons of a closed todo differ. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const part = (name: string): string => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), `${name}.part.html`), "utf8");
const row = (): string => `<row gap=2 wrap=false align=start>
<button run="todos-ext.status" with="id={{ id }}, status={{ closed ? 'open' : 'done' }}" into="st" emit="todos-changed" label="{{ closed ? '●' : '○' }}" variant=quiet tip="{{ doneTip }}"/>
<col fill=true gap=1>
<row gap=1 wrap=true align=baseline>
{{#if isNew}}<dot color="#f59e0b"/>{{/if}}
{{#if flagged}}<text tone=bad tip="important">⚑</text>{{/if}}
{{#if asking}}<text tone=warn tip="{{ askingTip }}">❗</text>{{/if}}
{{#if waiting}}{{#if not closed}}<text tip="Waiting for others">⏳</text>{{/if}}{{/if}}
{{#if closed}}<strike><text tone=muted>{{ text }}</text></strike>{{#else}}{{#if waiting}}<text tone=muted>{{ text }}</text>{{#else}}<b>{{ text }}</b>{{/if}}{{/if}}
{{#if state}}<chip>{{ state }}</chip>{{/if}}
</row>
<row gap=1 wrap=true align=center>
<copy text="{{ ref }}" label="{{ ref }}"/>
{{#if workRun}}<small><muted>·</muted> <a href="{{ workRun }}" tip="Open the run working on it on the Code tab">{{ workRef }}</a></small>{{/if}}
{{#if origin}}<small><muted>· {{ origin }}</muted></small>{{/if}}
{{#if ticket}}<small><muted>·</muted> {{#if ticketUrl}}<hover><a href="{{ ticketUrl }}">{{ ticket }} ↗</a><hovercard><b>{{ ticket }}</b> {{ ticketTitle }}<small><muted>{{ ticketStatus }}</muted></small></hovercard></hover>{{#else}}<mono>{{ ticket }}</mono>{{/if}}</small>{{/if}}
{{#each also}}<small><muted>+</muted> {{#if url}}<a href="{{ url }}" tip="Linked ticket — it's about the same thing">{{ key }} ↗</a>{{#else}}<mono>{{ key }}</mono>{{/if}}</small>{{/each}}
{{#each mrs}}<small><muted>·</muted> <a href="{{ url }}" tip="{{ tip }}">{{ label }}</a>{{#if tag}} <muted>({{ tag }})</muted>{{/if}}</small>{{/each}}
<small><muted>· {{ kind }}</muted></small>
{{#if due}}<box tone="{{ dueTone }}" action="state" state="dueedit" value="{{ id }}"><small>{{ dueLabel }}</small></box>{{#else}}{{#if not closed}}<button action="state" state="dueedit" value="{{ id }}" label="+ {{ dueLabel }}" variant=quiet/>{{/if}}{{/if}}
{{#if repeat}}
<menu label="↻ {{ repeat }}" tip="Comes back — change">
<button run="todos-ext.recurrence" with="id={{ id }}, freq=" emit="todos-changed" label="does not repeat" variant=quiet/>
<button run="todos-ext.recurrence" with="id={{ id }}, freq=daily" emit="todos-changed" label="every day" variant=quiet/>
<button run="todos-ext.recurrence" with="id={{ id }}, freq=weekly" emit="todos-changed" label="every week" variant=quiet/>
<button run="todos-ext.recurrence" with="id={{ id }}, freq=monthly" emit="todos-changed" label="every month" variant=quiet/>
<button run="todos-ext.recurrence" with="id={{ id }}, freq=yearly" emit="todos-changed" label="every year" variant=quiet/>
{{#if not closed}}<button run="todos-ext.regenerate" with="id={{ id }}" into="regen" emit="todos-changed" label="make again" variant=quiet tip="Make the calendar appointments and the actions again"/>{{/if}}
</menu>
{{#if due}}<a href="/api/todos/{{ id }}/calendar" tip="Show it in the calendar">📅</a>{{/if}}
{{#else}}{{#if not closed}}
<menu label="repeat" tip="Make it come back">
<button run="todos-ext.recurrence" with="id={{ id }}, freq=daily" emit="todos-changed" label="every day" variant=quiet/>
<button run="todos-ext.recurrence" with="id={{ id }}, freq=weekly" emit="todos-changed" label="every week" variant=quiet/>
<button run="todos-ext.recurrence" with="id={{ id }}, freq=monthly" emit="todos-changed" label="every month" variant=quiet/>
<button run="todos-ext.recurrence" with="id={{ id }}, freq=yearly" emit="todos-changed" label="every year" variant=quiet/>
</menu>
{{/if}}{{/if}}
{{#if opsLabel}}<hover width=420><button action="state" state="panel" value="{{ id }}" label="⚡ {{ opsLabel }}" variant=quiet/><hovercard>{{#each opsList}}<small>⚡ {{ text }}</small>{{/each}}{{#if opsWhy}}<small><muted>{{ opsWhy }}</muted></small>{{/if}}<small><muted>{{ opsHint }}</muted></small></hovercard></hover>{{/if}}
{{#if merged}}<small><text tone=warn tip="{{ mergedTip }}">· {{ merged }}</text></small>{{/if}}
{{#if time}}<button action="state" state="panel" value="{{ id }}" label="{{ time }}" variant=quiet/>{{/if}}
{{#if reported}}<small><text tone=good tip="{{ reportedTip }}">· ✓ {{ reported }}</text></small>{{/if}}
{{#if suggested}}<small><muted tip="{{ suggestedTip }}">· ✓ {{ suggested }}</muted></small>{{/if}}
{{#if deferred}}<small><muted>· deferred</muted></small>{{/if}}
{{#if backUp}}<small><text tone=warn tip="You had moved it down — it's back on top">· {{ backUp }}</text></small>{{/if}}
{{#each away}}<small><text tone=warn tip="Read from their messages — a question to them waits until they are back">· 🏖 {{ text }}</text></small>{{/each}}
</row>
{{#if note}}<small><muted>{{ note }}</muted></small>{{#else}}{{#if source}}<small><muted>{{ source }}</muted></small>{{/if}}{{/if}}
{{#if asking}}<small><text tone=warn><b>Waiting for you:</b> {{ asking }}</text></small>{{/if}}
{{#if lastError}}<small><text tone=bad>{{ lastError }}</text></small>{{/if}}
</col>
<row gap=1 wrap=false align=center>
<button action="state" state="panel" value="{{ id }}" label="⋯" variant=quiet tip="Open the todo"/>
{{#if not closed}}
<button run="todos-ext.flag" with="id={{ id }}, flagged={{ flagged ? 'false' : 'true' }}" emit="todos-changed" label="⚑" variant="{{ flagged ? 'danger' : 'quiet' }}" tip="{{ flagged ? 'Not important' : 'Important' }}"/>
{{#if deferred}}<button run="todos-ext.defer" with="id={{ id }}, deferred=false" emit="todos-changed" label="↑" variant=quiet tip="Bring back to the top"/>{{#else}}<button run="todos-ext.defer" with="id={{ id }}, deferred=true" emit="todos-changed" label="↓" variant=quiet tip="Move down — set aside for now (comes back up when something happens, in 3 days at the latest)"/>{{/if}}
<button run="todos-ext.status" with="id={{ id }}, status=dismissed" into="st" emit="todos-changed" label="✕" variant=quiet tip="{{ dismissTip }}"/>
{{/if}}
</row>
</row>`;

export function todosViewTemplate(): string {
  const r = row();
  const [panel, activity, omni, runbar, recap, today] = ["panel", "activity", "omni", "runbar", "recap", "today"].map(part);
  const tickets = part("tickets").replace("ROW", r);
  return `<state name="part" value="todos" keep=true/><state name="scope" value="open" keep=true/><state name="filter" value=""/><state name="chips" value="[]"/><state name="omniq" value=""/><state name="feedfilter" value="all"/><state name="att" value=""/><state name="recapday" value=""/><state name="dueedit" value=""/><state name="dueval" value=""/><state name="newtext" value="" keep=true/><state name="newdue" value=""/><state name="newticket" value=""/><state name="panel" value=""/><state name="askq" value="" keep=true/><state name="jql" value=""/><state name="aq" value=""/><state name="busy" value=""/><state name="instr" value="" keep=true/><state name="opedit" value=""/><state name="optext" value=""/><state name="noteedit" value=""/><state name="notetext" value=""/><state name="tf_name" value=""/><state name="tf_iban" value=""/><state name="tf_bic" value=""/><state name="tf_amount" value=""/><state name="tf_purpose" value=""/><state name="textedit" value=""/><state name="edittext" value=""/><state name="newnote" value="" keep=true/><state name="mins" value=""/><state name="timenote" value=""/>
<data name="x" lambda="todos.screen" with="scope={{ state.scope }}, filter={{ state.filter }}, chips={{ state.chips }}" debounce="300" when="{{ state.part == 'todos' and state.scope != 'activity' }}"/>
<data name="hits" lambda="todos.hits" with="q={{ state.omniq }}" debounce="150" when="{{ state.omniq }}"/>
<data name="feed" lambda="todos.feed" with="filter={{ state.feedfilter }}" when="{{ state.part == 'todos' and state.scope == 'activity' }}"/>
<data name="seen" flow="todos-ext.seen" with="id={{ data.feed.max }}" when="{{ state.scope == 'activity' and data.feed.max }}"/>
<data name="lage" lambda="todos.lage" with="att={{ state.att }}" every="5" when="{{ state.part == 'todos' or state.part == 'tickets' }}"/>
<data name="day" lambda="todos.day" with="day={{ state.recapday }}" every="5" when="{{ state.part == 'recap' }}"/>
<data name="today" lambda="todos.heute" when="{{ state.part == 'today' }}"/>
<data name="pick" lambda="documents.attach-list" with="q={{ state.aq }}" debounce=250 when="{{ state.panel }}"/>
<data name="men" lambda="todos.mention" with="text={{ state.newnote }}" debounce=250 when="{{ state.panel and state.newnote }}"/>
<data name="p" lambda="todos.panel" with="id={{ state.panel }}" when="{{ state.panel }}"/>
<state name="aq" value=""/><state name="abusy" value=""/>
<data name="pick" lambda="documents.attach-list" with="q={{ state.aq }}" when="{{ state.panel }}" debounce="250"/>
<on event="attached" action="reload"/>
<data name="listseen" flow="todos-ext.list-seen" when="{{ state.part == 'todos' and state.scope == 'open' and data.x }}"/>
<on event="todos-changed" action="reload"/>
{{#if state.part == 'todos' and state.scope != 'activity' and not data.x}}<muted>Loading …</muted>{{#else}}
<col gap=3>
<row gap=1 wrap=true align=center>
<button action="state" state="part" value="todos" label="Briefing" variant="{{ state.part == 'todos' ? 'primary' : 'quiet' }}"/>
<button action="state" state="part" value="tickets" label="Tickets" variant="{{ state.part == 'tickets' ? 'primary' : 'quiet' }}"/>
<button action="state" state="part" value="recap" label="Recap" variant="{{ state.part == 'recap' ? 'primary' : 'quiet' }}"/>
<button action="state" state="part" value="today" label="Today" variant="{{ state.part == 'today' ? 'primary' : 'quiet' }}"/>
</row>
{{#if state.part == 'todos'}}
${runbar}
<row gap=1 wrap=true align=center>
<button action="state" state="scope" value="open" label="Your todos · {{ data.x.counts.open }}" variant="{{ state.scope == 'open' ? 'primary' : 'quiet' }}"/>
<button action="state" state="scope" value="done" label="Done · {{ data.x.counts.done }}" variant="{{ state.scope == 'done' ? 'primary' : 'quiet' }}"/>
<button action="state" state="scope" value="worker" label="Worker · {{ data.x.counts.worker }}" variant="{{ state.scope == 'worker' ? 'primary' : 'quiet' }}"/>
<button action="state" state="scope" value="activity" label="Activity" variant="{{ state.scope == 'activity' ? 'primary' : 'quiet' }}"/>
</row>
{{#if state.scope == 'activity'}}
${activity}
{{#else}}
${omni}
<box>
<row gap=2 wrap=true align=end>
<col fill=true><input bind="newtext" placeholder="What's to be done?" enter="todo-add"/></col>
<input bind="newticket" placeholder="Ticket (optional)"/>
<input bind="newdue" type=date label="Due date"/>
<button run="todos-ext.add" with="text={{ state.newtext }}, ticket={{ state.newticket }}, due={{ state.newdue }}" into="added" then="newtext=" emit="todos-changed" label="Add" variant=primary disabled="{{ not state.newtext }}"/>
</row>
<on event="todo-add" run="todos-ext.add" with="text={{ state.newtext }}, ticket={{ state.newticket }}, due={{ state.newdue }}" into="added" then="newtext="/>
{{#if data.added.id}}<small><text tone="{{ data.added.merged ? 'warn' : 'good' }}">{{ data.added.message }}</text></small>{{/if}}
</box>
{{#if data.st.confirm}}
<callout tone=warn>
<text>{{ data.st.confirm }}</text>
<button run="todos-ext.status" with="id={{ data.st.id }}, status=done, early=true" into="st" emit="todos-changed" label="Mark it done" variant=primary/>
</callout>
{{/if}}
{{#if data.st.error}}{{#if not data.st.confirm}}<text tone=bad>{{ data.st.error }}</text>{{/if}}{{/if}}
{{#if state.scope == 'open'}}
{{#if data.x.groups}}
<col gap=4>
{{#each data.x.groups}}
<col gap=1>
<row gap=2 align=center><dot color="{{ color }}"/><b>{{ label }}</b><small><muted>{{ count }}</muted></small></row>
<col gap=1>
{{#each items}}
${r}
{{/each}}
</col>
</col>
{{/each}}
</col>
{{#else}}
<muted>{{ data.x.empty }}</muted>
{{/if}}
{{#if data.x.nWaiting}}
<section title="Waiting on others" aside="{{ data.x.nWaiting }}" collapsible=true>
<col gap=1>
{{#each data.x.waiting}}
${r}
{{/each}}
</col>
</section>
{{/if}}
{{#else}}
{{#if state.scope == 'worker'}}<small><muted>Todos the workers make themselves — they close them themselves too. They aren't in your list.</muted></small>{{/if}}
{{#if data.x.rows}}
<col gap=1>
{{#each data.x.rows}}
${r}
{{/each}}
</col>
{{#else}}
<muted>{{ data.x.empty }}</muted>
{{/if}}
{{/if}}
{{/if}}
{{/if}}
{{#if state.part == 'tickets'}}
${runbar}
${tickets}
{{/if}}
{{#if state.part == 'recap'}}
${recap}
{{/if}}
{{#if state.part == 'today'}}
${today}
{{/if}}
</col>
<dialog bind="dueedit" title="Due date">
<col gap=2>
<input bind="dueval" type=date label="Due date"/>
<row gap=2>
<button run="todos-ext.due" with="id={{ state.dueedit }}, due={{ state.dueval }}" then="dueedit=" emit="todos-changed" label="Save" variant=primary disabled="{{ not state.dueval }}"/>
<button run="todos-ext.due" with="id={{ state.dueedit }}, due=" then="dueedit=" emit="todos-changed" label="no due date"/>
</row>
</col>
</dialog>
${panel}{{/if}}
`;
}
