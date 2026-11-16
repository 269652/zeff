import type { ProfileTerm } from "./shared";
import { termsOf, type ProfileInput } from "./profile-terms";
export { termsOf, type ProfileInput };

/**
 * What Zeff knows about you that news can be matched against — gathered on this PC, never sent anywhere:
 *   · your facts (hobbies, family, places: "Lauras Hobby — klettert", "Paula: Rennrad"),
 *   · what your open todos are about (the words that come up, with the todo that made them: T-132),
 *   · what your open tickets are about (PROJ-364 …).
 * The scoring gives an item with such a word a lift and says why ("work: T-132"), so a headline about the thing you are
 * working on, or the thing a friend loves, comes up without you having named it as an interest.
 */

/** Gathers the profile from this Zeff: facts, open todos, open Jira tickets (each only if it is there). */
export async function profileTerms(): Promise<ProfileTerm[]> {
  const input: ProfileInput = { facts: [], todos: [], tickets: [] };
  try {
    input.facts = (await import("@/lib/facts")).listFacts(200).map((f) => ({ subject: f.subject, text: f.text }));
  } catch {
    // no facts
  }
  try {
    input.todos = (await import("@/lib/todos/store")).listTodos({ status: "open" }).map((t) => ({ ref: t.ref, text: t.text }));
  } catch {
    // no todos
  }
  try {
    const { getDb, schema } = await import("@/db");
    const { ne } = await import("drizzle-orm");
    input.tickets = getDb().select({ key: schema.jiraTickets.key, summary: schema.jiraTickets.summary }).from(schema.jiraTickets).where(ne(schema.jiraTickets.statusCategory, "done")).limit(60).all();
  } catch {
    // no Jira
  }
  return termsOf(input);
}
