import { getPref, setPref } from "@/lib/prefs";

const PORT = "knowledge-ext";

/**
 * From the built-in Knowledge to the plugin (zeff-plugins/plugins/knowledge-ext): the plugin on, its package installed under System — the flows that
 * ask the knowledge, have it read, keep something in it and match it to your todos, allowed to (your click is the yes) —, the page of its chat found
 * (the menu's Chat opens it) and the built-in off: it stands in through its port (state.ts PROVIDED_BY — the connection to the knowledge server, the
 * export it reads, the panel on a todo and the repos' systems go on being Zeff's). Needs the plugin in the plugins folder. Server only.
 */
export async function switchKnowledgeToPlugin(): Promise<{ page: number | null }> {
  const reg = await import("@/lib/ext/registry");
  if (!reg.scanPlugins(true).plugins.some((x) => x.id === PORT)) throw new Error(`The Knowledge plugin (${PORT}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  reg.setEnabled(PORT, true);
  const flows = await import("@/plugins/workspace/flows/store");
  const life = await import("@/plugins/workspace/package-life");
  if (!flows.flowByName("knowledge.ask")) {
    const pkg = await life.offeredPackage(PORT);
    if (!pkg) throw new Error(`The Knowledge plugin (${PORT}) brings no package.`);
    const system = getPref<number | null>("system.root", null);
    const { getPage } = await import("@/plugins/workspace/store");
    await life.installTracked(pkg, system && getPage(system) && !getPage(system)!.archivedAt ? system : null, { allow: true });
  }
  // (the chat's page: the database "Chat" among what the package made)
  const { getInstalled } = life;
  const root = getInstalled(PORT)?.rootId ?? null;
  let page: number | null = null;
  if (root) {
    const { subtree, getPage } = await import("@/plugins/workspace/store");
    page = subtree(root).find((id) => {
      const p = getPage(id);
      return !!p && p.kind === "database" && p.title === "Chat" && !p.archivedAt;
    }) ?? null;
  }
  if (page) setPref("knowledge.chatPage", page);
  (await import("@/plugins/state")).setInstalled("knowledge", false);
  return { page };
}
