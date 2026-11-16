import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "@/plugins/workspace/flows/actions";
import { GRAPH_FLOW_ACTIONS } from "./graph-actions"; // (messages.recent, people.resolve, people.claims … for lambdas and flows)
import { AI_FLOW_ACTIONS } from "./ai-actions"; // (the port of the AI steps: people.extract-input, people.compile-input … rag.retrieve)
import { SCREEN_FLOW_ACTIONS } from "./screen-actions"; // (the port of the screens: people.screen-data, people.page-data, people.run-tool …)

/**
 * What the People plugin lets lambdas and flows read (while it is built in — its port brings these the same way): your contacts' names,
 * and the account to pay someone to (their details, what they asked for). Reading only. Server only.
 */

const ids = (v: unknown): number[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 5000);

export const PEOPLE_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "people.names",
    group: "people",
    label: "Your contacts' names",
    summary: "The names of these contacts by their id — all your contacts without ids.",
    input: [{ name: "ids", type: "list" }],
    output: "{ names: { [id]: name } }",
    run: async (i) => {
      const { listPeople } = await import("./store");
      const want = new Set(ids(i.ids));
      return { names: Object.fromEntries(listPeople().filter((p) => !want.size || want.has(p.id)).map((p) => [p.id, p.name])) };
    },
  },
  {
    name: "people.list",
    group: "people",
    label: "Your contacts",
    summary: "Every contact: id, name, whether a person or an organisation — and, for these ids, where their page is.",
    input: [{ name: "hrefs", type: "list" }],
    output: "{ people: [{ id, name, kind }], hrefs: { [id]: href } }",
    run: async (i) => {
      const { listPeople } = await import("./store");
      const { personHref } = await import("@/plugins/workspace/people-database");
      const want = ids(i.hrefs);
      const hrefs: Record<number, string> = {};
      for (const id of want) hrefs[id] = await personHref(id);
      return { people: listPeople().map((p) => ({ id: p.id, name: p.name, kind: p.kind })), hrefs };
    },
  },
  {
    name: "people.emails",
    group: "people",
    label: "Your contacts' mail addresses",
    summary: "Each contact's mail addresses, by their id.",
    input: [],
    output: "{ people: [{ id, emails }] }",
    run: async () => ({ people: (await import("./store")).listPeople().map((p) => ({ id: p.id, emails: p.emails })) }),
  },
  {
    name: "people.contacts",
    group: "people",
    label: "Contacts for names",
    summary: "The contact each name means — one called so (or with that alias), else one whose name is in it — else, make: a new one (a person or an organisation as kind says; a creditor that is an organisation in \"authorities & creditors\"). orPerson: when the name finds nobody, this person instead (unless it is the creditor) before one is made. Making a contact needs the flow's api permission.",
    input: [{ name: "items", type: "json", required: true }],
    output: "{ ids: (id | null)[] } in the items' order",
    writes: true,
    run: async (i, ctx) => {
      const { contactFor } = await import("./contact");
      const items = (Array.isArray(i.items) ? i.items : []).slice(0, 50) as { name?: unknown; make?: unknown; new?: unknown; kind?: unknown; creditor?: unknown; orPerson?: unknown; notPerson?: unknown }[];
      if (items.some((x) => x.make === true || x.new === true) && !ctx.dryRun) ctx.may("api");
      const ids: (number | null)[] = [];
      for (const x of items) {
        // (new: a contact of its own, made as you named it — a person or an organisation as you chose; a creditor organisation among the authorities)
        if (x.new === true) {
          const name = String(x.name ?? "").trim();
          if (!name || ctx.dryRun) {
            ids.push(null);
            continue;
          }
          const { createPerson, setKind, setCircle } = await import("./store");
          const id = createPerson({ name: name.slice(0, 120) });
          const kind = x.kind === "organization" ? "organization" : "person";
          setKind(id, kind, "manual");
          if (x.creditor === true && kind === "organization") setCircle(id, "authorities", "ai");
          ids.push(id);
          continue;
        }
        const name = String(x.name ?? "");
        const kind = x.kind === "person" || x.kind === "organization" ? x.kind : undefined;
        const found = contactFor(name, false);
        const or = Number(x.orPerson) > 0 && Number(x.orPerson) !== Number(x.notPerson) ? Number(x.orPerson) : null;
        ids.push(found ?? or ?? (x.make === true && !ctx.dryRun ? contactFor(name, true, kind, x.creditor === true) : null));
      }
      return { ids };
    },
  },
  {
    name: "people.details",
    group: "people",
    label: "A contact's details",
    summary: "For these contacts: their name, whether a person or an organisation, their mail addresses and their details (key, value — iban, bic, phone, address …) as kept.",
    input: [{ name: "ids", type: "list", required: true }],
    output: "{ people: { [id]: { name, kind, emails, details: [{ key, value }] } } }",
    run: async (i) => {
      const { getPerson } = await import("./store");
      const { detailsOf } = await import("./details");
      const out: Record<number, { name: string; kind: string; emails: string[]; details: { key: string; value: string }[] }> = {};
      for (const id of ids(i.ids)) {
        const p = getPerson(id);
        if (p) out[id] = { name: p.name, kind: p.kind, emails: p.emails, details: detailsOf(id).map((d) => ({ key: d.key, value: d.value })) };
      }
      return { people: out };
    },
  },
  {
    name: "people.commitments",
    group: "people",
    label: "Open promises",
    summary: "The promises not kept yet (the ones Zeff shows): id, person id and name, text, direction (mine: you promised, theirs: they did), due day.",
    input: [],
    output: "{ commitments: [{ id, personId, personName, text, direction, due }] }",
    run: async () => {
      const { openCommitments } = await import("./graph");
      return { commitments: openCommitments().map((c) => ({ id: c.id, personId: c.personId, personName: c.personName, text: c.text, direction: c.direction, due: c.due })) };
    },
  },
  {
    name: "people.by-iban",
    group: "people",
    label: "Whose account is it",
    summary: "The contact each of these accounts (IBANs) belongs to — by their details and accounts (null: no one, or ambiguous).",
    input: [{ name: "ibans", type: "list", required: true }],
    output: "{ ids: { [iban]: id | null } }",
    run: async (i) => {
      const { makePersonResolver } = await import("./resolve");
      const who = makePersonResolver();
      const list = Array.isArray(i.ibans) ? (i.ibans as unknown[]).map(String).slice(0, 5000) : [];
      return { ids: Object.fromEntries(list.map((x) => [x, who.byIban(x) ?? null])) };
    },
  },
  {
    name: "people.accounts",
    group: "people",
    label: "Where to pay someone",
    summary: "The account to pay each of these contacts to — from their details and what they asked for (null: none known).",
    input: [{ name: "ids", type: "list", required: true }],
    output: "{ accounts: { [id]: { name, iban, bic } | null } }",
    run: async (i) => {
      const { personAccount } = await import("./account");
      return { accounts: Object.fromEntries(ids(i.ids).map((id) => [id, personAccount(id)])) };
    },
  },
];

extensionPoint<FlowAction[]>("workspace.flowActions").contribute("people", [...PEOPLE_FLOW_ACTIONS, ...GRAPH_FLOW_ACTIONS, ...AI_FLOW_ACTIONS, ...SCREEN_FLOW_ACTIONS]);
