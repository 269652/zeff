# Integrations: plugins in a repository of their own

Chrono and Punch — the booking systems Zeff exports to and reads back from — are **not part of this repository**. They live in
`Zeff-booking` (an employer's systems stay out of the code that can be shared) and are **mounted** into Zeff as a git
submodule under `integrations/booking/`. Zeff builds, tests and runs without them: no Chrono, no Punch, nothing else changes.

```
git submodule update --init            # a checkout with them (in a fresh clone: git clone --recurse-submodules)
npm run integrations                   # which integrations are mounted → src/lib/integrations/mounted-*.ts
```

`npm run integrations` is run for you by `dev`, `build`, `test`, `typecheck` and `npm run deploy` (the generated files are not
committed). A release (`npm run release`) is made from a commit and does not contain the submodule: Zeff without them.

## How a mount works

An integration is a folder in `integrations/` with up to three entry modules at its root:

| Module | Loaded by | What it holds |
|---|---|---|
| `meta.ts` | everything, incl. the browser | **data only**: its plugins' catalog entries (`IntegrationMeta`), added to `PLUGINS` |
| `server.ts` | the server | `IntegrationServer` per plugin id: sync settings and step, driver, sign-in, pages, and what it adds to the week, the month, the jobs and the week's close |
| `client.ts` | the week table, the entries list | `IntegrationClient`: marks for the data its server part handed over |

The generator writes one small file per kind (`mounted-meta.ts`, `mounted-server.ts`, `mounted-client.ts`), so the plugin
catalog (client-safe) never pulls server code, and the server never pulls the browser's. The types are in
`src/lib/integrations/types.ts`; the lookups in `meta.ts`, `server.ts`, `client.ts` and `slots.ts` next to it.

Whether a plugin is *there* needs no extra rule: `installedPlugins()` is made from `PLUGINS`, and an unmounted
integration's plugins are not in it.

## The extension points

| Where | Hook | Who calls it |
|---|---|---|
| Plugins page, menus, routes | `meta.manifest` | `src/plugins/catalog.ts` (`PLUGINS`) |
| Sync settings page | `server.syncSettings` | `src/plugins/sync-settings-modules.ts` |
| Sync menu + scheduler | `server.syncStep` | `src/lib/sync/registry.ts`, `src/lib/sync-scheduler.ts` |
| Browser driver | `server.driver` | `driverPath()` in `src/plugins/drivers.ts` |
| Sign-in (page, status, driver environment) | `server.service` | `attention.ts`, `logins.ts`, `app/actions.ts` |
| `/export/<id>`, `/settings/<id>` | `server.pages` | `src/app/export/[integration]`, `src/app/settings/[integration]` |
| The week's page (card, pull, export link, marks) | `server.week` → `WeekSlot` | `src/app/page.tsx` via `weekSlots()` |
| The month's page (approvals per day, pull) | `server.month` → `MonthSlot` | `src/app/month/page.tsx` via `monthSlots()` |
| The jobs page (toolbar, column) | `server.jobs` → `JobsSlot` | `src/app/jobs/page.tsx` via `jobsSlots()` |
| The week's close | `server.weekClose` | `src/lib/week-close.ts` |
| Marks in the week table / entries list | `client.CellMark`, `EntryMark`, `DayMark` … | `WeekTable`, `EntriesTable` |
| The time report plugin's places (cards, buttons, marks, approvals, jobs column) — as data | `server.slots` → `TimeSlot` | `src/plugins/zeiterfassung/time-slots.ts` (extension point `zeiterfassung.slots`) |
| A button of those places that runs the plugin's own code (a pull) | `server.slots.run(op, input)`, buttons made with `slotRun(…)` | the kernel's `time.slot-run`, the report's flow `zeiterfassung.slot-run` |
| Buttons on the Todos screen (links, or flows to run) | `server.todoActions` → `TodoAction[]` | `src/plugins/todos/places.ts` (extension point `todos.actions`), the kernel's read `todos.actions`, the Todos plugin's lambda `todos.places` |

The page hooks (`week`, `month`, `jobs`, `client.*`) are the built-in pages' — the screens that replaced them (the time report
and the Todos screen as plugins of the view language) draw the places from data: `slots` and `todoActions`. A sync step's own
default interval: its `step.schedule().everyMinutes` (the scheduler asks it before the Sync settings' row).

## Tests

An integration's tests live in its repository under `tests/` and are run by Zeff's `npm test` (they import Zeff's
modules, which is why there is no standalone build: the code is compiled inside a Zeff checkout).

## What still lives in Zeff

The database. Chrono's and Punch's data (`chrono_entries`, `punch_days`, a few columns on jobs and the report settings, the
"record the default break in Punch" setting) stay in Zeff's schema and migrations, so that mounting or unmounting never
touches data. `CHRONO_CDP_ENDPOINT` is still the (legacy) name of the environment variable that points every driver at the
automation Chrome. Both are candidates for a later, generic "integration data" store.
