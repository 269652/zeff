import { CONTRACT, matchContracts, recurringFlows, tFor } from "./lib.mjs";

//@CONTRACTS

const euro = (v) => v.toLocaleString(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortDay = (iso) => new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** The widget "Subscriptions not in your contracts": what goes out regularly but isn't in your contracts database, each with its cost a month and next payment. */
export async function handler(event, context) {
  const t = tFor(context.language);
  const zeff = context.zeff;
  const config = event?.config ?? {};
  const day = new Date().toLocaleDateString("sv-SE");
  const { sources } = await zeff.call("workspace.value-sources", { type: "fixkosten" });
  const { items: all, running } = await missing(zeff, day, sources);
  const target = contractsTarget(sources);
  const rhythmText = { monthly: t("Monthly"), quarterly: t("Quarterly"), yearly: t("Yearly") };
  const items = all.slice(0, Number(config.limit ?? 8)).map((r) => ({
    id: r.key,
    icon: "🔁",
    text: r.name + " · " + euro(r.amount),
    detail: [rhythmText[r.rhythm], r.rhythm !== "monthly" ? t("{amount} a month", { amount: euro(r.monthly) }) : "", t("last {date}", { date: shortDay(r.last) })].filter(Boolean).join(" · "),
    meta: t("next {date}", { date: shortDay(r.next) }),
    ...(target ? { actions: [{ id: "add", label: t("Add to {db}", { db: target.title || t("Contracts") }), icon: "+" }] } : {}),
  }));
  const monthly = all.reduce((x, r) => x + r.monthly, 0);
  return {
    kind: "list",
    items,
    ...(all.length ? { title: t("{n} of {running} running, {amount} a month", { n: all.length, running, amount: euro(monthly) }), count: all.length } : {}),
    empty: running ? t("Every subscription is in your contracts.") : t("No recurring payments in your bank bookings."),
    ...(target ? { footer: { text: target.title || t("Contracts"), href: "/workspace/" + target.dbId } } : {}),
  };
}
