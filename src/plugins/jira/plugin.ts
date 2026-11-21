import { definePlugin } from "../define";

/** Jira: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "jira",
  order: 210,
  actionsOrder: 10,
  name: "Jira",
  description: "Your tickets and those of the chosen boards — the basis of the todos, the context sync and the entries per ticket.",
  category: "connector",
  defaultInstalled: false,
  requires: "Jira's address and your Personal Access Token (Settings → Secrets).",
  settings: { href: "/settings/jira", what: "Address, access, chosen boards" },
  nav: [
    { href: "/jira", label: "Jira", hint: "Boards, tickets & sync" },
  ],
  routes: ["/jira"],
  syncSteps: ["jira"],
  services: ["jira"],
});
