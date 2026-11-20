import { RunMap } from "@/lib/work/run-map";
import type { ChildProcess } from "node:child_process";
import { currentAccountId } from "@/db/accounts";

/** A live (interactive) worker as the pages see it: its mode, whether it's at work, what it asks of you. */
export type LiveView = {
  /** The session's mode (Copilot: agent, plan, autopilot) and the ones it has. */
  mode: string;
  modes: { id: string; name: string }[];
  /** A turn is under way (it works); else it waits for you. */
  busy: boolean;
  /** It wants to do something and asks first: what, and the answers it offers. */
  permission: { title: string; detail: string | null; options: { id: string; name: string; kind: string }[] } | null;
  /** Its turn ended without a result: what it said last (a question, a status) — your move. */
  waiting: string | null;
  /** What else it lets you choose (an ACP agent's session config options): its models and the one it uses, its reasoning efforts and the one set. */
  models?: { value: string; label: string }[];
  model?: string;
  efforts?: string[];
  effort?: string;
  /** What a message may carry besides text: images, files (as links to them). */
  features?: ("images" | "files" | "effort" | "model")[];
};

/** A live session, server side (one Next server holds it; a restart ends it). */
export type Live = {
  runId: number;
  /** The account the run is of (its id is that account's database's). */
  account?: string;
  child: ChildProcess;
  sessionId: string;
  nextId: number;
  pending: Map<number, (msg: { result?: unknown; error?: { message?: string } }) => void>;
  /** The JSON-RPC id of the permission request it waits on. */
  permissionRpcId: number | string | null;
  /** More permissions it asked while one waits (it may ask several at once): shown one after the other, each answered. */
  /** It is in a stretch of thinking (logged once, not per word). */
  thinking?: boolean;
  queued?: { rpcId: number | string; view: NonNullable<LiveView["permission"]> }[];
  view: LiveView;
  /** What it has said in the current turn (its result is parsed from it). */
  turnText: string;
  /** Its session config options (ACP: model, reasoning effort …), each an id to set it by. */
  config?: { id: string; category?: string; currentValue: string; options: { value: string; name: string }[] }[];
  buf: string;
};

// Per account (a run's id is its account's): two accounts served side by side never see or steer each other's session.
const state = globalThis as { __zeffLive?: Map<number, Live>; __zeffLiveRuns?: RunMap<Live> };
export const lives = (state.__zeffLiveRuns ??= new RunMap<Live>(currentAccountId, state.__zeffLive));

/** A run's live session, as the pages see it (none: not an interactive one, or over). */
export const liveView = (runId: number): LiveView | undefined => lives.get(runId)?.view;
