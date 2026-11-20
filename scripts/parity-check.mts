// Dev helper: the report template drawn with each tab's real data from a running test server (BASE): the template's mistakes listed.
import fs from "node:fs";
const { renderView, viewDefaults } = await import("@/plugins/workspace/view-template");
const tpl = fs.readFileSync(process.argv[2], "utf8");
const base = process.env.BASE ?? "http://localhost:9472";
const get = async (name: string, input: Record<string, string>) => {
  const r = await fetch(`${base}/api/workspace/data`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ kind: "lambda", name, input }) });
  return ((await r.json()) as { output: unknown }).output;
};
const tabs: [string, string, string, Record<string, string>][] = [
  ["week", "w", "zeiterfassung.week", { week: process.env.WEEK ?? "", by: "" }],
  ["month", "m", "zeiterfassung.month", { month: "", by: "" }],
  ["analysis", "a", "zeiterfassung.analysis", { weeks: "8", tickets: "", split: "" }],
  ["day", "day", "zeiterfassung.day", {}],
  ["jobs", "j", "zeiterfassung.jobs", {}],
  ["settings", "s", "zeiterfassung.schedule", {}],
];
const extra = process.argv[3] ? JSON.parse(process.argv[3]) : {};
for (const [view, name, lambda, input] of tabs) {
  const data: Record<string, unknown> = { [name]: await get(lambda, input) };
  if (view === "settings") data.r = await get("zeiterfassung.rules", {});
  const out = renderView(tpl, { rows: [], props: [], titleName: "R", state: { ...viewDefaults(tpl), view, ...extra }, app: {}, data, db: { id: 1, title: "R" } } as never);
  console.log(view, JSON.stringify(out.errors).slice(0, 800));
}
