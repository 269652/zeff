/**
 * Where a service's sign-in is a page in Zeff instead of a login in the automation Chrome: Jira's is its token on Settings → Secrets
 * (Zeff talks to Jira's REST API with it). Null: signed in in the automation Chrome. Pure (the attention bar uses it too).
 */
export const signInHref = (id: string): string | null => (id === "jira" ? "/settings/secrets#jira" : null);
