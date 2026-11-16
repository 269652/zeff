/**
 * Which of the kernel's flow actions a view may do as you — the way the built-in screens' own buttons act: your click is the yes, so no
 * flow permission is asked. The rest of the flow actions are for flows (automation: they need what they were granted). Client-safe.
 */
/** What a view may do by itself, without a click (<data do="…">): only reading — a conversation, what is unread, Google's write access,
 * the inbox templates, the local AI's settings and what answers at an address, the bank's status, the rows and fields of any database (db.query, db.get,
 * db.schema: an app of several databases reads them as you) — and marking read the mail you looked at for a moment. */
export const AUTO_ACTIONS = new Set(["db.query", "db.get", "db.schema", "mail.thread", "mail.unread", "mail.mark-read", "zeff.grants", "mail.inbox-templates", "localai.config", "localai.probe", "bank.status", "oauth.status"]);

/** What a button may do (<button do="…">): a reply drafted or sent (confirm= asks first), mails archived or marked read, a field set on
 * rows, a new inbox, the local AI tested and its settings saved, rows of any database added, changed and moved to the trash (db.add,
 * db.insert, db.update, db.archive; many at once: rows.update, rows.archive) — and all a view may do by itself. */
export const USER_ACTIONS = new Set(["db.query", "db.get", "db.schema", "db.add", "db.insert", "db.update", "db.archive", "rows.update", "rows.archive", "mail.thread", "mail.unread", "row.reply.draft", "row.op", "mail.archive", "mail.archive-read", "mail.mark-read", "rows.set", "mail.gmail-change", "zeff.grants", "mail.inbox-templates", "mail.new-inbox", "localai.config", "localai.probe", "localai.test", "localai.save", "bank.status", "bank.save", "bank.auth", "bank.sync", "bank.import", "oauth.status", "oauth.connect-url", "oauth.disconnect"]);

/**
 * What a view's with= gives (texts by name) made into what the action takes: a dotted name is a key of an object (where.Status=Open,
 * values.Amount=5 → { where: { Status: "Open" } }), a text of JSON where the action takes JSON or a list ([3,4], {"a":1}) is read, true / false where it takes yes or no.
 */
export function shapeInput(input: Record<string, unknown>, fields: { name: string; type: string }[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    const dot = k.indexOf(".");
    if (dot > 0 && dot < k.length - 1) {
      const head = k.slice(0, dot);
      const inner = out[head] && typeof out[head] === "object" && !Array.isArray(out[head]) ? (out[head] as Record<string, unknown>) : {};
      out[head] = { ...inner, [k.slice(dot + 1)]: v };
    } else out[k] = v;
  }
  for (const f of fields) {
    const v = out[f.name];
    // (yes / no as the action takes it: raw=true)
    if (f.type === "boolean" && typeof v === "string" && /^(true|false)$/i.test(v.trim())) out[f.name] = v.trim().toLowerCase() === "true";
    if ((f.type === "json" || f.type === "list") && typeof v === "string" && /^\s*[[{]/.test(v)) {
      try {
        out[f.name] = JSON.parse(v);
      } catch {
        /* left as it is: the action says what is wrong */
      }
    }
  }
  return out;
}
