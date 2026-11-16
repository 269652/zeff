import { currentAccountId } from "@/db/accounts";

/**
 * A lambda's last answer as something code can read at once (sync): what a built-in's page or tool reads while a plugin's lambda works the thing out — the
 * Open loops of the Today page, the chips of the inbox. The last answer is returned; when it is older than `everyMinutes` (or there is none) the lambda
 * is asked again in the background. `forgetLambdaSnapshot` marks it stale (after a write); `refreshLambdaSnapshot` asks now and waits. Server only.
 */
type Kept = { at: number; value: unknown; asking: Promise<void> | null };
const kept: Map<string, Kept> = ((globalThis as { __zeffLambdaSnapshots?: Map<string, Kept> }).__zeffLambdaSnapshots ??= new Map());
const keyOf = (plugin: string, lambda: string, args: unknown) => `${currentAccountId()}|${plugin}|${lambda}|${JSON.stringify(args ?? {})}`;

function ask(k: Kept, plugin: string, lambda: string, args: Record<string, unknown>): Promise<void> {
  if (k.asking) return k.asking;
  k.asking = import("@/plugins/workspace/mcp-plugin-tools")
    .then((x) => x.runOwnLambda(plugin, lambda, args))
    .then((v) => {
      k.value = v;
    })
    .catch((e) => console.error(`[snapshot] ${plugin} ${lambda}:`, e instanceof Error ? e.message : e))
    .finally(() => {
      k.at = Date.now();
      k.asking = null;
    });
  return k.asking;
}

export function lambdaSnapshot<T>(plugin: string, lambda: string, args: Record<string, unknown>, everyMinutes: number): T | null {
  const key = keyOf(plugin, lambda, args);
  const k = kept.get(key) ?? { at: 0, value: null, asking: null };
  kept.set(key, k);
  if (!k.asking && Date.now() - k.at >= everyMinutes * 60_000) void ask(k, plugin, lambda, args);
  return (k.value as T) ?? null;
}

export function forgetLambdaSnapshot(plugin: string, lambda: string, args: Record<string, unknown> = {}): void {
  const k = kept.get(keyOf(plugin, lambda, args));
  if (k) k.at = 0;
}

/** Asked now, waited for: the fresh answer (null: it failed — the last one stays). */
export async function refreshLambdaSnapshot<T>(plugin: string, lambda: string, args: Record<string, unknown> = {}): Promise<T | null> {
  const key = keyOf(plugin, lambda, args);
  const k = kept.get(key) ?? { at: 0, value: null, asking: null };
  kept.set(key, k);
  await (k.asking ?? ask(k, plugin, lambda, args));
  return (k.value as T) ?? null;
}
