/** The kinds of what People keeps about a person (pure — the People port's lambdas bundle it). */

export const CLAIM_KINDS = ["fact", "role", "owns", "preference", "commitment"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];
export const LINK_TYPES = ["reports-to", "manages", "works-with", "decides", "owns", "on-ticket", "commented-on", "authored", "active-in", "knows-about"] as const;
/** Links the Entities plugin reads off the sources (not the AI's to propose): someone works at an organisation, lives or sits at a place. */
export const ENTITY_LINK_TYPES = ["works-at", "located-at"] as const;
export type LinkType = (typeof LINK_TYPES)[number] | (typeof ENTITY_LINK_TYPES)[number];
export const TARGET_TYPES = ["person", "ticket", "repo", "project", "topic"] as const;
/** The Entities plugin's targets: an organisation, a place (target_ref: its id; label: its name). */
export const ENTITY_TARGET_TYPES = ["org", "place"] as const;
export type TargetType = (typeof TARGET_TYPES)[number] | (typeof ENTITY_TARGET_TYPES)[number];
/** superseded: true once, no longer (a newer value took its place — see @/lib/trust); claims only. */
export type Status = "proposed" | "confirmed" | "rejected" | "superseded";

/** What addClaim / addLink take (graph.ts): a claim or a link to keep. */
export type ClaimInput = { personId: number; kind: ClaimKind; text: string; evidence?: string; sourceRef?: string; confidence?: number; status?: Status; direction?: "theirs" | "mine" | ""; due?: string };
export type LinkInput = { personId: number; rel: LinkType; targetType: TargetType; targetRef: string; label?: string; evidence?: string; source?: "rule" | "ai" | "manual"; sourceRef?: string; confidence?: number; status?: Status };
