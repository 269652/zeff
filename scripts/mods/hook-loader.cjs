/* eslint-disable @typescript-eslint/no-require-imports -- a build loader (and what it uses) is CommonJS: Turbopack loads webpack loaders with require() */
/**
 * The build loader that puts the mods' hooks in (next.config.ts, turbopack.rules): every exported function and component of a file
 * below src/ behind a named hook (analyze.cjs: transform). The source stays as it is — this changes only what is built. A file it can't
 * read the way it expects is passed through unchanged: a hook less is never a broken build.
 */
const crypto = require("node:crypto");
const path = require("node:path");
const { transform } = require("./analyze.cjs");

// The same file is built for several layers (the browser, server rendering, server components, route handlers, the
// instrumentation) — each a call of this loader with the same text. The answer is kept per file and text, in this worker.
const done = new Map();
const MAX_KEPT = 8000;

module.exports = function zeffHookLoader(source) {
  const file = this.resourcePath.split(path.sep).join("/");
  const at = file.lastIndexOf("/src/");
  if (at < 0) return source;
  const text = String(source);
  const key = `${file}|${crypto.createHash("sha1").update(text).digest("base64")}`;
  const kept = done.get(key);
  if (kept !== undefined) return kept;
  try {
    const out = transform(file.slice(at + 5), text);
    if (done.size >= MAX_KEPT) done.clear();
    done.set(key, out);
    return out;
  } catch (e) {
    // (said once per file in the build's log; the file is built as it is)
    console.warn(`[mods] no hooks for ${file.slice(at + 5)}: ${e && e.message}`);
    return source;
  }
};
