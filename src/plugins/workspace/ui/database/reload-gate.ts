/**
 * Which reads of a database may replace what is on the screen. A click shows its value at once (optimistic) and saves it behind;
 * a read of the whole database that was started before that click — or that is still on its way while saves are open — doesn't know
 * the click yet, and when its answer came back late it put the old value back over the new one ("the second click was overwritten").
 *
 *  - Only the newest read counts (answers arrive out of order).
 *  - A read that started before an edit, or that arrives while a save is still open, is dropped; the screen keeps what you did, and
 *    one read follows once the last save has answered (`endEdit` says so).
 */
export function createReloadGate() {
  let seq = 0;
  let epoch = 0;
  let open = 0;
  let dirty = false;
  return {
    /** A read starts: its ticket. */
    begin: () => ({ seq: ++seq, epoch }),
    /** A read answered: may it replace what is shown? (When it may not because of an edit, one read is owed after the edits.) */
    accept(ticket: { seq: number; epoch: number }): boolean {
      if (ticket.seq !== seq) return false;
      if (ticket.epoch !== epoch || open > 0) return ((dirty = true), false);
      return true;
    },
    /** An edit is shown and sent. */
    startEdit: () => void (epoch++, open++),
    /** An edit answered (any, ok or not): true when it was the last one open and a read is owed. */
    endEdit(): boolean {
      open = Math.max(0, open - 1);
      if (open > 0 || !dirty) return false;
      dirty = false;
      return true;
    },
    /** Something wants a read while edits are open: it waits for them. True when it may go now. */
    request(): boolean {
      if (open === 0) return true;
      dirty = true;
      return false;
    },
  };
}
