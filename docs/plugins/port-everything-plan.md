# Everything but the kernel, from the database — the master plan

Goal (2026-11-15): Zeff's code is the kernel only; every app, connector and screen is a plugin kept in the database (lambdas, views, flows, stores), changeable by
the AI on a human's instruction — no rebuild. Rules: [runtime-conversion.md](runtime-conversion.md) (composed from the kit, 1:1 parity, the built-in stays until
the port is 1:1 and switched, nothing plugin-specific in the kernel). Sizes below are lines of TypeScript, counted 2026-11-15.

## What stays the kernel

`src/plugins/workspace` (69k: databases, views, flows, lambdas, pipelines — the platform), `studio` (the editor), `notebook*` (runs the plugins' functions), `lib/ext`
(plugin registry, manifests), `lib/runs`, `lib/kernel`, `lib/ai` + `llm` (the model plumbing), `accounts`, `lib/lock`, `lib/boundaries`, `lib/trust`, the CLI AI
providers (`claude-cli`, `codex-cli`, `copilot-cli`), the sync registry, the generic bank/ledger/chrome/mcp services. Everything else is to move.

## State

| Done (a switchable port in zeff-plugins) | |
|---|---|
| lookups, web-search, browser, correlations, agenda, mail-client (screens), local-ai, learn, lang-de/es | |
| keep, whatsapp, signal, teams, gitlab (readers), outlook/gmail/imap (scrapers), google-calendar, revolut, cases, finances | switch done for finances |
| jira (reader, writes through the plugin) | screens still the kernel's |

## To move, in this order (smallest and most self-contained first; each: lambdas + views + flows + stores, parity test, switch, then delete the built-in's code)

**A. Connector remnants (kernel code that belongs to a plugin)** — ≈ 8k
1. `lib/google` (1.2k) + `google-drive` plugin (1.1k): Google Calendar API way, Drive.
2. `lib/microsoft` (0.4k) + `lib/teams` (0.4k): Graph API way for mail, calendar, Teams.
3. `lib/mail` (1.4k) + `imap-mail` (1.6k) + `outlook` (1.2k) + `gmail` (1.0k): IMAP/POP3 client and the shared mail keeping.
4. `lib/gitlab` (0.8k): the API way.
5. `lib/jira` (1.7k) + `jira-lage` (1.5k): "Meine Lage", writes, context/notes, boards.
6. Finances leftovers (income refresh: done — lambda `finances.income-refresh`, flow `finances.refresh-income`, kernel read `knowledge.profile`): the todo-settle hook (a kernel hook point for plugins), the income line in the stacked chart.

**B. Small apps** — ≈ 12k
7. `zeiterfassung` + the report pages (`app/analysis`, `/`, `/month`, `/jobs`, `/projects`, `/feierabend`): time tracking.
8. `auto-actions` (DONE as `auto-actions-ext`: lambda `auto-actions.review` + flow `autoactions.review`, kernel reads in `plugins/todos/flow-actions.ts`; untested) (0.5k), `actions` (0.4k), `questions` (DONE as `questions-ext`: planning+phrasing lambda `questions.ask`, kernel `data.views`/`data.query`; untested) (1.2k), `know` (DONE as `know-ext`: summary lambda + flows `know.summarize`/`know.prepare`, kernel `brief.get`; untested) (1.1k), `knowledge`/`knowledge-hub` (1.4k).
9. `backup` (1.3k), `explorer` (1.6k), `loops` (DONE as `loops-ext`: engine lambdas + flows, kernel reads in `people/graph-actions.ts`, snapshot `lib/ext/snapshots.ts`; untested) (1.4k), `entities` (1.6k), `timeline` (1.7k + `lib/series`).

**C. Medium apps** — ≈ 20k
10. `documents` (3.6k), `calendar` (3.9k + `lib/calendar` 2.3k), `todos` (1.1k + `lib/todos` 5.5k + `components/boards` 4.9k), `work` (Code tab: `lib/work` 7.3k + components 3.2k — decide kernel or plugin).

**D. Big apps** — ≈ 17k  (News: DONE except the settings page, the stories strip and a few page extras — `news-ext`, switchable; untested)
11. `news` (7.4k), `people` (9.2k).

**E. The way it improves itself (human instructions)** — build early, it speeds everything after
- named AI tasks (capability H: DONE — `contributes.aiTasks`, rows in Settings → AI, `ai.json` task=…; editable prompt per task still open), todo action types from a plugin (I), a kernel hook for the todo-settle,
- the change flow: a human writes what to improve → the AI changes lambdas/views/flows in the database → diff and preview → the human approves → a version with rollback,
- failures handed to the AI with the code (scrapers already), plugin tests that run before a change goes live.

**J. Plugin SQL — DONE** (`sql.query` / `sql.exec`, `lib/ext/sql.ts`): set-based work over a plugin's own or adopted tables. It is what News, People, Timeline and Documents need (scoring, joins, counts over thousands of rows).

## Rhythm per plugin
Generate the port from the built-in's pure cores (`scripts/port-<name>.mts`) → parity test → switch card on the Plugins page → once it has run for a while: delete the built-in's
code, its routes and its registration, so the build shrinks. Kernel reads that a port needs are added once, generic, never named after the plugin.

## Honest size
≈ 57k lines of app code remain outside the kernel. At the pace of the finances port (one big app ≈ 5–8 sessions), the whole move is a matter of weeks of work, not one sitting.
