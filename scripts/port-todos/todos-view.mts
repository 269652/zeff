/**
 * The Todos screen as the plugin's app view (views/todos.html): the built-in Todos tab's list in the view language — its tabs (Your todos / Done / Worker), the filter,
 * the groups by urgency, the todos you wait on, and a todo's row (tick, flag, words, ticket, kind, due day, repeat, set aside, worker's report, an agent's question,
 * the last error, where it came from) with what a click does (each a flow of the package over the kernel's engine) — and adding a todo. Its data is the lambda
 * `todos.screen` (data.x). Called by scripts/port-todos.mts.
 */

/** One todo's row — the same in every list. `scope`: whether the buttons of a closed todo differ. */
const row = (): string => `<row gap=2 wrap=false align=start>
<button run="todos-ext.status" with="id={{ id }}, status={{ closed ? 'open' : 'done' }}" into="st" emit="todos-changed" label="{{ closed ? '●' : '○' }}" variant=quiet tip="{{ closed ? ref + ' open again' : ref + ' done' }}"/>
<col fill=true gap=1>
<row gap=1 wrap=true align=baseline>
{{#if flagged}}<text tone=bad tip="important">⚑</text>{{/if}}
{{#if asking}}<text tone=warn tip="{{ askingTip }}">❗</text>{{/if}}
{{#if waiting}}{{#if not closed}}<text tip="Waiting for others">⏳</text>{{/if}}{{/if}}
{{#if closed}}<strike><text tone=muted>{{ text }}</text></strike>{{#else}}{{#if waiting}}<text tone=muted>{{ text }}</text>{{#else}}<b>{{ text }}</b>{{/if}}{{/if}}
{{#if state}}<chip>{{ state }}</chip>{{/if}}
</row>
<row gap=1 wrap=true align=center>
<copy text="{{ ref }}" label="{{ ref }}"/>
{{#if ticket}}<small><muted>·</muted> {{#if ticketUrl}}<a href="{{ ticketUrl }}" tip="{{ ticketTitle }}">{{ ticket }} ↗</a>{{#else}}<mono>{{ ticket }}</mono>{{/if}}</small>{{/if}}
{{#each also}}<small><muted>+</muted> {{#if url}}<a href="{{ url }}" tip="{{ title }}">{{ key }} ↗</a>{{#else}}<mono>{{ key }}</mono>{{/if}}</small>{{/each}}
<small><muted>· {{ kind }}</muted></small>
{{#if due}}<button action="state" state="dueedit" value="{{ id }}" label="{{ dueLabel }}" variant="{{ dueTone == 'bad' ? 'danger' : 'quiet' }}"/>{{#else}}{{#if not closed}}<button action="state" state="dueedit" value="{{ id }}" label="+ {{ dueLabel }}" variant=quiet/>{{/if}}{{/if}}
{{#if repeat}}<small><muted>↻ {{ repeat }}</muted></small>{{/if}}
{{#if reported}}<small><text tone=good tip="{{ reportedTip }}">· ✓ {{ reported }}</text></small>{{/if}}
{{#if suggested}}<small><muted tip="{{ suggestedTip }}">· ✓ {{ suggested }}</muted></small>{{/if}}
{{#if deferred}}<small><muted>· deferred</muted></small>{{/if}}
{{#if backUp}}<small><text tone=warn>· {{ backUp }}</text></small>{{/if}}
</row>
{{#if note}}<small><muted>{{ note }}</muted></small>{{#else}}{{#if source}}<small><muted>{{ source }}</muted></small>{{/if}}{{/if}}
{{#if asking}}<small><text tone=warn><b>Waiting for you:</b> {{ asking }}</text></small>{{/if}}
{{#if lastError}}<small><text tone=bad>{{ lastError }}</text></small>{{/if}}
</col>
{{#if not closed}}
<row gap=1 wrap=false align=center>
<button run="todos-ext.flag" with="id={{ id }}, flagged={{ flagged ? 'false' : 'true' }}" emit="todos-changed" label="⚑" variant="{{ flagged ? 'danger' : 'quiet' }}" tip="{{ flagged ? 'Not important' : 'Important' }}"/>
{{#if deferred}}<button run="todos-ext.defer" with="id={{ id }}, deferred=false" emit="todos-changed" label="↑" variant=quiet tip="Bring back to the top"/>{{#else}}<button run="todos-ext.defer" with="id={{ id }}, deferred=true" emit="todos-changed" label="↓" variant=quiet tip="Move down — set aside for now (comes back up when something happens, in 3 days at the latest)"/>{{/if}}
<button run="todos-ext.status" with="id={{ id }}, status=dismissed" into="st" emit="todos-changed" label="✕" variant=quiet tip="Dismiss — doesn't apply"/>
</row>
{{/if}}
</row>`;

export function todosViewTemplate(): string {
  const r = row();
  return `<state name="scope" value="open" keep=true/><state name="filter" value=""/><state name="dueedit" value=""/><state name="dueval" value=""/><state name="newtext" value=""/><state name="newdue" value=""/><state name="newticket" value=""/>
<data name="x" lambda="todos.screen" with="scope={{ state.scope }}, filter={{ state.filter }}" debounce="300"/>
<on event="todos-changed" action="reload"/>
{{#if not data.x}}<muted>Loading …</muted>{{#else}}
<col gap=3>
<heading level=2>Todos</heading>
<row gap=1 wrap=true align=center>
<button action="state" state="scope" value="open" label="Your todos · {{ data.x.counts.open }}" variant="{{ state.scope == 'open' ? 'primary' : 'quiet' }}"/>
<button action="state" state="scope" value="done" label="Done · {{ data.x.counts.done }}" variant="{{ state.scope == 'done' ? 'primary' : 'quiet' }}"/>
<button action="state" state="scope" value="worker" label="Worker · {{ data.x.counts.worker }}" variant="{{ state.scope == 'worker' ? 'primary' : 'quiet' }}"/>
</row>
<row gap=2 wrap=true align=center>
<col fill=true><input bind="filter" placeholder="Filter todos"/></col>
{{#if state.filter}}<button action="state" state="filter" value="" label="Clear the filter" variant=link/>{{/if}}
</row>
<box>
<row gap=2 wrap=true align=end>
<col fill=true><input bind="newtext" placeholder="What's to be done?" enter="todo-add"/></col>
<input bind="newticket" placeholder="Ticket (optional)"/>
<input bind="newdue" type=date label="Due date"/>
<button run="todos-ext.add" with="text={{ state.newtext }}, ticket={{ state.newticket }}, due={{ state.newdue }}" into="added" then="newtext=" emit="todos-changed" label="Add" variant=primary disabled="{{ not state.newtext }}"/>
</row>
<on event="todo-add" run="todos-ext.add" with="text={{ state.newtext }}, ticket={{ state.newticket }}, due={{ state.newdue }}" into="added" then="newtext="/>
{{#if data.added.id}}<small>{{#if data.added.merged}}<text tone=warn>{{ data.added.ref }} says the same already - merged into it.</text>{{#else}}<text tone=good>{{ data.added.ref }} created.</text>{{/if}}</small>{{/if}}
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
{{/if}}
`;
}
