# Performance: show the last answer at once, update behind it

Goal: a page of Zeff shows what it showed last at once and updates itself in the background (stale-while-revalidate) — never a
waterfall where each step waits for the one before. Nothing here knows any plugin; Learn is only the case we measured first.

## What was slow (measured before)

Measured in `next dev` on a copy of the data (so cold numbers include compiling; the warm numbers are the honest ones), Learn as the case.

| What | Before |
| --- | --- |
| `/learn` (reads the plugin's status, then redirects to the Courses page) | 1.4 s – 2.4 s per visit, every visit |
| `<data>` of a page = server actions | one browser's server actions run **one after the other**: `pendingAsksAction` waited 2.2 s behind `syncOverviewAction` (3–9 s, it computes every source's health) |
| first flow after a server start (`learn.courses`) | 2.3 – 5.3 s (loading the flow engine, lambda runner, plugin scan) |
| the flows themselves, warm | `learn.courses` 130–210 ms, `learn.map` 250–380 ms, `learn.progress` ~350 ms, `learn.lesson` 30–130 ms, `learn.dashboard` 200–250 ms |
| a `<data>` depending on another (`cardchat` needs `progress.dueCards`) | a real dependency: it can't start earlier |

So the time was not in the flows but around them: the status read on every `/learn`, the shell's slow sync-menu action blocking
the queue of server actions, the cold start, and a first view in a fresh browser with nothing kept.

## What is cached or parallel now

1. **`<data>` through a route, not a server action** — `POST /api/workspace/data` (src/app/api/workspace/data/route.ts). Requests to a
   route run side by side, so the `<data>` of a page no longer queue behind each other or behind the shell's actions. Same checks,
   same answer shape; if the route can't be reached the old server action runs (ui/view-flows.tsx `askData`).
2. **Last known answer, kept by the server** — `src/lib/data-cache.ts` (`answerKey`, `peekAnswer`, `rememberAnswer`): every finished
   flow / lambda answer is kept per account in memory and in the account's database (table `data_cache`, survives a restart). Where a
   browser has kept nothing (new browser, new device, cleared storage) a `<data>` asks `peek` (≈ 50 ms, nothing computed) at the same
   time as the real run and shows the kept answer (`data.x_status` = `stale`) until the fresh one replaces it. Where the browser has
   its own copy (localStorage, as before) that shows first. A kept answer is never trusted: the fresh run always follows, so after
   your own changes you never keep seeing old data for longer than the run takes. `do` sources (they may change things) are never kept.
3. **One run per thing at a time** — the same flow with the same inputs asked twice at once is computed once (`inflight`).
4. **Slow reads: stale-while-revalidate** — `swr(key, ttl, load)` in the same file: the last value at once, a newer one loaded behind
   it. Used for Learn's status on `/learn` (`learn:status`, 30 s; after the setup click it is read fresh) and for the sync menu's
   source health (`sourceHealth({ stale: true })`), which no longer holds up the shell's actions.
5. **Warm-up at server start** — instrumentation.ts loads the flow engine, lambda runner, the workspace actions and scans the plugins
   (per account) 1.5 s after the start, in the background, so the first page doesn't pay for it.
6. **Quiet sign that it reloads** — a view whose `<data>` shows a kept answer gets a 2 px line at its top edge (absolute, no layout
   shift, off for reduced motion and print).

## After

Same machine, same copy of the data, warm:

| What | Before | After |
| --- | --- | --- |
| `/learn` | 1.4 – 2.4 s | 0.15 – 0.17 s (first visit after a start ≈ 0.5 s) |
| kept answer of a `<data>` (new browser) | none — empty until the flow ran (0.15–0.4 s + queue) | ≈ 50 ms (`peek`) |
| `<data>` of a page | queued one behind the other | side by side (two POSTs seen in parallel on the Courses page) |
| shell's sync-menu action | 3 – 9 s, blocked the queue | not in the way of the `<data>` any more; health from the last read |

The flows' own run time (30 – 380 ms warm) is unchanged; what changed is how long the page waits for them.

## Answers per input: switching tabs (`<data>` in the browser)

A `<data>` keeps every answer per **page, source and resolved inputs** (src/plugins/workspace/ui/data-kept.ts: in memory for the
session — no size limit, 80 answers — and in localStorage as before, now keyed by the parsed inputs). What templates see:

| | |
| --- | --- |
| inputs seen before (Done → Open → Done) | the kept answer at once (`data.x_status` = `stale`), the fresh one replaces it |
| new inputs, nothing kept | `data.x` empty, `data.x_loading` true — never the answer for the other inputs; the server's kept answer (`peek`) if it has one |
| `{{#if data.x…}}…{{#else}}…{{/if}}`, `{{#each data.x…}}` while `x_loading` | the kit's loader (LoadingScreen, block size) in their place — by itself; `<loading/>` to place one |
| `data.x_last` | the last answer whatever it was asked with — for counts and headings that may show the one before meanwhile (a condition that reads `x_last` / `x_loading` decides by itself) |
| `hold="filter, chips, limit"` | when only these inputs change, the answer on screen stays while the new one loads (a search narrowing, "Show more"); a text typed on or taken back by a few letters counts as held by itself |
| `preload="scope=open\|done\|worker"` | once the current answer is in, the other values' answers are asked quietly (idle time, one at a time for the page, not while the tab is hidden, each at most every 30 s, through the same coalescing) — the first switch shows at once |

Rows keep their DOM across a newer answer: an `{{#each}}` item with an `id` (else `key`, `name`, `label`, `group`) is keyed by it,
the other blocks of a level by tag + look/tone + how many came before (card-template.tsx `siblingKeys`) — a callout shown above a
list doesn't redraw it. Measured on a test server (`next dev`, Todos with e2e/todos-parity-seed.mts, in-page per animation frame):

| Switch | Before | After |
| --- | --- | --- |
| Open → Done, first time | the open list's shape: Done empty, no indicator, ~0.7 s | loader in the first frame, the list at ~0.7 s; after the idle preload (~3 s on the page): the list in the first frame (35 ms) |
| Done again / Open again | reloaded from scratch | kept list in the first frame (32–85 ms Done, 110–280 ms Open — dev-mode render of the view), refreshed behind |
| a todo ticked | the list below a new callout drawn anew | the other rows keep their DOM nodes (5 of 5), no loader |
| Report Week ↔ Month (scripts/parity-seed-time.mts) | — | first Week: loader, content at ~0.66 s; then each switch shows the kept view in the first frame (~0.2 s) |

## Measuring

- `ZEFF_PERF=1` — every flow / lambda run of a view logs `[perf] flow learn.courses 130ms` (src/plugins/workspace/perf.ts).
- `scripts/perf-flows.mts` — runs flows three times and prints the time of each run:
  `PERF_ACCOUNT=privat npx tsx scripts/perf-flows.mts "learn.courses n=0, learn.map course=Französisch von A1 bis B2"`
  (set `DATABASE_PATH` and `ZEFF_PLUGINS_DIR` to a **copy** of the data).

## Still slow / next

- The very first flow of a lambda-backed screen after a start (a lambda starts a Node process, 100 – 300 ms; the module load part is warmed up now).
- `learn.map` and `learn.progress` recompute everything on each fresh run (they are 16 – 27 KB of output); materialising them in a
  table that the writes keep up to date would make the fresh run itself cheap. Needs a generic "this flow reads these databases"
  declaration for invalidation — not done.
- A `<data>` that needs another's answer (`cardchat` after `progress`) stays sequential by nature.
- Other plugin screens (Todos, Time tracking, Work sessions, People, Documents) get the route, the kept answers and the status line
  automatically where they use `<data>`; screens that load by server actions of their own (not `<data>`) are not touched yet.
- Prefetch of the next pages and bundle size (dev mode hides them) were not measured; measure on `next build` before touching them.

## Compiling (`next dev`)

The pages are only as quick as the dev server compiles them. Measured with `node scripts/perf-dev.mjs` (a disposable test server
— scripts/test-server.mjs — cold, its own dist dir removed first; headless Chrome; the API routes the pages call; an edit and the
recompile; the server's memory and what it wrote; `--trace` for Turbopack's own trace, `--warm-cache` for a restart).

What made it slow, and what keeps it fast:

1. **Dynamic imports on the server.** The server code has ~3 400 `await import()`. Turbopack makes each of them a chunk group, and
   by default (in `next dev`) a group carries *everything* its import reaches — also what the page loading it already has. As Zeff
   grew this got quadratic: 1.4 GB of server chunks for eight pages, the instrumentation alone ~52 000 copies of ~1 900 modules.
   `experimental.turbopackServerSideNestedAsyncChunking` (next.config.ts) makes a group carry only what isn't loaded yet.
2. **An entry that loads nothing statically.** Nested chunking only helps when the entry (a page, a route handler, the
   instrumentation) already has most of Zeff: an entry of a few modules with a dozen sibling `await import()`s of big subgraphs
   still costs one chunk group per path. Pages have the root layout (≈1 200 modules statically). The instrumentation imports its
   parts statically from one file (instrumentation-node.ts); route handlers that reach all of Zeff import `@/plugins/contributions`
   statically (search: 20 s → 4 s). **A new route handler or start step that reaches the plugins: do the same.** Check with
   perf-dev: an entry whose cold compile is far above its neighbours' is usually this.
3. **Big server-only libraries bundled per layer.** Instrumentation, pages and route handlers are separate layers that each compile
   what they use; drizzle, zod and the mail libraries were a quarter of the modules. They are `serverExternalPackages` now (Node
   loads them from node_modules). Add a new big server-side dependency there too.
4. **The mods' catalog** (next.config.ts writes zeff-hooks.json at every start): parsed all of src/ — 6–9 s before anything
   compiled; now only the changed files (cache in `<dist dir>/cache/zeff-hooks.json`).
5. **The mods' build loader** (scripts/mods/hook-loader.cjs) ran on every file once per layer, parsing it each time: ~20 % of a
   cold compile (A/B with `ZEFF_MOD_HOOKS=0`). It keeps its answer per file and text now, and next.config.ts hands it only files
   it would hook (an exported function or const, no "use server") — on par with hooks off.

Still costly: the first page compiles the server components' layer of ~2 000 modules (10–15 s cold), the first route handler
the route handlers' layer again (8–10 s — the first view's `<data>` waits for it), the instrumentation its own at the start
(the start ~20 s). They are three layers of the same code; the graph is that big because reading any extension point loads
every plugin's server.ts (plugins/contributions → server.generated.ts) and most modules reach that. A restart reuses Turbopack's
cache (`--warm-cache`: pages 0.3–3 s). Compiling the route handlers in the background after the start was tried: it made the
first page that much slower (both compile at once), so it is not done.

Not causes (measured): source maps (off: no faster), a storm of file writes elsewhere under Turbopack's root (no recompiles).
