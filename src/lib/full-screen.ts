/**
 * A link that opens a Workspace page full screen (FocusToggle: no header, no Workspace sidebar — the app has the whole window) for that visit:
 * ?focus=1 added. Only a /workspace/… address gets it (an old address the plugin isn't on for stays as it is).
 */
export function fullScreen(url: string): string {
  if (!url.startsWith("/workspace/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}focus=1`;
}
