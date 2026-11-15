import crypto from "node:crypto";

/**
 * A session with a driver lambda (capability D): Zeff's code calls one tool after another of a program the driver keeps open — the Jira MCP
 * server (started once, its 30 s cold start paid once), whatever a plugin's scraper holds — as if it were the program itself:
 * `openLambdaSession(lambda, init, body)` runs the driver with event.tool "session" and hands `body` a `call(tool, args)`. The driver
 * asks Zeff for the next call over two actions it may name in lambda.json's "zeff" (session.next, session.reply — flows/session-actions.ts),
 * runs it in its program and answers. Ends when `body` ends (the driver is told) or the driver ends. Server only.
 */
type Pending = { id: number; tool: string; args: unknown; resolve: (v: unknown) => void; reject: (e: Error) => void };
type Session = { queue: Pending[]; waiting: Pending[]; waiter: ((p: Pending | "done" | null) => void) | null; closed: boolean; failed: string | null; seq: number };

const sessions = new Map<string, Session>();

/** What the driver asked for next: a call, "done" (the body is over), or null (nothing yet — ask again). */
export function nextCall(sessionId: string, waitMs = 20000): Promise<{ id: number; tool: string; args: unknown } | "done" | null> {
  const s = sessions.get(sessionId);
  if (!s) return Promise.resolve("done");
  const take = (): { id: number; tool: string; args: unknown } | "done" | null => {
    const p = s.queue.shift();
    if (p) {
      s.waiting.push(p);
      return { id: p.id, tool: p.tool, args: p.args };
    }
    return s.closed ? "done" : null;
  };
  const now = take();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      s.waiter = null;
      resolve(null);
    }, waitMs);
    s.waiter = () => {
      clearTimeout(timer);
      s.waiter = null;
      resolve(take());
    };
  });
}

/** The driver's answer to a call. */
export function replyCall(sessionId: string, id: number, answer: { ok: boolean; value?: unknown; error?: string }): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  const i = s.waiting.findIndex((p) => p.id === id);
  if (i < 0) return;
  const [p] = s.waiting.splice(i, 1);
  if (answer.ok) p.resolve(answer.value);
  else p.reject(new Error(answer.error ?? "The driver answered with an error."));
}

export type SessionCall = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export async function openLambdaSession<T>(lambda: string, init: Record<string, unknown>, body: (call: SessionCall) => Promise<T>, timeoutMs = 150000): Promise<T> {
  const { invokeLambda } = await import("./run");
  const sessionId = crypto.randomUUID();
  const s: Session = { queue: [], waiting: [], waiter: null, closed: false, failed: null, seq: 0 };
  sessions.set(sessionId, s);
  const failAll = (message: string) => {
    s.failed = message;
    for (const p of [...s.queue, ...s.waiting]) p.reject(new Error(message));
    s.queue = [];
    s.waiting = [];
  };
  // (the driver ending first — it couldn't start its program, it timed out — fails what is asked of it)
  const running = invokeLambda(lambda, { tool: "session", sessionId, timeoutMs, ...init }, { asDriver: true }).then((r) => {
    if (!s.closed) failAll(r.ok ? "The driver ended the session." : r.error);
    return r;
  });
  const call: SessionCall = (tool, args) =>
    new Promise((resolve, reject) => {
      if (s.failed) return reject(new Error(s.failed));
      s.queue.push({ id: ++s.seq, tool, args, resolve, reject });
      s.waiter?.(null);
    });
  try {
    return await body(call);
  } finally {
    s.closed = true;
    s.waiter?.("done");
    await running.catch(() => undefined);
    sessions.delete(sessionId);
  }
}
