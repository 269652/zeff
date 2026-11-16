/**
 * The typed standard library of the flow language (docs/plugins/server-dsl.md): pure functions over text, lists, objects, dates, numbers
 * and regular expressions, used as filters in expressions — {{ input.q | trim | regexReplace('\\s+', ' ') | startsWith('a') }}.
 * Each one declares its signature (the Studio and the AI read it; a call is checked against it: a wrong kind is an error that
 * says which argument), has no side effects and never reads the clock (dates come in as values). Pure; client-safe.
 */

export type Ty = "text" | "number" | "bool" | "list" | "object" | "any";

export type StdFn = {
  what: string;
  /** The piped value first, then the arguments. */
  params: Ty[];
  /** How many of the last params may be left out. */
  optional?: number;
  returns: Ty | "text|null" | "list|null" | "number|null" | "object|null";
  fn: (...a: never[]) => unknown;
};

const kindOf = (v: unknown): Ty | "null" => (v === null || v === undefined ? "null" : typeof v === "string" ? "text" : typeof v === "number" ? "number" : typeof v === "boolean" ? "bool" : Array.isArray(v) ? "list" : "object");

function check(name: string, def: StdFn, args: unknown[]): void {
  const min = def.params.length - (def.optional ?? 0);
  if (args.length < min || args.length > def.params.length) throw new Error(`${name}: takes ${min === def.params.length ? min : `${min}–${def.params.length}`} argument${def.params.length === 1 ? "" : "s"} (${def.params.map((p, i) => (i === 0 ? `the value: ${p}` : p)).join(", ")}), got ${args.length}.`);
  args.forEach((a, i) => {
    const want = def.params[i];
    const got = kindOf(a);
    if (want !== "any" && got !== want) throw new Error(`${name}: ${i === 0 ? "the value" : `argument ${i}`} must be ${want}, not ${got}${got === "null" ? " — use | default(…) first" : got === "text" && want === "number" ? " — use | number first" : ""}.`);
  });
}

const obj = (v: unknown) => v as Record<string, unknown>;
const get = (o: unknown, path: string): unknown => {
  let v: unknown = o;
  for (const k of path.split(".").filter(Boolean)) {
    if (v === null || v === undefined || typeof v !== "object") return null;
    v = Array.isArray(v) ? v[Number(k)] : (v as Record<string, unknown>)[k];
  }
  return v === undefined ? null : v;
};
const key = (x: unknown, k: string) => String(get(x, k) ?? "");

const MAX_PATTERN = 300;
const MAX_SUBJECT = 200_000;
function re(pattern: string, flags = ""): RegExp {
  if (pattern.length > MAX_PATTERN) throw new Error(`a pattern may have at most ${MAX_PATTERN} characters.`);
  if (!/^[gimsuy]*$/.test(flags)) throw new Error(`“${flags}” are no regular-expression flags (g i m s u y).`);
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    throw new Error(`“${pattern}” is no regular expression: ${(e as Error).message}`);
  }
}
const subject = (s: string) => (s.length > MAX_SUBJECT ? s.slice(0, MAX_SUBJECT) : s);

const DAY = 86_400_000;
const when = (s: string): Date => {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  if (Number.isNaN(d.getTime())) throw new Error(`“${s}” is no date or time.`);
  return d;
};
const back = (d: Date, like: string) => (/^\d{4}-\d{2}-\d{2}$/.test(like) ? d.toISOString().slice(0, 10) : d.toISOString());
const two = (n: number) => String(n).padStart(2, "0");

export const STDLIB: Record<string, StdFn> = {
  // ---- text
  startsWith: { what: "startsWith('ab'): whether the text begins with it", params: ["text", "text"], returns: "bool", fn: ((s: string, p: string) => s.startsWith(p)) as never },
  endsWith: { what: "endsWith('ab')", params: ["text", "text"], returns: "bool", fn: ((s: string, p: string) => s.endsWith(p)) as never },
  contains: { what: "contains('ab'): whether the text holds it", params: ["text", "text"], returns: "bool", fn: ((s: string, p: string) => s.includes(p)) as never },
  padStart: { what: "padStart(5, '0')", params: ["text", "number", "text"], optional: 1, returns: "text", fn: ((s: string, n: number, c = " ") => s.padStart(Math.min(n, 10_000), c)) as never },
  padEnd: { what: "padEnd(5, ' ')", params: ["text", "number", "text"], optional: 1, returns: "text", fn: ((s: string, n: number, c = " ") => s.padEnd(Math.min(n, 10_000), c)) as never },
  capitalize: { what: "the first letter in capitals", params: ["text"], returns: "text", fn: ((s: string) => s.charAt(0).toUpperCase() + s.slice(1)) as never },
  splitRaw: { what: "splitRaw(','): a text cut at a separator as it is (split trims and drops empty parts)", params: ["text", "text"], returns: "list", fn: ((s: string, sep: string) => s.split(sep)) as never },
  indexOfText: { what: "indexOfText('ab'): where it starts (-1: not there)", params: ["text", "text"], returns: "number", fn: ((s: string, p: string) => s.indexOf(p)) as never },
  repeat: { what: "repeat(3)", params: ["text", "number"], returns: "text", fn: ((s: string, n: number) => s.repeat(Math.max(0, Math.min(n, 1000)))) as never },
  // ---- regular expressions
  regexTest: { what: "regexTest('^\\d+$', 'i'): whether it matches", params: ["text", "text", "text"], optional: 1, returns: "bool", fn: ((s: string, p: string, f = "") => re(p, f.replace(/g/g, "")).test(subject(s))) as never },
  regexMatch: { what: "regexMatch('(\\d+)-(\\d+)'): the first match as [whole, group 1, …] (null: none)", params: ["text", "text", "text"], optional: 1, returns: "list|null", fn: ((s: string, p: string, f = "") => { const m = re(p, f.replace(/g/g, "")).exec(subject(s)); return m ? [...m].map((x) => x ?? null) : null; }) as never },
  regexAll: { what: "regexAll('\\d+'): every match (the whole of each)", params: ["text", "text", "text"], optional: 1, returns: "list", fn: ((s: string, p: string, f = "") => [...subject(s).matchAll(re(p, f.includes("g") ? f : `${f}g`))].slice(0, 5000).map((m) => m[0])) as never },
  regexReplace: { what: "regexReplace('\\s+', ' ', 'g'): replace what matches ($1 for a group)", params: ["text", "text", "text", "text"], optional: 1, returns: "text", fn: ((s: string, p: string, r: string, f = "g") => subject(s).replace(re(p, f), r)) as never },
  // ---- lists
  reverse: { what: "the items the other way round", params: ["list"], returns: "list", fn: ((l: unknown[]) => [...l].reverse()) as never },
  flatten: { what: "lists inside the list opened one level", params: ["list"], returns: "list", fn: ((l: unknown[]) => l.flat(1)) as never },
  concat: { what: "concat(other): the list and another one", params: ["list", "list"], returns: "list", fn: ((a: unknown[], b: unknown[]) => [...a, ...b]) as never },
  includes: { what: "includes(x): whether the list holds x (as text or number as it is)", params: ["list", "any"], returns: "bool", fn: ((l: unknown[], x: unknown) => l.some((y) => y === x || JSON.stringify(y) === JSON.stringify(x))) as never },
  take: { what: "take(n): the first n items", params: ["list", "number"], returns: "list", fn: ((l: unknown[], n: number) => l.slice(0, Math.max(0, n))) as never },
  drop: { what: "drop(n): all but the first n items", params: ["list", "number"], returns: "list", fn: ((l: unknown[], n: number) => l.slice(Math.max(0, n))) as never },
  chunk: { what: "chunk(n): lists of n items", params: ["list", "number"], returns: "list", fn: ((l: unknown[], n: number) => { const k = Math.max(1, Math.floor(n)); const out: unknown[][] = []; for (let i = 0; i < l.length; i += k) out.push(l.slice(i, i + k)); return out; }) as never },
  compact: { what: "without empty items (null, '', false, 0)", params: ["list"], returns: "list", fn: ((l: unknown[]) => l.filter((x) => !(x === null || x === undefined || x === "" || x === false || x === 0))) as never },
  uniqueBy: { what: "uniqueBy('field'): the first item of each value of that field", params: ["list", "text"], returns: "list", fn: ((l: unknown[], k: string) => [...new Map(l.map((x) => [key(x, k), x] as const).reverse()).values()].reverse()) as never },
  groupBy: { what: "groupBy('field'): { value: [items] }", params: ["list", "text"], returns: "object", fn: ((l: unknown[], k: string) => { const out: Record<string, unknown[]> = {}; for (const x of l) (out[key(x, k)] ??= []).push(x); return out; }) as never },
  indexBy: { what: "indexBy('field'): { value: item } (the last wins)", params: ["list", "text"], returns: "object", fn: ((l: unknown[], k: string) => Object.fromEntries(l.map((x) => [key(x, k), x]))) as never },
  countBy: { what: "countBy('field'): { value: how many }", params: ["list", "text"], returns: "object", fn: ((l: unknown[], k: string) => { const out: Record<string, number> = {}; for (const x of l) out[key(x, k)] = (out[key(x, k)] ?? 0) + 1; return out; }) as never },
  min: { what: "min('field'?): the smallest number (null: none)", params: ["list", "text"], optional: 1, returns: "number|null", fn: ((l: unknown[], k?: string) => { const n = l.map((x) => Number(k ? get(x, k) : x)).filter(Number.isFinite); return n.length ? Math.min(...n) : null; }) as never },
  max: { what: "max('field'?): the largest number (null: none)", params: ["list", "text"], optional: 1, returns: "number|null", fn: ((l: unknown[], k?: string) => { const n = l.map((x) => Number(k ? get(x, k) : x)).filter(Number.isFinite); return n.length ? Math.max(...n) : null; }) as never },
  avg: { what: "avg('field'?): the mean (null: none)", params: ["list", "text"], optional: 1, returns: "number|null", fn: ((l: unknown[], k?: string) => { const n = l.map((x) => Number(k ? get(x, k) : x)).filter(Number.isFinite); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null; }) as never },
  zip: { what: "zip(other): [[a1, b1], [a2, b2], …]", params: ["list", "list"], returns: "list", fn: ((a: unknown[], b: unknown[]) => a.slice(0, b.length).map((x, i) => [x, b[i]])) as never },
  range: { what: "n | range: [0, 1, … n-1] (at most 10 000)", params: ["number"], returns: "list", fn: ((n: number) => Array.from({ length: Math.max(0, Math.min(Math.floor(n), 10_000)) }, (_, i) => i)) as never },
  // ---- objects
  get: { what: "get('a.b.0', default?): a value deep inside (null: not there)", params: ["any", "text", "any"], optional: 1, returns: "any", fn: ((o: unknown, p: string, d: unknown = null) => { const v = get(o, p); return v === null ? d : v; }) as never },
  has: { what: "has('key'): whether an object has that key", params: ["object", "text"], returns: "bool", fn: ((o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)) as never },
  pick: { what: "pick('a', 'b'): the object with only these keys", params: ["object", "text", "text", "text", "text", "text", "text"], optional: 5, returns: "object", fn: ((o: object, ...ks: string[]) => Object.fromEntries(ks.filter((k) => typeof k === "string" && k in o).map((k) => [k, obj(o)[k]]))) as never },
  omit: { what: "omit('a', 'b'): the object without these keys", params: ["object", "text", "text", "text", "text", "text", "text"], optional: 5, returns: "object", fn: ((o: object, ...ks: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !ks.includes(k)))) as never },
  merge: { what: "merge(other): the object with the other's keys on top", params: ["object", "object"], returns: "object", fn: ((a: object, b: object) => ({ ...a, ...b })) as never },
  setKey: { what: "setKey('k', value): the object with that key set", params: ["object", "text", "any"], returns: "object", fn: ((o: object, k: string, v: unknown) => ({ ...o, [k]: v })) as never },
  entries: { what: "[{ key, value }] of an object", params: ["object"], returns: "list", fn: ((o: object) => Object.entries(o).map(([k, v]) => ({ key: k, value: v }))) as never },
  fromEntries: { what: "[{ key, value }] to an object", params: ["list"], returns: "object", fn: ((l: unknown[]) => Object.fromEntries(l.map((e) => [String(obj(e)?.key ?? ""), obj(e)?.value ?? null]))) as never },
  typeOf: { what: "text, number, bool, list, object or null", params: ["any"], returns: "text", fn: ((v: unknown) => kindOf(v)) as never },
  // ---- numbers
  abs: { what: "absolute value", params: ["number"], returns: "number", fn: ((n: number) => Math.abs(n)) as never },
  floor: { what: "rounded down", params: ["number"], returns: "number", fn: ((n: number) => Math.floor(n)) as never },
  ceil: { what: "rounded up", params: ["number"], returns: "number", fn: ((n: number) => Math.ceil(n)) as never },
  clamp: { what: "clamp(lo, hi)", params: ["number", "number", "number"], returns: "number", fn: ((n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))) as never },
  // ---- dates (ISO texts; a date alone stays a date; no clock here — `env.now` and the clock capability give the time)
  addDays: { what: "addDays(n): a date or time n days later", params: ["text", "number"], returns: "text", fn: ((s: string, n: number) => back(new Date(when(s).getTime() + n * DAY), s)) as never },
  addMinutes: { what: "addMinutes(n): a time n minutes later", params: ["text", "number"], returns: "text", fn: ((s: string, n: number) => new Date(when(s).getTime() + n * 60_000).toISOString()) as never },
  diffDays: { what: "diffDays(other): whole days from other to this", params: ["text", "text"], returns: "number", fn: ((a: string, b: string) => Math.floor((when(a).getTime() - when(b).getTime()) / DAY)) as never },
  formatDate: { what: "formatDate('DD.MM.YYYY HH:mm'): YYYY MM DD HH mm ss (UTC)", params: ["text", "text"], returns: "text", fn: ((s: string, f: string) => { const d = when(s); return f.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => ({ YYYY: String(d.getUTCFullYear()), MM: two(d.getUTCMonth() + 1), DD: two(d.getUTCDate()), HH: two(d.getUTCHours()), mm: two(d.getUTCMinutes()), ss: two(d.getUTCSeconds()) })[t]!); }) as never },
  weekday: { what: "0 (Sunday) … 6", params: ["text"], returns: "number", fn: ((s: string) => when(s).getUTCDay()) as never },
  startOfDay: { what: "the day (YYYY-MM-DD) of a date or time", params: ["text"], returns: "text", fn: ((s: string) => when(s).toISOString().slice(0, 10)) as never },
};

/** The stdlib as filters of the expression language (FLOW_FILTERS): called with the piped value first; the arguments are checked. */
export const stdlibFilters: Record<string, { what: string; fn: (v: unknown, ...a: unknown[]) => unknown }> = Object.fromEntries(
  Object.entries(STDLIB).map(([name, def]) => [
    name,
    {
      what: `${def.what} → ${def.returns}`,
      fn: (v: unknown, ...a: unknown[]) => {
        check(name, def, [v, ...a]);
        return (def.fn as (...x: unknown[]) => unknown)(v, ...a);
      },
    },
  ]),
);
