"use server";

import type { RefCard } from "@/lib/refs/shared";

/** The hover cards of references named in a text (a ticket key, a person, a todo …) — asked by the cards on screen, several at once; by "kind:id". */
export async function refCardsAction(refs: { kind: string; id: string }[]): Promise<Record<string, RefCard>> {
  if (!Array.isArray(refs)) return {};
  const { refCards } = await import("@/lib/refs/point");
  return refCards(refs.filter((r) => r && typeof r.kind === "string" && (typeof r.id === "string" || typeof r.id === "number")).map((r) => ({ kind: r.kind, id: String(r.id) })));
}
