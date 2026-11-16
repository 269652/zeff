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
<row gap=1 wrap=false align=center>
<button action="state" state="panel" value="{{ id }}" label="⋯" variant=quiet tip="Open the todo"/>
{{#if not closed}}
<button run="todos-ext.flag" with="id={{ id }}, flagged={{ flagged ? 'false' : 'true' }}" emit="todos-changed" label="⚑" variant="{{ flagged ? 'danger' : 'quiet' }}" tip="{{ flagged ? 'Not important' : 'Important' }}"/>
{{#if deferred}}<button run="todos-ext.defer" with="id={{ id }}, deferred=false" emit="todos-changed" label="↑" variant=quiet tip="Bring back to the top"/>{{#else}}<button run="todos-ext.defer" with="id={{ id }}, deferred=true" emit="todos-changed" label="↓" variant=quiet tip="Move down — set aside for now (comes back up when something happens, in 3 days at the latest)"/>{{/if}}
<button run="todos-ext.status" with="id={{ id }}, status=dismissed" into="st" emit="todos-changed" label="✕" variant=quiet tip="Dismiss — doesn't apply"/>
{{/if}}
</row>
</row>`;

export function todosViewTemplate(): string {
  const r = row();
  return `<state name="scope" value="open" keep=true/><state name="filter" value=""/><state name="dueedit" value=""/><state name="dueval" value=""/><state name="newtext" value=""/><state name="newdue" value=""/><state name="newticket" value=""/><state name="panel" value=""/><state name="textedit" value=""/><state name="edittext" value=""/><state name="newnote" value=""/><state name="mins" value=""/><state name="timenote" value=""/>
<data name="x" lambda="todos.screen" with="scope={{ state.scope }}, filter={{ state.filter }}" debounce="300"/>
<data name="p" lambda="todos.panel" with="id={{ state.panel }}" when="{{ state.panel }}"/>
<state name="aq" value=""/><state name="abusy" value=""/>
<data name="pick" lambda="documents.attach-list" with="q={{ state.aq }}" when="{{ state.panel }}" debounce="250"/>
<on event="attached" action="reload"/>
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
<dialog bind="panel" title="{{ data.p.ref }}" side=right wide=true>
{{#if data.p.found}}
<col gap=3>
{{#if state.textedit == data.p.id}}
<col gap=2>
<input bind="edittext" rows=3 value="{{ data.p.text }}"/>
<row gap=2>
<button run="todos-ext.text" with="id={{ data.p.id }}, text={{ state.edittext }}" then="textedit=" done="Saved." emit="todos-changed" label="Save" variant=primary disabled="{{ not state.edittext }}"/>
<button action="state" state="textedit" value="" label="Cancel"/>
</row>
</col>
{{#else}}
<row gap=2 wrap=false align=start>
<col fill=true><heading level=3>{{ data.p.text }}</heading></col>
{{#if not data.p.closed}}<button action="state" state="textedit" value="{{ data.p.id }}" then="edittext={{ data.p.text }}" label="✎" variant=quiet tip="Change the words"/>{{/if}}
</row>
{{/if}}
<row gap=2 wrap=true align=center>
<small><muted>{{ data.p.kind }}</muted></small>
{{#if data.p.ticket}}<small><mono>{{ data.p.ticket }}</mono></small>{{/if}}
{{#if data.p.due}}<small><muted>{{ data.p.due }}</muted></small>{{/if}}
{{#if data.p.waiting}}<small><muted>⏳ Waiting for others</muted></small>{{/if}}
</row>
{{#if data.p.note}}<small><muted>{{ data.p.note }}</muted></small>{{#else}}{{#if data.p.source}}<small><muted>{{ data.p.source }}</muted></small>{{/if}}{{/if}}
<row gap=2 wrap=true>
{{#if data.p.closed}}<button run="todos-ext.status" with="id={{ data.p.id }}, status=open" into="st" emit="todos-changed" label="Open again"/>{{#else}}
<button run="todos-ext.status" with="id={{ data.p.id }}, status=done" into="st" then="panel=" emit="todos-changed" label="Done" variant=primary/>
<button run="todos-ext.status" with="id={{ data.p.id }}, status=dismissed" into="st" then="panel=" emit="todos-changed" label="Dismiss — doesn't apply"/>
{{/if}}
</row>
{{#if data.p.nOps}}
<section title="Actions" aside="{{ data.p.nOps }}" open=true collapsible=true>
<col gap=2>
{{#if data.p.opsWhy}}<small><text tone=muted>{{ data.p.opsWhy }}</text></small>{{/if}}
{{#if data.p.blockedBy}}<small><text tone=warn>{{ data.p.blockedBy }}</text></small>{{/if}}
{{#each data.p.ops}}
<box>
<row gap=2 wrap=false align=start>
<col fill=true gap=1>
<b>⚡ {{ heading }}</b>
{{#if detail}}<small><muted>{{ detail }}</muted></small>{{/if}}
{{#if body}}<text pre=true>{{ body }}</text>{{/if}}
</col>
{{#if not data.p.closed}}
{{#if runnable}}<button run="todos-ext.run" with="id={{ data.p.id }}, only={{ only }}" into="ran" confirm="Zeff does it itself, no AI" emit="todos-changed" label="Run" variant=primary/>{{/if}}
<button run="todos-ext.op-remove" with="id={{ data.p.id }}, index={{ index }}" emit="todos-changed" label="✕" variant=quiet tip="Remove this action"/>
{{/if}}
</row>
</box>
{{/each}}
{{#if data.p.manyRunnable}}{{#if not data.p.closed}}<button run="todos-ext.run" with="id={{ data.p.id }}" into="ran" emit="todos-changed" label="Run all" variant=primary/>{{/if}}{{/if}}
{{#if data.ran.message}}<text tone=good>{{ data.ran.message }}</text>{{/if}}
</col>
</section>
{{/if}}
<section title="Notes" aside="{{ data.p.nNotes }}" open=true collapsible=true>
<col gap=2>
{{#each data.p.notes}}
<box>
<row gap=2 wrap=false align=start>
<col fill=true gap=1>
<small><muted>{{#if by}}{{ by }} · {{/if}}{{ when }}</muted></small>
<text pre=true>{{ text }}</text>
{{#if url}}<small><a href="{{ url }}">{{ urlLabel }} ↗</a></small>{{/if}}
</col>
{{#if mine}}<button run="todos-ext.note-remove" with="id={{ data.p.id }}, at={{ at }}" emit="todos-changed" label="✕" variant=quiet tip="Remove this note"/>{{/if}}
</row>
</box>
{{/each}}
<input bind="newnote" rows=3 placeholder="Add a note — context for the briefing, workers and agents"/>
<row gap=2>
<button run="todos-ext.note" with="id={{ data.p.id }}, text={{ state.newnote }}" into="noted" then="newnote=" emit="todos-changed" label="Save note" variant=primary disabled="{{ not state.newnote }}"/>
</row>
{{#if data.noted.message}}<small><text tone=good>{{ data.noted.message }}</text></small>{{/if}}
</col>
</section>
<section title="Time" aside="{{ data.p.totalTime }}" collapsible=true open=true>
<col gap=2>
{{#each data.p.time}}
<row gap=2 wrap=false align=baseline><b>{{ length }}</b><col fill=true><small>{{ note }}</small><small><muted>{{ by }} · {{ when }}</muted></small></col></row>
{{/each}}
<row gap=2 wrap=true align=end>
<input bind="mins" type=number placeholder="Add time you spent on this todo"/>
<col fill=true><input bind="timenote" placeholder="What was done"/></col>
<button run="todos-ext.time" with="id={{ data.p.id }}, minutes={{ state.mins }}, note={{ state.timenote }}" then="mins=" emit="todos-changed" label="Add time" disabled="{{ not state.mins }}"/>
</row>
</col>
</section>
{{#if data.p.mrs}}
<section title="Merge requests" collapsible=true open=true>
<col gap=1>{{#each data.p.mrs}}<small><a href="{{ url }}">MR {{ ref }} ↗</a> <muted>{{ title }}{{#if state}} ({{ state }}){{/if}}</muted></small>{{/each}}</col>
</section>
{{/if}}
{{#if data.p.nPlanned}}
<section title="Path" collapsible=true>
<col gap=1>{{#each data.p.planned}}{{#if path}}<small><b>{{ path }}</b></small>{{/if}}{{#each steps}}<small>→ {{ text }} <muted>({{ kind }})</muted></small>{{/each}}{{/each}}</col>
</section>
{{/if}}
<section title="Attach a document" collapsible=true>
<col gap=2>
<row gap=2 align=center>
<col fill=true><search bind="aq" placeholder="Search the documents …"/></col>
<upload bind="abusy" run="documents.add" with="todo={{ state.panel }}" multiple=true label="Upload new …" done="Attached — being read …" emit="attached"/>
</row>
<small><muted>An attached document is context for this todo.</muted></small>
{{#each data.pick.items}}
<row gap=2 align=start wrap=false>
<text>{{ icon }}</text>
<col fill=true><b>{{ title }}</b> <small><muted>{{ sizeText }}</muted></small><small><muted>{{ text }}</muted></small></col>
<button run="documents.attach" with="todo={{ state.panel }}, doc={{ id }}" done="Attached." emit="attached" label="Attach"/>
</row>
{{/each}}
{{#if data.pick.items}}{{#else}}<small><muted>{{ data.pick.count ? 'Nothing matches.' : 'No documents yet — upload one.' }}</muted></small>{{/if}}
</col>
</section>
{{#if data.p.nSources}}
<section title="Context" aside="{{ data.p.nSources }}" collapsible=true open=true>
<col gap=2>
{{#each data.p.sources}}
<box>
<small><muted>{{ label }}{{#if author}} · {{ author }}{{/if}}{{#if when}} · {{ when }}{{/if}}</muted></small>
{{#if headline}}<b>{{ headline }}</b>{{/if}}
{{#if text}}<text pre=true>{{ text }}</text>{{/if}}
</box>
{{/each}}
</col>
</section>
{{/if}}
</col>
{{#else}}
<muted>Loading …</muted>
{{/if}}
</dialog>
{{/if}}
`;
}
