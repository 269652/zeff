import { accountFor } from "@/lib/girocode";
import { isInstalled } from "@/plugins/state";
import { detailsOf } from "./details";
import { claimsOf } from "./graph";
import { getPerson } from "./store";

/** A person's account to pay to (their details, what they asked for) — null: none known, or no People plugin. Server only. */
export function personAccount(personId: number): { name: string; iban: string; bic?: string | null } | null {
  if (!isInstalled("people")) return null;
  const p = getPerson(personId);
  return p ? accountFor(p.name, detailsOf(p.id), claimsOf(p.id).map((x) => x.text)) : null;
}
