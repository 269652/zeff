# What is left to move out of the kernel (2026-11-15, after News)

Done as switchable plugins (zeff-plugins): lookups, web-search, browser, correlations, agenda, mail-client, local-ai, learn, lang-de/es, keep, whatsapp, signal, teams, gitlab,
outlook/gmail/imap (scrapers), google-calendar, revolut, cases, finances, jira (reader/writes), **auto-actions, questions, know, loops, news** (news: all but a few page extras).
New kernel capabilities on the way: AI tasks from plugins (H), plugin SQL (J), kernel snapshots of a lambda's answer, the todo/people/messages reads.

## What stays the kernel (decided)

The platform and the **shared entity graph**, which every app reads and none owns:
- workspace, studio, notebook*, lib/ext, runs, accounts, lock, boundaries, trust, ai/llm + the AI CLIs, the sync registry, the generic bank/ledger/chrome/mcp services;
- **the entity graph**: people (the contacts, their details, the promises read from messages), entities (organisations, projects, places), timeline (the event log and its refs) — the loops, the know brief,
  the questions' views, the correlations and the search all read them (`people/graph-actions.ts`, `know/flow-actions.ts`, `timeline.events-for` …). Their *screens* and *AI steps* can be plugins; the data model is not;
- the todo engine (todos, ops, the settle hooks) and its action catalogue (`actions`), the work engine (workers, runs), time tracking's core (jobs, projects, bookings), backup.

## Still to move (each a package + lambdas + flows + views over kernel reads, like News)

| Plugin | Lines | What moves | What it needs first |
|---|---|---|---|
| documents | 3.6k | **done in `documents-ext`:** the AI steps, local folders, reading, search, the screen (view language: grid/list, PDF/picture frame, ticks, uploads by `<upload run>`), the settings page (folders, folder browser, confirmation, transcriber), the abstracts (`documents.abstracts`), the attach panel (`views/documents-attach.html`). **left:** the file route `/api/documents/:id/file`, the badge and the attach panel *inside* the todo screens, the document inbox databases (Workspace source), skip/restart that stop a run in flight | the todo screens' port (to embed the attach panel and show the badge), a generic file route |
| documents | 3.6k | file reading, abstracts, search, todo relations | kernel reads for files and text extraction |
| calendar | 3.9k (+2.3k lib) | the calendar app, meetings, entries | the calendar model (IR) as kernel reads |
| jira-lage | 1.5k | "Meine Lage" | the Jira kernel reads |
| knowledge (+hub) | 1.4k | Confluence client, export, graph | a connection kind (token) for plugins |
| knowledge (+hub) | ✅ 1.4k | **done as `knowledge-ext`** (chat, state, sync/add, the matching to todos; connection and export stay the kernel's: `service.read`/`service.send`, `todos.attached`/`todos.attach`) | the todo panel and the repos' systems still move |
| google-drive | 1.1k | Drive sync | OAuth for plugins (secrets, routes) |
| explorer | 1.6k | file browser | kernel fs reads, UI in the view language |
| news (rest) | ✅ | **done** (slice 8: kit `<stories>`, `<speak>`, `<visible>`, `<grid masonry>`; topic chips, Today's line, widget, kept-items source, settings catalog) — left: the kernel pieces named in runtime-conversion.md (tables, `/news` route, settings link, prompt catalog) | — |
| people (screens + AI) | 9.2k | **AI steps done** (slice 1) and **the screens done** (slice 2: the overview, a person's page, the widgets, the review sources, badges, series; the built-in screens are removed: Zeff has no overview or person page of its own, the plugin's are put in the people database when it is on) — formulas and identity proposals stay the kernel's by design | see runtime-conversion.md, People slice 2 |
| news (rest) | ~0.8k | stories strip, masonry, topic chips, Today's news, the kept items' database | kit elements (stories, masonry) |
| todos / work / zeiterfassung (screens) | 20k+ | the boards, the Code tab, the reports | the largest: after the others. **zeiterfassung: week, month, analysis, end of day, jobs/projects and settings done as `zeiterfassung-ext`** (kernel reads/writes `time.*`) — left: the booking systems' slots (Chrono/Punch marks), a few details of the week (drag and drop, todo context, add context), see runtime-conversion.md |

## Rhythm
Each: read it, write the kernel reads it needs (generic, never plugin-named), a generator `scripts/port-<name>.mts`, run the lambdas **for real against a copy of the database** (the harness that found the
bugs of the last round: packages need an `id` and a `version`, flows say `input.x` not `env.input.x`, a manifest description is at most 300 characters, a lambda only reads), switch, then delete the built-in's code.
