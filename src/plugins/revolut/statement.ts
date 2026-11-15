/**
 * Revolut's statements: reading one is the pure core (core.ts — its port has it bundled); keeping the bookings, the statements among
 * the documents and their note are the kernel's (lib/bank/statements.ts), whoever reads them. Kept here for what imports them.
 */
export { parseStatement, accountOf } from "./core";
export { importStatement, importStatementDocuments, statementNote } from "@/lib/bank/statements";
