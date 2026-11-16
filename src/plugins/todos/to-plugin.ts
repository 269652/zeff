import { switchConnectorToPlugin } from "../connector-port";

/**
 * From the built-in Todos screens to the plugin (zeff-plugins/plugins/todos-ext): the plugin on, its package installed under System (the screen's database and the flows that
 * tick off, add, run actions, sync and write — allowed the permissions they ask for, your click is the yes). The Todos plugin itself stays on: the todos, their actions and the
 * settle hooks are the kernel's; /todos and /t/<n> lead to the plugin's page (workspace/todos-app.ts). Server only.
 */
export async function switchTodosToPlugin(): Promise<{ flow: string }> {
  return switchConnectorToPlugin("todos", { port: "todos-ext", flow: "todos-ext.status", minutes: async () => 0, keepBuiltin: true });
}
