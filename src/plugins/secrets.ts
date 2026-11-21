/**
 * The secrets a plugin brings: each plugin that needs a token or a login has a module (src/plugins/<id>/secrets.ts) listing them.
 * They show on Settings → Secrets under the plugin's name, kept encrypted per account (src/lib/secrets/store.ts), and the plugin
 * reads them with `getSecret(name)` — which still finds a value in `.env` that was never moved. Types only.
 */
export type PluginSecret = {
  /** Its name, the environment variable it replaces (capital letters, digits, _). */
  name: string;
  label: string;
  what: string;
  /** false: an address or a login — shown on the page. Default: true (never shown again once saved). */
  secret?: boolean;
};
