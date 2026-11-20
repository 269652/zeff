/**
 * What you do in a live session (POST /api/work/:id/live) — here, on the server that follows the session: Zeff's own.
 * The phone's server (which only watches) hands it over (host op "work.liveDo"). Server only.
 */
import { answerPermission, interruptLive, sendToLive, setConfig, setMode, wrapUp } from "@/plugins/copilot-cli/interactive";
import { liveView } from "@/plugins/copilot-cli/live-state";
import { liveDriverOf, type LiveDriver } from "@/lib/work/live-driver";
import { EFFORTS, type AskAnswer, type Effort } from "@/lib/work/shared";
import { t } from "@/lib/i18n/server";

/** Images with a message: at most this many, each at most this big (base64 of it). */
const MAX_IMAGES = 6;
const MAX_IMAGE = 7 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export type LiveBody = {
  do?: string;
  option?: string;
  text?: string;
  mode?: string;
  model?: string;
  effort?: string;
  cmd?: string;
  requestId?: string;
  answer?: AskAnswer;
  images?: { mediaType?: string; data?: string }[];
  /** Files with the message (not pictures): where each is — the session reads them itself. */
  files?: { name: string; path: string }[];
};

/** The pictures of a message, checked: the types a model reads, not too big. */
function checkedImages(list: LiveBody["images"]): { mediaType: string; data: string }[] {
  return (list ?? []).slice(0, MAX_IMAGES).map((i) => {
    const mediaType = String(i.mediaType ?? "");
    const data = String(i.data ?? "");
    if (!IMAGE_TYPES.includes(mediaType)) throw new Error(t("Not an image Claude reads ({type}): PNG, JPEG, GIF or WebP.", { type: mediaType || "?" }));
    if (!data || data.length > MAX_IMAGE || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new Error(t("An image is too big (5 MB at most) or unreadable."));
    return { mediaType, data };
  });
}

/** An action on a run's live session (its driver following it here — taken up if not yet); what it answers. */
export async function liveDo(runId: number, body: LiveBody): Promise<Record<string, unknown>> {
  const driver = liveDriverOf(runId);
  if (driver && !driver.view(runId)) driver.reattach([runId]);
  if (driver?.view(runId)) {
    const out = await session(driver, runId, body);
    return out;
  }
  // A Copilot session Zeff's own server holds (this one only watches): done there.
  if (!liveView(runId) && (await import("@/lib/host/role")).delegates()) return await (await import("@/lib/host/client")).callHost<Record<string, unknown>>("work.liveDo", { runId, body }, 120000);
  if (body.do === "answer") answerPermission(runId, String(body.option ?? ""));
  else if (body.do === "send") {
    const text = String(body.text ?? "").trim();
    const images = checkedImages(body.images);
    const files = body.files ?? [];
    if (!text && !images.length && !files.length) throw new Error(t("The message is empty."));
    sendToLive(runId, text.slice(0, 8000), { images, files });
  } else if (body.do === "mode") await setMode(runId, String(body.mode ?? ""));
  else if (body.do === "model") await setConfig(runId, "model", String(body.model ?? ""));
  else if (body.do === "effort") await setConfig(runId, "thought_level", String(body.effort ?? ""));
  else if (body.do === "interrupt") interruptLive(runId);
  else if (body.do === "wrap-up") wrapUp(runId);
  else throw new Error(t("Unknown action."));
  return {};
}

type ClaudeBody = LiveBody;

async function session(d: LiveDriver, runId: number, b: ClaudeBody) {
  switch (b.do) {
    case "send": {
      // (files that are not pictures: where to read them, after your words — as a new session's attachments go)
      const { attachmentsPrompt } = await import("./attachments");
      const text = (String(b.text ?? "").trim() + attachmentsPrompt(b.files ?? [])).trim();
      const images = checkedImages(b.images);
      if (!text && !images.length) throw new Error(t("The message is empty."));
      // Its chat's stored conversation changed (a lesson's messages edited): a fresh session takes the message instead.
      const fresh = images.length ? null : await (await import("./conversation-guard")).freshInstead(runId, text);
      if (fresh) return { fresh };
      await d.send(runId, text.slice(0, 100000) || "(see the image)", images);
      return {};
    }
    case "answer": {
      if (!b.requestId || !b.answer || (b.answer.behavior !== "allow" && b.answer.behavior !== "deny")) throw new Error(t("Which answer?"));
      const a = b.answer;
      if (a.then !== undefined && !d.view(runId)?.session.modes.some((m) => m.id === a.then)) throw new Error(t("Unknown mode."));
      await d.answer(runId, b.requestId, {
        behavior: a.behavior,
        always: !!a.always,
        message: typeof a.message === "string" ? a.message.slice(0, 4000) : undefined,
        interrupt: !!a.interrupt,
        answers: a.answers && typeof a.answers === "object" ? Object.fromEntries(Object.entries(a.answers).map(([k, v]) => [String(k).slice(0, 500), String(v).slice(0, 2000)])) : undefined,
        then: a.then,
        input: a.input && typeof a.input === "object" ? a.input : undefined,
      });
      return {};
    }
    case "interrupt":
      await d.interrupt(runId);
      return {};
    case "mode":
      await d.setMode(runId, String(b.mode ?? ""));
      return {};
    case "model":
      await d.setModel(runId, String(b.model ?? ""));
      return {};
    case "effort": {
      const effort = String(b.effort ?? "");
      if (!(EFFORTS as readonly string[]).includes(effort)) throw new Error(t("Unknown effort."));
      if (!d.setEffort) throw new Error(t("This session's effort can't be changed."));
      await d.setEffort(runId, effort as Effort);
      return {};
    }
    case "shell": {
      const cmd = String(b.cmd ?? "").trim();
      if (!cmd) throw new Error(t("Which command?"));
      if (!d.shell) throw new Error(t("This session doesn't run commands of yours."));
      const r = await d.shell(runId, cmd.slice(0, 8000));
      return { out: r.out.slice(-20000), code: r.code };
    }
    case "wrap-up":
      await d.finish(runId);
      return {};
    case "close":
      await d.close(runId);
      return {};
    default:
      throw new Error(t("Unknown action."));
  }
}
