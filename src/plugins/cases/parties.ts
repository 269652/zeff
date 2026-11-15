import { emitChange } from "@/lib/events";
import { isInstalled } from "@/plugins/state";
import { casesDb, getCase, listCases } from "./store";

/**
 * Who a case is with (the Cases plugin): its parties as contacts of the People plugin — the creditor (who it is owed to: a
 * bank, an authority, a company, a person), who collects it (a bailiff, a collection agency, a lawyer) and who is paid (whose
 * account). As the AI named them when it summed the case up — the contacts found by their names, or made (a person or an
 * organisation, as the AI said); what you chose stays. Server only.
 */

export const PARTY_ROLES = ["creditor", "collector", "payee"] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];
export type PartySource = "ai" | "manual";
export type Party = { personId: number; name: string; source: PartySource };

const RANK: Record<PartySource, number> = { ai: 1, manual: 2 };

/** A case's parties, by role (a contact gone: none). */
export function partiesOf(caseId: number): Partial<Record<PartyRole, Party>> {
  const d = casesDb();
  const rows = d.prepare("select role, person_id, source from case_parties where case_id = ?").all(caseId) as { role: PartyRole; person_id: number; source: PartySource }[];
  const out: Partial<Record<PartyRole, Party>> = {};
  if (!rows.length || !isInstalled("people")) return out;
  for (const r of rows) {
    const p = d.prepare("select name from people where id = ?").get(r.person_id) as { name: string } | undefined;
    if (p) out[r.role] = { personId: r.person_id, name: p.name, source: r.source === "manual" ? "manual" : "ai" };
  }
  return out;
}

/** A party set (null: taken off). The AI's word doesn't go over yours. Whether it changed. */
export function setParty(caseId: number, role: PartyRole, personId: number | null, source: PartySource): boolean {
  const d = casesDb();
  const had = d.prepare("select person_id, source from case_parties where case_id = ? and role = ?").get(caseId, role) as { person_id: number; source: PartySource } | undefined;
  if (had && RANK[had.source] > RANK[source]) return false;
  if (personId == null) {
    if (!had) return false;
    d.prepare("delete from case_parties where case_id = ? and role = ?").run(caseId, role);
  } else {
    if (had?.person_id === personId && had.source === source) return false;
    d.prepare("insert into case_parties (case_id, role, person_id, source) values (?, ?, ?, ?) on conflict (case_id, role) do update set person_id = excluded.person_id, source = excluded.source").run(caseId, role, personId, source);
  }
  emitChange("todos");
  return true;
}

// (who a name means is the People plugin's: people/contact.ts — the port's flow asks it through people.contacts)
export { contactFor } from "@/plugins/people/contact";
import { contactFor } from "@/plugins/people/contact";

/** A case's parties as the AI named them in its summary — what you chose stays. A summary without them (older): none yet. */
export function assignParties(caseId: number): void {
  const c = getCase(caseId);
  const s = c?.compiled;
  if (!c || !s || s.manual || s.creditor === undefined) return;
  const creditor = s.creditor ? contactFor(s.creditor, true, s.creditorKind, true) : null;
  if (creditor) setParty(caseId, "creditor", creditor, "ai");
  // Who collects it: the one named — found, else the case's person (when not the creditor), else made.
  const collector = s.collector ? (contactFor(s.collector, false) ?? (c.personId && c.personId !== creditor ? c.personId : contactFor(s.collector, true, s.collectorKind))) : null;
  if (collector && collector !== creditor) setParty(caseId, "collector", collector, "ai");
  // Who is paid: the payee's contact (not made — an account holder isn't a contact of its own).
  const payee = s.payee ? contactFor(s.payee, false) : null;
  if (payee) setParty(caseId, "payee", payee, "ai");
}

/** Every running case's parties, as their summaries name them. */
export function assignAllParties(): void {
  for (const c of listCases()) if (c.status === "open" && c.compiled && !c.compiled.manual) assignParties(c.id);
}
