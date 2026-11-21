# Security: what to trust a plugin with

An external plugin is code someone wrote, running on your computer, next to your mail, tickets and source code.
Zeff limits what a plugin can reach, but **only some permissions are limits you can rely on**. Read this before you
turn on a plugin you didn't write.

## The short version

- A plugin **without `exec`** is contained: it can only do what its permissions say, through Zeff's API, from a sandboxed
  frame. That's a real boundary.
- A plugin **with `exec`** runs programs **with your rights**. Zeff can't contain that: such a plugin can read your files,
  use your logins, send network requests and call Zeff however it likes. Turn it on only if you'd run its code
  directly.
- A plugin with **`prompt`** can tell your workers what to do. Workers run with your repos and tools: treat its rules
  like instructions you'd give yourself.

## Permissions, in what they really mean

| Permission | What it is | Boundary? |
| --- | --- | --- |
| `work.read` | read sessions, logs (which can contain code, tickets, mail excerpts), results | yes (API checks) |
| `work.write` | start workers that act in your repos — a worker can edit files and run commands, within Work's own rules (permission mode, isolation) | yes for the API; what a started worker may do is Work's setting |
| `todos.read` / `todos.write` | read your todos / add todos | yes |
| `prompt` | its text is appended to every worker's rules | no: it steers the AI |
| `network` | its panels may contact any website (so what they read from Zeff can leave) | yes (the frame's CSP) |
| `exec` | start programs with your rights | **no** |

A plugin with `exec` can also use the API through its token for anything its permissions list (they apply to the
API), but nothing stops it from reading Zeff's data folder directly. `exec` means full trust.

## What Zeff does

- **Panels are sandboxed** (a frame without an origin of its own, a `Content-Security-Policy` that forbids other
  origins). They can't read Zeff's page, cookies or storage, can't call Zeff's API directly, and only reach Zeff through
  the permission-checked bridge. Only the plugin's `ui/` folder can be loaded, with paths checked against `..`,
  dotfiles and symbolic links out of the folder.
- **Everything is off until you turn it on**, per account, with the permissions listed first. A plugin that is updated to
  ask for more doesn't get the new permissions until you turn it off and on again.
- **The API checks permissions on the server**, on every call, for the plugin the token or the page names. Another
  website open in your browser can't call it (Zeff's usual guard).
- **Hooks are bounded**: no shell, a time limit, at most four at once, Zeff's own secrets removed from their environment.
- **Tokens** (`ZEFF_EXT_TOKEN`) are HMACs made with a secret in your Zeff data folder (`ext-secret`, owner-only); each
  one is for one plugin.

## Zeff Secrets (Settings → Secrets)

The tokens and logins Zeff's own plugins need — Jira's address, login and Personal Access Token (or Cloud's API token), your own Microsoft
or Google app, the knowledge server's token — are entered on **Settings → Secrets**, not in `.env` or in chat.

- **Declared by the plugin:** each plugin that needs one lists it in `src/plugins/<id>/secrets.ts` (name, label, what it is, whether it is a
  secret or just an address/login); `src/plugins/secrets-modules.ts` collects those of the installed plugins. The page shows them per plugin
  (`/settings/secrets#jira` is Jira's section — its "Sign in" buttons link there).
- **Stored encrypted** (AES-256-GCM, the key in `<data>/.secret-key`, never in the database), per account — in the account's own database
  (table `secrets`), or, if you choose, in a database of its own beside it (`secrets.db`), so a copied `zeff.db` carries none.
- **Never sent back:** once saved, a secret is shown only as *set* / *not set*; you can replace or clear it. Addresses and logins
  (`secret: false`) are shown. Values never go into logs, error messages or a program's whole environment — each plugin reads the names it
  declared with `getSecret(name)` (`src/lib/secrets/store.ts`), which still finds a value only in `.env` until you move it over ("Copy from .env").
- **Jira** uses them for its REST API (`src/lib/jira/connection.ts`, `rest.ts`): Server / Data Center with `Authorization: Bearer <PAT>`,
  Cloud with your e-mail and an API token (basic auth). "Test connection" asks `/rest/api/2/myself`. Without a token the Jira MCP server
  (mcp-atlassian, from `JIRA_MCP_COMMAND` or `.mcp.json`) is the fallback, and only the Jira names are handed to it.

## What Zeff does not do

- It doesn't check who wrote a plugin or sign anything: **you** decide to trust it.
- It doesn't sandbox programs a plugin starts (`exec`), nor the MCP servers it gives workers: both run with your rights.
- It doesn't inspect rule files: whatever they say, workers read.
- Plugins are shared by all accounts on the computer (the folder is), but turned on **per account**.

## Habits

- Prefer plugins that need few permissions, and read the manifest and scripts of ones that need `exec`.
- Keep secrets (API keys) out of the plugin folder if you share it; read them from the environment of the Zeff process
  (`env` in `zeff-launcher.json`) in your hook instead.
- Escape what you show in a panel: run summaries, ticket and todo texts come from other people.
- A plugin you stop trusting: turn it off on the Plugins page, then delete its folder.
