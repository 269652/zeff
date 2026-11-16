/**
 * Documents' screens as the plugin's views, in the view language (scripts/port-documents.mts writes them): the Documents screen (contributes.appViews →
 * views/documents.html: the scopes as tabs, search, sort, grid or list, the ticks, the document picked with its file, its text and its buttons, adding files by a
 * button or dropped on the view), the settings page (a database with an app view in the package: local folders, what waits for your confirmation, the reading, the
 * audio transcriber) and the attach panel for a todo (views/documents-attach.html). Their data are lambdas (documents.screen, documents.text, documents.settings,
 * documents.attach-list), what they do are flows (documents.add, documents.act, documents.folder, documents.browse, documents.setting, documents.attach). The
 * texts are the English ones of the built-in's screens: the language packs translate them as they do the built-in's.
 */

const STATES = `<state name="scope" value="inbox"/><state name="sort" value="newest"/><state name="layout" value="grid" keep=true/><state name="q" value=""/><state name="selected" value=""/><state name="checked" value=""/><state name="limit" value="48"/><state name="busy" value=""/><state name="full" value=""/>
<data name="docs" lambda="documents.screen" with="scope={{ state.scope }}, q={{ state.q }}, sort={{ state.sort }}, limit={{ state.limit }}, selected={{ state.selected }}, checked={{ state.checked }}" debounce=250/>
<data name="doc" lambda="documents.text" with="id={{ state.selected }}, chars={{ state.full ? 0 : 6000 }}" when="{{ state.selected }}"/>
<on event="docs-changed" action="reload"/>
<on event="find" action="state" state="scope" value="all"/>
{{#if data.docs.picked}}<on event="doc-open" action="url" href="{{ data.docs.picked.fileUrl }}"/>{{/if}}`;

const BADGES = `{{#if status == 'failed'}}<badge color=red>failed</badge>{{#else}}{{#if status == 'queued' or status == 'extracting'}}<badge color=blue>reading …</badge>{{#else}}{{#if status == 'unsupported'}}<badge color=yellow>not readable</badge>{{#else}}{{#if compiled}}<badge color=green>✓ compiled</badge>{{/if}}{{/if}}{{/if}}{{/if}}`;
const NAME = `{{#if unread}}<b>{{ title | truncate(80) }}</b>{{#else}}{{ title | truncate(80) }}{{/if}}`;
const THUMB = `{{#if isImage}}<img src="{{ fileUrl }}" alt="{{ title }}" h=140 fit=cover/>{{#else}}<box tone=muted><col gap=1 align=center><heading level=1>{{ icon }}</heading><small><muted>{{ ending }}</muted></small></col></box>{{/if}}`;
const fact = (label: string, value: string) => `<row gap=3><muted>${label}</muted><small>${value}</small></row>`;

const mark = (op: string, ids: string, label: string, extra = "") => `<button run="documents.act" with="op=${op}, ids=${ids}" emit="docs-changed" ${extra} label="${label}"/>`;

export function documentsScreenTemplate(): string {
  const s = `${STATES}

{{#if data.docs.scopeOptions}}<tabs bind="scope" options="{{ data.docs.scopeOptions }}"/>{{/if}}

<row gap=2>
<upload bind="busy" run="documents.add" multiple=true zone=view label="+ Add files" done="Added." emit="docs-changed"/>
{{#if data.docs.checkedCount}}
<b>{{ data.docs.checkedCount }} selected</b>
${mark("read", "{{ state.checked }}", "✓ Mark read", 'then="checked="')}
${mark("unread", "{{ state.checked }}", "● Mark unread", 'then="checked="')}
${mark("delete", "{{ state.checked }}", "🗑 Delete", 'then="checked=" variant=danger confirm="Delete the selected documents for good?"')}
<button action="state" state="checked" value="" label="Clear" variant=quiet/>
{{#else}}
<search bind="q" placeholder="Search documents …"/>
<select bind="sort" options="newest:Newest first, oldest:Oldest first, unread:Unread first, name:Name, size:Largest first"/>
<grow/>
{{#if data.docs.markAll}}${mark("read", "{{ data.docs.unreadIds | join(',') }}", "✓ Mark all read")}{{/if}}
<tabs bind="layout" options="grid:▦, list:☰"/>
{{/if}}
</row>
{{#if state.busy}}<small><muted>Working …</muted></small>{{/if}}
{{#if data.docs.reading.now}}<row gap=2 align=center><small><muted>Reading: {{ data.docs.reading.now }} now, {{ data.docs.reading.waiting }} waiting</muted></small>${mark("restart", "", "Restart reading", 'variant=quiet')}</row>{{#else}}{{#if data.docs.reading.waiting}}<row gap=2 align=center><small><muted>{{ data.docs.reading.waiting }} waiting — nothing is being read right now.</muted></small>${mark("restart", "", "Start reading", 'variant=quiet')}</row>{{/if}}{{/if}}
{{#if data.docs.heldCount}}<callout tone=warn><row gap=2 align=center><text>{{ data.docs.heldCount }} documents from your folders wait for your confirmation — the AI reads, compiles and looks at them only then.</text><grow/>${mark("approve", "{{ data.docs.heldIds | join(',') }}", "Confirm all")}</row></callout>{{/if}}

<grid cols="{{ data.docs.picked ? 2 : 1 }}" gap=4 min=320>
<col gap=3>
{{#if data.docs.count}}
{{#if state.layout == 'list'}}
<col gap=1>
{{#each data.docs.items}}
<row gap=2 wrap=false>
<check bind="checked" value="{{ id }}"/>
<dot color="{{ unread ? '#4f46e5' : '#0000' }}"/>
<box action="state" state="selected" value="{{ id }}">
<row gap=2 wrap=false>{{ icon }} ${NAME}<grow/>{{#if from}}<muted>{{ from }}</muted>{{/if}}${BADGES}<muted>{{ sizeText }}</muted><muted>{{ day }}</muted></row>
</box>
</row>
{{/each}}
</col>
{{#else}}
<grid cols=4 gap=3 min=200>
{{#each data.docs.items}}
<col gap=1>
<row gap=2><check bind="checked" value="{{ id }}"/><grow/>{{#if unread}}<dot color="#4f46e5"/>{{/if}}</row>
<box action="state" state="selected" value="{{ id }}" tip="{{ tip }}">
<col gap=2>
${THUMB}
<clamp lines=2>${NAME}</clamp>
<small><muted>{{ sizeText }} · {{ day }}</muted></small>
{{#if from}}<small><muted>✉ {{ from }}</muted></small>{{/if}}
{{#if localShown}}<small><muted>📁 {{ localShown }}{{#if localMissing}} · deleted in the folder{{/if}}</muted></small>{{/if}}
<row>${BADGES}{{#if held}}<badge color=yellow>waits for your confirmation</badge>{{/if}}</row>
</col>
</box>
</col>
{{/each}}
</grid>
{{/if}}
{{#if data.docs.hasMore}}<row gap=2 justify=center><button action="state" state="limit" value="{{ data.docs.nextLimit }}" label="More"/></row>{{/if}}
{{#else}}
<box tone=muted>
<heading level=1>{{ data.docs.emptyIcon }}</heading>
<text>{{ data.docs.emptyText }}</text>
<small><muted>Drop files here to add them.</muted></small>
</box>
{{/if}}
</col>
{{#if data.docs.picked}}
<box>
<col gap=3>
<row gap=2 align=start><b>{{ data.docs.picked.title }}</b><grow/><button action="state" state="selected" value="" label="✕" variant=quiet/></row>
{{#if data.docs.picked.isPdf}}<media src="{{ data.docs.picked.fileUrl }}" kind=pdf h=520 label="{{ data.docs.picked.title }}"/>
{{#else}}{{#if data.docs.picked.isImage}}<img src="{{ data.docs.picked.fileUrl }}" alt="{{ data.docs.picked.title }}" fit=contain/>
{{#else}}{{#if data.docs.picked.isAudio}}<media src="{{ data.docs.picked.fileUrl }}" kind=audio label="{{ data.docs.picked.title }}"/>
{{#else}}<box tone=muted><col gap=1 align=center><heading level=1>{{ data.docs.picked.icon }}</heading><small><muted>{{ data.docs.picked.ending }}</muted></small></col></box>{{/if}}{{/if}}{{/if}}
<row gap=2>
<button run="documents.act" with="op=read, ids={{ data.docs.picked.id }}" emit="doc-open" label="Open"/>
<a href="{{ data.docs.picked.fileUrl }}&download=1">Download</a>
{{#if data.docs.picked.unread}}${mark("read", "{{ data.docs.picked.id }}", "✓ Mark read")}{{#else}}${mark("unread", "{{ data.docs.picked.id }}", "● Mark unread")}{{/if}}
{{#if data.docs.picked.held}}${mark("approve", "{{ data.docs.picked.id }}", "Confirm")}{{/if}}
{{#if data.docs.picked.status == 'failed' or data.docs.picked.status == 'unsupported'}}${mark("reread", "{{ data.docs.picked.id }}", "Read again")}{{/if}}
{{#if data.docs.picked.status == 'queued' or data.docs.picked.status == 'extracting'}}${mark("skip", "{{ data.docs.picked.id }}", "Skip")}{{/if}}
${mark("delete", "{{ data.docs.picked.id }}", "🗑", 'then="selected=" variant=danger confirm="Delete this document for good?"')}
</row>
<col gap=1>
${fact("Type", "{{ data.docs.picked.kindLabel }}")}
${fact("Size", "{{ data.docs.picked.sizeText }}")}
${fact("Added", "{{ data.docs.picked.added }}")}
{{#if data.docs.picked.fromFull}}${fact("From", "{{ data.docs.picked.fromFull }}")}{{/if}}
{{#if data.docs.picked.localShown}}${fact("Folder", "{{ data.docs.picked.localShown }}")}{{/if}}
${fact("State", "{{ data.docs.picked.stateText }}")}
</col>
{{#if data.docs.picked.error}}<text tone=bad>{{ data.docs.picked.error }}</text>{{/if}}
{{#if data.doc.found}}
<col gap=2>
{{#if data.doc.summary}}<b>Summary</b><text>{{ data.doc.summary }}</text>{{/if}}
{{#if data.doc.text}}<b>Text</b><text pre=true>{{ data.doc.text }}</text>{{#if data.doc.more}}<button action="state" state="full" value="1" label="Show all" variant=quiet/>{{/if}}{{/if}}
</col>
{{/if}}
{{#if data.docs.picked.concepts}}<row gap=1 wrap=true>{{#each data.docs.picked.concepts}}<button action="state" state="q" value="{{ this }}" emit="find" label="{{ this }}" variant=quiet/>{{/each}}</row>{{/if}}
</col>
</box>
{{/if}}
</grid>`;
  return s;
}

/** The settings page: what the built-in's Settings → Documents has — the local folders, those waiting for you, the reading, the transcriber. */
export function documentsSettingsTemplate(): string {
  return `<state name="s_path" value=""/><state name="s_mode" value="confirm"/><state name="browsing" value=""/><state name="t_cmd" value=""/><state name="t_auto" value=""/>
<data name="s" lambda="documents.settings"/>
<on event="settings-changed" action="reload"/>
{{#if not data.s}}<muted>Loading …</muted>{{#else}}
<box title="Local folders">
<col gap=3>
<text tone=muted>Zeff reads in every document from these folders by itself (subfolders too) — new and changed files on each run, a deleted file stays as a document. “Automatically”: the AI reads, compiles and looks at the documents by itself. “Wait for my confirmation”: nothing with the AI happens until you confirm them.</text>
{{#each data.s.folders}}
<row gap=2 align=center>
<col fill=true><b>📁 {{ path }}</b><small><muted>{{ status }}</muted></small></col>
<button run="documents.folder" with="op=mode, id={{ id }}, mode=confirm" emit="settings-changed" label="Wait for my confirmation" variant="{{ mode == 'confirm' ? 'primary' : 'plain' }}"/>
<button run="documents.folder" with="op=mode, id={{ id }}, mode=auto" emit="settings-changed" label="Automatically" variant="{{ mode == 'auto' ? 'primary' : 'plain' }}"/>
<button run="documents.folder" with="op=remove, id={{ id }}" emit="settings-changed" label="Remove" variant=danger confirm="No longer read this folder? Its documents stay."/>
</row>
{{/each}}
<row gap=2 align=center>
<small><muted>New folder:</muted></small>
<button action="state" state="s_mode" value="confirm" label="Wait for my confirmation" variant="{{ state.s_mode == 'confirm' ? 'primary' : 'plain' }}"/>
<button action="state" state="s_mode" value="auto" label="Automatically" variant="{{ state.s_mode == 'auto' ? 'primary' : 'plain' }}"/>
<button run="documents.browse" with="path=" into="browse" then="browsing=1" label="Choose a folder …" variant=primary/>
{{#if data.s.folders}}<button run="documents.folders" done="Folders read in." emit="settings-changed" label="Read in now"/>{{/if}}
</row>
<row gap=2 wrap=false><col fill=true><input bind="s_path" label="or paste a path, e.g. C:\\Users\\me\\Documents\\Rechnungen"/></col><button run="documents.folder" with="op=add, path={{ state.s_path }}, mode={{ state.s_mode }}" then="s_path=" emit="settings-changed" label="Add" disabled="{{ not state.s_path }}"/></row>
</col>
</box>
<dialog bind="browsing" title="Choose a folder">
<col gap=2>
<row gap=2 align=center>
<button run="documents.browse" with="path={{ data.browse.parent }}" into="browse" label="↑ {{ data.browse.parent ? 'Up' : 'Drives' }}"/>
<small><muted>{{ data.browse.path ? data.browse.path : 'This computer' }}</muted></small>
</row>
{{#if data.browse.path}}<button run="documents.folder" with="op=add, path={{ data.browse.path }}, mode={{ state.s_mode }}" then="browsing=" emit="settings-changed" label="Add this folder" variant=primary/>{{/if}}
{{#each data.browse.dirs}}<button run="documents.browse" with="path={{ path }}" into="browse" label="📁 {{ name }}" variant=quiet/>{{/each}}
</col>
</dialog>
{{#if data.s.pending}}
<box title="Waiting for your confirmation">
<col gap=2>
<text tone=muted>The text of these is read where that needs no AI; nothing else happens with them until you confirm.</text>
{{#each data.s.pending}}<row gap=2 align=center><col fill=true><text>{{ name }}</text></col><button run="documents.act" with="op=approve, ids={{ id }}" emit="settings-changed" label="Confirm"/></row>{{/each}}
</col>
</box>
{{/if}}
<box title="Reading">
<row gap=2 align=center>
<col fill=true><text>{{ data.s.reading.now }} being read now, {{ data.s.reading.waiting }} waiting.</text></col>
<button run="documents.act" with="op=restart" done="Reading restarted." emit="settings-changed" label="Restart reading"/>
</row>
</box>
<box title="Audio transcriber">
<col gap=3>
<text tone=muted>Audio is turned into text by a command you set — Zeff installs nothing. {file} is the recording, {dir} a folder for its output (it takes the .txt written there, else what the command prints). For example whisper "{file}" --model small --output_format txt --output_dir "{dir}"</text>
<row gap=2 wrap=false><col fill=true><input bind="t_cmd" label="Audio transcriber" value="{{ data.s.transcriber }}"/></col></row>
<row gap=2 align=center>
<button action="state" state="t_auto" value="true" label="Install Poppler by itself when a scanned or complex PDF needs it" variant="{{ (state.t_auto ? state.t_auto == 'true' : data.s.autoInstall) ? 'primary' : 'plain' }}"/>
<button action="state" state="t_auto" value="false" label="Not by itself" variant="{{ (state.t_auto ? state.t_auto == 'true' : data.s.autoInstall) ? 'plain' : 'primary' }}"/>
<button run="documents.setting" with="transcriber={{ state.t_cmd == '' ? data.s.transcriber : state.t_cmd }}, autoInstall={{ state.t_auto ? state.t_auto : data.s.autoInstall }}" done="Saved." emit="settings-changed" label="Save" variant=primary/>
</row>
</col>
</box>
{{/if}}`;
}

/** The attach panel for a todo (a block to put under a todo: state.todo = the todo's id): the documents to pick from, with their abstracts; new files attached at once. */
export function documentsAttachTemplate(): string {
  return `<state name="todo" value=""/><state name="aq" value=""/><state name="busy" value=""/>
<data name="pick" lambda="documents.attach-list" with="q={{ state.aq }}" debounce=250/>
<on event="attached" action="reload"/>
<col gap=2>
<row gap=2 align=center>
<col fill=true><search bind="aq" placeholder="Search the documents …"/></col>
<upload bind="busy" run="documents.add" with="todo={{ state.todo }}" multiple=true zone=view label="Upload new …" done="Attached — being read …" emit="attached"/>
</row>
<small><muted>…or drop files on this panel. An attached document is context for this todo.</muted></small>
{{#if data.pick.items}}
{{#each data.pick.items}}
<row gap=2 align=start wrap=false>
<text>{{ icon }}</text>
<col fill=true><b>{{ title }}</b> <small><muted>{{ sizeText }}</muted></small><small><muted>{{ text }}</muted></small></col>
<button run="documents.attach" with="todo={{ state.todo }}, doc={{ id }}" done="Attached." emit="attached" label="Attach"/>
</row>
{{/each}}
{{#else}}
<small><muted>{{ data.pick.count ? 'Nothing matches.' : 'No documents yet — upload one.' }}</muted></small>
{{/if}}
</col>`;
}
