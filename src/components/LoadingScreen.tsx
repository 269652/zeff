/**
 * The one loading screen of Zeff: a calm spinner and a short word, in the middle of where the content will be — while a page loads
 * (app/loading.tsx), while an app's view waits for the data of its first screen (workspace/ui/view-template.tsx), while a route
 * redirects (the main area empty: globals.css .main-body:empty draws the same). Never half a screen meanwhile. No hooks: for server
 * and client. The sizes are in globals.css (.zeff-loading-*).
 * size "screen": the room of a page under the header; "view": an app's view on a Workspace page (under the page's bar — the whole
 * room in full screen); "block": a block inside a page (a widget, an embedded view).
 */
export function LoadingScreen({ label, size = "screen" }: { label: string; size?: "screen" | "view" | "block" }) {
  return (
    <div className={`zeff-loading zeff-loading-${size} flex w-full flex-col items-center justify-center gap-3`} role="status" aria-live="polite">
      {/* (turned as an element of its own, not the svg: the browser turns that on its compositor — it keeps going while the page is busy loading) */}
      <span className={`${size === "block" ? "size-6" : "size-10"} zeff-spinner inline-block animate-spin text-indigo-600 [animation-duration:900ms] will-change-transform dark:text-indigo-400`} aria-hidden>
        <svg viewBox="0 0 48 48" className="size-full">
          <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="4" className="opacity-15" />
          <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="40 126" />
        </svg>
      </span>
      <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">{label}</span>
    </div>
  );
}
