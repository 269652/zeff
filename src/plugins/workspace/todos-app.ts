import { getSqlite } from "@/db";
import { isInstalled } from "@/plugins/state";

/**
 * Todos in the Workspace: the page of the Todos plugin (zeff-plugins/plugins/todos-ext) — a database whose view is the plugin's template (`lambda="todos.screen"`), made
 * by its package. This is the way in the links have always used (/todos, /todos?todos=done, /t/37): it opens that page with the tab, the part or the todo set as its
 * state (`s.<name>`). Null: the Workspace isn't there, or the plugin isn't installed. Server only.
 */
export function todosApp(): number | null {
  if (!isInstalled("workspace")) return null;
  const r = getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null and instr(schema, 'todos.screen') > 0 order by id limit 1").get() as { id: number } | undefined;
  return r?.id ?? null;
}

/** What the old address meant, as the page's state: `?todos=done|worker|activity`, `?part=tickets`, `?view=recap&day=…`, a todo's number to open. */
export function todosState(sp: { todos?: string; part?: string; view?: string; day?: string; ticket?: string }, todo?: number): string {
  const s: Record<string, string> = {};
  if (sp.view === "recap" || sp.view === "gestern") {
    s.part = "recap";
    if (sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day)) s.recapday = sp.day;
  } else if (sp.part === "tickets") s.part = "tickets";
  else {
    s.part = "todos";
    if (sp.todos === "done" || sp.todos === "worker" || sp.todos === "activity") s.scope = sp.todos;
  }
  if (todo) s.panel = String(todo);
  return new URLSearchParams(Object.entries(s).map(([k, v]) => [`s.${k}`, v])).toString();
}
