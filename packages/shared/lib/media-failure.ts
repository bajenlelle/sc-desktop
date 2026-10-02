/**
 * Why a <video> has nothing to show, and what to tell the user.
 *
 * Two different failures look identical on screen — a black box — and need
 * different advice. A container or codec the webview can't open at all makes
 * the element fire `error` with MEDIA_ERR_SRC_NOT_SUPPORTED. A file whose
 * audio plays but whose video codec isn't decodable fires no `error` at all;
 * it just reports videoWidth 0 — iPhone HEVC footage on Windows, where
 * WebView2 has no HEVC decoder. Anything else is the file being gone or
 * unreadable — or, for a clip streamed from R2, the network.
 */
export type MediaFailure = "unsupported" | "no_picture" | "unavailable";

/** HTMLMediaElement's MEDIA_ERR_SRC_NOT_SUPPORTED, spelled out because Node has no MediaError. */
const SRC_NOT_SUPPORTED = 4;

export function classifyMediaError(code: number | null | undefined): MediaFailure {
  return code === SRC_NOT_SUPPORTED ? "unsupported" : "unavailable";
}

export interface MediaFailureContext {
  /** The source is streamed from the cloud, not read from this computer. */
  remote?: boolean;
}

export function mediaFailureMessage(kind: MediaFailure, ctx: MediaFailureContext = {}): string {
  switch (kind) {
    case "unsupported":
      return "Unsupported video format. Convert it to MP4 (H.264) and choose the file again.";
    case "no_picture":
      return "This video's codec isn't supported here, so there's no picture. Convert it to MP4 (H.264) and choose the file again.";
    case "unavailable":
      return ctx.remote
        ? "Can't load this clip. Check your connection and try again."
        : "Can't load this video. Check that the file still exists, then choose it again.";
  }
}
