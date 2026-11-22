"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

/**
 * Server Actions of the plugin sources (sources.ts): add / remove a repository, check it, install or update from it (merged with what was
 * changed here); the update notes and the conflicts an update waits for; packages.json followed (packages-sync.ts).
 */

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const done = () => revalidatePath("/plugins");

export async function addSourceAction(url: string, branch: string, token: string): Promise<Res> {
  try {
    (await import("./sources")).addSource(String(url ?? ""), String(branch ?? "").trim() || undefined, String(token ?? ""));
    done();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function removeSourceAction(id: string): Promise<Res> {
  try {
    (await import("./sources")).removeSource(String(id));
    done();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function checkSourcesAction(fresh = false): Promise<Res<{ states: import("./sources").SourceState[] }>> {
  try {
    const states = await (await import("./sources")).checkAll({ fresh: !!fresh });
    // (checked now: the update notes follow at once — not only at the half-hourly check)
    if (fresh) await (await import("./packages-sync")).checkForUpdates().catch(() => {});
    return { ok: true, states };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** What an install or update did, in a line. */
function told(r: import("./sources").InstallReport): string {
  if (r.conflicts.length === 1) return t("{id} {to}: a conflict with what you changed — settle it to finish the update", { id: r.id, to: r.to });
  if (r.conflicts.length) return t("{id} {to}: {n} conflicts with what you changed — settle them to finish the update", { id: r.id, to: r.to, n: r.conflicts.length });
  const what = r.from ? t("{id}: {from} → {to}", { id: r.id, from: r.from, to: r.to }) : t("{id} {to} installed — switch it on to use it", { id: r.id, to: r.to });
  const app = r.app ? ` · ${t("its app {from} → {to}", { from: r.app.from, to: r.app.to })}` : "";
  const merged = r.merged.length ? ` · ${t("merged with your changes: {files}", { files: r.merged.join(", ") })}` : "";
  const kept = r.kept.length ? ` · ${t("kept as you changed them: {files}", { files: r.kept.join(", ") })}` : "";
  const signed = r.verified?.signed ? ` · ${t("signed ({key})", { key: r.verified.signed })}` : "";
  const stale = r.verified?.catalog === false ? ` · ${t("the repository's catalog.json is out of date for it")}` : "";
  return what + app + merged + kept + signed + stale;
}

export async function installFromSourceAction(sourceId: string, pluginId: string): Promise<Res<{ message: string; conflicts: string[] }>> {
  try {
    // A patch to Zeff itself ("mod:<id>"): only a signed release, built and loaded (lib/mods/feed.ts).
    if (String(pluginId).startsWith("mod:")) {
      const m = await (await import("./sources")).installModFromSource(String(sourceId), String(pluginId).slice(4));
      await (await import("./packages-sync")).checkForUpdates().catch(() => {});
      done();
      return { ok: true, message: `${m.id} ${m.from ? `${m.from} → ` : ""}${m.to}${m.problems.length ? ` — it didn't build: ${m.problems[0]}` : ""}`, conflicts: [] };
    }
    const r = await (await import("./sources")).installFromSource(String(sourceId), String(pluginId));
    const sync = await import("./packages-sync");
    // (packages.json says what this Zeff has: the plugin and where it came from)
    if (!r.conflicts.length) sync.rememberInPackages(r.id);
    await sync.checkForUpdates().catch(() => {});
    done();
    return { ok: true, message: told(r), conflicts: r.conflicts };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function updateAllFromSourcesAction(): Promise<Res<{ message: string }>> {
  try {
    const r = await (await import("./sources")).updateAll();
    const sync = await import("./packages-sync");
    for (const x of r) if (!x.conflicts.length) sync.rememberInPackages(x.id);
    await sync.checkForUpdates().catch(() => {});
    done();
    return { ok: true, message: r.length ? r.map(told).join(" · ") : t("Everything is up to date.") };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

// ---------------------------------------------------------------------------
// Update notes, and an update that waits for its conflicts
// ---------------------------------------------------------------------------

export type UpdatesView = { updates: import("./packages-sync").UpdateNote[]; packages: import("./packages-sync").PackagesState | null };

/** The notes found at the last check (cheap: read from a file) — the app asks every few minutes. `fresh`: the sources checked now. */
export async function pluginUpdatesAction(fresh = false): Promise<Res<UpdatesView>> {
  try {
    const sync = await import("./packages-sync");
    if (fresh) await sync.checkForUpdates();
    return { ok: true, updates: sync.storedUpdates().updates, packages: sync.packagesState() };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** “Later”: this version isn't offered again. */
export async function putOffUpdateAction(id: string, version: string): Promise<Res> {
  try {
    (await import("./packages-sync")).putOff(String(id), String(version));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export type MergeFileView = { rel: string; outcome: string; resolved?: string; binary?: boolean; base?: string | null; mine?: string | null; theirs?: string | null; markers?: string; result?: string | null };
export type MergeView = { pluginId: string; from: string | null; to: string; files: MergeFileView[] };

/** The update waiting for its conflicts (the conflicts with their three sides; the rest only named). */
export async function pendingMergeAction(pluginId: string): Promise<Res<{ merge: MergeView | null }>> {
  try {
    const m = (await import("./sources")).pendingMerge(String(pluginId));
    if (!m) return { ok: true, merge: null };
    const files: MergeFileView[] = m.files.map((f) =>
      f.outcome === "conflict"
        ? { rel: f.rel, outcome: f.outcome, resolved: f.resolved, binary: f.binary, base: f.base, mine: f.mine, theirs: f.theirs, markers: f.markers, result: f.result === undefined || f.result === null ? f.result : Buffer.from(f.result, "base64").toString("utf8") }
        : { rel: f.rel, outcome: f.outcome },
    );
    return { ok: true, merge: { pluginId: m.pluginId, from: m.from.version, to: m.to.version, files } };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** One conflict settled: keep mine, take theirs, or a text (the AI's, or the person's). */
export async function settleConflictAction(pluginId: string, rel: string, how: "mine" | "theirs" | "ai" | "edited", content?: string | null): Promise<Res> {
  try {
    if (!["mine", "theirs", "ai", "edited"].includes(how)) throw new Error("How?");
    await (await import("./sources")).settleConflict(String(pluginId), String(rel), how, content === undefined ? undefined : content === null ? null : String(content));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** The AI's merge of one conflict — a proposal for the editor, not saved. */
export async function aiMergeAction(pluginId: string, rel: string): Promise<Res<{ text: string; note: string }>> {
  try {
    const m = (await import("./sources")).pendingMerge(String(pluginId));
    const f = m?.files.find((x) => x.rel === rel && x.outcome === "conflict");
    if (!f) throw new Error("No such conflict.");
    if (f.binary) throw new Error(t("This file is not text — keep yours or take theirs."));
    return { ok: true, ...(await (await import("./merge-ai")).aiMerge(f.rel, f.base ?? null, f.mine ?? null, f.theirs ?? null)) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** The waiting update written (no conflict left). */
export async function finishMergeAction(pluginId: string): Promise<Res<{ message: string }>> {
  try {
    const r = await (await import("./sources")).finishMerge(String(pluginId));
    const sync = await import("./packages-sync");
    sync.rememberInPackages(r.id);
    await sync.checkForUpdates().catch(() => {});
    done();
    return { ok: true, message: told(r) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** The waiting update dropped: the plugin stays as it is. */
export async function cancelMergeAction(pluginId: string): Promise<Res> {
  try {
    (await import("./sources")).cancelMerge(String(pluginId));
    await (await import("./packages-sync")).checkForUpdates().catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** packages.json followed now (also when it didn't change). */
export async function applyPackagesAction(): Promise<Res<{ state: import("./packages-sync").PackagesState | null }>> {
  try {
    const state = await (await import("./packages-sync")).applyPackagesFile({ force: true });
    done();
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

// ---------------------------------------------------------------------------
// The marketplace (Plugins → Browse; marketplace.ts)
// ---------------------------------------------------------------------------

/** Every plugin of every source with how it stands here. `cached`: the last check's (at once, no network); `check`: checked (10 minutes cached); `fresh`: checked now. */
export async function marketplaceAction(mode: "cached" | "check" | "fresh" = "cached"): Promise<Res<{ view: import("./marketplace").MarketView; permissions: Record<string, string> }>> {
  try {
    const m = String(mode);
    const view = await (await import("./marketplace")).marketplace(m === "fresh" ? "fresh" : m === "check" ? "check" : "cached");
    if (m === "fresh") await (await import("./packages-sync")).checkForUpdates().catch(() => {});
    return { ok: true, view, permissions: (await import("./permission-texts")).permissionTexts() };
  } catch (e) {
    console.error("[marketplace] the listing failed", e);
    return { ok: false, error: errorMessage(e) };
  }
}

/** The detail panel's README, screenshots and changelog (the commits that touched the plugin's folder). */
export async function pluginDetailAction(sourceId: string, pluginId: string): Promise<Res<{ detail: import("./sources").PluginDetail }>> {
  try {
    return { ok: true, detail: await (await import("./sources")).pluginDetail(String(sourceId), String(pluginId)) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * Switched on from Browse: what it asks for granted (the person said yes to the list), and its app installed when it brings one and it
 * isn't there yet. A built-in's port (plugins/ports.ts) is switched the port's way instead — its settings carried over, the built-in off.
 */
export async function switchOnPluginAction(pluginId: string): Promise<Res<{ message: string }>> {
  try {
    const id = String(pluginId);
    const reg = await import("./registry");
    const plugin = reg.getPlugin(id);
    if (!plugin) throw new Error(t("This plugin isn't in the plugins folder any more."));
    const sync = await import("./packages-sync");
    const { PORTS } = await import("@/plugins/ports");
    const port = PORTS.find((p) => p.plugin === id);
    if (port) {
      await port.switch();
      await sync.rememberPort(id).catch(() => false);
      revalidatePath("/", "layout");
      return { ok: true, message: t("It runs as a plugin now; your settings came along.") };
    }
    reg.setEnabled(id, true);
    let app = "";
    if (plugin.manifest.contributes.workspacePackages.length) {
      try {
        const life = await import("@/plugins/workspace/package-life");
        const pkg = !life.getInstalled(id) ? await life.offeredPackage(id) : null;
        if (pkg) {
          await life.installTracked(pkg, null, { allow: true });
          app = ` · ${t("its app “{name}” is in the Workspace", { name: pkg.name ?? id })}`;
        }
      } catch (e) {
        app = ` · ${t("its app wasn't installed: {error}", { error: errorMessage(e) })}`;
      }
    }
    revalidatePath("/", "layout");
    return { ok: true, message: t("{name} on.", { name: plugin.manifest.name }) + app };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** Taken out from Browse: off, its folder moved aside (.removed), out of packages.json. A port the built-in runs through stays. */
export async function removePluginAction(pluginId: string): Promise<Res<{ message: string }>> {
  try {
    const id = String(pluginId);
    const { PORTS } = await import("@/plugins/ports");
    const port = PORTS.find((p) => p.plugin === id);
    if (port) {
      const { isInstalled, onlyThroughPort } = await import("@/plugins/state");
      const on = !!(await import("./registry")).getPlugin(id)?.enabled;
      if (onlyThroughPort(port.builtin as never) || (on && !isInstalled(port.builtin as never))) throw new Error(t("Zeff's built-in {name} runs through this plugin — switch the built-in on again first (Plugins → Installed).", { name: port.builtin }));
    }
    await (await import("./sources")).removePlugin(id);
    const sync = await import("./packages-sync");
    sync.forgetInPackages(id);
    await sync.checkForUpdates().catch(() => {});
    revalidatePath("/", "layout");
    return { ok: true, message: t("{id} removed — its folder is kept under .removed in the plugins folder; what it made in Zeff stays.", { id }) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** A token for a source (a private repository; GitHub's rate limit): kept in Zeff, never shown again, never written into packages.json. Empty: removed. */
export async function setSourceTokenAction(url: string, token: string): Promise<Res> {
  try {
    (await import("./sources")).setSourceToken(String(url), String(token ?? ""));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
