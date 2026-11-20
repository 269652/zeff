/* eslint-disable @typescript-eslint/no-require-imports -- a build loader (and what it uses) is CommonJS: Turbopack loads webpack loaders with require() */
/**
 * The catalog of hooks (docs/mods.md): every hook point of src/ — its name, function or component, async, its parameters, file and line,
 * its code's hash — written to zeff-hooks.json beside the build, so the Mods page and the AI know what can be hooked also where Zeff runs
 * without its sources (the release). Made by next.config.ts when it starts (dev and build) and by `node scripts/mods/catalog.cjs`.
 */
const fs = require("node:fs");
const path = require("node:path");
const { analyze } = require("./analyze.cjs");

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/**
 * Each file's analysis, kept between starts in the build's cache folder (<dist dir>/cache/zeff-hooks.json — .next, or the
 * ZEFF_DIST_DIR a deploy or test server builds into): a file whose size and modification time are the same is not parsed
 * again — parsing all of src/ took 6–9 s of every `next dev` start.
 */
function cacheFile(root) {
  return path.join(root, process.env.ZEFF_DIST_DIR || ".next", "cache", "zeff-hooks.json");
}
function readCache(file) {
  try {
    const c = JSON.parse(fs.readFileSync(file, "utf8"));
    return c && c.version === CACHE_VERSION && c.files ? c.files : {};
  } catch {
    return {};
  }
}
// (bumped when analyze.cjs changes what it finds — a cache of the old one is then not used)
const CACHE_VERSION = 1;

/** The catalog of a checkout (root: the folder with src/). */
function buildCatalog(root) {
  const src = path.join(root, "src");
  const points = [];
  const cachePath = cacheFile(root);
  const cached = readCache(cachePath);
  const files = {};
  for (const f of walk(src, [])) {
    const rel = path.relative(src, f).split(path.sep).join("/");
    let entry;
    try {
      const st = fs.statSync(f);
      const c = cached[rel];
      if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) entry = c;
      else {
        const a = analyze(rel, fs.readFileSync(f, "utf8"));
        entry = { size: st.size, mtimeMs: st.mtimeMs, client: a.client, points: a.points.map((p) => ({ id: p.id, kind: p.kind, async: p.async, params: p.params, line: p.line, hash: p.hash })) };
      }
    } catch {
      /* (a file the parser can't read has no hooks) */
      continue;
    }
    files[rel] = entry;
    for (const p of entry.points) points.push({ id: p.id, kind: p.kind, async: p.async, params: p.params, file: `src/${rel}`, line: p.line, hash: p.hash, side: entry.client ? "client" : "server" });
  }
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ version: CACHE_VERSION, files }));
  } catch {
    /* (no cache: parsed again next time) */
  }
  points.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { made: new Date().toISOString(), count: points.length, points };
}

/** Written beside the build (zeff-hooks.json in the app's folder) — only when src/ is there. */
function writeCatalog(root) {
  if (!fs.existsSync(path.join(root, "src"))) return null;
  const c = buildCatalog(root);
  fs.writeFileSync(path.join(root, "zeff-hooks.json"), JSON.stringify(c));
  return c.count;
}

module.exports = { buildCatalog, writeCatalog };

if (require.main === module) console.log(`zeff-hooks.json: ${writeCatalog(process.cwd())} hooks`);
