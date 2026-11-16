"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { FIELD_TYPES, type FieldSpec } from "@/plugins/workspace/flows/types";
import { capabilitiesAction, capabilityAction, deleteCapabilityAction, restoreCapabilityAction, saveCapabilityAction } from "../server-actions";

/**
 * The capabilities: what a flow's action node can call, as the database declares it — Zeff's own actions (a row each: its texts, its
 * input fields, its switch; the code is only the handler), wrappers over a primitive or another capability, and small programs of
 * flow nodes. What you change here is what the engine, the Studio's picker and the AI go by — every save is a version you can bring back.
 */

type Row = { name: string; label: string; summary: string; group: string; class: string; made: "command" | "use" | "nodes"; enabled: boolean; writes: boolean; versions: number };
type Cap = {
  name: string;
  label: string;
  summary: string;
  input: FieldSpec[];
  output: string;
  enabled: boolean;
  writes?: boolean;
  class?: string;
  group?: string;
  impl: { command: string } | { use: string; input?: Record<string, unknown>; output?: unknown } | { nodes: unknown[]; output?: unknown };
};

const CLASS_ORDER = ["wrapper", "program", "primitive", "command", "read", "vendor"];
const CLASS_NOTE: Record<string, string> = {
  wrapper: "Yours: wrap a primitive or another action",
  program: "Yours: a small program of flow nodes",
  primitive: "Generic — stays code",
  command: "Writes with the kernel's rules — stays code",
  read: "Reads Zeff's data — to become a view and a flow",
  vendor: "Glue for one service — to become a flow",
};

const json = (v: unknown) => JSON.stringify(v ?? null, null, 2);

export function Capabilities() {
  const t = useT();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => void capabilitiesAction().then((r) => r.ok && setRows(r.capabilities)), []);
  useEffect(load, [load]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = rows.filter((r) => !needle || `${r.name} ${r.label} ${r.summary}`.toLowerCase().includes(needle));
    return CLASS_ORDER.map((c) => ({ c, items: hit.filter((r) => r.class === c) })).filter((g) => g.items.length);
  }, [rows, q]);

  const make = async () => {
    const name = window.prompt(t("Name of the new capability (lowercase, dots)"), "my.thing");
    if (!name) return;
    const r = await saveCapabilityAction({ name: name.trim().toLowerCase(), label: name.trim(), input: [], output: "the result", impl: { use: "log", input: { message: "hello" } } });
    if (!r.ok) return toast(r.error, { tone: "error" });
    if (!r.saved) return toast(r.problems.join("\n"), { tone: "error" });
    load();
    setOpen(r.capability.name);
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("Capabilities")}</h2>
          <button type="button" className="btn btn-sm" onClick={() => void make()}>
            + {t("Capability")}
          </button>
        </div>
        <p className="text-xs text-zinc-500">{t("What a flow's action can call, as the database declares it. A row's texts, fields and switch are what the engine and the AI go by.")}</p>
        <input className="input" placeholder={t("Search")} value={q} onChange={(e) => setQ(e.target.value)} />
        {groups.map((g) => (
          <div key={g.c}>
            <div className="label" title={t(CLASS_NOTE[g.c] ?? "")}>
              {t(CLASS_NOTE[g.c] ?? g.c)} · {g.items.length}
            </div>
            <ul className="space-y-0.5">
              {g.items.map((r) => (
                <li key={r.name}>
                  <button type="button" className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${open === r.name ? "bg-indigo-50 dark:bg-indigo-950/60" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`} title={r.summary} onClick={() => setOpen(r.name)}>
                    <span className={`min-w-0 flex-1 truncate font-mono text-xs ${r.enabled ? "" : "text-zinc-400 line-through"}`}>{r.name}</span>
                    {r.writes && <span title={t("changes something")}>✎</span>}
                    {r.versions > 1 && <span className="text-[10px] text-zinc-500">v{r.versions}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="min-w-0">{open ? <CapabilityForm key={open} name={open} onChanged={load} onGone={() => (load(), setOpen(null))} /> : <p className="text-sm text-zinc-500">{t("Pick a capability to read or change its row.")}</p>}</div>
    </div>
  );
}

function CapabilityForm({ name, onChanged, onGone }: { name: string; onChanged: () => void; onGone: () => void }) {
  const t = useT();
  const [cap, setCap] = useState<Cap | null>(null);
  const [versions, setVersions] = useState<{ version: number; at: string }[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [implText, setImplText] = useState("");
  const [dirty, setDirty] = useState(false);

  const load = useCallback(() => {
    void capabilityAction(name).then((r) => {
      if (!r.ok) return toast(r.error, { tone: "error" });
      setCap(r.capability as Cap);
      setVersions(r.versions);
      setImplText(json((r.capability as Cap).impl));
      setProblems([]);
      setDirty(false);
    });
  }, [name]);
  useEffect(load, [load]);
  if (!cap) return <p className="text-sm text-zinc-500">…</p>;
  const command = "command" in cap.impl;
  const change = (patch: Partial<Cap>) => (setCap({ ...cap, ...patch }), setDirty(true));
  const field = (i: number, patch: Partial<FieldSpec>) => change({ input: cap.input.map((f, k) => (k === i ? { ...f, ...patch } : f)) });

  const save = async () => {
    let impl: unknown = cap.impl;
    if (!command) {
      try {
        impl = JSON.parse(implText);
      } catch (e) {
        return setProblems([`impl: ${(e as Error).message}`]);
      }
    }
    const r = await saveCapabilityAction({ ...cap, impl });
    if (!r.ok) return toast(r.error, { tone: "error" });
    if (!r.saved) return setProblems(r.problems);
    toast(t("Saved — a new version."));
    load();
    onChanged();
  };

  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-base font-semibold">{cap.name}</h3>
        {cap.class && <span className="rounded bg-zinc-100 px-1.5 text-xs dark:bg-zinc-800">{cap.class}</span>}
        {cap.writes && <span className="text-xs text-amber-600">✎ {t("changes something")}</span>}
        <label className="ml-auto flex items-center gap-1 text-sm">
          <input type="checkbox" checked={cap.enabled} onChange={(e) => change({ enabled: e.target.checked })} />
          {t("On")}
        </label>
      </div>
      {!cap.enabled && <p className="text-xs text-amber-600">{t("Switched off: flows that call it fail with a clear message, and the AI isn't offered it.")}</p>}
      <label className="block space-y-1">
        <span className="label mb-0">{t("Label")}</span>
        <input className="input" value={cap.label} onChange={(e) => change({ label: e.target.value })} />
      </label>
      <label className="block space-y-1">
        <span className="label mb-0">{t("What it does")}</span>
        <textarea className="input min-h-20" value={cap.summary} onChange={(e) => change({ summary: e.target.value })} />
      </label>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="label mb-0">{t("Input")}</span>
          <button type="button" className="btn btn-sm" onClick={() => change({ input: [...cap.input, { name: "", type: "text" }] })}>
            + {t("Field")}
          </button>
        </div>
        {cap.input.map((f, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input className="input w-36 font-mono" placeholder={t("name")} value={f.name} onChange={(e) => field(i, { name: e.target.value })} />
            <select className="input w-28" value={f.type} onChange={(e) => field(i, { type: e.target.value as FieldSpec["type"] })}>
              {FIELD_TYPES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={!!f.required} onChange={(e) => field(i, { required: e.target.checked || undefined })} />
              {t("required")}
            </label>
            <input className="input min-w-0 flex-1" placeholder={t("help")} value={f.help ?? ""} onChange={(e) => field(i, { help: e.target.value || undefined })} />
            <button type="button" className="btn btn-sm" aria-label={t("Remove")} onClick={() => change({ input: cap.input.filter((_, k) => k !== i) })}>
              ✕
            </button>
          </div>
        ))}
        {!cap.input.length && <p className="text-xs text-zinc-500">{t("No input.")}</p>}
      </div>
      <label className="block space-y-1">
        <span className="label mb-0">{t("What it gives back (in words)")}</span>
        <input className="input" value={cap.output} onChange={(e) => change({ output: e.target.value })} />
      </label>
      {command ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("Its code is Zeff's own handler")} <code className="font-mono">{"command" in cap.impl ? cap.impl.command : ""}</code>. {t("Here you change how it is described and whether it is on; what it does stays code.")}
        </p>
      ) : (
        <label className="block space-y-1">
          <span className="label mb-0">{"use" in cap.impl ? t("What it wraps (use, input mapping, output)") : t("Its program (nodes, output)")} — JSON</span>
          <textarea className="input min-h-64 font-mono text-xs" spellCheck={false} value={implText} onChange={(e) => (setImplText(e.target.value), setDirty(true))} />
        </label>
      )}
      {problems.length > 0 && (
        <ul className="space-y-0.5 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
          {problems.map((p, i) => (
            <li key={i} className="font-mono">
              {p}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={!dirty} onClick={() => void save()}>
          {t("Save")}
        </button>
        {dirty && (
          <button type="button" className="btn" onClick={load}>
            {t("Discard")}
          </button>
        )}
        {!command && (
          <button
            type="button"
            className="btn btn-danger ml-auto"
            onClick={async () => {
              if (!window.confirm(t("Delete this capability? Its versions stay, flows that call it will fail."))) return;
              const r = await deleteCapabilityAction(cap.name);
              if (!r.ok) return toast(r.error, { tone: "error" });
              onGone();
            }}
          >
            {t("Delete")}
          </button>
        )}
      </div>
      {versions.length > 1 && (
        <details className="text-sm">
          <summary className="cursor-pointer">{t("Versions")} ({versions.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {versions.map((v, i) => (
              <li key={v.version} className="flex items-center gap-2">
                <span className="font-mono text-xs">v{v.version}</span>
                <span className="text-xs text-zinc-500">{new Date(v.at).toLocaleString()}</span>
                {i === 0 ? (
                  <span className="text-xs text-zinc-500">{t("current")}</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={async () => {
                      const r = await restoreCapabilityAction(cap.name, v.version);
                      if (!r.ok) return toast(r.error, { tone: "error" });
                      load();
                      onChanged();
                    }}
                  >
                    {t("Bring back")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
