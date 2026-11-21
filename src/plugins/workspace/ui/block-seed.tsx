"use client";

import { createContext, type ReactNode } from "react";
import type { BlockDef } from "../blocks";

/**
 * The blocks of your own, handed over with a page that shows some (app/workspace/[id]/page.tsx): its blocks are drawn in the page's
 * first HTML already and nothing waits for their read — which, as a server action, queues behind the page's others (use-blocks.ts).
 */
export const BlockSeed = createContext<BlockDef[] | null>(null);

export function BlockSeedProvider({ blocks, children }: { blocks: BlockDef[] | null; children: ReactNode }) {
  return <BlockSeed.Provider value={blocks}>{children}</BlockSeed.Provider>;
}
