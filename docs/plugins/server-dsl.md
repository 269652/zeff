# The server DSL — one language for everything a plugin does on the server

Status 2026-11-15. Written after reading the flow engine (`src/plugins/workspace/flows/*`), the lambda runner (`workspace/lambdas/run.ts`)
and all 117 lambdas of `zeff-plugins`. **Built** = in this branch, tested (`tests/server-dsl.test.ts`). **Designed** = not built yet.

## 1. The question, answered with numbers

> Is there a clean server-side DSL, or are server actions code referenced by a name?

Both, and the split is the problem. The flow engine **is** an interpreted language (flows are data, in the DB, AI-editable) — but it is a
*weak* one, so everything it cannot say went into TypeScript actions (matched by a name string) or into JavaScript lambdas.

**What a flow can express today (before this slice):** 14 node kinds (action, set, if, switch, foreach, parallel, try, script, ask, approve, wait, call, return, fail); expressions = paths + the formula language + 28 filters; variables = one flat `vars` map (`set`); loops = `foreach` only
(no `while`, max 1000); functions = none (only calling *another flow*); errors = `try/catch` (no `finally`, one `error.message`);
writes = only through kernel actions; types = none (everything is `unknown`, filters coerce silently); regex, dates, objects (merge/pick/omit),
list math = missing; the only escape is a `script` node (QuickJS, pure data in/out).

**Kernel actions (≈ 227 names; counted by name, classified by me):**

| Kind | ≈ | Examples | Verdict |
|---|---|---|---|
| Generic primitives | 65 | `sql.*` 2, `pref.*` 2, `db.*`/`rows.*` 15, `store.*` 3, `http.request`/`web.*` 5, `fs.*`/`files.*` 12, `ai.*`/`prompts.*` 10, `oauth.*` 7 (→ commands), `extract.*` 2, `time.now`, `lambda.invoke`, `meta.*` | right idea; 9 would do (§4) |
| Domain over kernel-owned data | 100 | `people.*` 27, `todos.*` 22, `mail.*`/`messages.*` 16, `calendar.*` 12, `timeline/facts/brief/series` 10 | ~75 are reads that exist only because flows had no way to say a `select` + a loop → SQL views. ~25 are writes with real invariants (todo engine, ledger, mail send) → stay kernel **commands** |
| Vendor / connector glue | 45 | `jira.*` 11, `gitlab.*` 6, `bank.*` 6, `connectors` 10, `teams.*`, `localai.*`, `signal.send`, `gcal.sync` | `http` + `store` + `secret` + a flow; only the protocol drivers (IMAP, Chrome scraper) must stay code |

**Lambdas (117 in zeff-plugins; 101 function, 9 driver, 7 lookup; 6 324 lines):**
- They are read-only by rule (`a.writes → refused`). So the *same* job is split in two: the lambda computes, **a flow node writes what it returns** (`finances.account-mark`: "the flow keeps it"). That split exists only because the DSL could not compute.
- 287 declared `zeff.call` uses of 88 distinct ops: 153 (53 %) are already generic primitives (`sql.query` 27, `pref.get` 26, `store.query` 25,
  `ai.json` 21 …), 134 are domain reads (`todos.open`, `people.known-in` …).
- 24 lambdas call nothing from the kernel (pure compute); 85 import a shared `lib.mjs` — mostly **transplanted TypeScript** (esbuild bundle of the
  built-in's core: finances 30 KB, correlations). That is *porting by copying*, not DSL; it stays JavaScript until its parts are rewritten.
- Lambdas run in a Node child with `--permission` (not in QuickJS); flows' `script` nodes run in QuickJS. Two sandboxes, two APIs.

**Verdict:** not everything but the kernel is "mapped in the DB so the AI can change it": the plugin *shell* is (manifest, views, flows,
lambdas, stores), but the *behaviour* is split between (a) data (flows), (b) JS blobs (lambdas) and (c) ~225 TypeScript actions referenced by
string. (c) cannot be inspected, versioned or changed by the AI at all, and nothing declares its schema in the DB — the Studio reads TypeScript
objects. The fix is a language that is strong enough that (b) and most of (c) become (a), plus a **closed, small** set of primitives declared
as data.

## 2. The language

One language, three layers. A plugin author (human or AI) writes only layer 1–2; layer 3 is the kernel.

```
 flow / function / capability   ← data in the DB, versioned, AI-editable          (layers 1–2)
 ────────────────────────────────────────────────────────────────────────────
 primitives (9) + commands      ← TypeScript, closed, declared with schemas in DB  (layer 3)
```

### 2.1 Values and types
JSON values: `null · bool · number · text · list · object`. **Gradual typing**: declared on flow inputs, function params, capability
input/output schemas (`FieldSpec`: text number boolean json list date url db row); *checked* (a) when a capability/flow is saved (arity, unknown
names, required inputs, literal kinds), (b) at run time at every stdlib call and capability boundary — the error says which argument:
`padStart: argument 1 must be number, not text — use | number first`. No implicit coercion in the new stdlib (the old filters keep theirs). `null`
is explicit: `| default(…)`.

### 2.2 Expressions
Unchanged syntax, so every existing flow stays valid: `{{ path | filter(args) | filter }}`, a text with several `{{ }}` is a text, one alone is
the value. Paths: `input.x`, `steps.<id>`, `vars.x`, `item/index/<as>`, `error.message`, `env.*`, `row`, `secrets.*`. Operators from the
formula language (`and or not == != < > + - * /`). Everything callable is a **stdlib function** applied with `|` (value first):

| Group | Functions (★ = new in this slice, 49) |
|---|---|
| text | `trim upper lower text truncate replace stripHtml urlencode split lines` · ★`startsWith endsWith contains padStart padEnd capitalize splitRaw indexOfText repeat` |
| regex | ★`regexTest regexMatch regexAll regexReplace` (pattern ≤ 300 chars, subject ≤ 200 k) |
| list | `first last count join slice pluck where sort unique sum` · ★`reverse flatten concat includes take drop chunk compact uniqueBy groupBy indexBy countBy min max avg zip range` |
| object | `keys values` · ★`get has pick omit merge setKey entries fromEntries typeOf` |
| number | `number round` · ★`abs floor ceil clamp` |
| date | `date` · ★`addDays addMinutes diffDays formatDate weekday startOfDay` (ISO texts, UTC, pure — "now" comes from `env.now` / `core.clock.now`) |
| json | `json parse` |

Each stdlib entry has a declared signature (`stdlib.ts`: `params`, `optional`, `returns`, `what`) — the Studio and the AI read it from there; the
doc table is generated from it, not written by hand. **Next:** `regexSplit`, `sortBy` with multiple keys, `mean/std/corr` (what the
correlations lib needs), `formatNumber(locale)`, `uuid`-free hashing (`sha256`), `base64`, higher-order helpers as *nodes*, not lambdas in
expressions (an expression stays a pure value, never a program).

### 2.3 Statements (nodes)
`set` (flat `vars`) · `if/switch` · `foreach` (≤ 1000) · ★`while` (≤ `max`, default 200; still true at `max` = error, not silent cut) ·
`parallel` · `try` with ★`finally` · ★`fn` + ★`apply` (user functions) · `call` (another flow) · `return` · `fail` · `action` (a capability) ·
`script` (escape hatch, QuickJS) · `ask/approve/wait` (the run suspends; resumed from its journal).

**Functions** (★ built): `{ kind:"fn", name, params:[…], nodes:[…], output? }` is hoisted (defined before the run starts, global per flow, duplicate
names are a save error); `{ kind:"apply", fn, args:{…} }` runs it in a **fresh scope** (`vars` = the params, `steps` empty), result = a `return`
node, the fn's `output` expression, or its last node. Recursion limit 20 (`functions call each other more than 20 deep`), step budget shared with
the caller. Unknown function/parameter: a save-time error with the node id *and* a run-time error.

**Errors:** `try … catch … finally` (★ `finally` runs after the work *and* after the catch, also when a `return` passes through; **not** while the
run is suspended — a suspended run restarts from its journal and reaches `finally` when it ends). `fail` = `throw`. Actions have `retry` and
`onError: continue`. **Designed:** `error.code/node/capability` (typed errors), `rethrow`.

**Parallel / await:** `parallel` (branches side by side, joined — that *is* the await). **Designed:** `spawn`/`await` for long jobs (a
capability returns a handle; `await` suspends the run exactly like `wait`), bounded fan-out `parallel max: 5` over a list.

**Transactions** (★ built): `{ kind:"tx", nodes }` runs its nodes inside one SQLite `BEGIN IMMEDIATE … COMMIT`; any error rolls back (a `return` inside commits first). Only nodes that never wait are allowed inside (`set if switch foreach while try fn apply return fail` and `core.*` actions) — no http, ai, ask, approve, wait, parallel, call, script, no nested tx — checked at save time and at run time. Transactions on the one connection are queued, so they never interleave. A tx is one journal entry (all or nothing; a resume never replays half of it); its nodes' own outputs are not kept, and `vars` it set are not restored when the tx is replayed from the journal.

### 2.4 Determinism, limits, safety
- **Replay:** every effect (action/capability/script) is journaled by node key; a resumed run replays outputs instead of running again. Pure
  parts (expressions, stdlib, `set`) re-run and must give the same result ⇒ stdlib is pure and reads no clock/random. Time comes only from
  `core.clock.now` (journaled). ★ `env.now/today/hour/trigger` are frozen at the run's start (journal `__env`): a resumed run sees the same values.
- **Limits:** steps per run `permissions.maxSteps` (500 default, ≤ 20 000) · `while.max` 200 (≤ 5000) · `foreach.max` 500 (≤ 1000) · fn depth 20 ·
  capability nesting 5–6 · log values 4 000 chars · `sql.query` ≤ 5 000 rows · http body ≤ 5 MB · regex pattern/subject caps · fs files ≤ 1 MB ·
  ★ `permissions.runTimeoutMs` (checked between nodes, so one long action finishes first). **Designed:** value size cap (`maxValueBytes`), per-capability timeouts declared in the schema.
  Known soft spots: JS regexes cannot be interrupted (→ run `regex*` in QuickJS with the interrupt handler or switch to RE2), a synchronous
  SQLite statement cannot be interrupted (→ `sql` runs with a `progress_handler` budget in the worker).
- **Permissions (grants):** a flow's `permissions` are the *only* authority: `web` domains, `write` databases, ★`sql` tables, ★`pref` keys
  (`finances.*`), `store`, `driver`, `sync`, `meta`, `ai`, `send`, `money`, `todos`. The AI writes `requested` (what it wants); only the user grants.
  A capability runs **with the caller's grants** — it can never have more than the flow that calls it (tested: a flow without the `pref` grant gets
  “may not read the preference …” through a capability that reads one). **Designed:** per-capability `needs` declared and intersected at save time so the Studio can show “this flow can: …”.

## 3. Capabilities: actions as data

An action is no longer a name matched to code. It is a row in `ws_capabilities` (★ built):

```jsonc
{ "name": "news.item", "label": "One news item", "summary": "…",
  "input":  [ { "name": "id", "type": "number", "required": true } ],      // FieldSpec[] — the Studio draws the form from it
  "output": "{ found, title, url, … }",                                    // words today; JSON-schema designed
  "impl": { "use": "sql.query", "input": { "sql": "…", "params": ["{{ input.id }}"] }, "output": "{{ result.rows[0] }}" } }
//   or  "impl": { "nodes": [ …flow nodes… ], "output": "…" }              // a small program, with its own input
```
- `use` wraps a **primitive** or another capability (input mapped, answer shaped); `nodes` is a program (fns allowed). Composition depth ≤ 6.
- `writes` is *derived* (what it is made of), so dry runs skip it and the Studio can warn — no hand-set flag to forget.
- Saved only if valid: **every problem is returned with its place** (`impl.input.key: {{ x | nofilter }} — There is no filter …`; `impl.use: “x” is neither a primitive (…) nor a capability`; `name: …`), as a list, not the first one.
- Lookup order in the engine: kernel action (old, untouched) → `core.<primitive>` → DB capability. So nothing existing is shadowed.

### 3.1 The closed primitive set (layer 3)
| Primitive | Does | Grant | Status |
|---|---|---|---|
| `sql` | `query` one SELECT (≤ 5 000 rows, `?` params, read-only checked by the driver); `exec` one INSERT/UPDATE/DELETE (no DDL), inside `tx` it commits with the rest | `sql: [tables]` to read, `sqlWrite: [tables]` to write, never `ws_flow_secrets` | ★ query, ★ exec |
| `pref` | `get` / `set` JSON value | `pref: [key | prefix*]` | ★ |
| `clock` | `now` → `{ now, today, local }` (journaled) | — | ★ |
| `log` | a line in the run console | — | ★ |
| `http` | request (domains, redirects re-checked, private IPs refused, 5 MB) + secret headers | `web: [domains]`, `secret` | ★ `core.http` (wraps `http.request`) |
| `fs` | **bounded**: `list / read-text / write-text` under named roots (≤ 1 MB, symlinks and `..` resolved, nothing leaves a root; writing needs `write`) | `fs: [{root, write?}]` | ★ |
| `ai` | `json` / `ask` / `classify` / `extract` with prompt template + schema, cost counted | `ai: true` | exists as `ai.*` |
| `store` | plugin stores (`put/query/delete`, idempotent by key) | `store: [names]` | exists |
| `secret` | `core.http` with `secretHeaders: { authorization: { secret: "NAME", prefix: "Bearer " } }` — the value is put into the header on the server; the flow can't read it, logs mask it; only names in `secret: [names]` | `secret: [names]` | ★ (as part of `http`) |
| `rows`/`db` | rows of Zeff's databases (pages) | `write: [dbIds]` | exists; ~15 actions → 3 |
| **commands** | named kernel operations with real invariants: `todos.add/done`, `money.pay/settle`, `mail.send`, `people.resolve` | `todos`, `money`, `send`, … | declared in DB, handler in code, versioned |

The 9 are `sql · http · fs · ai · store · pref · secret · clock · log` (+ `rows`). **Commands** are the honest third tier: the todo engine, the
ledger, the mail sender have invariants that are code, not data; they stay TypeScript, but **declared** (name, schemas, needs, writes) in the DB
like any capability with `impl: { command: "todos.add" }` — so the AI sees the same catalogue and the Studio no longer reads TypeScript objects.

## 4. Mapping: existing actions and lambda patterns → DSL

| Existing | In the DSL | Stays kernel? |
|---|---|---|
| `pref.get` / `pref.set` (lambda-only, adoptable list) | `core.pref.get/set` + `pref` grant | primitive |
| `sql.query` / `sql.exec` | `core.sql.query` (built); `exec` in `tx` (designed) | primitive |
| `db.query/get/schema/cells/...`, `rows.*` (15) | `sql` over `v_rows`-style views for reads; `rows` primitive for writes (3 ops) | primitive |
| `store.query/put/delete` | `store` primitive | primitive |
| `http.request`, `web.read/html/search` | `http` + stdlib (`stripHtml`, `regex*`); `web.html`/`extract.css` = `html.select` stdlib (next) | primitive |
| `extract.css`, `extract.regex` | stdlib `regexAll/regexMatch`; css select as stdlib | no |
| `fs.*`, `files.*` (12) | `fs` bounded | primitive |
| `ai.json/extract/ask/classify`, `prompts.fill/text`, `ai.memo-*` | `ai` primitive; prompts are `store` rows; memo = `store` | primitive |
| `oauth.*` (7) | stay **commands**: encrypted token storage and refresh are kernel code, never raw `core.http`/`core.pref` access (port-drive's objection, agreed) | yes |
| `people.names/list/emails/contacts/details/accounts/by-iban/named-in/known-in/claims/commitments` (≈ 12 reads) | `sql` over entity-graph **views** + `fn`s (ranking, matching in stdlib) | views only |
| `people.resolve/claim-*/extract-*/compile-*/classify-*/normalize-*` | `ai` + `store` flows; `resolve` stays a command (fuzzy identity) | `resolve` |
| `todos.texts/open/by-ids/refs/tickets/sources/attached/followed/transfers` (≈ 14 reads) | `sql` views | views only |
| `todos.add/done/dismiss/propose/ensure-due/...` (≈ 8) | **commands** | yes (todo engine) |
| `mail.messages/thread/unread/conversation/senders/...`, `messages.recent/of-ref/later` | `sql` views | views |
| `mail.archive/mark-read/gmail-change/new-inbox`, `row.reply.draft`, `row.op`, `signal.send` | commands + `http` (Gmail/Graph REST) | driver for IMAP |
| `appointments.*`, `meetings.upcoming`, `calendar.busy` | `sql` views (reads); `appointments.save/respond/...` commands | commands |
| `timeline.events-for`, `facts.list`, `brief.get`, `series.read`, `knowledge.profile` | `sql` views | views |
| `money.allocations` (read); `money.pay/confirm/settle` | `sql` view; **commands** (ledger) | commands |
| `jira.*` (11), `gitlab.*` (6), `teams.*`, `bank.*` (6), `gcal.sync`, `connector.sync`, `localai.*` | one flow each: `http` + `secret` + `store` + stdlib | no (only IMAP/Chrome drivers) |
| `meta.read/run`, `lambda.invoke`, `fn.call`, `api.call`, `driver.call`, `chrome.up` | `apply` (user fns), `call`, commands | `meta`, `driver` |
| **Lambda pattern** pref/sql read + shape (`finances.account-mark`, `news.item`, `know.upcoming`, `finances.income-refresh`) | one flow/capability: primitive + `set`/stdlib. **`finances.account-mark` ported, 11/11 same** | no |
| **Pattern** lambda computes, flow writes ("the flow keeps it") | one flow with `core.pref.set`/`store.put`/`sql.exec` — lambda disappears | no |
| **Pattern** `ai.json` + `prompts.fill` + shape (12) | `ai` primitive + `set` | no |
| **Pattern** list/rank/merge over `todos.open`, `people.*` (loops, know.summary) | `foreach`/`while` + `groupBy/sort/take` + `fn` | no |
| **Pattern** fetch + parse (6 lambdas) | `http` + `regex*`/`parse` | no |
| **Pattern** transplanted `lib.mjs` (85 lambdas: finances 30 KB, correlations core) | stays `script`/lambda until rewritten; numeric helpers added to stdlib (`mean std corr`) | not yet |
| drivers (9), lookups (7) | driver = `core.driver` primitive (exec grant); lookup = flow with `lookup:` (exists) | driver process |

After this: ~9 primitives + ~25 commands in code (≈ 35 TypeScript units, each with a declared schema in the DB) instead of ≈ 227 named actions,
and the 101 function lambdas shrink to those with real transplanted logic.

## 5. How the AI edits it
- **JSON form** (today, built): the flow/capability object. Validated on save: `normalizeFlow/normalizeCapability` (structure, ids unique) +
  `checkFlow` (actions/capabilities exist and get their required inputs, expressions parse, `apply` targets and parameters exist, fn names unique).
  Errors carry **node id or JSON path** (`impl.nodes.cur: …`, `go: f has no parameter “b” (it has: a)`).
- **Patch ops** (★ built, `flows/patch.ts`): `insert / replace / update / remove / move` a node by id (and slot) — ids are stable anchors, so the AI edits one node, not the whole program; the result is re-normalised as a whole and every problem comes back as `op 2 (insert): the id “u” is taken`, nothing applied. Capabilities: `patchCapability`, every save is a version (`listCapabilityVersions`, `restoreCapability` — a restore is a new version, nothing is lost). **Designed:** the same for flows (`part-versions`) and diff/revert in the Studio.
- **Text form** (designed — a readable view of the same tree, round-trips 1:1, produces *line-precise* errors `file:line:col`):
  ```
  flow dsl.account-mark(key: text, kind: text, save: bool = false) grants { pref: ["finances.ownAccounts"] } {
    let key = input.key | default('') | text | trim
    if key == '' { fail "No recipient." }
    let all = core.pref.get(key: "finances.ownAccounts").value | default({})
    if kind in ['own', 'credit'] { all = all | setKey(key, kind) } else { all = all | omit(key) }
    if input.save { core.pref.set(key: "finances.ownAccounts", value: all) }
    return { value: all }
  }
  ```
  Parser = ~400 lines (hand-written, no deps) mapping to/from `FlowNode`; the JSON stays the storage truth.
- **Dry run** (exists): `writes` capabilities are skipped and reported; the AI proposes, the user sees "would do: …" and the grants it asks for.

## 6. Migration
The DSL is a **superset**: nothing was removed, renamed or re-typed. Existing flows normalise and run unchanged (tested: the whole
`workspace-flows`, `workspace-lambdas`, `flow-queue` suites pass). New node kinds (`fn apply while tx`) only *added* to `NODE_KINDS` (+ `kernel-contract.ts`); kernel
actions keep resolving first; lambdas keep calling `zeff.call`. Order of work: (1) stdlib + fn/while/finally + capability registry ← **done**;
(2) re-declare the 65 generic actions as capabilities with schemas in the DB (generated from the TypeScript objects once, then the DB is truth);
(3) entity-graph views + `sql` grants → delete the ~75 read actions as plugins stop using them; (4) `tx` + `sql.exec` + `fs`/`secret` primitives ← **done**;
(5) patch ops + versions for capabilities ← **done**, text form still to build; (6) port lambdas by pattern (§4), delete lib transplants one by one; (7) lambdas become
a *compat layer* (a lambda = a `script` node), then go.

## 7. This slice
Files: `flows/stdlib.ts` (49 typed functions), `flows/capabilities.ts` (registry, 5 primitives, validation), `flows/engine.ts` (+`fn/apply/while/finally`,
capability lookup), `flows/types.ts` (+3 node kinds, `finally`, `permissions.sql/pref`), `flows/check.ts`, `scripts/dsl-parity.mts`,
`tests/server-dsl.test.ts` (7 tests), `tests/fixtures/server-dsl/*` (the real lambda and its flow).
Run the parity on a **copy** of the database: `DATABASE_PATH=<copy> npx tsx scripts/dsl-parity.mts` (11/11 same, including the case the
lambda cannot do: the flow keeps the preference itself).

## 8. The kernel's actions in the database (declared)
`flows/declare.ts` turns every TypeScript flow action into a capability row `{ impl: { command: "<name>" } }` with its schema, `writes`, group and a **class**: `primitive` (generic, stays code), `read` (reads kernel data — to become a SQL view plus a flow, then deleted), `command` (writes with kernel invariants — stays code), `vendor` (glue for one service — to become a flow over http + secret + store). Run `DATABASE_PATH=<db> npx tsx scripts/declare-actions.mts [--apply]` (dry by default). It is idempotent, never overwrites a row (the row is the truth; the AI may edit it), and reports drift (code schema differs from the row) and orphans (row without code). On a copy of the database with this branch's registry: 115 declared — 39 primitive, 29 read, 14 command, 33 vendor. A wrapper capability may now target a kernel action (`use: "time.now"`). **The engine goes by the row** (`resolveAction` in `capabilities.ts`): a kernel action with a row gets the row's label, summary, input and output — its required inputs are checked from the row — and `enabled: false` switches it off (run and `checkFlow` say “switched off”). The code is only the handler; a row never makes an action weaker (it writes if the row or the code says so). Rows are read with a 2 s cache. **Declared at first use**, once per database (`ensureDeclared` in `declare.ts`, called by the engine, `checkFlow` and the catalogue) — no boot step, no shared start file; a failure never stops a run (the code is the fallback). **The catalogue** the Studio's picker (`flowCatalogAction`) and the AI's `workspace_flow_docs` read is `declaredCatalog()`: rows' texts and schemas, the `core.*` primitives and the data capabilities, switched-off ones left out. **The Studio edits the rows** (Studio → Capabilities, `studio/ui/Capabilities.tsx`): list by class, search, a form for label, text, input fields, output, the on/off switch and — for wrappers and programs — the `use`/`nodes` JSON; saving shows every problem with its place and keeps a version, versions can be brought back; kernel actions can be switched off but not deleted. Not yet: `read`-class actions are still code, and the form's JSON box for `nodes` is not the flow canvas.
