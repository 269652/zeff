/**
 * Full screen (components/FocusToggle.tsx) before the first paint: a Workspace page opened with ?focus=1, or with full screen kept in
 * this browser, gets html[data-focus] as its HTML is read — the Workspace sidebar and an app's page bar are never drawn first and
 * taken away after React started. Runs inline in the root layout's <head>.
 */

/** Where full screen is kept in this browser. */
export const FOCUS_KEY = "zeff-focus";

/** The pages full screen is for: a Workspace page (FocusToggle is in its bar) — under an account's route too ("/privat/workspace/12"). */
export const FOCUS_PAGE = /\/workspace\/\d+(?:$|[/?#])/;

export function focusScript(): string {
  return `(function(){try{if(!${FOCUS_PAGE}.test(location.pathname))return;var on=new URLSearchParams(location.search).get("focus")==="1";try{on=on||localStorage.getItem(${JSON.stringify(FOCUS_KEY)})==="1"}catch(e){}if(on)document.documentElement.setAttribute("data-focus","")}catch(e){}})()`;
}
