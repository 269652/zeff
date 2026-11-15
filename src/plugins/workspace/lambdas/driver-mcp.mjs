// What a driver lambda gets as "zeff:automation/mcp-stdio": the same createMcp, but serveMcp only collects its tools and handlers — the
// driver-runner calls them (context.mcp) instead of a stdio server. So a scraper written as an MCP server runs as a driver lambda unchanged.
export { createMcp } from "../../../../scripts/automation/mcp-stdio.mjs";

export function serveMcp(options) {
  globalThis.__zeffDriverMcp = options;
}
