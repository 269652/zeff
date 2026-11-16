import { withAccount, currentAccountId } from "@/db/accounts";
import { errorMessage } from "@/lib/errors";

/**
 * Reading what was dropped: the Documents plugin (documents-ext) does it — its flow documents.read reads the text of what waits (text, Office files and PDFs right
 * here; pictures, scans and recordings by the AI or the transcriber), and documents.abstracts fetches the knowledge server's abstracts. This is only the kernel's
 * way to say "something new is waiting": a document kept by the mail attachments, a capture, the Explorer or an upload starts that flow in the background. Server only.
 */
export function startProcessing(): void {
  const account = currentAccountId();
  void withAccount(account, async () => {
    const { documentsPortFlows } = await import("./port");
    await documentsPortFlows([{ name: "documents.read" }, { name: "documents.abstracts" }]);
  }).catch((e) => console.error("[documents]", errorMessage(e)));
}
