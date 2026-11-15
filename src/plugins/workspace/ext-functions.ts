/**
 * What external plugins bring to the Workspace through their functions (a manifest's contributes.lookups and contributes.sources):
 * a lookup's search and details, a source's records are each read by a plugin function (Python or Node.js, run by the Notebook plugin).
 * The function only does what the user granted it (Settings → Notebook → Functions). Server only.
 */
import { getPlugin, scanPlugins } from "@/lib/ext/registry";
import { REPLACEABLE_SOURCES } from "@/lib/ext/stores";
import { runPluginFunction } from "./plugin-fn";
import type { LookupHit, LookupSource, LookupValue } from "./lookup-point";
import type { WorkspaceSource } from "./source-point";
import type { SourceRecord } from "./pipeline";
import type { WorkspaceFieldType } from "./field-point";

const call = runPluginFunction;

const str = (v: unknown, max = 500) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "").slice(0, max);
const enabled = () => scanPlugins().plugins.filter((p) => getPlugin(p.id)?.enabled);

/** Field types external plugins declare: checked by a pattern, a range or a list of choices - no code. */
export function externalFieldTypes(): WorkspaceFieldType[] {
  return enabled().flatMap((p) =>
    p.manifest.contributes.fieldTypes.map((f): WorkspaceFieldType => {
      const re = f.pattern ? new RegExp(f.pattern) : null;
      return {
        id: `${p.id}.${f.id}`,
        label: f.label,
        icon: f.icon,
        description: f.description,
        display: f.display,
        ...(f.max ? { max: f.max } : {}),
        ...(f.href ? { href: f.href } : {}),
        ...(f.kind === "choice" ? { suggestions: () => f.options } : {}),
        parse: (input) => {
          const s = input.trim();
          if (s === "") return null;
          if (f.kind === "number") {
            const n = Number(s.replace(",", "."));
            if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.maxValue !== undefined && n > f.maxValue)) throw new Error(`${f.label}: ${f.min ?? "…"}-${f.maxValue ?? "…"}`);
            return n;
          }
          if (f.kind === "choice") {
            const hit = f.options.find((o) => o.toLowerCase() === s.toLowerCase());
            if (!hit) throw new Error(`${f.label}: ${f.options.join(", ")}`);
            return hit;
          }
          if (re && !re.test(s)) throw new Error(`${f.label}: ${s} does not fit`);
          return s.slice(0, 500);
        },
      };
    }),
  );
}

export function externalLookups(): LookupSource[] {
  return enabled().flatMap((p) =>
    p.manifest.contributes.lookups.map(
      (l): LookupSource => ({
        id: `${p.id}.${l.id}`,
        label: l.label,
        what: l.what,
        fields: l.fields,
        ...(l.credit ? { credit: l.credit } : {}),
        slow: l.slow,
        search: async (query, language) => {
          const v = await call(p.id, l.search, { query, language });
          return (Array.isArray(v) ? v : []).slice(0, 20).flatMap((h): LookupHit[] => {
            const o = h && typeof h === "object" ? (h as Record<string, unknown>) : null;
            if (!o || !str(o.id) || !str(o.title)) return [];
            return [{ id: str(o.id, 200), title: str(o.title, 200), ...(str(o.subtitle) ? { subtitle: str(o.subtitle, 200) } : {}), ...(/^https?:\/\//.test(str(o.image)) ? { image: str(o.image, 500) } : {}) }];
          });
        },
        details: async (id, language) => {
          const v = await call(p.id, l.details, { id, language });
          const out: Record<string, LookupValue> = {};
          if (v && typeof v === "object" && !Array.isArray(v))
            for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
              if (x === null || typeof x === "string" || typeof x === "number") out[k] = x as LookupValue;
              else if (Array.isArray(x)) out[k] = x.map((y) => str(y, 200)).filter(Boolean);
            }
          return out;
        },
      }),
    ),
  );
}

const TYPED = new Set(["text", "date", "checkbox", "select", "url", "number", "person"]);
const GROUPS = new Set(["todo", "doing", "done"]);

export function externalSources(): WorkspaceSource[] {
  return enabled().flatMap((p) =>
    p.manifest.contributes.sources.map((s): WorkspaceSource => {
      // (a port's source stands in for its built-in's — by its id, so the databases that read it go on: only its own built-in's)
      const replaces = s.replaces && (REPLACEABLE_SOURCES[p.id] ?? []).includes(s.replaces) ? s.replaces : null;
      return {
        id: replaces ?? `${p.id}.${s.id}`,
        label: s.label,
        icon: s.icon,
        hint: s.hint,
        noNewRows: s.noNewRows,
        ...(s.lockedFields.length ? { lockedFields: s.lockedFields } : {}),
        read: async () => {
          let v: unknown;
          if (s.lambda) {
            const { invokeLambda } = await import("./lambdas/run");
            const r = await invokeLambda(s.lambda, {});
            if (!r.ok) throw new Error(r.error);
            v = r.result;
          } else v = await call(p.id, s.read!, {});
          return (Array.isArray(v) ? v : []).slice(0, 5000).flatMap((r): SourceRecord[] => {
            const o = r && typeof r === "object" ? (r as Record<string, unknown>) : null;
            if (!o || !str(o.ref) || !str(o.title)) return [];
            const fields: Record<string, string> = {};
            if (o.fields && typeof o.fields === "object") for (const [k, x] of Object.entries(o.fields as Record<string, unknown>)) fields[k.slice(0, 60)] = str(x, 2000);
            const st = o.status && typeof o.status === "object" ? (o.status as { name?: unknown; group?: unknown }) : null;
            const typed = (Array.isArray(o.typed) ? o.typed : []).slice(0, 60).flatMap((x): NonNullable<SourceRecord["typed"]> => {
              const f = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
              if (!f || !str(f.id) || !TYPED.has(str(f.type))) return [];
              const value = f.value === null || typeof f.value === "string" || typeof f.value === "number" || typeof f.value === "boolean" ? f.value : null;
              return [{ id: str(f.id, 60), name: str(f.name, 80) || str(f.id, 60), type: str(f.type) as never, value, ...(f.format === "number" || f.format === "euro" ? { format: f.format } : {}) }];
            });
            return [
              {
                ref: str(o.ref, 200),
                title: str(o.title, 300),
                ...(str(o.key) ? { key: str(o.key, 60) } : {}),
                fields,
                ...(st && str(st.name) && GROUPS.has(str(st.group)) ? { status: { name: str(st.name, 60), group: str(st.group) as "todo" | "doing" | "done" } } : {}),
                ...(typed.length ? { typed } : {}),
                ...(/^[a-z][a-z0-9-]{0,39}$/.test(str(o.dataType)) ? { dataType: str(o.dataType) as never } : {}),
                ...(typeof o.text === "string" ? { text: str(o.text, 20000) } : {}),
                ...(/^https?:\/\//.test(str(o.url)) ? { url: str(o.url, 1000) } : {}),
                ...(str(o.updatedAt) ? { updatedAt: str(o.updatedAt, 40) } : {}),
              },
            ];
          });
        },
      };
    }),
  );
}
