import type { RefCardProvider } from "@/lib/refs/point";
import type { RefTone } from "@/lib/refs/shared";

const TONE = (s: string | null): RefTone => (/merged/i.test(s ?? "") ? "good" : /closed/i.test(s ?? "") ? "muted" : /approved/i.test(s ?? "") ? "good" : /opened|open/i.test(s ?? "") ? "info" : "muted");
const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "");

/** A merge request's card ("!168" in a text, or its URL): its title, state, project, branch, author, how its description begins — as the GitLab sync kept it. */
export const MR_REF_CARD: RefCardProvider = {
  kind: "mr",
  card: async (id, { t }) => {
    const { listGitlabItems } = await import("@/lib/gitlab/store");
    const all = listGitlabItems({ kind: "mr", limit: 500 });
    // By its URL (unique), by "project!168", else the latest "!168".
    const [project, ref] = id.includes("!") && !id.startsWith("!") && !/^https?:/.test(id) ? [id.slice(0, id.indexOf("!")), id.slice(id.indexOf("!"))] : ["", id];
    const m = all.find((x) => x.url === id) ?? all.filter((x) => x.ref === ref && (!project || x.project === project)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    if (!m) return null;
    const body = m.body.replace(/<!--[\s\S]*?-->/g, "").replace(/[#*_`>]+/g, "").replace(/\s+/g, " ").trim();
    return {
      kind: "mr",
      id,
      eyebrow: `${m.project} ${m.ref}`,
      title: m.title,
      badges: m.state ? [{ label: m.state, tone: TONE(m.state) }] : [],
      facts: [...(m.branch ? [{ label: t("Branch"), value: m.branch }] : []), ...(m.author ? [{ label: t("Author"), value: m.author }] : []), ...(day(m.updatedAt) ? [{ label: t("Updated"), value: day(m.updatedAt) }] : [])],
      ...(body ? { excerpt: body.slice(0, 300) } : {}),
      links: [{ label: t("Open in GitLab ↗"), href: m.url, external: true }],
    };
  },
};
