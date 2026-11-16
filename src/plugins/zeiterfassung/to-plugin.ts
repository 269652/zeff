import { getPref, setPref } from "@/lib/prefs";

const PORT = "zeiterfassung-ext";
const PREF = "time.reportPage";

/**
 * The time report's page in the Workspace — the database "Report" of the plugin's package, shown by its template (zeff-plugins/plugins/zeiterfassung-ext). Its id;
 * null: the plugin isn't in the plugins folder, isn't on, or its package isn't installed (the Plugins page switches to it). Server only.
 */
export async function reportPage(): Promise<number | null> {
  const reg = await import("@/lib/ext/registry");
  if (!reg.scanPlugins().plugins.some((x) => x.id === PORT) || !reg.isEnabled(PORT)) return null;
  const { getDatabase } = await import("@/plugins/workspace/store");
  const known = getPref<number | null>(PREF, null);
  const db = known ? getDatabase(known) : null;
  if (known && db && !db.page.archivedAt) return known;
  const inst = (await import("@/plugins/workspace/package-life")).getInstalled(PORT);
  if (!inst) return null;
  const found = Object.values(inst.map)
    .map((id) => getDatabase(id as number))
    .find((d) => d && !d.page.archivedAt && d.schema.views.some((v) => v.type === "app" && v.app === "template" && !!v.template));
  if (!found) return null;
  setPref(PREF, found.page.id);
  return found.page.id;
}

/** The address of the report with its tab and what that tab is set to (state names of the template: view, week, month, by, fdate, fweek, jd, …). */
export async function reportLink(state: Record<string, string | undefined>): Promise<string> {
  const id = await reportPage();
  if (!id) return "/plugins";
  const q = new URLSearchParams(Object.entries(state).flatMap(([k, v]) => (v ? [[`s.${k}`, v]] : []))).toString();
  return `/workspace/${id}${q ? `?${q}` : ""}`;
}

/**
 * From the built-in time tracking screens to the plugin (zeff-plugins/plugins/zeiterfassung-ext): the plugin on, its package installed — the report (week, month,
 * analysis, end of day, jobs, settings) and the flows that book, change and delete (your click is the yes: they are allowed what they write) —, the page found
 * (the old addresses lead to it) and the built-in's screens off: it stands in through its port (state.ts PROVIDED_BY) — the bookings, jobs, projects, the
 * schedule and the report rules stay Zeff's: they are what the plugin reads and writes. Server only.
 */
export async function switchZeiterfassungToPlugin(): Promise<{ page: number | null }> {
  const reg = await import("@/lib/ext/registry");
  if (!reg.scanPlugins(true).plugins.some((x) => x.id === PORT)) throw new Error(`The time tracking plugin (${PORT}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  reg.setEnabled(PORT, true);
  const life = await import("@/plugins/workspace/package-life");
  if (!life.getInstalled(PORT)) {
    const pkg = await life.offeredPackage(PORT);
    if (!pkg) throw new Error(`The time tracking plugin (${PORT}) brings no package.`);
    const system = getPref<number | null>("system.root", null);
    const { getPage } = await import("@/plugins/workspace/store");
    await life.installTracked(pkg, system && getPage(system) && !getPage(system)!.archivedAt ? system : null, { allow: true });
  }
  const page = await reportPage();
  (await import("@/plugins/state")).setInstalled("zeiterfassung", false);
  return { page };
}
