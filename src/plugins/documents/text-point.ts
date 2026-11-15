import { extensionPoint } from "@/lib/plugin-kit/extension-point";

/**
 * What other plugins say a document's text is, in place of what was read (a bank statement is the kernel's: lib/bank/statements.ts). The first that gives a
 * text wins; null: the document's own text. Server only.
 */
export type DocumentText = (name: string, text: string) => string | null | Promise<string | null>;

export const documentTexts = extensionPoint<DocumentText>("documents.texts");
