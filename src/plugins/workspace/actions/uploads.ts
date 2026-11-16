"use server";

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MAX_STAGED_BYTES, STAGED_KEEP_MS, STAGED_TOKEN, stagingDir } from "../uploads-staging";
import { run } from "./shared";

/**
 * One file a view's <upload run="…"> brings, staged for a flow (uploads-staging.ts). A view cannot hand a flow more than a few hundred KB as
 * input, so the bytes travel here and the flow gets a token. Nothing here knows what the file is for.
 */

/** One file staged (form field "file"). Answers { token, name, size, mime }. */
export async function stageUploadAction(form: FormData) {
  return run(async () => {
    const file = form.get("file");
    if (!file || typeof file === "string") throw new Error("No file.");
    if (!file.size) throw new Error(`“${file.name}” is empty.`);
    if (file.size > MAX_STAGED_BYTES) throw new Error(`“${file.name}” is too large (at most ${MAX_STAGED_BYTES / 1024 / 1024} MB).`);
    const dir = await stagingDir();
    fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
    // (what nobody took is cleared away)
    for (const f of fs.readdirSync(/*turbopackIgnore: true*/ dir)) {
      const p = path.join(dir, f);
      try {
        if (STAGED_TOKEN.test(f) && Date.now() - fs.statSync(/*turbopackIgnore: true*/ p).mtimeMs > STAGED_KEEP_MS) fs.rmSync(/*turbopackIgnore: true*/ p, { force: true });
      } catch {
        // gone in the meantime
      }
    }
    const token = randomBytes(16).toString("hex");
    fs.writeFileSync(/*turbopackIgnore: true*/ path.join(dir, token), Buffer.from(await file.arrayBuffer()));
    return { token, name: file.name, size: file.size, mime: file.type };
  });
}
