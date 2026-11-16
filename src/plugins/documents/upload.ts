/** Posts files to the store (POST /api/documents); the answer says what came of each. */
export async function uploadDocuments(files: File[]): Promise<{ ok: boolean; documents?: { id: number; ref: string; name: string; fresh: boolean }[]; errors?: string[]; error?: string }> {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  const r = await fetch("/api/documents", { method: "POST", body: fd });
  return r.json().catch(() => ({ ok: false, error: `${r.status}` }));
}
