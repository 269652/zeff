import { prefixedUrl } from "@/lib/redirect";
import { isInstalled } from "@/plugins/state";
import { getTodo } from "@/lib/todos/store";
import { mergedIntoChain } from "@/lib/todos/merge";

/** /t/37: T-37 — its panel on the Todos page (the Todos plugin's), among the open ones or the done ones when it is settled. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isInstalled("todos")) return Response.redirect(prefixedUrl("/plugins", request.url), 307);
  const { id } = await ctx.params;
  const n = Number(String(id).replace(/^t-?/i, ""));
  // A duplicate that was merged leads to the todo that kept its id.
  const t = Number.isInteger(n) && n > 0 ? getTodo(mergedIntoChain(n)) : undefined;
  const { todosApp, todosState } = await import("@/plugins/workspace/todos-app");
  const page = todosApp();
  if (!page) return Response.redirect(prefixedUrl("/plugins", request.url), 307);
  const q = todosState({ todos: t && t.status !== "open" ? "done" : undefined }, t?.id);
  return Response.redirect(prefixedUrl(`/workspace/${page}${q ? `?${q}` : ""}`, request.url), 307);
}
