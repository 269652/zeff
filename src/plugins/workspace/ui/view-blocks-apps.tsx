"use client";

import { useEffect, useMemo, useRef } from "react";
import { qrMatrix, qrPath } from "@/lib/girocode";

/**
 * Kit pieces for apps (view-template.ts): a chart of several series (stacked columns and bars, a line per series, its legend), and the
 * tick box of an item for doing something with many at once (<check>). Drawn by ui/view-template.tsx.
 */

const NAMED: Record<string, string> = { gray: "#a1a1aa", brown: "#a16207", orange: "#f97316", yellow: "#eab308", green: "#22c55e", blue: "#3b82f6", purple: "#a855f7", pink: "#ec4899", red: "#ef4444" };
const PALETTE = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#a855f7", "#ec4899", "#84cc16"];
const colorOf = (c: string | undefined, i: number) => (c ? (c.startsWith("#") ? c : (NAMED[c] ?? PALETTE[i % PALETTE.length])) : PALETTE[i % PALETTE.length]);
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export type SeriesPoint = { label: string; value: number; parts?: number[]; text?: string };

/** Several series over the same labels: stacked columns (column), stacked bars (bar), a line each (line); its legend under it. */
export function SeriesChart({ kind = "column", look, data, series }: { kind?: string; look?: string; data: SeriesPoint[]; series: { name: string; color?: string }[] }) {
  if (!data.length || !series.length) return null;
  const colors = series.map((s, i) => colorOf(s.color, i));
  const part = (d: SeriesPoint, i: number) => Math.max(0, d.parts?.[i] ?? 0);
  // (look=track, columns: a report's weeks — the total above each column, its label under it, and its text= as a small badge)
  if (kind === "column" && look === "track") {
    const totals = data.map((d) => series.reduce((n, _s, i) => n + part(d, i), 0));
    const top = Math.max(...totals, 1);
    return (
      <div className="flex items-end gap-2 overflow-x-auto pb-1" style={{ minHeight: 174 }}>
        {data.map((d, j) => (
          <div key={d.label} className="flex min-w-9 flex-1 flex-col items-center gap-1">
            <div className="text-xs font-medium text-zinc-500 tabular-nums">{totals[j] ? fmt(totals[j]) : ""}</div>
            <div className="flex w-full flex-col-reverse items-stretch" style={{ height: 130 }}>
              {series.map((s, i) => (part(d, i) > 0 ? <div key={s.name} style={{ height: `${(part(d, i) / top) * 100}%`, backgroundColor: colors[i] }} title={`${s.name}: ${fmt(part(d, i))}`} /> : null))}
              {totals[j] === 0 && <div className="mt-auto h-0.5 w-full bg-zinc-200 dark:bg-zinc-800" />}
            </div>
            <div className="text-xs text-zinc-500">{d.label}</div>
            {d.text && <div className="rounded bg-sky-50 px-1 text-xs font-medium text-sky-700 tabular-nums dark:bg-sky-950 dark:text-sky-300">{d.text}</div>}
          </div>
        ))}
      </div>
    );
  }
  const tip = (d: SeriesPoint) => `${d.label}: ${series.map((s, i) => `${s.name} ${fmt(d.parts?.[i] ?? 0)}`).join(", ")}`;
  const legend = (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-400">
      {series.map((s, i) => (
        <li key={s.name} className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-sm" style={{ background: colors[i] }} aria-hidden />
          {s.name}
        </li>
      ))}
    </ul>
  );
  if (kind === "bar" || kind === "pie") {
    const max = Math.max(...data.map((d) => series.reduce((n, _s, i) => n + part(d, i), 0)), 1);
    return (
      <div>
        <ul className="space-y-1.5 text-xs">
          {data.map((d) => (
            <li key={d.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2" title={tip(d)}>
              <span className="truncate">{d.label}</span>
              <span className="flex h-2.5 overflow-hidden rounded-sm">
                {series.map((s, i) => (
                  <span key={s.name} style={{ width: `${(part(d, i) / max) * 100}%`, background: colors[i] }} />
                ))}
              </span>
              <span className="text-zinc-500 tabular-nums">{fmt(series.reduce((n, _s, i) => n + (d.parts?.[i] ?? 0), 0))}</span>
            </li>
          ))}
        </ul>
        {legend}
      </div>
    );
  }
  const w = 100 / data.length;
  const line = kind === "line";
  const max = Math.max(...data.map((d) => (line ? Math.max(...series.map((_s, i) => part(d, i))) : series.reduce((n, _s, i) => n + part(d, i), 0))), 1);
  return (
    <div>
      <svg viewBox="0 0 100 50" className="h-40 w-full" preserveAspectRatio="none" role="img" aria-label={data.map(tip).join("; ")}>
        {line
          ? series.map((s, i) => <polyline key={s.name} fill="none" stroke={colors[i]} strokeWidth={1.5} vectorEffect="non-scaling-stroke" points={data.map((d, j) => `${j * w + w / 2},${50 - (part(d, i) / max) * 48}`).join(" ")} />)
          : data.map((d, j) => {
              let y = 50;
              return (
                <g key={d.label}>
                  <title>{tip(d)}</title>
                  {series.map((s, i) => {
                    const h = (part(d, i) / max) * 48;
                    y -= h;
                    return <rect key={s.name} x={j * w + w * 0.15} width={w * 0.7} y={y} height={h} fill={colors[i]} />;
                  })}
                </g>
              );
            })}
      </svg>
      <div className="flex text-[10px] text-zinc-500">
        {data.map((d) => (
          <span key={d.label} className="flex-1 truncate text-center" title={tip(d)}>
            {d.label}
          </span>
        ))}
      </div>
      {legend}
    </div>
  );
}

/** A tick box of a list's item (value) or of all of them (ids): the ids ticked as a JSON list, given to onChange. */
export function CheckBox({ a, onChange }: { a: Record<string, string>; onChange: (next: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const some = a.some === "true";
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);
  const toggle = (on: boolean) => {
    let ticked: string[] = [];
    try {
      ticked = (JSON.parse(a.current || "[]") as unknown[]).map(String);
    } catch {
      ticked = [];
    }
    const these: string[] = a.ids ? (JSON.parse(a.ids) as string[]) : a.value ? [a.value] : [];
    const next = on ? [...new Set([...ticked, ...these])] : ticked.filter((x) => !these.includes(x));
    onChange(next.length ? JSON.stringify(next) : "");
  };
  return (
    <label className="inline-flex shrink-0 items-center gap-1.5 text-sm print:hidden" onClick={(e) => e.stopPropagation()}>
      <input ref={ref} type="checkbox" className="size-4 accent-indigo-600" checked={a.checked === "true"} aria-label={a.label || undefined} onChange={(e) => toggle(e.target.checked)} />
      {a.label}
    </label>
  );
}

/** A text as a QR code, black on white with its quiet zone (dark mode too); its caption under it. Too long a text: said, not drawn. */
export function QrCode({ value, size = 160, label }: { value: string; size?: number; label?: string }) {
  const qr = useMemo(() => {
    try {
      return { m: qrMatrix(value), error: "" };
    } catch (e) {
      return { m: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [value]);
  if (!qr.m) return <p className="text-xs text-red-600 dark:text-red-400">{qr.error}</p>;
  const n = qr.m.length + 8;
  return (
    <figure className="inline-flex flex-col items-start gap-1">
      <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label={label || value} className="rounded-md ring-1 ring-zinc-200 dark:ring-zinc-700">
        <rect width={n} height={n} fill="#fff" />
        <path d={qrPath(qr.m)} fill="#000" />
      </svg>
      {label && <figcaption className="text-xs text-zinc-500">{label}</figcaption>}
    </figure>
  );
}
