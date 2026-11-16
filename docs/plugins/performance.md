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
