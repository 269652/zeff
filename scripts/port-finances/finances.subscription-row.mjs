import { CONTRACT, matchContracts, recurringFlows, tFor } from "./lib.mjs";

//@CONTRACTS

/**
 * A subscription (by its recipient's key) as the row it becomes in the contracts database: { database, title, values } — values by the fields' names
 * (what the flow's db.add writes): its cost a month, per payment, rhythm, last and next, the status, the source ref when the database follows the recurring source.
 */
export async function handler(event, context) {
  const t = tFor(context.language);
  const zeff = context.zeff;
  const day = new Date().toLocaleDateString("sv-SE");
  const { sources } = await zeff.call("workspace.value-sources", { type: "fixkosten" });
  const target = contractsTarget(sources);
  if (!target) throw new Error(t("There is no contracts database yet (Workspace → templates → Contracts)."));
  const { bookings } = await zeff.call("bank.bookings", { from: addDays(day, -800), to: "9999-12-31" });
  const r = recurringFlows(bookings, day).out.find((x) => x.key === String(event?.key ?? ""));
  if (!r) throw new Error(t("This payment isn't recurring any more."));
  const prop = (id) => target.properties.find((p) => p.id === id);
  const option = (p, name) => (p?.options ?? []).find((o) => String(o).toLowerCase() === String(name).toLowerCase());
  const rhythm = { monthly: t("Monthly"), quarterly: t("Quarterly"), yearly: t("Yearly") }[r.rhythm];
  const status = target.properties.find((p) => p.type === "status");
  const values = {};
  const set = (p, v) => {
    if (p && v !== undefined && v !== null) values[p.name] = v;
  };
  set(prop(target.propId), r.monthly);
  set(prop(CONTRACT.amount), r.amount);
  set(prop(CONTRACT.rhythm), option(prop(CONTRACT.rhythm), rhythm));
  set(prop(CONTRACT.last), r.last);
  set(prop(CONTRACT.next), r.next);
  if (status?.options?.length) set(status, status.options[0]);
  // A database that follows the recurring source: the row is the one it would bring (its ref) — it isn't brought twice.
  if (prop("srcref") && target.follows.includes("recurring")) set(prop("srcref"), "recurring:" + r.key);
  return { database: target.dbId, title: r.name, values };
}
