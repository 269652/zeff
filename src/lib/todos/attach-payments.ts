import { isInstalled } from "@/plugins/state";
import { paymentForTodo } from "@/lib/girocode-todo";
import type { TodoOp } from "@/lib/todos/shared";
import { listTodos, setTodoOps } from "@/lib/todos/store";
import { payees } from "@/plugins/people/details";

/**
 * Payment todos, by rule — no AI: the open todos that ask you to pay get a transfer action (the GiroCode a click away) when the account
 * is known — in the todo, or of a person it names or whose case it is. The kernel's: it reads only todos and people (moved out of the
 * built-in Cases, which did it after a briefing — its port's cases need it the same). Server only.
 */

/** A todo that asks for money to go out: to transfer, to pay, an instalment. */
const PAYS = /überweis|bezahl|zahl(?:en|ung)|\brate\b|raten|begleich|anweis/i;

/** The open todos that are payments get their transfer (those that have one keep it). How many got one. */
export function attachPayments(): number {
  if (!isInstalled("todos") || !isInstalled("people")) return 0;
  const people = payees();
  if (!people.length) return 0;
  let n = 0;
  for (const todo of listTodos({ status: "open" })) {
    if (!PAYS.test(todo.text) || todo.ops.some((o) => o.type === "bank-transfer")) continue;
    const p = paymentForTodo(todo, people);
    if (!p) continue;
    const op: TodoOp = { type: "bank-transfer", name: p.name, iban: p.iban, bic: p.bic ?? "", amount: p.amount != null ? p.amount.toFixed(2) : "", purpose: p.purpose };
    setTodoOps(todo.id, [...todo.ops, op], undefined, true);
    n++;
  }
  return n;
}
