import { getPref, setPref } from "@/lib/prefs";

const PORT = "work-ext";

/** The Workspace pages of the port: the Code screen and its settings (set when it is switched to), as page ids. */
export const workCodePage = (): number | null => getPref<number | null>("work.codePage", null);
/** The Code app's page, at the top of the Workspace (moved there once: the flows behind its buttons stay in System). */
export async function workCodeHome(): Promise<number | null> {
  const page = workCodePage();
  if (page) (await import("@/plugins/workspace/package-home")).surfaceApp(page, { name: "Code", holder: "Code — the actions behind its buttons", done: "work.codeHome" });
  return page;
}
export const workSettingsPage = (): number | null => getPref<number | null>("work.settingsPage", null);

/**
 * From the built-in Code tab to the plugin (zeff-plugins/plugins/work-ext): the plugin on, its package installed under System — the screen, the settings and
 * the flows that start, send, answer, stop, commit, switch a branch, set up and remove (your click is the yes: they are allowed the permission "api") —, the
 * pages of the screen and its settings found (/work, /repos and the Code section of the Settings open them) and the built-in off: it stands in through its port
 * (state.ts PROVIDED_BY — the workers, runs, the work host, the logs and the live sessions go on being Zeff's). Server only.
 */
export async function switchWorkToPlugin(): Promise<{ page: number | null }> {
  const reg = await import("@/lib/ext/registry");
  if (!reg.scanPlugins(true).plugins.some((x) => x.id === PORT)) throw new Error(`The Code plugin (${PORT}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  reg.setEnabled(PORT, true);
  const flows = await import("@/plugins/workspace/flows/store");
  const life = await import("@/plugins/workspace/package-life");
  if (!flows.flowByName("work.start")) {
    const pkg = await life.offeredPackage(PORT);
    if (!pkg) throw new Error(`The Code plugin (${PORT}) brings no package.`);
    const system = getPref<number | null>("system.root", null);
    const { getPage } = await import("@/plugins/workspace/store");
    await life.installTracked(pkg, system && getPage(system) && !getPage(system)!.archivedAt ? system : null, { allow: true });
  }
  const root = life.getInstalled(PORT)?.rootId ?? null;
  let page: number | null = null;
  if (root) {
    const { subtree, getPage } = await import("@/plugins/workspace/store");
    const find = (title: string) =>
      subtree(root).find((id) => {
        const p = getPage(id);
        return !!p && p.kind === "database" && p.title === title && !p.archivedAt;
      }) ?? null;
    page = find("Sessions");
    const settings = find("Code settings");
    if (page) {
      setPref("work.codePage", page);
      (await import("@/plugins/workspace/package-home")).surfaceApp(page, { name: "Code", holder: "Code — the actions behind its buttons", done: "work.codeHome" });
    }
    if (settings) setPref("work.settingsPage", settings);
  }
  (await import("@/plugins/state")).setInstalled("work", false);
  return { page };
}
