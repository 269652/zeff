import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { setupTempData } from "./helpers";

setupTempData();
process.env.ZEFF_PACKAGES_FILE = path.join(process.env.DATABASE_PATH!, "..", "packages.json");

/**
 * The marketplace (Plugins → Browse): a repository's catalog.json lists its plugins in one request — no manifest read one by one, no cap —,
 * a folder the catalog doesn't name is still read (and the catalog said to be out of date), installing from GitHub downloads exactly the
 * plugin's folder, checks it against the catalog's hash, writes it switched off and records it in packages.json; the last listing is kept
 * on disk for the header's search; the detail panel's README and changelog; a plugin removed again; a plugin copied in by hand tied to its
 * source. The network is a stand-in for GitHub's API and raw files, serving from memory.
 */

type Repo = Record<string, string>;
const commits: Record<string, Repo> = {};
let head = "c1";
const asked: string[] = [];
const manifest = (id: string, version: string, extra: Record<string, unknown> = {}) => JSON.stringify({ id, name: id.toUpperCase(), version, apiVersion: 1, ...extra });

function serve() {
  return async (url: string) => {
    asked.push(url);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer as ArrayBuffer });
    const miss = { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const raw = /^https:\/\/raw\.githubusercontent\.com\/me\/market\/([^/]+)\/(.+)$/.exec(url);
    if (raw) {
      const repo = commits[raw[1]] ?? {};
      const file = decodeURIComponent(raw[2]);
      return file in repo ? ok(repo[file]) : miss;
    }
    if (url === "https://api.github.com/repos/me/market") return ok({ default_branch: "main" });
    if (url === "https://api.github.com/repos/me/market/commits/main") return ok({ sha: head });
    const tree = /^https:\/\/api\.github\.com\/repos\/me\/market\/git\/trees\/([^?]+)/.exec(url);
    if (tree) return ok({ tree: Object.entries(commits[tree[1]] ?? {}).map(([p, c]) => ({ path: p, type: "blob", size: c.length })) });
    if (/^https:\/\/api\.github\.com\/repos\/me\/market\/commits\?sha=/.test(url)) return ok([{ sha: "c1".padEnd(40, "0"), commit: { message: "notes 1.0.0: the first\n\nmore", author: { date: "2026-11-01T10:00:00Z", name: "Me" } } }]);
    return miss;
  };
}

async function catalogFor(repo: Repo, entries: { path: string; extra?: Record<string, unknown> }[]): Promise<string> {
  const { contentHash } = await import("@/lib/ext/catalog-hash");
  const plugins = entries.map(({ path: dir, extra }) => {
    const m = JSON.parse(repo[`${dir}/zeff-plugin.json`]);
    const files = new Map(Object.entries(repo).filter(([p]) => p.startsWith(`${dir}/`)).map(([p, c]) => [p.slice(dir.length + 1), Buffer.from(c)]));
    return { id: m.id, name: m.name, version: m.version, description: m.description ?? "", keywords: m.keywords ?? [], category: m.category, icon: m.icon, path: dir, permissions: m.permissions ?? [], requires: { apiVersion: 1 }, adds: { flows: [{ name: `${m.id}.sync`, title: "Read it" }], syncs: [`${m.id}.sync`] }, files: files.size, size: 10, hash: contentHash(files), signed: false, readme: "Short.", ...extra };
  });
  return JSON.stringify({ format: 1, plugins });
}

test("a catalog lists the plugins in one request; installing from GitHub downloads the folder, checks it, records it", async () => {
  const src = await import("@/lib/ext/sources");
  const reg = await import("@/lib/ext/registry");
  const sync = await import("@/lib/ext/packages-sync");
  const market = await import("@/lib/ext/marketplace");
  src.setSourceFetcher(serve() as never);
  const repo: Repo = {
    "README.md": "# market",
    "plugins/notes/zeff-plugin.json": manifest("notes", "1.0.0", { keywords: ["journal", "diary"], category: "app", icon: "📝", permissions: [] }),
    "plugins/notes/fn/hello.js": "return 1;\r\n",
    "plugins/notes/README.md": "# Notes\n\nWrite notes.\n",
    "plugins/calc/zeff-plugin.json": manifest("calc", "2.0.0", { category: "ai" }),
    "plugins/calc/x.txt": "x",
    // (new, not in the catalog yet: read from its manifest)
    "plugins/later/zeff-plugin.json": manifest("later", "0.1.0"),
  };
  repo["catalog.json"] = await catalogFor(repo, [{ path: "plugins/notes" }, { path: "plugins/calc" }]);
  commits.c1 = repo;
  const s = src.addSource("https://github.com/me/market");

  const st = await src.checkSource(s.id, { fresh: true });
  assert.equal(st.error, undefined);
  assert.deepEqual(st.listedBy, { catalog: true, unlisted: ["plugins/later"] });
  assert.deepEqual(st.plugins.map((p) => p.id).sort(), ["calc", "later", "notes"]);
  const manifestReads = asked.filter((u) => u.includes("raw.githubusercontent") && u.endsWith("zeff-plugin.json"));
  assert.deepEqual(manifestReads, ["https://raw.githubusercontent.com/me/market/c1/plugins/later/zeff-plugin.json"], "only the folder the catalog doesn't name is read one by one");
  const notes = st.plugins.find((p) => p.id === "notes")!;
  assert.deepEqual([notes.listing.keywords, notes.listing.category, notes.listing.icon], [["journal", "diary"], "app", "📝"]);
  assert.equal(st.plugins.find((p) => p.id === "later")!.listing.name, "LATER", "described from its manifest");

  // The marketplace and the header's search: from the last check, without the network.
  const before = asked.length;
  const view = await market.marketplace("cached");
  assert.equal(view.items.length, 3);
  assert.equal(asked.length, before, "the cached listing asks nobody");
  assert.ok(market.notInstalledForSearch().some((p) => p.id === "notes" && p.text.includes("diary") && p.text.includes("notes.sync")), "found by its keywords and what it adds");

  // Install: exactly the folder, checked against the catalog's hash (CRLF counted as LF), off, recorded in packages.json.
  const r = await src.installFromSource(s.id, "notes");
  assert.deepEqual([r.from, r.to, r.conflicts], [null, "1.0.0", []]);
  assert.equal(r.verified?.catalog, true);
  assert.equal(r.verified?.signed, null);
  const dir = path.join(reg.pluginsRoot(), "notes");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["README.md", "fn", "zeff-plugin.json"]);
  assert.equal(reg.isEnabled("notes"), false, "it comes in switched off");
  assert.ok(!asked.some((u) => u.includes("/plugins/calc/x.txt")), "nothing of another plugin is downloaded");
  sync.rememberInPackages("notes");
  const pf = JSON.parse(fs.readFileSync(process.env.ZEFF_PACKAGES_FILE!, "utf8"));
  assert.deepEqual(pf.plugins.notes, { source: "market", path: "plugins/notes" });
  assert.equal(pf.sources.market.url, "https://github.com/me/market");
  assert.equal((await market.marketplace("cached")).items.find((i) => i.listing.id === "notes")!.installed, "1.0.0");
  assert.ok(!market.notInstalledForSearch().some((p) => p.id === "notes"), "installed: no longer offered by the search");

  // The detail panel: the README in full and the folder's commits.
  const d = await src.pluginDetail(s.id, "notes");
  assert.match(d.readme!, /Write notes/);
  assert.deepEqual(d.history.map((c) => c.subject), ["notes 1.0.0: the first"]);

  // A catalog out of date (the files changed, the hash didn't): installed all the same, and said.
  const v2: Repo = { ...repo, "plugins/calc/x.txt": "changed" };
  publishSame(v2, "c2");
  await src.checkSource(s.id, { fresh: true });
  const rc = await src.installFromSource(s.id, "calc");
  assert.equal(rc.verified?.catalog, false);

  // The listing on disk: after the memory is gone (a restart), the marketplace still has it.
  src.setSourceFetcher(undefined);
  assert.equal((await market.marketplace("cached")).items.length, 3);

  // Removed: off, the folder moved aside, its origin forgotten, out of packages.json.
  src.setSourceFetcher(serve() as never);
  await src.removePlugin("notes");
  sync.forgetInPackages("notes");
  assert.ok(!fs.existsSync(dir));
  assert.ok(fs.readdirSync(path.join(reg.pluginsRoot(), ".removed")).some((n) => n.startsWith("notes-")));
  assert.equal(src.origin("notes"), null);
  assert.equal(JSON.parse(fs.readFileSync(process.env.ZEFF_PACKAGES_FILE!, "utf8")).plugins.notes, undefined);
  src.setSourceFetcher(undefined);
});

function publishSame(repo: Repo, sha: string) {
  commits[sha] = repo;
  head = sha;
}

test("a plugin copied in by hand is tied to the source whose catalog has exactly its files (a port's switch records it)", async () => {
  const src = await import("@/lib/ext/sources");
  const reg = await import("@/lib/ext/registry");
  const sync = await import("@/lib/ext/packages-sync");
  src.setSourceFetcher(serve() as never);
  const repo: Repo = { "plugins/port-x/zeff-plugin.json": manifest("port-x", "1.0.0"), "plugins/port-x/a.txt": "a" };
  repo["catalog.json"] = await catalogFor(repo, [{ path: "plugins/port-x" }]);
  publishSame(repo, "c3");
  const s = src.listSources().find((x) => x.url === "https://github.com/me/market")!;
  await src.checkSource(s.id, { fresh: true });
  const dir = path.join(reg.pluginsRoot(), "port-x");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "zeff-plugin.json"), repo["plugins/port-x/zeff-plugin.json"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "a");
  reg.scanPlugins(true);
  assert.equal(await sync.rememberPort("port-x"), true);
  assert.equal(src.origin("port-x")!.sha, "c3");
  assert.deepEqual(JSON.parse(fs.readFileSync(process.env.ZEFF_PACKAGES_FILE!, "utf8")).plugins["port-x"], { source: "market", path: "plugins/port-x" });
  // Changed here: not the catalog's files — left as it is.
  fs.mkdirSync(path.join(reg.pluginsRoot(), "port-y"), { recursive: true });
  fs.writeFileSync(path.join(reg.pluginsRoot(), "port-y", "zeff-plugin.json"), manifest("port-y", "1.0.0"));
  reg.scanPlugins(true);
  assert.equal(await sync.rememberPort("port-y"), false);
  src.setSourceFetcher(undefined);
});

test("catalog.json: a broken file or entry is said, the rest still listed", async () => {
  const { parseCatalog } = await import("@/lib/ext/catalog");
  assert.equal(parseCatalog("{").ok, false);
  assert.match((parseCatalog(JSON.stringify({ format: 2, plugins: [] })) as { error: string }).error, /format 2/);
  const r = parseCatalog(JSON.stringify({ format: 1, plugins: [{ id: "ok-one", name: "Ok", path: "plugins/ok" }, { id: "Bad Id", name: "x" }] }));
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.plugins.map((p) => p.id), ["ok-one"]);
    assert.equal(r.problems.length, 1);
    assert.equal(r.plugins[0].category, undefined);
  }
});

// The plugins repository itself, read as a local git source (only where its worktree is beside this checkout): its catalog lists every
// plugin, and an install's download matches the catalog's hash.
const LOCAL = process.env.ZEFF_TEST_PLUGINS_REPO ?? path.resolve(process.cwd(), "..", "..", "..", "..", "zeff-plugins-catalog");
test("the zeff-plugins repository as a local source: listed by its catalog, a plugin installed and verified", { skip: !fs.existsSync(path.join(LOCAL, "catalog.json")) && "no plugins repository with a catalog beside this checkout" }, async () => {
  const src = await import("@/lib/ext/sources");
  const s = src.addSource(LOCAL);
  const st = await src.checkSource(s.id, { fresh: true });
  assert.equal(st.error, undefined, st.error);
  assert.equal(st.listedBy?.catalog, true);
  assert.deepEqual(st.listedBy?.unlisted, []);
  assert.ok(st.plugins.length >= 39, `${st.plugins.length} plugins`);
  assert.ok(st.plugins.every((p) => p.listing.category && p.listing.keywords.length), "every plugin has a category and keywords");
  const r = await src.installFromSource(s.id, "lookups-ext");
  assert.equal(r.verified?.catalog, true, "the download is what the catalog describes");
  const d = await src.pluginDetail(s.id, "lookups-ext");
  assert.ok(d.history.length > 0, "its changelog from git");
});
