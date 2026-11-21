/**
 * The connectors' ports (zeff-plugins/plugins/<id>-ext) — the mail plugins (WhatsApp, Signal, GitLab, Teams: scripts/port-drivers.mts; Jira: scripts/port-jira.mts; scripts/port-drivers.mts — their scrapers in the plugin): each a package with one sync flow, a step of the Sync
 * menu in the place of the built-in's (`replaces`), that calls the kernel's connector.sync for its source. Reading the source stays the
 * kernel's driver (the automation Chrome, Signal Desktop, Teams' API); the built-in counts as there while its port is on (state.ts
 * PROVIDED_BY), so its actions (a reply sent), its settings and pages keep working.
 *
 *   npx tsx scripts/port-connectors.mts [<zeff-plugins folder>]     (default ../zeff-plugins)
 */
import fs from "node:fs";
import { keepCatalogFields } from "./lib/catalog-fields.mts";
import path from "node:path";

const repo = path.resolve(process.argv[2] ?? "../zeff-plugins");

const CONNECTORS = [
  // The mail plugins share the mail step: each port's flow reads its own mailboxes (connector.sync "outlook-mail" …), the step the others'.
  {
    builtin: "outlook-mail",
    name: "Outlook Mail",
    icon: "✉️",
    what: "Your Outlook inbox's latest mails — read through Microsoft's API or the automation Chrome, as the Connections page says; none marked read.",
    description: "Reads your Outlook inbox's latest mails into Zeff — through Microsoft's API or Outlook Web in the account's automation Chrome, as the Connections page says; none marked read. Replies open as drafts in Outlook.",
    shared: true,
  },
  {
    builtin: "gmail",
    name: "Gmail",
    icon: "📮",
    what: "Your Gmail accounts' latest mails — read through Gmail's API or the automation Chrome, as the Connections page says; none marked read.",
    description: "Reads your Gmail accounts' latest mails into Zeff — through Gmail's API or Gmail in the account's automation Chrome, as the Connections page says; none marked read. With Gmail's write access, replies are sent from Zeff on your click.",
    shared: true,
  },
  {
    builtin: "imap-mail",
    name: "E-Mail (IMAP / POP3)",
    icon: "📧",
    what: "Your mail accounts' latest mails (IMAP / POP3, each under its name) — read from their servers; none marked read.",
    description: "Reads your mail accounts (IMAP / POP3) into Zeff — each under its name, from its own server; none marked read. Replies are sent over the account's SMTP server on your click.",
    shared: true,
  },
] as const;

for (const c of CONNECTORS) {
  const id = `${c.builtin}-ext`;
  const dir = path.join(repo, "plugins", id);
  fs.mkdirSync(dir, { recursive: true });
  const manifestFile = path.join(dir, "zeff-plugin.json");
  const had = fs.existsSync(manifestFile) ? (JSON.parse(fs.readFileSync(manifestFile, "utf8")) as { version?: string }) : {};
  const version = had.version ?? "1.0.0";
  fs.writeFileSync(
    manifestFile,
    JSON.stringify({ ...keepCatalogFields(had), $schema: "http://127.0.0.1:9333/ext/sdk/zeff-plugin.schema.json", id, name: c.name, version, description: c.description, author: "Zeff", apiVersion: 1, permissions: [], contributes: { workspacePackages: [`${c.builtin}.package.json`] } }, null, 2) + "\n",
  );
  const flow = {
    name: `${c.builtin}.sync`,
    title: `Read ${c.name}`,
    description: c.what,
    inputs: [],
    nodes: [{ id: "read", kind: "action", action: "connector.sync", input: { source: c.builtin, by: "{{ env.trigger.kind }}" } }],
    output: "{{ steps.read }}",
    requested: { sync: [c.builtin] },
    triggers: [{ kind: "schedule", everyMinutes: 15, from: "08:00", to: "19:00" }],
    // (a mail plugin's flow stands beside the shared mail step, replacing none of it)
    sync: { label: c.name, what: c.what, ...("shared" in c ? {} : { replaces: (c as { builtin: string }).builtin }) },
  };
  const pkg = {
    format: 1,
    id,
    version,
    name: c.name,
    description: `${c.name} read into Zeff — a sync of the Sync menu.`,
    icon: c.icon,
    localize: true,
    items: [
      { id: "i1", kind: "page", title: c.name, icon: c.icon, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `${c.what} Its sync is the flow below — a step of the Sync menu; how often it runs: the Sync settings.` }] }] } },
      { id: "i2", parent: "i1", kind: "page", title: `Read ${c.name}`, icon: "⚡", content: { type: "doc", content: [{ type: "paragraph" }] }, flow },
    ],
  };
  fs.writeFileSync(path.join(dir, `${c.builtin}.package.json`), JSON.stringify(pkg, null, 2) + "\n");
  fs.writeFileSync(
    path.join(dir, "README.md"),
    `# ${c.name}

${c.description}

- **A sync of the Sync menu.** The package brings one flow, \`${c.builtin}.sync\`, marked as a sync in the place of the built-in's step:
  run it there, see how it last went, set how often on the Sync settings page. By itself it runs only between 8 and 19 o'clock.
- **The reading is Zeff's.** Reading ${c.name} is a driver of Zeff's kernel; the flow calls it through \`connector.sync\`, which needs the
  flow's permission \`sync: ${c.builtin}\` — you allow it when you switch.
- **Everything else stays.** Replies from Zeff, the inbox, the chats and the todos found in them keep working.
- **Generated** by Zeff's \`scripts/port-connectors.mts\`.

**Switching:** Plugins → ${c.name} (built-in) → *Switch to the plugin*.
`,
  );
  console.log(`${dir}: ${c.name} ${version}`);
}
