import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "../workspace/flows/actions";
import type { FieldSpec } from "../workspace/flows/types";
import { getSecret } from "@/lib/secrets/store";

/**
 * Generic reads and writes for plugins' lambdas and flows (docs/zeff-kernel.md): the services this account runs next to Zeff (a server of its own on
 * this machine), and what a plugin's AI step attaches to the open todos. Nothing here knows a plugin — the plugin that talks to such a service names it
 * and brings its address and token as its settings (`serviceUrl`, `serviceToken`); the open todos' slots are the kernel's list (TODO_SLOTS). Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const text = (v: unknown): string => (v == null ? "" : String(v));

/** The services an account runs beside Zeff (their address, and the token Zeff holds for them). The plugin's own settings win. */
async function serviceOf(name: string): Promise<{ url: string; token: string }> {
  if (name === "knowledge") return { url: (await import("@/db/accounts")).accountKnowledge().url, token: getSecret("KNOWLEDGE_TOKEN") };
  throw new Error(`There is no service “${name}” on this account.`);
}

/** The settings (`serviceUrl`, `serviceToken`) of the plugin a lambda belongs to, or of the one a flow names (`connection`). */
async function settingsOf(i: Record<string, unknown>, flow: string | null | undefined): Promise<{ url: string; token: string }> {
  let plugin = text(i.connection);
  if (!plugin && flow?.startsWith("lambda:")) plugin = ((await (await import("../workspace/lambdas/store")).getLambda(flow.slice(7)))?.plugin ?? "").replace(/^ext:/, "");
  if (!plugin) return { url: "", token: "" };
  const p = (await import("@/lib/ext/registry")).getPlugin(plugin);
  if (!p?.enabled) return { url: "", token: "" };
  const v = (await import("@/lib/ext/plugin-settings")).pluginSettings(plugin, p.manifest);
  return { url: text(v.serviceUrl).trim().replace(/\/+$/, ""), token: text(v.serviceToken) };
}

/** Only a service on this machine or its own network — never the public web (that is `http.request`'s). */
async function localUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`“${raw}” is no address.`);
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("A service address is http(s) without a user name.");
  const { isPrivateIp } = await import("../workspace/flows/actions");
  const { lookup } = await import("node:dns/promises");
  const ips = /^[\d.]+$|:/.test(url.hostname) ? [url.hostname.replace(/^\[|\]$/g, "")] : (await lookup(url.hostname, { all: true }).catch(() => [])).map((a) => a.address);
  if (!ips.length || !ips.every((ip) => isPrivateIp(ip))) throw new Error(`${url.hostname} isn't an address on this machine or its network — services are local.`);
  return url;
}

async function call(i: Record<string, unknown>, flow: string | null | undefined, method: "GET" | "POST" | "PUT" | "DELETE"): Promise<unknown> {
  const own = await settingsOf(i, flow);
  const base = text(i.service) ? await serviceOf(text(i.service)) : { url: "", token: "" };
  const origin = own.url || base.url;
  if (!origin) throw new Error("Which service? name it (service) or set its address in the plugin's settings.");
  const path = text(i.path);
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("path: begins with a single /.");
  const url = await localUrl(`${origin}${path}`);
  const token = own.token || base.token;
  const headers: Record<string, string> = { accept: "application/json" };
  if (i.body !== undefined && i.body !== null && i.body !== "") headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  let r: Response;
  try {
    r = await fetch(url, { method, headers, body: i.body === undefined || i.body === null || i.body === "" ? undefined : JSON.stringify(i.body), signal: AbortSignal.timeout(Math.min(600000, Number(i.timeoutMs) || 10000)), cache: "no-store", redirect: "error" });
  } catch {
    throw new Error(`The service at ${url.origin} isn't answering — is it running?`);
  }
  const data = (await r.json().catch(() => null)) as (Record<string, unknown> & { error?: string }) | null;
  if (!r.ok || !data) throw new Error(typeof data?.error === "string" ? data.error : `${url.origin}: ${r.status}`);
  return data;
}

/** The todo fields a plugin may attach JSON to (the column each is kept in) — the kernel's list, like the stores a port may adopt. */
const TODO_SLOTS: Record<string, "knowledge"> = { matches: "knowledge" };

export const SERVICE_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "service.read",
    group: "data",
    label: "Ask a service next to Zeff",
    summary:
      "A question to a service on this machine (GET, or POST with a JSON body when the question needs one — it changes nothing there): service (a name this account runs) or the plugin's own address and token (its settings serviceUrl, serviceToken — a flow names the plugin: connection), path (begins with /), body, timeoutMs. The JSON answer; an error says what the service said.",
    input: [f("service", "text"), f("connection", "text", { help: "a flow: the plugin whose settings give the address and token" }), f("path", "text", { required: true }), f("body", "json"), f("timeoutMs", "number", { default: 10000 })],
    output: "the service's JSON answer",
    run: async (i, ctx) => call(i, ctx.flow, i.body === undefined || i.body === null || i.body === "" ? "GET" : "POST"),
  },
  {
    name: "service.send",
    group: "data",
    label: "Tell a service next to Zeff to do something",
    summary: "A call that makes the service do something (start reading, keep a text): method POST | PUT | DELETE, service or connection, path, body, timeoutMs. Needs the flow's permission api. The JSON answer.",
    input: [f("service", "text"), f("connection", "text"), f("method", "text", { options: ["POST", "PUT", "DELETE"], default: "POST" }), f("path", "text", { required: true }), f("body", "json"), f("timeoutMs", "number", { default: 30000 })],
    output: "the service's JSON answer",
    needs: ["api"],
    writes: true,
    run: async (i, ctx) => {
      ctx.may("api");
      if (ctx.dryRun) return {};
      const m = text(i.method).toUpperCase();
      return call(i, ctx.flow, m === "PUT" || m === "DELETE" ? m : "POST");
    },
  },
  {
    name: "todos.attached",
    group: "todos",
    label: "The open todos with what a plugin attached to them",
    summary:
      "The open todos with what is attached to them under a slot (matches: what a plugin matched to each — JSON, null when nothing yet): id, text, ticket, the ticket's summary, updatedAt, attached; plus every open todo's id (openIds) and the context settings of an AI step (area: the step's numbers, its own instructions, and what the todos show: displayOff).",
    input: [f("slot", "text", { required: true }), f("area", "text", { help: "the context step whose numbers and instructions are wanted" })],
    output: "{ todos: [{ id, text, ticket, ticketSummary, updatedAt, attached }], openIds, numbers, extra, displayOff }",
    run: async (i) => {
      const column = TODO_SLOTS[text(i.slot)];
      if (!column) throw new Error(`There is no slot “${text(i.slot)}” on a todo.`);
      const { getDb, schema } = await import("@/db");
      const { listTodos } = await import("@/lib/todos/store");
      const { getJiraTicket } = await import("@/lib/jira/store");
      const { getContextPrefs, extraBlock } = await import("@/lib/runs/context-prefs");
      const { getTodoDisplayOff } = await import("@/lib/todo-display-store");
      const stored = new Map(getDb().select({ id: schema.todos.id, v: schema.todos[column] }).from(schema.todos).all().map((r) => [r.id, r.v]));
      const open = listTodos({ status: "open" });
      const area = text(i.area);
      const step = area ? (getContextPrefs() as unknown as Record<string, { numbers: Record<string, number> } | undefined>)[area] : undefined;
      return {
        todos: open.map((t) => {
          let attached: unknown = null;
          try {
            attached = stored.get(t.id) ? JSON.parse(stored.get(t.id)!) : null;
          } catch {
            attached = null;
          }
          return { id: t.id, text: t.text, ticket: t.ticket || null, ticketSummary: t.ticket ? (getJiraTicket(t.ticket)?.summary ?? "") : "", updatedAt: t.updatedAt, attached };
        }),
        openIds: open.map((t) => t.id),
        numbers: step?.numbers ?? {},
        extra: area ? extraBlock(area as never) : "",
        displayOff: getTodoDisplayOff(),
      };
    },
  },
  {
    name: "todos.attach",
    group: "todos",
    label: "Attach something to todos",
    summary: "Keeps JSON under a slot of todos (matches): items [{ id, value }] — each value replaces what was attached, except the keys named in keep (kept from what is there: a part somebody else wrote). Needs the flow's permission todos.",
    input: [f("slot", "text", { required: true }), f("items", "json", { required: true }), f("keep", "list")],
    output: "{ attached }",
    writes: true,
    run: async (i, ctx) => {
      if (!ctx.perms.todos) throw new Error("This flow may not change todos — grant it under the flow's permissions (todos).");
      const column = TODO_SLOTS[text(i.slot)];
      if (!column) throw new Error(`There is no slot “${text(i.slot)}” on a todo.`);
      const items = (Array.isArray(i.items) ? i.items : []).slice(0, 500) as { id?: unknown; value?: unknown }[];
      if (ctx.dryRun) return { attached: 0 };
      const keep = (Array.isArray(i.keep) ? i.keep : []).map(text);
      const { getDb, schema } = await import("@/db");
      const { eq } = await import("drizzle-orm");
      const { emitChange } = await import("@/lib/events");
      const db = getDb();
      let n = 0;
      for (const it of items) {
        const id = Number(it.id);
        if (!Number.isInteger(id) || !it.value || typeof it.value !== "object") continue;
        const row = db.select({ v: schema.todos[column] }).from(schema.todos).where(eq(schema.todos.id, id)).get();
        if (!row) continue;
        let was: Record<string, unknown> = {};
        try {
          was = row.v ? (JSON.parse(row.v) as Record<string, unknown>) : {};
        } catch {
          was = {};
        }
        const next = { ...(it.value as Record<string, unknown>), ...Object.fromEntries(keep.filter((k) => was[k] !== undefined).map((k) => [k, was[k]])) };
        db.update(schema.todos).set({ [column]: JSON.stringify(next) }).where(eq(schema.todos.id, id)).run();
        n++;
      }
      if (n) emitChange("todos");
      return { attached: n };
    },
  },
];

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("knowledge", SERVICE_FLOW_ACTIONS);
