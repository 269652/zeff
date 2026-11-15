import { isInstalled } from "@/plugins/state";
import { createPerson, listPeople, namesThem, setCircle, setKind } from "./store";

type Kind = "person" | "organization";

/**
 * The contact a name means (a case's creditor, who collects it, who is paid): one called so (or with that alias), else one whose name is in it — else, `make`, a new
 * one, a person or an organisation as the AI said (`kind`); a creditor that is an organisation in "authorities & creditors".
 */
export function contactFor(name: string, make: boolean, kind?: Kind, creditor = false): number | null {
  const n = name.trim();
  if (!n || !isInstalled("people")) return null;
  const people = listPeople();
  const low = n.toLowerCase();
  const exact = people.find((p) => [p.name, ...p.aliases].some((x) => x.toLowerCase() === low));
  if (exact) return exact.id;
  // The longest name in it wins ("Gerichtsvollzieherin Wagner, AG Musterstadt" → the one with the alias "Wagner").
  const named = people.filter((p) => namesThem(p, n)).sort((a, b) => b.name.length - a.name.length)[0];
  if (named) return named.id;
  if (!make) return null;
  const id = createPerson({ name: n.slice(0, 120) });
  if (kind) setKind(id, kind, "ai");
  if (kind === "organization" && creditor) setCircle(id, "authorities", "ai");
  return id;
}


