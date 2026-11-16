// (pure: the plugins' ports bundle it)
/** What a todo asks for. */
export const TODO_KINDS = [
  "reply",
  "comment",
  "update",
  "implement",
  "fix",
  "test",
  "review",
  "clarify",
  "document",
  "deploy",
  "merge",
  "other",
] as const;
export type TodoKind = (typeof TODO_KINDS)[number];
