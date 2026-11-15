# Jira's port — the plan

Decided 2026-11-14: nothing plugin-specific stays in the kernel (see [runtime-conversion.md](runtime-conversion.md), capability D).
Jira is the biggest of the connectors, because it is not a scraper but the base of other things.

## What Jira is today (measured)

- **A client of an external MCP server** (`mcp-atlassian`, set by `JIRA_MCP_COMMAND` or `.mcp.json`) — not the automation Chrome. About 20
  tools are called: `jira_search`, `jira_get_board_issues`, `jira_get_agile_boards`, `jira_get_issue`, `jira_get_transitions`,
  `jira_transition_issue`, `jira_update_issue`, `jira_create_issue`, `jira_create_issue_link`, `jira_add_comment`, `jira_edit_comment`.
- **`src/lib/jira/` (1,550 lines):** `sync.ts` (config + the three reads), `normalize.ts` (issue → ticket), `store.ts` (535: upserts, boards,
  booked tickets, mine flags), `boards.ts`, `comments.ts`, `context-sync.ts` / `note-sync.ts` (Zeff's context and notes written into
  Jira comments), `mcp-client.ts` (the stdio MCP client).
- **`src/plugins/jira/` (800)** — actions (transition, assign, comment, create), the Jira app in the Workspace, settings; **`jira-lage/` (1,200)** —
  the board view "Meine Lage", picking tickets, assigning.
- **86 files outside** import `lib/jira/*`; **~30 read the table `jira_tickets`** (todos, entities, timeline, loops, knowledge, people, news,
  search, RAG, the Workspace pipeline …). Jira's tickets are shared data, like the bank's bookings.
- **`lib/jira/mcp-client.ts` is not Jira's:** 26 other files (mail, Teams, GitLab, Keep, Signal, calendar, the drivers …) use it as *the*
  stdio MCP client. It only carries Jira's name.

## The line

| Stays in the kernel (generic) | Moves into the plugin `jira-ext` |
|---|---|
| the stdio MCP client (renamed `lib/mcp/stdio.ts`) | which server, which tool, the JQL, the fields |
| the tables `jira_tickets`, `jira_boards`, `jira_comments` as **shared data** (adopted stores, like `bank_transactions`) | reading: search, board issues, boards, titles of booked tickets |
| a generic action to call an MCP server's tool (`mcp.call`: command from settings, allowed per flow) | normalising an issue, planning the upsert (pure core, as `cases` did) |
| `driver.call`, `db.mirror`, `login.notice`, `workspace.after-sync` (done) | the writes: transition, assign, comment, create, link, edit comment |
| | context / notes into Jira comments |
| | "Meine Lage" and the Jira app screens (view language) |

## Where it stands (stages 1–3 done, 2026-11-14)

- **1 ✅** the stdio MCP client is the kernel's: `lib/mcp/stdio.ts` (`lib/jira/mcp-client.ts` keeps `jiraDown`, `jiraNotFoundHint` and a re-export).
- **2 ✅ — simpler than planned:** no `mcp.call` action and no adopted tables. A **driver lambda starts the MCP server itself** and reads in one
  session (the kernel gives drivers `zeff:automation/mcp-client` and `context.resolveCommand`), so the cold start is paid once; the
  tickets are kept by the kernel's `jira.keep` (the built-in's own `keepJiraRead`), which stays the one place that writes `jira_tickets`.
- **3 ✅** `plugins/jira-ext` (`scripts/port-jira.mts`): the reader `jira.driver` + the flow `jira.sync`; the switch carries the server's
  command, environment (the token, straight into encrypted settings) and JQL over. Untested: a parity run against `syncFromJira`.
- **4 ✅ writing** (transition, assign, comment, create + link; the board's suggestions; "assign to me" in Meine Lage) — the driver tool `ops`,
  asked through `lib/jira/port-ops.ts` while the plugin is on; otherwise the built-in's own sessions.
- **5 ✅ context and notes into Jira comments** — the driver tool `calls` (attach / post / edit / upsert): a batch of context items in ONE session;
  a note is one short session per call. Divergence to know: in the batch a failed attachment doesn't stop its item's comment from being posted.
- **Boards sync ✅** — the driver tool `boards` (the stage-3 read had left it out).
- **Reads of the runs, the recap, the board briefing and the people accounts ✅** — through a **driver session** (`lambdas/session.ts`, the actions
  `session.next` / `session.reply`): Zeff's code calls `call(tool, args)` one after another against the Jira MCP server the plugin's driver keeps open
  (started once), so those sites kept their code and only swapped `runStdioSession` for `runJiraSession` (`lib/jira/port-ops.ts`). They still read
  the search tool, fields and address from the built-in's config (environment / .mcp.json).
- **Open (old note, now partly done):** reads of the run and briefing code (`lib/runs/collect.ts`, `recap.ts`, `jira-lage/board-lage.ts`, `people/accounts.ts` still open their own
  MCP session), 6 (screens: the Jira app, "Meine Lage"), 7 (clean-up: `lib/jira/{sync,boards,comments,*-sync}.ts` go with the built-in).
  None of it has been run against a real Jira.

## Stages (each leaves Zeff working and switchable)

1. **Rename the MCP client** to the kernel's own (`lib/mcp/stdio.ts`, a mechanical change in 32 imports; `lib/jira/mcp-client.ts` stays a re-export
   until the end). No behaviour change.
2. **Kernel pieces:** (a) `mcp.call` action — one tool of a stdio MCP server, the server from the plugin's settings (command, args, env, env file
   — encrypted), allowed by a flow permission `mcp: ["jira"]`; (b) `jira_*` tables adoptable by `jira-ext` (`ADOPTABLE`), as `cases` did.
3. **Reading (the sync):** the pure core `normalize` + `plan upsert` bundled into lambdas (`scripts/port-jira.mts`, like `port-cases`); the flow
   `jira.sync` (a step of the Sync menu, in the built-in's place): config → search mine → board issues per enabled board (paged) → merge →
   `store.put` into `jira_tickets` → mark inactive / mine / board membership → titles for booked tickets. Same unread-board rule (nothing deactivated
   when a board wasn't read to the end). Parity test against `syncFromJira` with the same issues.
4. **Writing:** the todo actions (transition, assign, comment, create + link) become flows/lambdas calling `mcp.call`; `plugins/jira/run.ts`
   asks the port while it is on (as `runDriver` does for the scrapers).
5. **Context and notes into Jira** (`context-sync`, `note-sync`): the same, as a flow on the Zeff side with the kernel's reads.
6. **Screens:** the Jira app and "Meine Lage" (`jira-lage`, which stays its own plugin that depends on Jira) in the view language; `jira-lage` reads
   tickets through the kernel's table, not `lib/jira/*`.
7. **Switch + clean-up:** *Switch to the plugin*; when the built-in goes, `lib/jira/{sync,normalize,boards,comments,*-sync}.ts` go with it; only the
   shared tables (and their readers) stay.

## Risks and decisions for you

- **The 30 readers of `jira_tickets` keep working** — the table stays as shared data; only who writes it changes. Decide: keep the table
  names (`jira_tickets` …) — recommended — or rename (breaks every reader, no gain).
- **The MCP server's secrets** (token, URL) move from `.env.local` / `.mcp.json` into the plugin's encrypted settings at the switch (you type them
  in again, or they are read from where they are once and encrypted). Zeff never asks for them in chat.
- **`mcp.call` runs a program** (the MCP server) on this computer: the plugin needs `exec`, like the scrapers; the flow's `mcp` permission names the
  server. The AI could mend the reading — and so also change what program starts: the settings (command) are yours, not the lambda's.
- **Size:** ~3,000 lines move or are rewritten; stages 1–3 (reading) are the ones that matter first and can ship alone.
- **Tests:** parity tests for stage 3 and 4 (same issues in → same tickets out; same transition out) — currently skipped by your request; they
  are the way to know the port is 1:1, so say when to run them.
