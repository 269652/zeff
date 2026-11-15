import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "./actions";
import type { FieldSpec } from "./types";

/**
 * The kernel's connector actions for flows (docs/zeff-kernel.md, "The line": a connector's driver is the kernel's — the automation
 * Chrome, Google's API): a source read into Zeff. A connector's port brings its sync as a flow marked `sync` (a step of the Sync menu)
 * that calls one of these — allowed only with the flow's `sync` permission for that source. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : "");

export const CONNECTOR_ACTIONS: FlowAction[] = [
  {
    name: "gcal.sync",
    group: "connectors",
    label: "Read Google Calendar",
    summary:
      "Your Google calendars read into Zeff's calendars — through Google's API or the automation Chrome, as the Connections page says; the weeks of the calendar settings (and, from–to, a range besides). Nothing changes in Google. Needs the flow's sync permission for gcalendar.",
    input: [f("from", "text", { help: "Also read this range: its first day, YYYY-MM-DD" }), f("to", "text", { help: "… and the day after its last" }), f("background", "boolean", { help: "By itself: not when the automation Chrome isn't running" }), f("by", "text", { help: "What started it (env.trigger.kind): \"schedule\" counts as by itself" })],
    output: "{ ok, message }",
    writes: true,
    run: async (i, ctx) => {
      if (!(ctx.perms.sync ?? []).includes("gcalendar")) throw new Error("This flow may not read Google Calendar into Zeff — grant “gcalendar” under the flow's permissions (sync).");
      if (ctx.dryRun) return { ok: true, message: "dry run: Google Calendar not read" };
      const from = day(i.from);
      const to = day(i.to);
      const { syncGoogleCalendar } = await import("@/lib/google/calendar-sync");
      return syncGoogleCalendar({ background: i.background === true || i.background === "true" || i.by === "schedule", ...(from && to ? { range: { from, to } } : {}) });
    },
  },
];

/**
 * Capability D: a driver lambda (kind driver — a scraper of a web app in the automation Chrome, a desktop app's reader) called. Kept like any
 * lambda: the plugin's as it ships, a fix of it (yours, the AI's) in the database. Allowed by the flow's `driver` permission naming it.
 */
CONNECTOR_ACTIONS.push({
  name: "driver.call",
  group: "connectors",
  label: "Run a driver",
  summary: "A driver lambda run (kind driver: it reaches the account's automation Chrome or a desktop app — a plugin's scraper): name, event. What it returns. Needs the flow's driver permission for it; a plugin's driver only while the plugin is granted exec.",
  input: [f("name", "text", { required: true }), f("event", "json")],
  output: "what the driver returns",
  writes: true,
  run: async (i, ctx) => {
    const name = String(i.name ?? "").trim();
    if (!(ctx.perms.driver ?? []).includes(name)) throw new Error(`This flow may not run the driver “${name}” — grant it under the flow's permissions (driver).`);
    if (ctx.dryRun) return { ok: true, message: `dry run: ${name} not run` };
    // (Tests: a stand-in for the Chrome a driver reads — the scraper itself needs the real one)
    const stand = (globalThis as { __zeffDriverStandIn?: (name: string, event: unknown) => unknown }).__zeffDriverStandIn;
    if (stand) return stand(name, i.event);
    const { getLambda } = await import("../lambdas/store");
    if (getLambda(name)?.manifest.kind !== "driver") throw new Error(`There is no driver “${name}”.`);
    const { invokeLambda } = await import("../lambdas/run");
    const r = await invokeLambda(name, i.event && typeof i.event === "object" ? i.event : {}, { asDriver: true });
    if (!r.ok) throw new Error(r.error);
    return r.result;
  },
});

// What a plugin's sync flow needs of the kernel around its driver — generic, no plugin's own.
CONNECTOR_ACTIONS.push(
  {
    name: "messages.save",
    group: "connectors",
    label: "Keep messages",
    summary: "Messages a connector read (a driver's: mails, chats) kept with the others — the inbox, the chats, the todos found in them, the knowledge read them: source (whose — needs the flow's sync permission for it), messages [{ id?, from, to?, subject, preview, receivedAt, folder, … } as the mail sync keeps them]. Each kept once.",
    input: [f("source", "text", { required: true }), f("messages", "json", { required: true })],
    output: "{ added, total, what }",
    writes: true,
    run: async (i, ctx) => {
      const source = String(i.source ?? "").trim();
      if (!(ctx.perms.sync ?? []).includes(source)) throw new Error(`This flow may not keep messages of ${source} — grant “${source}” under the flow's permissions (sync).`);
      const list = Array.isArray(i.messages) ? (i.messages as never[]) : [];
      if (ctx.dryRun) return { added: 0, total: list.length, what: "dry run" };
      const r = (await import("@/lib/mail/store")).saveMails(list);
      const { t } = await import("@/lib/i18n/server");
      return { ...r, what: t("{added} new · {total} in all", { added: r.added, total: r.total }) };
    },
  },
  {
    name: "messages.count",
    group: "connectors",
    label: "How many messages a folder has",
    summary: "How many messages are kept in a folder (WhatsApp, Signal, a mailbox) — e.g. whether a connector read it before.",
    input: [f("folder", "text", { required: true })],
    output: "{ count }",
    run: async (i) => {
      const { getDb, schema } = await import("@/db");
      const { sql } = await import("drizzle-orm");
      const folder = String(i.folder ?? "");
      return { count: getDb().select({ n: sql<number>`count(*)` }).from(schema.emails).where(sql`${schema.emails.folder} = ${folder}`).get()?.n ?? 0 };
    },
  },
  {
    name: "chrome.up",
    group: "connectors",
    label: "Is the automation Chrome running",
    summary: "Whether this account's automation Chrome answers — nothing is started for it. A sync by itself (by: schedule) waits while it doesn't.",
    input: [],
    output: "{ up }",
    run: async () => ({ up: await (await import("@/plugins/drivers")).automationUp(undefined, 3000) }),
  },
  {
    name: "login.notice",
    group: "connectors",
    label: "Ask to sign in, or say it is fine again",
    summary: "A service's sign-in notice (Zeff's attention, as the Connections page shows it): service (its id, e.g. keep), message — shown when the message says a sign-in is needed, gone when ok is true.",
    input: [f("service", "text", { required: true }), f("message", "text"), f("ok", "boolean")],
    output: "{ shown }",
    writes: true,
    run: async (i, ctx) => {
      const service = String(i.service ?? "").trim();
      if (!/^[a-z][a-z0-9-]{0,39}$/.test(service)) throw new Error("Which service? (its id)");
      if (ctx.dryRun) return { shown: false };
      const a = await import("@/lib/attention");
      if (i.ok === true || i.ok === "true") {
        a.clearAttention(`login:${service}`);
        return { shown: false };
      }
      const message = String(i.message ?? "").slice(0, 300);
      if (!a.needsSignIn(message) && !/sign[- ]in|anmeld/i.test(message)) return { shown: false };
      a.raiseLogin(service as never, message);
      return { shown: true };
    },
  },
  {
    name: "workspace.after-sync",
    group: "connectors",
    label: "The databases after a sync",
    summary: "What a sync brought, carried on: the Workspace's databases with a pipeline read again (as after every built-in sync).",
    input: [],
    output: "{ ok }",
    writes: true,
    run: async (_i, ctx) => {
      if (ctx.dryRun) return { ok: true };
      await (await import("@/plugins/workspace/pipeline")).runPipelinesAfterSync().catch((e) => console.error("[workspace] the pipelines failed", e));
      return { ok: true };
    },
  },
);

// The kernel's own: always there (read with the other flow actions — flows/actions.ts flowActions()).
extensionPoint<FlowAction[]>("workspace.flowActions").contribute("core:connectors", CONNECTOR_ACTIONS);

// The connectors whose reading is a kernel step (Teams, WhatsApp, Signal): one action for all — the source named, allowed by the flow's `sync`.
extensionPoint<FlowAction[]>("workspace.flowActions").contribute("core:connector-steps", [
  {
    name: "connector.sync",
    group: "connectors",
    label: "Read a connector",
    summary: "A connector's messages read into Zeff — whatsapp (WhatsApp Web's chat list), signal (Signal Desktop), outlook-mail / gmail / imap-mail (that plugin's mailboxes),  — as its sync does. By itself (by: schedule) only while what it reads is running. Needs the flow's sync permission for that source.",
    input: [f("source", "text", { required: true, options: ["whatsapp", "signal", "outlook-mail", "gmail", "imap-mail"] }), f("background", "boolean", { help: "By itself: not when what it reads isn't running" }), f("by", "text", { help: "What started it (env.trigger.kind): \"schedule\" counts as by itself" })],
    output: "{ ok, message }",
    writes: true,
    run: async (i, ctx) => {
      const { CONNECTOR_STEPS, MAIL_PLUGINS, runConnectorSync, runMailConnectorSync } = await import("@/lib/sync/registry");
      const source = String(i.source ?? "").trim() as (typeof CONNECTOR_STEPS)[number];
      const all: readonly string[] = [...CONNECTOR_STEPS, ...MAIL_PLUGINS];
      if (!all.includes(source)) throw new Error(`connector.sync reads ${all.join(", ")} — not “${source}”.`);
      if (!(ctx.perms.sync ?? []).includes(source)) throw new Error(`This flow may not read ${source} into Zeff — grant “${source}” under the flow's permissions (sync).`);
      if (ctx.dryRun) return { ok: true, message: `dry run: ${source} not read` };
      const background = i.background === true || i.background === "true" || i.by === "schedule";
      if ((MAIL_PLUGINS as readonly string[]).includes(source)) return runMailConnectorSync(source as (typeof MAIL_PLUGINS)[number], background);
      return runConnectorSync(source, background);
    },
  },
]);
