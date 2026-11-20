/**
 * After e2e/seed-work.mts: the Code screen switched to its plugin (work-ext, from ZEFF_PLUGINS_DIR — generate it with
 * `npx tsx scripts/port-work.mts <folder>`), as the Plugins page's switch does. Prints the Code page's id.
 */
if (!process.env.DATABASE_PATH || !process.env.ZEFF_TEST_SERVER) throw new Error("Only for a test server's database (DATABASE_PATH + ZEFF_TEST_SERVER).");
await import("@/plugins/contributions");
const { switchWorkToPlugin } = await import("@/plugins/work/to-plugin");
const { page } = await switchWorkToPlugin();
console.log(`Code switched to its plugin: page ${page}`);
