import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "./actions";
import type { FieldSpec } from "./types";

/**
 * The kernel's reads of Zeff's shared data for plugins' lambdas and flows (docs/zeff-kernel.md — what a port reads instead of another
 * plugin's code): the money ledger's payments by what they pay, a database's rows by their source's ref, where Zeff's own databases are.
 * Reading only. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const strings = (v: unknown, max: number): string[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => String(x).trim()).filter(Boolean).slice(0, max);

export const DATA_ACTIONS: FlowAction[] = [
  {
    name: "mail.messages",
    group: "mail",
    label: "Your mails and messages",
    summary: "The mails and messages Zeff keeps (any folder): those whose subject or preview contains a text, when given — key, subject, preview, when, the sender's address.",
    input: [f("contains", "text"), f("limit", "number", { default: 20000 })],
    output: "{ messages: [{ key, subject, preview, at, email }] }",
    run: async (i) => {
      const { getSqlite } = await import("@/db");
      const contains = typeof i.contains === "string" ? i.contains : "";
      const limit = Math.max(1, Math.min(50000, Number(i.limit) || 20000));
      try {
        return { messages: getSqlite().prepare("select key, subject, preview, received_at at, lower(from_email) email from emails where (? = '' or instr(subject || ' ' || preview, ?) > 0) order by received_at desc limit ?").all(contains, contains, limit) };
      } catch {
        return { messages: [] };
      }
    },
  },
  {
    name: "sources.texts",
    group: "data",
    label: "What sources say",
    summary: "Mails (mail:<key>), letters (doc:<id>) and todos (todo:<id>) by their refs: a mail's sender, subject and preview, a letter's name, summary and text, a todo's text, note and status.",
    input: [f("refs", "list", { required: true })],
    output: "{ sources: { [ref]: { mail? | doc? | todo? } } }",
    run: async (i) => {
      const { getSqlite } = await import("@/db");
      const d = getSqlite();
      const one = <T>(sql: string, arg: unknown): T | undefined => {
        try {
          return d.prepare(sql).get(arg) as T | undefined;
        } catch {
          return undefined; // (the plugin behind it never ran)
        }
      };
      const out: Record<string, unknown> = {};
      for (const ref of strings(i.refs, 2000)) {
        const at = ref.indexOf(":");
        const kind = ref.slice(0, at);
        const id = ref.slice(at + 1);
        const v =
          kind === "mail" ? one("select from_name fromName, subject, preview from emails where key = ?", id)
          : kind === "doc" ? one("select name, summary, text from documents where id = ?", Number(id))
          : kind === "todo" ? one("select text, note, status from todos where id = ?", Number(id))
          : undefined;
        if (v) out[ref] = { [kind]: v };
      }
      return { sources: out };
    },
  },
  {
    name: "todos.texts",
    group: "todos",
    label: "Your todos' texts",
    summary: "Every todo (not merged into another): its text, its note, when it was made.",
    input: [],
    output: "{ todos: [{ id, text, note, at }] }",
    run: async () => {
      const { isInstalled } = await import("@/plugins/state");
      if (!isInstalled("todos")) return { todos: [] };
      const { getSqlite } = await import("@/db");
      return { todos: getSqlite().prepare("select id, text, note, created_at at from todos where merged_into is null").all() };
    },
  },
  {
    name: "money.allocations",
    group: "data",
    label: "Payments by what they pay",
    summary: 'The money ledger\'s payments allocated to these things ("case:12", "debt:3" …), oldest first — a booking\'s, a payment todo\'s, one said by hand.',
    input: [f("refs", "list", { required: true })],
    output: "{ allocations: { [ref]: [{ paymentId, date, amount, key, label, source, tx }] } }",
    run: async (i) => {
      const { allocationsOf } = await import("@/lib/money/ledger");
      return { allocations: Object.fromEntries(strings(i.refs, 2000).map((ref) => [ref, allocationsOf(ref).map((a) => ({ paymentId: a.paymentId, date: a.date, amount: a.amount, key: a.key, label: a.label, source: a.source, tx: a.tx }))])) };
    },
  },
  {
    name: "money.pay",
    group: "money",
    label: "Book a payment",
    summary: 'A payment kept in the money ledger — once per key ("tx:<booking>", "todo:<id>", "hand:<n>") — and allocated to what it pays ("case:12" …): their figures follow (the flows on ledger.changed run). Needs the flow\'s money permission.',
    input: [f("key", "text", { required: true }), f("date", "text", { required: true }), f("amount", "number", { required: true }), f("label", "text", { required: true }), f("source", "text", { required: true, options: ["bank", "todo", "hand"] }), f("tx", "text"), f("allocate", "json", { help: "[{ ref, amount }]" })],
    output: "{ paymentId }",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.money) throw new Error("This flow may not book money — grant it under the flow's permissions (money).");
      if (ctx.dryRun) return { paymentId: null, dryRun: true };
      const ledger = await import("@/lib/money/ledger");
      const source = i.source === "bank" || i.source === "todo" ? i.source : "hand";
      const p = ledger.recordPayment({ key: String(i.key), date: String(i.date), amount: Number(i.amount), label: String(i.label), source, tx: typeof i.tx === "string" && i.tx ? i.tx : null });
      for (const a of (Array.isArray(i.allocate) ? i.allocate : []) as { ref?: unknown; amount?: unknown }[]) if (typeof a.ref === "string" && Number.isFinite(Number(a.amount))) ledger.allocate(p.id, a.ref, Number(a.amount));
      return { paymentId: p.id };
    },
  },
  {
    name: "money.confirm",
    group: "money",
    label: "A booking confirms a payment",
    summary: "A payment ticked off or said by hand, confirmed by the bank's booking (its label gets the booking's). Needs the flow's money permission.",
    input: [f("paymentId", "number", { required: true }), f("tx", "text", { required: true }), f("label", "text", { required: true })],
    output: "{}",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.money) throw new Error("This flow may not book money — grant it under the flow's permissions (money).");
      if (!ctx.dryRun) (await import("@/lib/money/ledger")).confirmByBank(Number(i.paymentId), String(i.tx), String(i.label));
      return {};
    },
  },
  {
    name: "money.settle",
    group: "money",
    label: "What a payment settles",
    summary: "A payment as evidence (a booking without todo or case): what it pays anyway — a promise to whoever it paid, a debt of yours to them (lib/todos/settle.ts). The refs it settled. Needs the flow's money permission.",
    input: [f("evidence", "json", { required: true })],
    output: "{ settled: string[] }",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.money) throw new Error("This flow may not book money — grant it under the flow's permissions (money).");
      if (ctx.dryRun) return { settled: [] };
      const e = (i.evidence && typeof i.evidence === "object" ? i.evidence : {}) as import("@/lib/todos/settle").Evidence;
      return { settled: (await import("@/lib/todos/settle")).settleEvidence(e) };
    },
  },
  {
    name: "todos.transfers",
    group: "todos",
    label: "Open todos that ask you to pay",
    summary: "The open todos with a transfer on them: to whom, the account, how much, the purpose.",
    input: [],
    output: "{ todos: [{ id, op: { name, iban, amount, purpose } }] }",
    run: async () => {
      const { isInstalled } = await import("@/plugins/state");
      if (!isInstalled("todos")) return { todos: [] };
      const { listTodos } = await import("@/lib/todos/store");
      return { todos: listTodos({ status: "open" }).flatMap((t) => t.ops.filter((o) => o.type === "bank-transfer").map((o) => ({ id: t.id, op: o }))) };
    },
  },
  {
    name: "todos.add",
    group: "todos",
    label: "Add a todo",
    summary: "A todo of yours — through the gate every todo goes through (one that repeats an open one isn't made twice: that one is given back) — with a due day and actions (a transfer …). Needs the flow's todos permission.",
    input: [f("text", "text", { required: true }), f("due", "text"), f("ops", "json")],
    output: "{ id }",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not add todos — grant it under the flow's permissions (todos).");
      if (ctx.dryRun) return { id: null };
      const { addManualTodo, setTodoDue, setTodoOps } = await import("@/lib/todos/store");
      const todo = addManualTodo({ ticket: "", text: String(i.text) });
      if (typeof i.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(i.due)) setTodoDue(todo.id, i.due);
      const ops = (Array.isArray(i.ops) ? i.ops : []) as { type?: string }[];
      const add = ops.filter((o) => o && typeof o.type === "string" && !todo.ops.some((x) => x.type === o.type));
      if (add.length) setTodoOps(todo.id, [...todo.ops, ...(add as never[])], undefined, true);
      return { id: todo.id };
    },
  },
  {
    name: "todos.done",
    group: "todos",
    label: "Mark a todo done",
    summary: "A todo done, with a note saying why (a booking that paid it …). Needs the flow's todos permission.",
    input: [f("id", "number", { required: true }), f("note", "text", { required: true })],
    output: "{}",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not mark todos done — grant it under the flow's permissions (todos).");
      if (ctx.dryRun) return {};
      const { addTodoUserNote, setTodoStatus } = await import("@/lib/todos/store");
      addTodoUserNote(Number(i.id), String(i.note));
      setTodoStatus(Number(i.id), "done", String(i.note));
      return {};
    },
  },
  {
    name: "workspace.row-source",
    group: "data",
    label: "What a row was made from",
    summary: 'The ref of what a row of a source\'s database stands for ("case:12", "mail:…") — for a row of a database made from another, the row it was made from, followed back.',
    input: [f("row", "row", { required: true })],
    output: "{ ref }",
    run: async (i) => {
      const { getSqlite } = await import("@/db");
      let id = Number(i.row);
      for (let depth = 0; depth < 7 && id > 0; depth++) {
        const r = getSqlite().prepare("select props from ws_pages where id = ?").get(id) as { props: string } | undefined;
        if (!r) break;
        let ref = "";
        try {
          ref = String((JSON.parse(r.props) as Record<string, unknown>).srcref ?? "");
        } catch {
          break;
        }
        const from = /^page:(\d+)$/.exec(ref);
        if (!from) return { ref: ref || null };
        id = Number(from[1]);
      }
      return { ref: null };
    },
  },
  {
    name: "zeff.installed",
    group: "data",
    label: "Which plugins are there",
    summary: "Whether these plugins are installed (a built-in there through its port counts).",
    input: [f("ids", "list", { required: true })],
    output: "{ installed: { [id]: boolean } }",
    run: async (i) => {
      const { isInstalled } = await import("@/plugins/state");
      return { installed: Object.fromEntries(strings(i.ids, 100).map((id) => [id, isInstalled(id as never)])) };
    },
  },
  {
    name: "todos.by-ids",
    group: "todos",
    label: "Todos by their numbers",
    summary: "These todos (not merged into another): text, status, due — the open first, the newest first.",
    input: [f("ids", "list", { required: true })],
    output: "{ todos: [{ id, text, status, due }] }",
    run: async (i) => {
      const ids = strings(i.ids, 2000).map(Number).filter((n) => n > 0);
      if (!ids.length) return { todos: [] };
      const { getSqlite } = await import("@/db");
      try {
        return { todos: getSqlite().prepare(`select id, text, status, due from todos where id in (${ids.map(() => "?").join(",")}) and merged_into is null order by status = 'done', id desc`).all(...ids) };
      } catch {
        return { todos: [] };
      }
    },
  },
  {
    name: "workspace.value",
    group: "data",
    label: "The rows of a value type",
    summary: 'A value type of the Workspace ("Fixkosten": columns of your databases publish what it is) read: its aggregate (sum by default), the total over all its rows, and the rows { id, title, amount, source }. None published: total null.',
    input: [f("type", "text", { required: true })],
    output: "{ agg, total, items }",
    run: async (i) => {
      const { isInstalled } = await import("@/plugins/state");
      if (!isInstalled("workspace")) return { agg: null, total: null, items: [] };
      const { refRows, valueAggregate, valueSources } = await import("@/plugins/workspace/values");
      const { getPage } = await import("@/plugins/workspace/store");
      const { rollup } = await import("@/plugins/workspace/model");
      const type = String(i.type ?? "").trim().toLowerCase();
      const refs = valueSources(type as never);
      if (!refs.length) return { agg: null, total: null, items: [] };
      const had = valueAggregate(type as never);
      const agg = had && had !== "count_unique" ? had : "sum";
      const items = refs.flatMap((ref) => {
        const source = getPage(ref.dbId)?.title || "?";
        return refRows(ref).map((r) => ({ id: `${ref.dbId}:${r.rowId}`, title: r.title, amount: r.value, source }));
      });
      const total = rollup(agg, undefined, items.map((x) => x.amount));
      return { agg, total: typeof total === "number" && Number.isFinite(total) ? Math.round(total * 100) / 100 : null, items };
    },
  },
  {
    name: "workspace.value-sources",
    group: "data",
    label: "The databases that publish a value type",
    summary: 'The databases whose columns publish a value type ("Fixkosten"): for each its id, the published column, its fields { id, name, type }, the rows that count { rowId: value } (running ones) and all its rows { id, title, cells } as kept. [] when none publish it.',
    input: [f("type", "text", { required: true })],
    output: "{ sources: [{ dbId, propId, title, properties, running, rows }] }",
    run: async (i) => {
      const { isInstalled } = await import("@/plugins/state");
      if (!isInstalled("workspace")) return { sources: [] };
      const { refRows, valueSources } = await import("@/plugins/workspace/values");
      const { getDatabase, getPage, rawRows } = await import("@/plugins/workspace/store");
      const type = String(i.type ?? "").trim().toLowerCase();
      const seen = new Set<string>();
      const sources = valueSources(type as never).flatMap((ref) => {
        const d = getDatabase(ref.dbId);
        const key = `${ref.dbId}:${ref.propId}`;
        if (!d || d.page.archivedAt || seen.has(key)) return [];
        seen.add(key);
        return [
          {
            dbId: ref.dbId,
            propId: ref.propId,
            title: getPage(ref.dbId)?.title || "",
            properties: d.schema.properties.map((p) => ({ id: p.id, name: p.name, type: p.type })),
            running: Object.fromEntries(refRows(ref).map((r) => [String(r.rowId), r.value])),
            rows: rawRows(ref.dbId).map((r) => ({ id: r.id, title: r.title, cells: r.cells })),
          },
        ];
      });
      return { sources };
    },
  },
  {
    name: "pref.get",
    group: "data",
    label: "A preference a port may read",
    summary: "A preference of Zeff that the calling plugin's built-in kept as its own (lib/ext/stores.ts ADOPTABLE_PREFS): key → its value (null: not set). Any other key is refused.",
    input: [f("key", "text", { required: true })],
    output: "{ value }",
    run: async (i, ctx) => {
      const key = String(i.key ?? "").trim();
      const lambda = String(ctx.flow ?? "").replace(/^lambda:/, "");
      const { getLambda } = await import("@/plugins/workspace/lambdas/store");
      const plugin = (getLambda(lambda)?.plugin ?? "").replace(/^ext:/, "");
      const { ADOPTABLE_PREFS } = await import("@/lib/ext/stores");
      if (!plugin || !(ADOPTABLE_PREFS[plugin] ?? []).includes(key)) throw new Error(`The preference “${key}” isn't one this plugin may read.`);
      const { getPref } = await import("@/lib/prefs");
      return { value: getPref<unknown>(key, null) };
    },
  },
  {
    name: "db.cells",
    group: "data",
    label: "A database's rows as kept",
    summary: "The rows of a database (by its id) as kept: { id, title, cells } — the cells by their field's id (not its name, which changes with the language), the values as stored (a person field's ids, a select's option id, a date as text). For code that knows the fields it reads.",
    input: [f("db", "db", { required: true }), f("limit", "number", { default: 2000 })],
    output: "{ rows: [{ id, title, cells }] }",
    run: async (i) => {
      const { rawRows } = await import("@/plugins/workspace/store");
      const limit = Math.min(5000, Math.max(1, Number(i.limit) || 2000));
      return { rows: rawRows(Number(i.db)).slice(0, limit).map((r) => ({ id: r.id, title: r.title, cells: r.cells })) };
    },
  },
  {
    name: "workspace.rows-by-ref",
    group: "data",
    label: "A database's rows by their source",
    summary: 'The rows of a database by the ref of what they were made from ("case:12" → the row\'s id) — those starting with prefix only, when given.',
    input: [f("db", "db", { required: true }), f("prefix", "text")],
    output: "{ rows: { [ref]: rowId } }",
    run: async (i) => {
      const { rawRows } = await import("@/plugins/workspace/store");
      const prefix = typeof i.prefix === "string" ? i.prefix : "";
      const out: Record<string, number> = {};
      for (const r of rawRows(Number(i.db))) {
        const ref = String(r.cells.srcref ?? "");
        if (ref && ref.startsWith(prefix)) out[ref] = r.id;
      }
      return { rows: out };
    },
  },
  {
    name: "zeff.places",
    group: "data",
    label: "Where Zeff's databases are",
    summary: "The databases Zeff made for itself, by what they are (null: not made, or gone): cases, debts, people, mail, chats, inbox.",
    input: [],
    output: "{ cases, debts, people, mail, chats, inbox }",
    run: async () => {
      const { getPref } = await import("@/lib/prefs");
      const { getDatabase } = await import("@/plugins/workspace/store");
      const at = (key: string) => {
        const id = getPref<number | null>(key, null);
        const d = id ? getDatabase(id) : null;
        return d && !d.page.archivedAt ? id : null;
      };
      return { cases: at("workspace.casesDb"), debts: at("workspace.debtsDb"), people: at("workspace.peopleDb"), mail: at("workspace.mailDb"), chats: at("workspace.chatsDb"), inbox: at("workspace.inboxDb") };
    },
  },
];

// The kernel's own: always there (read with the other flow actions — flows/actions.ts flowActions()).
extensionPoint<FlowAction[]>("workspace.flowActions").contribute("core:data", DATA_ACTIONS);
