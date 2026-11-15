import { caseRefs } from "@/lib/todos/similar";
import { caseKey, caseTitle, type CaseSummary } from "./shared";

/**
 * Cases' pure core: what a case stands at (its letters' open amount less what was paid since), where it pays to, and the overview of the
 * running cases — worked out of plain data, nothing read here. The built-in (bank.ts, payments.ts, block-actions.ts) and its port
 * (zeff-plugins: cases-ext, its lambdas — scripts/port-cases.mts bundles this) say the same out of the same rows. Client-safe.
 */

export type Paid = { date: string; amount: number };
export type CaseLite = { id: number; key: string; label: string; status: string; personId: number | null; compiled: CaseSummary | null };
export type Account = { name: string; iban: string; bic?: string | null };
export type CasePayment = { name: string; iban: string; bic: string; purpose: string; amount: number | null };

/** What is paid on a case since its summary was made (its payments oldest first), what is open now, the last payment. */
export function standingOf(c: Pick<CaseLite, "compiled"> | null | undefined, payments: Paid[]): { paidSince: number; open: number | null; last: Paid | null } {
  const since = c?.compiled?.at?.slice(0, 10) ?? "";
  const paidSince = payments.filter((p) => p.date >= since).reduce((s, p) => s + p.amount, 0);
  const open = c?.compiled?.open != null ? Math.max(0, Math.round((c.compiled.open - paidSince) * 100) / 100) : null;
  const last = payments.at(-1);
  return { paidSince, open, last: last ? { date: last.date, amount: last.amount } : null };
}

/** Where a case pays to: what its summary says, else its person's account (`account`) — the instalment (else what is open) as amount. */
export function paymentOf(c: Pick<CaseLite, "label" | "compiled">, account: Account | null): CasePayment | null {
  const s = c.compiled;
  const amount = s?.installment ?? s?.open ?? null;
  if (s?.iban) return { name: s.payee || s.party || c.label, iban: s.iban, bic: s.bic, purpose: s.purpose || c.label, amount };
  return account ? { name: account.name, iban: account.iban, bic: account.bic ?? "", purpose: s?.purpose || c.label, amount } : null;
}

export type OverviewCase = { id: number; rowId: number | null; title: string; label: string; person: string; creditor: string; collector: string; open: number | null; nextDue: string | null; nextWhat: string; payment: CasePayment | null; summed: boolean };
export type CasesOverview = { figures: { open: number; dueSoon: number; overdue: number; running: number }; cases: OverviewCase[]; debtsDb: number | null };

/**
 * The cases database's overview: the running cases (not done, not your own debts) by what is due first, each with who it is owed to and
 * where it pays to; the money in figures. Everything it needs handed in: the cases, their payments, parties' and people's names, the
 * accounts of the people a case has, the rows the cases are in, today.
 */
export function overviewOf(v: {
  cases: CaseLite[];
  payments: Record<number, Paid[]>;
  parties: Record<number, { creditor?: string; collector?: string }>;
  names: Record<number, string>;
  accounts: Record<number, Account | null>;
  rows: Record<string, number>;
  today: string;
  in30: string;
  debtsDb: number | null;
}): CasesOverview {
  const cases = v.cases
    .filter((c) => c.status === "open" && !c.compiled?.done && !c.compiled?.manual)
    .map(
      (c): OverviewCase => ({
        id: c.id,
        rowId: v.rows[`case:${c.id}`] ?? null,
        title: caseTitle(c),
        label: c.label,
        person: c.personId ? (v.names[c.personId] ?? "") : "",
        creditor: v.parties[c.id]?.creditor ?? "",
        collector: v.parties[c.id]?.collector ?? "",
        open: c.compiled?.open == null ? null : standingOf(c, v.payments[c.id] ?? []).open,
        nextDue: c.compiled?.nextDue ?? null,
        nextWhat: c.compiled?.nextWhat ?? "",
        payment: paymentOf(c, c.personId ? (v.accounts[c.personId] ?? null) : null),
        summed: !!c.compiled,
      }),
    )
    .sort((a, b) => (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999"));
  const figures = {
    open: cases.reduce((s, c) => s + (c.open ?? 0), 0),
    dueSoon: cases.filter((c) => c.nextDue && c.nextDue >= v.today && c.nextDue <= v.in30).reduce((s, c) => s + (c.payment?.amount ?? 0), 0),
    overdue: cases.filter((c) => c.nextDue && c.nextDue < v.today).length,
    running: cases.length,
  };
  return { figures, cases, debtsDb: v.debtsDb };
}

/** A row of the cases' table (store.ts, the port's adopted store) as a case: what the AI summed up with your corrections over it. */
export type CaseRow = { id: number; key: string; label: string; status: string; person_id: number | null; note: string; compiled: string | null; overrides?: string | null; created_at: string; updated_at: string; last_at: string };
export function caseFromRow(r: CaseRow): CaseLite & { note: string; createdAt: string; updatedAt: string; lastAt: string; status: "open" | "closed" | "ignored" } {
  let compiled: CaseSummary | null = null;
  try {
    compiled = r.compiled ? ({ ...(JSON.parse(r.compiled) as CaseSummary), ...(r.overrides ? (JSON.parse(r.overrides) as Partial<CaseSummary>) : {}) } as CaseSummary) : null;
  } catch {
    compiled = null;
  }
  return { id: r.id, key: r.key, label: r.label, status: r.status === "closed" || r.status === "ignored" ? r.status : "open", personId: r.person_id, note: r.note, compiled, createdAt: r.created_at, updatedAt: r.updated_at, lastAt: r.last_at };
}

// ---------------------------------------------------------------------------
// Finding the cases (detect.ts — by rule, no AI)
// ---------------------------------------------------------------------------

/** Words that say a number is a case number. */
const CASE_WORDS = /(?:^|[^\p{L}])(?:Az\.?|Aktenzeichen|Zeichen|Geschäftszeichen|Verfahren|Sache|Vorgang|Akte|Kassenzeichen)(?:$|[^\p{L}])/iu;
/** Numbers that are no case: a calendar week, a page, a paragraph, a number ("Nr 5/26"). */
const NOT_A_CASE = /^(?:KW|NR|NO|TEL|FAX|S|SEITE|ABS|ART|PAR|BL|BD|TZ|RZ|RN|CW)\b/;

export type Source = { ref: string; kind: "mail" | "doc" | "todo" | "event"; at: string; title: string };
/** What the cases are found in: the mails (with a "/" somewhere), the letters that are read, the todos (not merged). */
export type DetectInput = {
  mails: { key: string; subject: string; preview: string; at: string; email: string | null }[];
  docs: { id: number; name: string; summary: string; text: string; at: string }[];
  todos: { id: number; text: string; note: string | null; at: string }[];
  /** Your contacts' mail addresses (null: no People plugin). */
  people: { id: number; emails: string[] }[] | null;
  /** The cases there are (any status), with the refs of their sources. */
  cases: { id: number; key: string; label: string; status: string; personId: number | null; lastAt: string; updatedAt: string }[];
  sources: { caseId: number; ref: string }[];
  now: string;
};
/** What finding them does: cases made or changed (by their key — a new one has no id), sources linked, the counts. */
export type DetectPlan = {
  cases: { id?: number; key: string; label: string; status: string; person_id: number | null; last_at: string; updated_at: string; created_at?: string }[];
  sources: (Source & { key: string })[];
  created: number;
  linked: number;
};

type Hit = { key: string; label: string; source: Source; worded: boolean; email?: string | null; text: string };

/** Every place a case number stands, with what makes it one. */
function hitsOf(v: DetectInput): Hit[] {
  const out: Hit[] = [];
  const note = (text: string, source: Source, email?: string | null) => {
    for (const label of caseRefs(text)) {
      const key = caseKey(label);
      if (!NOT_A_CASE.test(key)) out.push({ key, label, source, worded: CASE_WORDS.test(text) || source.kind === "doc", email, text });
    }
  };
  for (const m of v.mails) note(`${m.subject} — ${m.preview}`, { ref: `mail:${m.key}`, kind: "mail", at: m.at, title: m.subject }, m.email);
  for (const d of v.docs) note(`${d.name}\n${d.summary}\n${d.text}`, { ref: `doc:${d.id}`, kind: "doc", at: d.at, title: d.name }, null);
  for (const t of v.todos) note(`${t.text} ${t.note ?? ""}`, { ref: `todo:${t.id}`, kind: "todo", at: t.at, title: t.text }, null);
  return out;
}

/** The profile whose address the sources carry most (a mail from them, a letter with their address in it). */
function personOf(found: Hit[], people: DetectInput["people"]): number | null {
  if (!people) return null;
  const votes = new Map<number, number>();
  for (const h of found) for (const p of people) if (p.emails.some((e) => e === h.email || (h.source.kind === "doc" && h.text.toLowerCase().includes(e)))) votes.set(p.id, (votes.get(p.id) ?? 0) + 1);
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * The cases found again from the sources (detect.ts did this against the tables; the port's lambda against its stores): a number becomes a
 * case when it looks like one — next to "Az.", "Zeichen" …, in a letter, or in more than one place; each place a source of it. A new source
 * moves a case's last activity on (and its label, when it is the newest) and brings a closed case back; a case without a person gets the one
 * its sources' addresses name.
 */
export function findCases(v: DetectInput): DetectPlan {
  const people = v.people?.map((p) => ({ id: p.id, emails: p.emails.map((e) => e.toLowerCase()) })) ?? null;
  const byKey = new Map<string, Hit[]>();
  for (const h of hitsOf(v)) byKey.set(h.key, [...(byKey.get(h.key) ?? []), h]);
  const cases = new Map(v.cases.map((c) => [c.key, { ...c }]));
  const linkedRefs = new Set(v.sources.map((s) => `${s.caseId}|${s.ref}`));
  const changed = new Map<string, DetectPlan["cases"][number]>();
  const sources: DetectPlan["sources"] = [];
  const newRefs = new Map<string, Set<string>>();
  let created = 0;
  let linked = 0;
  for (const [key, found] of byKey) {
    const places = new Set(found.map((h) => h.source.ref));
    if (!found.some((h) => h.worded) && places.size < 2) continue;
    const newest = [...found].sort((a, b) => b.source.at.localeCompare(a.source.at))[0];
    let c = cases.get(key);
    const isNew = !c;
    if (!c) {
      c = { id: 0, key, label: newest.label, status: "open", personId: null, lastAt: newest.source.at, updatedAt: v.now };
      cases.set(key, c);
      changed.set(key, { key, label: c.label, status: "open", person_id: null, last_at: c.lastAt, updated_at: v.now, created_at: v.now });
      created++;
    }
    const mine = (newRefs.get(key) ?? newRefs.set(key, new Set()).get(key))!;
    const seen = new Set<string>();
    for (const h of found) {
      if (seen.has(h.source.ref)) continue;
      seen.add(h.source.ref);
      if ((!isNew && linkedRefs.has(`${c.id}|${h.source.ref}`)) || mine.has(h.source.ref)) continue;
      mine.add(h.source.ref);
      sources.push({ ...h.source, title: h.source.title.slice(0, 200), key });
      // (a new source: the case's last activity on — its label as written there, when it is the newest; a closed case back)
      const row = changed.get(key) ?? { ...(c.id ? { id: c.id } : {}), key, label: c.label, status: c.status, person_id: c.personId, last_at: c.lastAt, updated_at: c.updatedAt };
      // (as the case stood before this source: whether it comes back is judged by when it last changed before it)
      const before = c.updatedAt;
      if (h.source.at > c.lastAt) {
        c.lastAt = h.source.at;
        if (h === newest) c.label = h.label;
        c.updatedAt = v.now;
        Object.assign(row, { last_at: c.lastAt, label: c.label, updated_at: v.now });
      }
      if (c.status === "closed" && h.source.at > before) {
        c.status = "open";
        c.updatedAt = v.now;
        Object.assign(row, { status: "open", updated_at: v.now });
      }
      changed.set(key, row);
      if (!isNew) linked++;
    }
    if (c.personId == null) {
      const person = personOf(found, people);
      if (person) {
        c.personId = person;
        changed.set(key, { ...(changed.get(key) ?? { ...(c.id ? { id: c.id } : {}), key, label: c.label, status: c.status, last_at: c.lastAt, updated_at: c.updatedAt }), person_id: person, updated_at: v.now });
      }
    }
  }
  return { cases: [...changed.values()], sources, created, linked };
}
