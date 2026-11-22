"use client";

import { Fragment } from "react";
import { RefLink } from "@/components/RefLink";
import { splitRefs } from "@/lib/refs/shared";
import { usePeopleLinks } from "@/plugins/people/PersonMention";
import { splitMentions, splitTags } from "@/plugins/people/mentions";

/** How a reference looks in a text, by its kind. */
export const REF_LOOK: Record<string, string> = {
  ticket: "font-mono text-indigo-700 not-italic hover:underline dark:text-indigo-300",
  todo: "font-mono text-indigo-600 hover:underline dark:text-indigo-400",
  mr: "font-mono text-indigo-700 not-italic hover:underline dark:text-indigo-300",
  person: "underline decoration-zinc-400/70 decoration-dotted underline-offset-2 hover:text-teal-700 hover:decoration-teal-500 dark:hover:text-teal-300",
  tag: "underline decoration-teal-500/80 underline-offset-2 hover:text-teal-700 dark:hover:text-teal-300",
  page: "font-medium text-indigo-600 hover:underline dark:text-indigo-400",
};

/**
 * A free text (a todo's words, a note, a comment) with the references in it as <ref>s: ticket keys, T-37, !168 — and the people it
 * names (`people`: "names" every name and alias the People plugin knows, "tags" only @-tags, "none"). `hrefs`: links by the words
 * ("PROJ-12" → its Jira URL) where the view knows them.
 */
export function RefText({ text, people = "names", tickets = true, todos = true, mrs = true, hrefs }: { text: string; people?: "names" | "tags" | "none"; tickets?: boolean; todos?: boolean; mrs?: boolean; hrefs?: Record<string, string> }) {
  const { matcher, hrefs: personHref } = usePeopleLinks();
  return splitRefs(text, { tickets, todos, mrs, hrefs }).map((p, i) => {
    if (p.kind)
      return (
        <RefLink key={i} kind={p.kind} id={p.id!} href={p.href} className={REF_LOOK[p.kind]}>
          {p.text}
        </RefLink>
      );
    if (people === "none" || !matcher) return <Fragment key={i}>{p.text}</Fragment>;
    const parts = people === "tags" ? splitTags(p.text, matcher) : splitMentions(p.text, matcher);
    return (
      <Fragment key={i}>
        {parts.map((m, j) =>
          m.person ? (
            <RefLink key={j} kind="person" id={String(m.person.id)} href={personHref[m.person.id]} className={people === "tags" || m.text.startsWith("@") ? REF_LOOK.tag : REF_LOOK.person}>
              {m.text}
            </RefLink>
          ) : (
            <Fragment key={j}>{m.text}</Fragment>
          ),
        )}
      </Fragment>
    );
  });
}
