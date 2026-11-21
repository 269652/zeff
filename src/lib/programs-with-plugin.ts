import type { PrereqId } from "./prerequisites-shared";

/**
 * Programs installed along with a plugin when it is turned on (and they are missing): Poppler (pdftotext, pdftoppm) with Documents —
 * the built-in and its port. Shown as needed on This PC (PREREQ_PLUGINS), installed the way This PC's "Install" does (winget / scoop on
 * Windows, Homebrew on a Mac), in the background. Server only.
 */
export const INSTALL_WITH: Record<string, PrereqId[]> = {
  documents: ["poppler"],
  "documents-ext": ["poppler"],
};

/** Whether a program may be installed by itself (Documents → Settings: "install Poppler automatically", on by default). */
async function allowed(id: PrereqId): Promise<boolean> {
  if (id === "poppler") return (await import("@/plugins/documents/settings")).documentSettings().autoInstall;
  return true;
}

/** Start installing what these plugins need and lack; the programs started (none in tests: nothing is installed on the machine). */
export async function installProgramsFor(pluginIds: string[]): Promise<PrereqId[]> {
  if (process.env.NODE_ENV === "test" || process.env.ZEFF_NO_AUTO_INSTALL) return [];
  const want = [...new Set(pluginIds.flatMap((p) => INSTALL_WITH[p] ?? []))];
  if (!want.length) return [];
  const { prerequisites } = await import("./prerequisites");
  const { installPlan, installStates, startInstall } = await import("./prerequisites-install");
  const { hasCommand } = await import("@/plugins/documents/poppler");
  const rows = prerequisites();
  const started: PrereqId[] = [];
  for (const id of want) {
    if (rows.find((r) => r.id === id)?.found || !(await allowed(id))) continue;
    if (installStates().some((s) => s.id === id && s.state === "running")) continue;
    const plan = installPlan(id, process.platform, hasCommand);
    if (!plan) continue; // (no package manager: This PC says how to get it)
    startInstall(id, { plan, found: () => !!prerequisites().find((x) => x.id === id)?.found });
    started.push(id);
  }
  return started;
}
