import { AsyncLocalStorage } from "node:async_hooks";

/**
 * What happens in the Workspace's databases, told to the routines that listen (routine-triggers.ts): a row added, a cell changed. The
 * store only says it; nothing here depends on the routines (they are loaded when there is something to tell). While a pipeline writes
 * its rows, or a routine runs, the rows' own events stay quiet: the pipeline tells once when it is through, and a routine's changes
 * never set routines off again (no loops). Server only.
 */
export type RowEvent = "row.added" | "row.changed" | "row.removed";
export type RowEventInfo = { db: number; row: number; field?: string; /** The new value of the cell, as text (row.changed). */ value?: string };

const quietScope = new AsyncLocalStorage<boolean>();

/** `fn` runs with the rows' events suppressed. */
export const quietly = <T>(fn: () => T): T => quietScope.run(true, fn);
export const isQuiet = (): boolean => quietScope.getStore() === true;

const sourceScope = new AsyncLocalStorage<boolean>();

/** `fn` runs as a source writing its own records: the one thing allowed to add rows to a database that only shows a source. */
export const viaSource = <T>(fn: () => T): T => sourceScope.run(true, fn);
export const isViaSource = (): boolean => sourceScope.getStore() === true;

const flowScope = new AsyncLocalStorage<string>();

/** `fn` runs as the flow `name`: what it changes never starts that same flow again (an event it causes skips it — no echo). */
export const asFlow = <T>(name: string, fn: () => T): T => flowScope.run(name, fn);
/** The flow whose run this is, if any. */
export const currentFlow = (): string | null => flowScope.getStore() ?? null;

/**
 * What happens to pages (any page — a document, a database, a row's page): made, its title, text, icon, cover or place changed, moved to
 * the trash. Told to the flows that listen (a sync keeping a copy elsewhere up to date); like the rows' events, quiet while quiet.
 */
export type PageEvent = "page.added" | "page.changed" | "page.removed";
export function emitPageEvent(event: PageEvent, page: number, field?: string): void {
  if (isQuiet()) return;
  void import("./flows/engine").then((m) => m.fireFlowEvent({ event, page, ...(field ? { field } : {}) })).catch(() => undefined);
}

/** Tell the routines (in the background; a failure there never touches the store). */
export function emitRowEvent(event: RowEvent, info: RowEventInfo): void {
  if (isQuiet()) return;
  void import("./routine-triggers").then((m) => m.fireRoutineEvent(event, info)).catch(() => undefined);
  // (The flows that listen too — flows/engine.ts.)
  void import("./flows/engine").then((m) => m.fireFlowEvent({ event, db: info.db, row: info.row, field: info.field, value: info.value })).catch(() => undefined);
}
