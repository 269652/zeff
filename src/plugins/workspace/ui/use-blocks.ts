"use client";

import { useContext, useEffect, useLayoutEffect, useState } from "react";
import { BlockSeed } from "./block-seed";
import { PREFIX_ATTR } from "@/lib/account-routes";
import { listBlocksAction } from "../actions";
import type { BlockDef } from "../blocks";
import { WS_CHANGED } from "./ChatPanel";

/**
 * The blocks of your own (blocks.ts) as the views draw them: read once for the page, again when the Workspace changed (the
 * assistant made or changed one). Every view on the page shares the one read. The last ones read are kept in this browser (per
 * account): a page of blocks opened again draws them at once and reads them anew behind (they rarely change) — it doesn't wait for
 * the read, which as a server action queues behind the page's others. A page that shows blocks hands them over itself (BlockSeed):
 * then they are in its first HTML, and that is this page's read.
 */

let cache: BlockDef[] | null = null;
/** The cache is this page's read (not only what the browser kept). */
let fresh = false;
let loading: Promise<BlockDef[]> | null = null;
const listeners = new Set<(b: BlockDef[]) => void>();

const keepKey = () => `zeff.blocks:${document.documentElement.getAttribute(PREFIX_ATTR) ?? ""}`;

function kept(): BlockDef[] | null {
  try {
    const s = localStorage.getItem(keepKey());
    const v = s ? (JSON.parse(s) as unknown) : null;
    return Array.isArray(v) ? (v as BlockDef[]) : null;
  } catch {
    return null;
  }
}

function load(force = false): Promise<BlockDef[]> {
  if (cache && fresh && !force) return Promise.resolve(cache);
  if (loading && !force) return loading;
  loading = listBlocksAction()
    .then((r) => (r.ok ? r.blocks : (cache ?? [])))
    .catch(() => cache ?? [])
    .then((b) => {
      fresh = true;
      // (The same blocks as before: the views keep what they have — nothing is drawn again.)
      if (!cache || JSON.stringify(cache) !== JSON.stringify(b)) {
        cache = b;
        for (const l of listeners) l(b);
        try {
          const text = JSON.stringify(b);
          if (text.length < 500_000) localStorage.setItem(keepKey(), text);
        } catch {
          // full or blocked: not kept
        }
      }
      loading = null;
      return b;
    });
  return loading;
}

/** The blocks — null until they are read (a view using one draws it a moment later, without a mistake meanwhile). */
export function useBlockDefs(): BlockDef[] | null {
  const seed = useContext(BlockSeed);
  const [blocks, setBlocks] = useState<BlockDef[] | null>(cache ?? seed);
  // (What this browser kept, before the first paint — the page doesn't show its loading screen for blocks it knows.)
  useLayoutEffect(() => {
    if (!cache && seed) {
      cache = seed;
      fresh = true;
      return;
    }
    const k = cache ?? kept();
    if (!k) return;
    cache = k;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read from the browser's storage after hydration (the server has none)
    setBlocks(k);
  }, [seed]);
  useEffect(() => {
    listeners.add(setBlocks);
    void load().then(setBlocks);
    const again = () => void load(true);
    window.addEventListener(WS_CHANGED, again);
    return () => {
      listeners.delete(setBlocks);
      window.removeEventListener(WS_CHANGED, again);
    };
  }, []);
  return blocks;
}
