"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmAction } from "@/components/confirm";
import { useT } from "@/components/I18nProvider";
import { Markdown } from "@/components/Markdown";
import { toast } from "@/components/Toaster";
import { setExtPluginEnabledAction } from "@/lib/ext/actions";
import { addsSummary, type CatalogEntry } from "@/lib/ext/catalog";
import type { MarketItem, MarketView } from "@/lib/ext/marketplace";
import { PLUGIN_CATEGORIES, type PluginCategoryId } from "@/lib/ext/categories";
import { addSourceAction, installFromSourceAction, marketplaceAction, pluginDetailAction, removePluginAction, setSourceTokenAction, switchOnPluginAction } from "@/lib/ext/source-actions";
import type { PluginDetail } from "@/lib/ext/sources";
import type { T } from "@/lib/i18n/shared";

/**
 * Plugins → Browse: the marketplace. Every plugin of every source (each repository's catalog.json — lib/ext/marketplace.ts), searchable by
 * name, description, keywords and what it adds, filtered by category and how it stands here; a card per plugin and a detail panel (its
 * README, what it asks for and adds, its changelog) with Install / Update / Switch on / Remove. Installing downloads exactly the plugin's
 * folder from the repository and checks it (manifest, signature, the catalog's hash); it comes in switched off, and Switch on asks first.
 * Shows the last check at once, then checks the sources (10 minutes cached); "Check now" asks them again.
 */

type Status = "all" | "installed" | "not-installed" | "updates" | "ports";

const categoryLabel = (t: T, c: PluginCategoryId | "other" | undefined): string =>
  ({
    app: t("Apps"),
    connector: t("Connectors"),
    communication: t("Mail & chat"),
    ai: t("AI"),
    time: t("Time tracking"),
    finance: t("Finances"),
    knowledge: t("Knowledge"),
    language: t("Languages"),
    developer: t("Developer tools"),
    system: t("System"),
    other: t("Other"),
  })[c ?? "other"] ?? t("Other");

const addsLabel = (t: T, key: string, n: number): string =>
  ({
    apps: t("{n} app(s)", { n }),
    pages: t("{n} page(s)", { n }),
    databases: t("{n} database(s)", { n }),
    syncs: t("{n} sync(s)", { n }),
    flows: t("{n} flow(s)", { n }),
    views: t("{n} view(s)", { n }),
    widgets: t("{n} widget(s)", { n }),
    drivers: t("{n} driver(s)", { n }),
    lookups: t("{n} lookup(s)", { n }),
    tools: t("{n} AI tool(s)", { n }),
    aiTasks: t("{n} AI step(s)", { n }),
    services: t("{n} service(s)", { n }),
    functions: t("{n} function(s)", { n }),
    stores: t("{n} store(s)", { n }),
    commands: t("{n} command(s)", { n }),
    mcpServers: t("{n} MCP server(s)", { n }),
    hooks: t("{n} hook(s)", { n }),
    schedules: t("{n} schedule(s)", { n }),
    chats: t("{n} chat(s)", { n }),
    oauth: t("{n} sign-in(s)", { n }),
    languages: t("a language"),
    settings: t("{n} setting(s)", { n }),
  })[key] ?? `${n} ${key}`;

const kb = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} kB`);

function searchText(e: CatalogEntry, source: string): string {
  return [e.id, e.name, e.description, ...e.keywords, e.category ?? "", e.author ?? "", source, ...addsSummary(e.adds).flatMap((a) => [a.key, ...a.names]), ...e.adds.flows.map((f) => f.name)].join(" ").toLowerCase();
}

function Icon({ e, size = "text-2xl" }: { e: CatalogEntry; size?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- a small data: URL from the catalog, nothing to optimize
  if (e.iconImage) return <img src={e.iconImage} alt="" className="h-9 w-9 shrink-0 rounded-lg object-contain" />;
  return (
    <span aria-hidden className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 ${size} dark:bg-zinc-800`}>
      {e.icon ?? "🧩"}
    </span>
  );
}

function Badges({ it, t }: { it: MarketItem; t: T }) {
  const pill = "rounded px-1.5 py-0.5 text-[11px] font-medium";
  return (
    <span className="flex flex-wrap gap-1">
      {it.installed ? (
        it.enabled ? (
          <span className={`${pill} bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200`}>{t("on")}</span>
        ) : (
          <span className={`${pill} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}>{t("installed · off")}</span>
        )
      ) : null}
      {it.updateAvailable && <span className={`${pill} bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200`}>⬆ {it.listing.version}</span>}
      {it.conflicts > 0 && <span className={`${pill} bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200`}>{t("update waits")}</span>}
      {it.port && <span className={`${pill} bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200`}>{it.port.switched ? t("runs the built-in") : t("replaces a built-in")}</span>}
      {it.listing.signed && <span className={`${pill} bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200`}>✓ {t("signed")}</span>}
      {it.listing.permissions.includes("exec") && <span className={`${pill} bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300`}>{t("runs programs")}</span>}
    </span>
  );
}

export function Marketplace({ initialPlugin }: { initialPlugin?: string }) {
  const t = useT();
  const router = useRouter();
  const [view, setView] = useState<MarketView | null>(null);
  const [words, setWords] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<PluginCategoryId | "other" | "all">("all");
  const [status, setStatus] = useState<Status>("all");
  const [signedOnly, setSignedOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ key: string; detail?: PluginDetail; error?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newToken, setNewToken] = useState("");

  const load = useCallback(async (mode: "cached" | "check" | "fresh") => {
    const r = await marketplaceAction(mode);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setView(r.view);
    setWords(r.permissions);
  }, []);

  // The last check at once, then the sources asked (cached ten minutes on the server).
  useEffect(() => {
    let live = true;
    void (async () => {
      const first = await marketplaceAction("cached");
      if (!live) return;
      if (first.ok) {
        setView(first.view);
        setWords(first.permissions);
      }
      setChecking(true);
      const r = await marketplaceAction("check");
      if (!live) return;
      setChecking(false);
      if (r.ok) {
        setView(r.view);
        setWords(r.permissions);
      } else toast(r.error, { tone: "error" });
    })();
    return () => {
      live = false;
    };
  }, []);

  // A plugin named in the address (the header's search: "Install …") opens once it is listed.
  useEffect(() => {
    if (!initialPlugin || !view || open) return;
    const it = view.items.find((x) => x.listing.id === initialPlugin);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the plugin to open is known only once the listing arrived
    if (it) setOpen(it.key);
  }, [initialPlugin, view, open]);

  const current = view?.items.find((x) => x.key === open) ?? null;
  useEffect(() => {
    if (!current) return;
    let live = true;
    void pluginDetailAction(current.sourceId, current.listing.id).then((r) => {
      if (!live) return;
      setDetail(r.ok ? { key: current.key, detail: r.detail } : { key: current.key, error: r.error });
    });
    return () => {
      live = false;
    };
  }, [current?.key, current?.sha]); // eslint-disable-line react-hooks/exhaustive-deps -- read again for another plugin or commit only

  const items = useMemo(() => {
    const want = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (view?.items ?? []).filter((it) => {
      if (category !== "all" && (it.listing.category ?? "other") !== category) return false;
      if (status === "installed" && !it.installed) return false;
      if (status === "not-installed" && it.installed) return false;
      if (status === "updates" && !it.updateAvailable && !it.conflicts) return false;
      if (status === "ports" && !it.port) return false;
      if (signedOnly && !it.listing.signed) return false;
      const text = searchText(it.listing, it.source);
      return want.every((w) => text.includes(w));
    });
  }, [view, q, category, status, signedOnly]);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const it of view?.items ?? []) c.set(it.listing.category ?? "other", (c.get(it.listing.category ?? "other") ?? 0) + 1);
    return c;
  }, [view]);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) return void toast(r.error ?? t("Didn't work."), { tone: "error", ms: 12000 });
    if (r.message) toast(r.message, { tone: "ok", ms: 12000 });
    await load("check");
    router.refresh();
  };

  const permissionList = (e: CatalogEntry) => (e.permissions.length ? e.permissions.map((p) => `• ${p} — ${words[p] ?? p}`).join("\n") : t("(nothing special)"));
  const install = (it: MarketItem) => {
    if (!it.installed && !confirmAction(`${t("Install “{name}” {v} from {repo}?", { name: it.listing.name, v: it.listing.version, repo: it.source })}\n\n${t("Its folder is downloaded and checked; it comes in switched off. It will ask for:")}\n${permissionList(it.listing)}`)) return;
    void run(`i:${it.key}`, () => installFromSourceAction(it.sourceId, it.listing.id));
  };
  const switchOn = (it: MarketItem) => {
    const head = it.port ? t("Switch Zeff's built-in to the plugin “{name}”? Your settings come along; the built-in is switched off.", { name: it.listing.name }) : t("Turn on “{name}”? It may:", { name: it.listing.name });
    if (!confirmAction(`${head}\n\n${permissionList(it.listing)}\n\n${t("Only turn on plugins you trust.")}`)) return;
    void run(`o:${it.key}`, () => switchOnPluginAction(it.listing.id));
  };
  const remove = (it: MarketItem) => {
    if (!confirmAction(t("Remove “{name}”? It is switched off and its folder moved aside; what it made in Zeff (its app's pages, its settings) stays.", { name: it.listing.name }))) return;
    void run(`r:${it.key}`, () => removePluginAction(it.listing.id));
  };

  const actions = (it: MarketItem, big = false) => {
    const sm = big ? "btn" : "btn btn-sm";
    const b = (k: string) => busy === `${k}:${it.key}`;
    return (
      <div className="flex flex-wrap gap-1.5">
        {!it.installed && (
          <button type="button" className={`${sm} btn-primary`} disabled={!!busy} onClick={() => install(it)}>
            {b("i") ? t("Installing …") : `＋ ${t("Install")}`}
          </button>
        )}
        {it.installed && (it.updateAvailable || it.conflicts > 0) && (
          <button type="button" className={`${sm} btn-primary`} disabled={!!busy} onClick={() => void run(`i:${it.key}`, () => installFromSourceAction(it.sourceId, it.listing.id))}>
            {b("i") ? t("Working …") : `⬆ ${t("Update to {v}", { v: it.listing.version })}`}
          </button>
        )}
        {it.installed && !it.enabled && (
          <button type="button" className={`${sm} ${it.updateAvailable ? "" : "btn-primary"}`} disabled={!!busy} onClick={() => switchOn(it)}>
            {b("o") ? "…" : it.port ? t("Switch to the plugin") : t("Switch on")}
          </button>
        )}
        {it.installed && it.enabled && big && (
          <button type="button" className={sm} disabled={!!busy} onClick={() => void run(`f:${it.key}`, () => setExtPluginEnabledAction(it.listing.id, false))}>
            {t("Turn off")}
          </button>
        )}
        {it.installed && big && (
          <button type="button" className={`${sm} text-red-700 dark:text-red-300`} disabled={!!busy} onClick={() => remove(it)}>
            {b("r") ? "…" : t("Remove")}
          </button>
        )}
      </div>
    );
  };

  const chip = (on: boolean) => `rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${on ? "border-indigo-500 bg-indigo-50 text-indigo-800 dark:border-indigo-400 dark:bg-indigo-950 dark:text-indigo-200" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"}`;
  const statuses: [Status, string][] = [
    ["all", t("All")],
    ["not-installed", t("Not installed")],
    ["installed", t("Installed")],
    ["updates", t("Updates")],
    ["ports", t("Replace a built-in")],
  ];

  return (
    <section className="space-y-4" aria-labelledby="browse-title" data-marketplace>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="browse-title" className="text-sm font-semibold text-zinc-500 uppercase">
          {t("Browse plugins")}
        </h2>
        <span className="text-xs text-zinc-400">
          {view ? t("{n} in {s} source(s)", { n: view.items.length, s: view.sources.length }) : t("Checking …")}
          {checking ? ` · ${t("checking the sources …")}` : ""}
        </span>
        <span className="flex-1" />
        <button type="button" className="btn btn-sm" disabled={checking || !!busy} onClick={() => (setChecking(true), void load("fresh").finally(() => setChecking(false)))}>
          ↻ {t("Check now")}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setAdding(!adding)} aria-expanded={adding}>
          ＋ {t("Add a repository")}
        </button>
      </div>
      {adding && (
        <form
          className="card grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void run("add", () => addSourceAction(newUrl, "", newToken)).then(() => (setNewUrl(""), setNewToken(""), setAdding(false)));
          }}
        >
          <input className="input" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://github.com/owner/repo" aria-label={t("Repository")} required />
          <input className="input" type="password" autoComplete="off" value={newToken} onChange={(e) => setNewToken(e.target.value)} placeholder={t("Token (only for a private one)")} aria-label={t("Token")} />
          <button type="submit" className="btn btn-primary" disabled={!!busy}>
            {t("Add")}
          </button>
          <p className="text-xs text-zinc-500 sm:col-span-3">{t("A GitHub repository (read through GitHub's web API — no git needed), any git address, or a folder on this computer. Every folder with a zeff-plugin.json in it is a plugin; a catalog.json at its top lists them at once.")}</p>
        </form>
      )}

      <div className="space-y-2">
        <input type="search" className="input max-w-xl" placeholder={t("Search by name, keyword or what it adds …")} aria-label={t("Search the marketplace")} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQ("")} />
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("Category")}>
          <button type="button" className={chip(category === "all")} aria-pressed={category === "all"} onClick={() => setCategory("all")}>
            {t("All categories")}
          </button>
          {[...PLUGIN_CATEGORIES, "other" as const].filter((c) => counts.get(c)).map((c) => (
            <button key={c} type="button" className={chip(category === c)} aria-pressed={category === c} onClick={() => setCategory(category === c ? "all" : c)}>
              {categoryLabel(t, c)} <span className="text-zinc-400">{counts.get(c)}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("Status")}>
          {statuses.map(([s, label]) => (
            <button key={s} type="button" className={chip(status === s)} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {label}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={signedOnly} onChange={(e) => setSignedOnly(e.target.checked)} /> {t("Signed only")}
          </label>
          {view && (
            <span className="ml-auto text-xs text-zinc-500" aria-live="polite">
              {t("{n} shown", { n: items.length })}
            </span>
          )}
        </div>
      </div>

      <div className={`grid items-start gap-4 ${current ? "xl:grid-cols-[minmax(0,1fr)_28rem]" : ""}`}>
        <div>
          {view === null ? (
            <p className="text-sm text-zinc-400">{t("Checking …")}</p>
          ) : view.items.length === 0 ? (
            <p className="card p-4 text-sm text-zinc-500">{t("No plugins yet: add a repository — the zeff-plugins repository is https://github.com/269652/zeff-plugins.")}</p>
          ) : items.length === 0 ? (
            <p className="card p-4 text-sm text-zinc-500">{t("No plugin matches.")}</p>
          ) : (
            <ul className={`grid gap-3 ${current ? "md:grid-cols-2" : "md:grid-cols-2 2xl:grid-cols-3"}`}>
              {items.map((it) => (
                <li key={it.key}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={open === it.key}
                    onClick={() => setOpen(open === it.key ? null : it.key)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(open === it.key ? null : it.key))}
                    className={`card flex h-full cursor-pointer flex-col gap-2 p-3 text-left transition hover:border-indigo-300 dark:hover:border-indigo-700 ${open === it.key ? "border-indigo-500 ring-2 ring-indigo-500/30 dark:border-indigo-400" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon e={it.listing} />
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-medium">
                          {it.listing.name} <span className="text-xs font-normal text-zinc-400">{it.installed && it.installed !== it.listing.version ? `${it.installed} → ${it.listing.version}` : it.listing.version}</span>
                        </h3>
                        <p className="truncate text-xs text-zinc-400">
                          {categoryLabel(t, it.listing.category)} · {it.source}
                        </p>
                      </div>
                    </div>
                    <p className="line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">{it.listing.description}</p>
                    <div className="mt-auto flex flex-wrap items-end justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                      <Badges it={it} t={t} />
                      {actions(it)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {current && (
          <DetailPanel
            it={current}
            t={t}
            words={words}
            detail={detail?.key === current.key ? detail : null}
            actions={actions(current, true)}
            onClose={() => setOpen(null)}
            installFrom={(sourceId) => {
              if (!confirmAction(t("Install “{name}” from {repo}?", { name: current.listing.name, repo: current.others.find((o) => o.sourceId === sourceId)?.source ?? "" }))) return;
              void run(`i:${current.key}`, () => installFromSourceAction(sourceId, current.listing.id));
            }}
          />
        )}
      </div>

      {view && view.sources.length > 0 && <SourcesList view={view} t={t} busy={!!busy} run={run} />}
    </section>
  );
}

function DetailPanel({ it, t, words, detail, actions, onClose, installFrom }: { it: MarketItem; t: T; words: Record<string, string>; detail: { detail?: PluginDetail; error?: string } | null; actions: React.ReactNode; onClose: () => void; installFrom: (sourceId: string) => void }) {
  const e = it.listing;
  const adds = addsSummary(e.adds);
  const gh = it.sourceUrl.startsWith("https://github.com/") ? it.sourceUrl : null;
  return (
    <aside className="card space-y-4 p-4 xl:sticky xl:top-2 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto" aria-label={t("Details of {name}", { name: e.name })} data-plugin-detail>
      <div className="flex items-start gap-3">
        <Icon e={e} size="text-3xl" />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold">{e.name}</h3>
          <p className="text-xs text-zinc-500">
            <span className="font-mono">{e.id}</span> · {e.version}
            {e.author ? ` · ${e.author}` : ""} ·{" "}
            {gh ? (
              <a className="text-indigo-600 hover:underline dark:text-indigo-400" href={`${gh}/tree/${it.sha || "HEAD"}/${e.path}`} target="_blank" rel="noopener noreferrer">
                {it.source}/{e.path}
              </a>
            ) : (
              `${it.source}/${e.path}`
            )}
          </p>
        </div>
        <button type="button" className="rounded px-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={onClose} aria-label={t("Close")}>
          ✕
        </button>
      </div>
      <Badges it={it} t={t} />
      {actions}
      {it.installed && !it.enabled && !it.updateAvailable && <p className="text-xs text-zinc-500">{t("Installed {v}, switched off — switch it on to use it.", { v: it.installed })}</p>}
      {it.ungranted.length > 0 && <p className="text-xs text-red-600 dark:text-red-400">{t("An update asks for more ({list}) — turn it off and on again to grant it.", { list: it.ungranted.join(", ") })}</p>}
      <p className="text-sm text-zinc-700 dark:text-zinc-200">{e.description}</p>
      {e.keywords.length > 0 && (
        <p className="flex flex-wrap gap-1">
          {e.keywords.map((k) => (
            <span key={k} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {k}
            </span>
          ))}
        </p>
      )}

      <div className="space-y-1">
        <h4 className="label">{t("It asks for")}</h4>
        {e.permissions.length === 0 ? (
          <p className="text-sm text-zinc-500">{t("Nothing special — it works with what Zeff gives every plugin.")}</p>
        ) : (
          <ul className="space-y-0.5 text-sm">
            {e.permissions.map((p) => (
              <li key={p} className={p === "exec" ? "text-amber-700 dark:text-amber-400" : "text-zinc-600 dark:text-zinc-300"}>
                <span className="font-mono text-xs">{p}</span> — {words[p] ?? t("(no installed plugin offers this)")}
              </li>
            ))}
          </ul>
        )}
      </div>

      {adds.length > 0 && (
        <div className="space-y-1">
          <h4 className="label">{t("What it adds")}</h4>
          <ul className="space-y-0.5 text-sm text-zinc-600 dark:text-zinc-300">
            {adds.map((a) => (
              <li key={a.key}>
                <b className="font-medium">{addsLabel(t, a.key, a.n)}</b>
                {a.names.length > 0 && <span className="text-zinc-500">: {a.names.slice(0, 8).join(", ")}{a.names.length > 8 ? " …" : ""}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1">
        <h4 className="label">{t("Needs")}</h4>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          {t("Extension API {v}", { v: e.requires.apiVersion ?? 1 })}
          {e.requires.plugins.length > 0 && ` · ${t("the plugins {ids}", { ids: e.requires.plugins.join(", ") })}`}
          {it.port && ` · ${t("replaces Zeff's built-in “{id}”", { id: it.port.builtin })}`}
        </p>
        {it.others.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            {t("Also in:")}
            {it.others.map((o) => (
              <span key={o.sourceId}>
                {o.source} {o.version}
                {!it.installed && (
                  <button type="button" className="ml-1 text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => installFrom(o.sourceId)}>
                    {t("install from there")}
                  </button>
                )}
              </span>
            ))}
          </p>
        )}
        <p className="text-xs text-zinc-500">
          {t("{n} files, {size}", { n: e.files, size: kb(e.size) })}
          {e.signed ? ` · ${t("signed by {key}", { key: e.signed.key })}` : ` · ${t("not signed")}`}
          {e.hash ? ` · sha256 ${e.hash.slice(0, 12)}…` : ""}
        </p>
      </div>

      {detail?.detail?.screenshots.length ? (
        <div className="grid grid-cols-2 gap-2">
          {detail.detail.screenshots.map((s) => (
            // eslint-disable-next-line @next/next/no-img-element -- data: URLs read from the repository
            <img key={s.path} src={s.url} alt={s.path} className="rounded border border-zinc-200 dark:border-zinc-700" />
          ))}
        </div>
      ) : null}

      <div className="space-y-1">
        <h4 className="label">{t("About it")}</h4>
        {detail === null ? (
          <p className="text-sm text-zinc-400">{e.readme ?? t("Reading …")}</p>
        ) : detail.error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{detail.error}</p>
        ) : detail.detail?.readme ? (
          <div className="max-h-[28rem] overflow-y-auto rounded border border-zinc-100 p-3 dark:border-zinc-800">
            <Markdown text={detail.detail.readme} image={() => null} />
          </div>
        ) : (
          <p className="text-sm text-zinc-500">{t("It has no README.")}</p>
        )}
      </div>

      {detail?.detail && detail.detail.history.length > 0 && (
        <div className="space-y-1">
          <h4 className="label">{t("Changes")}</h4>
          <ul className="space-y-1 text-xs">
            {detail.detail.history.map((c) => (
              <li key={c.sha} className="flex gap-2">
                {gh ? (
                  <a className="shrink-0 font-mono text-indigo-600 hover:underline dark:text-indigo-400" href={`${gh}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer">
                    {c.sha.slice(0, 7)}
                  </a>
                ) : (
                  <span className="shrink-0 font-mono text-zinc-400">{c.sha.slice(0, 7)}</span>
                )}
                <span className="min-w-0 text-zinc-600 dark:text-zinc-300">
                  {c.subject} <span className="text-zinc-400">· {c.at ? new Date(c.at).toLocaleDateString() : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

function SourcesList({ view, t, busy, run }: { view: MarketView; t: T; busy: boolean; run: (key: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => Promise<void> }) {
  const [tokenFor, setTokenFor] = useState<string | null>(null);
  const [token, setToken] = useState("");
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold text-zinc-500 uppercase">{t("Where they come from")}</h3>
      <ul className="space-y-1.5 text-sm">
        {view.sources.map((s) => (
          <li key={s.id} className="card flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="font-medium">{s.source}</span>
            <span className="text-xs text-zinc-500">
              {s.error ? "" : s.catalog ? t("catalog.json — listed at once") : t("no catalog.json — each manifest read")}
              {s.unlisted.length > 0 && ` · ${t("the catalog is out of date: {n} folder(s) not in it", { n: s.unlisted.length })}`}
              {s.hasToken ? ` · 🔑 ${t("with a token")}` : ""}
              {` · ${t("checked {when}", { when: new Date(s.checkedAt).toLocaleString() })}`}
            </span>
            {s.error && <span className="w-full text-xs text-red-600 dark:text-red-400">{s.error}</span>}
            <span className="flex-1" />
            {tokenFor === s.id ? (
              <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(`tok:${s.id}`, () => setSourceTokenAction(s.url, token)).then(() => (setTokenFor(null), setToken("")));
                }}
              >
                <input className="input py-0.5 text-xs" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={t("Token (empty: none)")} aria-label={t("Token")} />
                <button type="submit" className="btn btn-sm" disabled={busy}>
                  {t("Save")}
                </button>
              </form>
            ) : (
              s.url.startsWith("https://") && (
                <button type="button" className="rounded px-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => setTokenFor(s.id)}>
                  🔑 {s.hasToken ? t("Change the token") : t("Add a token")}
                </button>
              )
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-500">{t("A private GitHub repository needs a token (a fine-grained one with read access to its contents); a token also raises GitHub's limit of requests. It is kept in Zeff and never shown again. Removing a source, its branch: Installed → Sources.")}</p>
    </div>
  );
}
