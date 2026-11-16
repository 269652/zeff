import { getTicketCards } from "@/lib/jira/store";

/**
 * A ticket key's link and what its hover card says (title, status, type, who has it), as plain text — what the weekly and monthly report's ticket links show.
 * A ticket Zeff has no card for is only its key (with the link, when the Jira address is known).
 */
export type TicketInfo = { url: string; tip: string };

export function ticketInfos(keys: (string | null | undefined)[]): (key: string | null | undefined) => TicketInfo {
  const cards = getTicketCards(keys);
  return (key) => {
    const card = key ? cards[key.toUpperCase()] : undefined;
    if (!card) return { url: "", tip: "" };
    const tip = card.synced ? [card.summary, [card.status, card.issueType, card.priority, card.assignee].filter(Boolean).join(" · ")].filter(Boolean).join("\n") : "";
    return { url: card.url ?? "", tip };
  };
}
