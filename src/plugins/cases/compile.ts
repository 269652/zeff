import { getSqlite } from "@/db";
import { runAi } from "@/lib/ai";
import { promptText } from "@/lib/prompts";
import type { CaseSummary } from "./shared";
import { checkedSummary, dueForSummary, sentences, SUMMARY_INSTRUCTIONS, SUMMARY_SCHEMA, summaryPrompt, type SourceText, type SummaryAnswer } from "./core-summary";
import { assignParties } from "./parties";
import { getCase, listCases, sourcesOf, updateCase } from "./store";

/**
 * A case summed up (the Cases plugin): the AI reads its sources — the mails, the letters' text, the todos —
 * and says what the matter is, who it is with, the money (whole claim, still open, instalment), the next
 * payment or deadline and where to pay. Every value is checked (an IBAN by its check digits, a date by
 * its form, an amount by being one); what doesn't hold is left empty. Again only when new sources came.
 */

// (the schema, the instructions, the checking: the pure core's — the port's flow uses the same: core-summary.ts)
const SCHEMA = SUMMARY_SCHEMA;
type Answer = SummaryAnswer;
export const INSTRUCTIONS = SUMMARY_INSTRUCTIONS;
export { sentences };

/** What the AI said, checked. */
export const checked = (a: Answer, key: string, sources: number): CaseSummary => checkedSummary(a, key, sources, new Date().toISOString());

/** What the AI reads of one case: its sources, newest last, each with as much as it says. */
function promptFor(caseId: number): string {
  const c = getCase(caseId)!;
  const d = getSqlite();
  const texts: SourceText[] = [...sourcesOf(caseId)].reverse().map((s) => {
    const [kind, id] = [s.ref.slice(0, s.ref.indexOf(":")), s.ref.slice(s.ref.indexOf(":") + 1)];
    const base = { ref: s.ref, at: s.at, title: s.title };
    if (kind === "mail") {
      const m = d.prepare("select from_name fromName, subject, preview from emails where key = ?").get(id) as SourceText["mail"] | undefined;
      return m ? { ...base, mail: m } : base;
    }
    if (kind === "doc") {
      const doc = d.prepare("select name, summary, text from documents where id = ?").get(Number(id)) as SourceText["doc"] | undefined;
      return doc ? { ...base, doc } : base;
    }
    if (kind === "todo") {
      const t = d.prepare("select text, note, status from todos where id = ?").get(Number(id)) as SourceText["todo"] | undefined;
      return t ? { ...base, todo: t } : base;
    }
    return base;
  });
  return summaryPrompt(c, texts, promptText("cases-compile", INSTRUCTIONS));
}

export type CompileDeps = { ask: (prompt: string, schema: object) => Promise<Answer> };

const realAsk = (): CompileDeps["ask"] => async (prompt, schema) => (await runAi<Answer>(prompt, schema, { task: "cases-compile", timeoutMs: 4 * 60000, maxBudgetUsd: 0.3 })).output ?? {};

const flag = globalThis as { __zeffCasesCompile?: boolean };

/**
 * The cases summed up: those never summed up and those with new sources since (`force`: these `ids` anyway).
 * At most `limit` per run, the newest activity first. How many were done.
 */
export async function compileCases(opts: { ids?: number[]; force?: boolean; limit?: number; ask?: CompileDeps["ask"] } = {}): Promise<{ compiled: number; error?: string }> {
  if (flag.__zeffCasesCompile) return { compiled: 0, error: "already running" };
  flag.__zeffCasesCompile = true;
  let compiled = 0;
  try {
    const ask = opts.ask ?? realAsk();
    // (A debt you wrote down yourself is never summed up anew; one summed up before the creditor was asked for: once more — core-summary.ts.)
    const all = listCases();
    const due = dueForSummary(all, Object.fromEntries(all.map((c) => [c.id, sourcesOf(c.id).length])), opts);
    for (const c of due) {
      const answer = await ask(promptFor(c.id), SCHEMA);
      updateCase(c.id, { compiled: checked(answer, c.key, sourcesOf(c.id).length) });
      // (What was paid since — a todo ticked off today — counted in the new summary too.)
      (await import("./todo-paid")).settleCase(c.id);
      // Its creditor and who collects it as contacts.
      assignParties(c.id);
      compiled++;
    }
    return { compiled };
  } catch (e) {
    return { compiled, error: e instanceof Error ? e.message : String(e) };
  } finally {
    flag.__zeffCasesCompile = false;
  }
}
