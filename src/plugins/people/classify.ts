import { getSqlite } from "@/db";
import { runAi } from "@/lib/ai";
import { clip } from "@/lib/text";
import { promptText } from "@/lib/prompts";
import { isInstalled } from "@/plugins/state";
import { claimsOf } from "./graph";
import { isCircle, type Circle, type ContactKind, type Person } from "./shared";
import { listPeople, relationsOf, setCircle, setKind } from "./store";

/**
 * What each contact is (the People plugin), as the AI reads it: a person or an organisation (a bank, an authority, a company),
 * and their circle (family, friends, work, authorities & creditors, services). The AI gets what Zeff knows of each — relations,
 * roles, addresses, accounts, cases, how you are in touch — and decides; no list of names or words does. Many at once (one call
 * per batch). What you chose stays. Server only.
 */

import { CLASSIFY_BATCH, INSTRUCTIONS, SCHEMA, classifyPrompt, type ClassifyAnswer } from "./classify-core";

export { INSTRUCTIONS, type ClassifyAnswer };
export type ClassifyDeps = { ask: (prompt: string, schema: object) => Promise<ClassifyAnswer> };

/** What Zeff knows of a contact, in a few lines (for the AI). */
export function classifyEvidence(p: Person, d: ReturnType<typeof getSqlite>): string {
  const lines = [`## ${p.id}: ${p.name}${p.aliases.length ? ` (auch: ${p.aliases.slice(0, 4).join(", ")})` : ""}`];
  if (p.emails.length) lines.push(`Mail: ${p.emails.slice(0, 3).join(", ")}`);
  if (p.whatsapp) lines.push(`WhatsApp-Chat: ${p.whatsapp}`);
  if (p.accounts.length) lines.push(`Jira-Konto: ${p.accounts.map((a) => a.value).join(", ")}`);
  const rel = relationsOf(p.id).out.map((r) => r.rel);
  if (rel.length) lines.push(`Beziehung zu mir: ${rel.slice(0, 4).join(", ")}`);
  const claims = claimsOf(p.id).filter((c) => c.status !== "rejected" && c.kind !== "commitment").slice(0, 4);
  for (const c of claims) lines.push(`- ${clip(c.text, 160)}`);
  if (p.compiled?.connection) lines.push(`Was uns verbindet: ${clip(p.compiled.connection, 300)}`);
  try {
    const cases = d.prepare("select c.label, c.compiled, cp.role from case_parties cp join cases c on c.id = cp.case_id where cp.person_id = ? limit 3").all(p.id) as { label: string; compiled: string | null; role: string }[];
    for (const c of cases) lines.push(`Vorgang ${c.label} (${c.role === "creditor" ? "Gläubiger" : c.role === "collector" ? "treibt ein" : "Zahlungsempfänger"}): ${clip((JSON.parse(c.compiled ?? "{}") as { title?: string }).title, 100)}`);
  } catch {
    // no cases kept
  }
  try {
    const teams = (d.prepare("select count(*) n from teams_messages where sender_name = ? collate nocase").get(p.name) as { n: number }).n;
    if (teams) lines.push(`Teams-Nachrichten von ihr: ${teams}`);
  } catch {
    // no Teams kept
  }
  return lines.join("\n");
}

const realAsk = (): ClassifyDeps["ask"] => async (prompt, schema) => (await runAi<ClassifyAnswer>(prompt, schema, { task: "people-classify", timeoutMs: 4 * 60000, maxBudgetUsd: 0.3 })).output ?? {};

/** The contacts to place (not yet placed; `force`: all, `ids`: these) — in batches, each with what Zeff knows of them (for the AI). */
export function classifyInput(opts: { ids?: number[]; force?: boolean } = {}): { batches: { ids: number[]; blocks: string[] }[]; asked: number } {
  const todo = listPeople().filter((p) => (!opts.ids || opts.ids.includes(p.id)) && !(p.kindSource === "manual" && p.circleSource === "manual") && (opts.force || !p.kindSource || !p.circleSource));
  const d = getSqlite();
  const batches: { ids: number[]; blocks: string[] }[] = [];
  for (let i = 0; i < todo.length; i += CLASSIFY_BATCH) {
    const batch = todo.slice(i, i + CLASSIFY_BATCH);
    batches.push({ ids: batch.map((p) => p.id), blocks: batch.map((p) => classifyEvidence(p, d)) });
  }
  return { batches, asked: todo.length };
}

/** What the AI said of a batch, kept (yours stays). How many changed. */
export function applyClassified(ids: number[], a: ClassifyAnswer | null | undefined): number {
  let changed = 0;
  for (const x of a?.people ?? []) {
    const p = listPeople().find((b) => b.id === Number(x.id) && ids.includes(b.id));
    if (!p) continue;
    const kind: ContactKind | null = x.kind === "organization" || x.kind === "person" ? x.kind : null;
    if (kind && setKind(p.id, kind, "ai")) changed++;
    const circle: Circle | "" = isCircle(String(x.circle ?? "")) ? (x.circle as Circle) : "";
    // An empty circle only when nothing was set yet: the AI saying "unclear" doesn't take one back.
    if ((circle || !p.circleSource) && setCircle(p.id, circle, "ai")) changed++;
  }
  return changed;
}

/**
 * The contacts not placed yet (`force`: all, `ids`: these) — kind and circle by the AI, in batches. Yours stay. How many changed.
 * Without the LLM plugin: nothing.
 */
export async function classifyContacts(opts: { ids?: number[]; force?: boolean; ask?: ClassifyDeps["ask"]; myName?: string } = {}): Promise<{ changed: number; asked: number }> {
  if (!opts.ask && !isInstalled("llm")) return { changed: 0, asked: 0 };
  const { batches, asked } = classifyInput(opts);
  if (!asked) return { changed: 0, asked: 0 };
  const ask = opts.ask ?? realAsk();
  let changed = 0;
  for (const b of batches) changed += applyClassified(b.ids, await ask(classifyPrompt(promptText("people-classify", INSTRUCTIONS), opts.myName, b.blocks), SCHEMA));
  return { changed, asked };
}
