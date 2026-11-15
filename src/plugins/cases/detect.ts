import { getSqlite } from "@/db";
import { isInstalled } from "@/plugins/state";
import { emitChange } from "@/lib/events";
import { findCases, type DetectInput } from "./core";
import { casesDb, listCases } from "./store";

/**
 * Finding the cases (the Cases plugin): the case numbers in mails, letters (documents) and todos, by rule —
 * no AI. A number becomes a case when it looks like one: written next to "Az.", "Zeichen", "Verfahren" …,
 * in a letter, or in more than one place; a calendar week or a page number never. Each place it stands
 * is a source of the case; the person whose address the mails and letters carry is the one on the other side.
 */

const all = <T>(sql: string): T[] => {
  try {
    return getSqlite().prepare(sql).all() as T[];
  } catch {
    return []; // the plugin behind it never ran
  }
};

/** What the cases are found in, as the pure core takes it (core.ts findCases — the port's lambda reads the same through the kernel). */
export function detectInput(): DetectInput {
  const people = isInstalled("people") ? all<{ id: number; emails: string }>("select id, emails from people").map((p) => ({ id: p.id, emails: JSON.parse(p.emails) as string[] })) : null;
  return {
    mails: all("select key, subject, preview, received_at at, lower(from_email) email from emails where (subject || ' ' || preview) like '%/%'"),
    docs: all("select id, name, summary, substr(text, 1, 6000) text, created_at at from documents where status = 'ready'"),
    todos: isInstalled("todos") ? all("select id, text, note, created_at at from todos where merged_into is null") : [],
    people,
    cases: listCases({ all: true }).map((c) => ({ id: c.id, key: c.key, label: c.label, status: c.status, personId: c.personId, lastAt: c.lastAt, updatedAt: c.updatedAt })),
    sources: all<{ caseId: number; ref: string }>("select case_id caseId, ref from case_sources"),
    now: new Date().toISOString(),
  };
}

/** The cases read again from the sources: new ones made, new places linked (the plan: core.ts findCases — applied here). */
export function detectCases(): { created: number; linked: number } {
  const plan = findCases(detectInput());
  if (!plan.cases.length && !plan.sources.length) return { created: plan.created, linked: plan.linked };
  const d = casesDb();
  const ids = new Map<string, number>();
  d.transaction(() => {
    for (const c of plan.cases) {
      if (c.id) {
        d.prepare("update cases set label = ?, status = ?, person_id = ?, last_at = ?, updated_at = ? where id = ?").run(c.label, c.status, c.person_id, c.last_at, c.updated_at, c.id);
        ids.set(c.key, c.id);
      } else ids.set(c.key, Number(d.prepare("insert into cases (key, label, status, person_id, created_at, updated_at, last_at) values (?, ?, ?, ?, ?, ?, ?)").run(c.key, c.label, c.status, c.person_id, c.created_at ?? c.updated_at, c.updated_at, c.last_at).lastInsertRowid));
    }
    const known = new Map(listCases({ all: true }).map((c) => [c.key, c.id]));
    const add = d.prepare("insert or ignore into case_sources (case_id, ref, kind, at, title) values (?, ?, ?, ?, ?)");
    for (const s of plan.sources) add.run(ids.get(s.key) ?? known.get(s.key), s.ref, s.kind, s.at, s.title);
  })();
  emitChange("todos");
  return { created: plan.created, linked: plan.linked };
}
