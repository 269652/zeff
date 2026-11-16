import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * The installed Documents screens against a COPY of the real data (the tests' own temp data has too few documents to find a template error the browser
 * shows): ZEFF_LIVE_COPY = a folder holding a copy of data/zeff.db* and data/plugins — never the live folder itself. Every scope, layout, sort and a document
 * of each kind picked are drawn with what the lambdas give, as the browser would get it; the settings page and the attach panel too: no error.
 *   ZEFF_LIVE_COPY=<scratch> ZEFF_PLUGINS_REPO=<zeff-plugins> node --import tsx --test tests/documents-live.test.ts
 */
const live = process.env.ZEFF_LIVE_COPY;
const skip = live && fs.existsSync(path.join(live, "zeff.db")) ? false : "set ZEFF_LIVE_COPY to a copy of the data folder (zeff.db*, plugins)";
if (live) {
  process.env.DATABASE_PATH = path.join(live, "zeff.db");
  process.env.ZEFF_PLUGINS_DIR = path.join(live, "plugins");
}

async function lambda(name: string, event: Record<string, unknown> = {}) {
  const { getLambda } = await import("@/plugins/workspace/lambdas/store");
  const { runLambda } = await import("@/plugins/workspace/lambdas/run");
  const l = getLambda(name);
  assert.ok(l, `the lambda ${name} is installed`);
  const r = await runLambda(l, event);
  assert.ok(r.ok, r.ok ? "" : `${name}: ${r.error}`);
  return r.result as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

test("the installed Documents screens draw with the real data: no template errors", { skip }, async () => {
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  assert.ok(reg.isEnabled("documents-ext"), "documents-ext is on in this copy");
  const dir = path.join(process.env.ZEFF_PLUGINS_DIR!, "documents-ext");
  const { renderView } = await import("@/plugins/workspace/view-template");
  const draw = (source: string, state: Record<string, string>, data: Record<string, unknown>) =>
    renderView(source, { rows: [], props: [], titleName: "Documents", state, app: {}, data, db: { id: 1, title: "Documents" } });

  // Odd names and texts a real folder brings (the copy only): template syntax, quotes, markup, very long, no concepts.
  {
    const { getSqlite } = await import("@/db");
    const odd = ["{{ state.q }} \"x\" <b>fett</b>", "{{#if a}}", "Rechnung 'Müller' & Söhne — 2026 😀.pdf", "x".repeat(300) + ".docx", "a,b:c=d.txt"];
    const kindOfName = (n: string) => (/\.pdf$/.test(n) ? "pdf" : /\.docx$/.test(n) ? "office" : "text");
    const ins = getSqlite().prepare("insert or ignore into documents (name, mime, size, sha256, kind, status, error, file, text, summary, concepts, compiled, created_at, updated_at) values (?, '', 1, ?, ?, 'ready', '', 'f', ?, ?, ?, 0, ?, ?)");
    odd.forEach((n, i) => ins.run(n, `odd${i}`, kindOfName(n), `Text {{ ${i} }} "mit" <script>`, i % 2 ? "{{ summary }}" : "", i % 2 ? "a, {{b}}, c=d" : "", new Date().toISOString(), new Date().toISOString()));
  }
  // The screen: every scope, layout and sort; a document of each kind picked, with its text.
  const screenTpl = fs.readFileSync(path.join(dir, "views", "documents.html"), "utf8");
  const first = await lambda("documents.screen", { scope: "all", limit: 1000 });
  const scopes = String(first.scopeOptions).split(/,\s*(?=[\w-]+:)/).map((s) => s.split(":")[0]);
  assert.ok(scopes.includes("all"));
  const kinds = new Map<string, number>();
  for (const d of first.items as { id: number; kind: string }[]) if (!kinds.has(d.kind) || kinds.size < 0) kinds.set(d.kind, d.id);
  const picks = [...kinds.values(), ...(first.items as { id: number }[]).slice(0, 5).map((d) => d.id)];
  let drawn = 0;
  for (const scope of scopes)
    for (const layout of ["grid", "list"])
      for (const sort of ["newest", "unread", "name", "size", "oldest"]) {
        const state = { scope, layout, sort };
        const docs = await lambda("documents.screen", { ...state, checked: `[${picks.join(",")}]` });
        const r = draw(screenTpl, state, { docs });
        assert.deepEqual(r.errors, [], JSON.stringify(state));
        drawn++;
      }
  for (const id of picks) {
    const state = { scope: "all", selected: String(id) };
    const docs = await lambda("documents.screen", { ...state, limit: 1000 });
    const doc = await lambda("documents.text", { id, chars: 6000 });
    assert.deepEqual(draw(screenTpl, state, { docs, doc }).errors, [], `document ${id}`);
    assert.deepEqual(draw(screenTpl, { ...state, layout: "list", full: "1" }, { docs, doc: await lambda("documents.text", { id, chars: 0 }) }).errors, [], `document ${id} (list, whole text)`);
    drawn += 2;
  }
  // A search that finds, one that finds nothing.
  for (const q of ["rechnung", "zzzgibtesnicht"]) assert.deepEqual(draw(screenTpl, { scope: "all", q }, { docs: await lambda("documents.screen", { scope: "all", q }) }).errors, [], q);
  console.log(`documents screen: ${drawn} drawings, ${first.count} documents, scopes ${scopes.join(" ")}`);

  // The settings page: as installed (the package's database page).
  // (as installed in the copy — a package not updated yet has none: then the plugin's package, which an update installs)
  const { getSqlite } = await import("@/db");
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "documents.package.json"), "utf8")) as { items: { kind: string; title: string; schema?: { views: { template: string }[] }; flow?: { name: string } }[] };
  const installed = (getSqlite().prepare("select schema from ws_pages where kind = 'database' and title = 'Documents settings' and archived_at is null").all() as { schema: string }[]).map((r) => JSON.parse(r.schema).views[0].template as string);
  const views = installed.length ? installed : pkg.items.filter((i) => i.kind === "database" && i.title === "Documents settings").map((i) => i.schema!.views[0].template);
  assert.ok(views.length, "the settings page is there");
  const settings = await lambda("documents.settings");
  const browse = { path: "C:\\", parent: null, dirs: [{ name: "A", path: "C:\\A" }] };
  for (const tpl of views)
    for (const state of [{}, { browsing: "1" }, { t_auto: "false", t_cmd: "x" }] as Record<string, string>[])
      for (const data of [{ s: settings }, { s: settings, browse }, {}]) assert.deepEqual(draw(tpl, state, data).errors, [], JSON.stringify(state));

  // The installed package (1.0.0, before the screens) is offered the update and takes it: the screens' flows and the settings page are there after.
  {
    const life = await import("@/plugins/workspace/package-life");
    const st = (await life.packageStatus()).find((p) => p.id === "documents-ext" || /documents/i.test(p.id));
    console.log("package status:", JSON.stringify(st ? { id: st.id, v: st.version, offered: st.offered } : null));
    if (st && st.updateAvailable) {
      const pkgNew = await life.offeredPackage(st.id);
      const r = await life.updateTracked(st.id, pkgNew!, { force: true, allow: true });
      assert.ok(r, "updated");
      console.log(`package ${st.id}: ${st.version} -> updated`);
      const { flowByName } = await import("@/plugins/workspace/flows/store");
      for (const n of ["documents.add", "documents.act", "documents.folder", "documents.browse", "documents.setting", "documents.attach", "documents.abstracts", "documents.pull"]) assert.ok(flowByName(n), `${n} is installed by the update`);
    }
  }
  // Everything the screens call is there: their lambdas (installed) and flows (the plugin's package).
  const flows = new Set(pkg.items.flatMap((i) => (i.flow ? [i.flow.name] : [])));
  const { getLambda } = await import("@/plugins/workspace/lambdas/store");
  const sources = [screenTpl, ...views, fs.readFileSync(path.join(dir, "views", "documents-attach.html"), "utf8")];
  for (const src of sources) {
    for (const m of src.matchAll(/\brun="([^"{]+)"/g)) assert.ok(flows.has(m[1]) || m[1].startsWith("news."), `the flow ${m[1]} is in the package`);
    for (const m of src.matchAll(/\blambda="([^"{]+)"/g)) assert.ok(getLambda(m[1]), `the lambda ${m[1]} is installed`);
  }
  // The attach panel (and the todo dialog's section of it).
  const attachTpl = fs.readFileSync(path.join(dir, "views", "documents-attach.html"), "utf8");
  for (const q of ["", "rechnung", "zzzgibtesnicht"]) assert.deepEqual(draw(attachTpl, { todo: "7", aq: q }, { pick: await lambda("documents.attach-list", { q }) }).errors, [], q);
});
