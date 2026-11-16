import { onlyThroughPort } from "@/plugins/state";
import { stepExtensionOk } from "@/plugins/extension-state";

/**
 * Documents kept by its port (zeff-plugins/plugins/documents-ext): while the port is on and the built-in only stands in through it (state.ts PROVIDED_BY), the
 * steps the port's flows took over (the document review and matching after the briefing, the local folders, the reading) run as those flows — and the built-in's
 * own code does what stays its own (uploads, the screen, the settings page). Server only.
 */

export const DOCUMENTS_PORT = "documents-ext";

/** The port keeps the documents' steps (the built-in is there only through it). */
export const documentsPortOn = (): boolean => onlyThroughPort("documents");

/** A step of the port's, when it is on and the extension that brings it is: the briefing runs its flow instead of the built-in's step. */
export const documentsPortStep = (step: "doctodos" | "docrelations"): boolean => documentsPortOn() && stepExtensionOk(step);

/** The port's flows run one after the other, now: what each gave back, by name. A failing one doesn't stop the next. */
export async function documentsPortFlows(flows: { name: string; input?: Record<string, unknown> }[]): Promise<Record<string, unknown>> {
  const { flowByName } = await import("@/plugins/workspace/flows/store");
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const out: Record<string, unknown> = {};
  for (const f of flows) {
    if (!flowByName(f.name)) continue;
    try {
      const r = await runFlow(f.name, f.input ?? {});
      if (r.status === "done") out[f.name] = r.output;
      else console.error(`[documents] ${f.name}: ${r.error ?? r.status}`);
    } catch (e) {
      console.error(`[documents] ${f.name}:`, e);
    }
  }
  return out;
}
