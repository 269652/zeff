import { isEnabled } from "@/lib/ext/registry";
import { isInstalled } from "@/plugins/state";

/**
 * Your debts and bank figures as shared data of the kernel: they live in the same database and tables whether the built-in Finances keeps
 * them or its port (zeff-plugins/plugins/finances-ext, whose sources, widgets and Kennzahlen take over). What reads them — People, the first look,
 * the brief, the timeline, the cases' blocks — asks here whether Finances is there at all. Server only.
 */
export const FINANCES_PORT = "finances-ext";

const portOn = (): boolean => {
  try {
    return isEnabled(FINANCES_PORT);
  } catch {
    return false;
  }
};

/** Whether Finances is there: the built-in on, or its port. */
export const financesThere = (): boolean => isInstalled("finances") || portOn();
