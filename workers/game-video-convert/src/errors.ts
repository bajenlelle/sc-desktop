/**
 * How the converter's failures are named for the `game-video` function
 * (job_failed's `error` and `retryable`), and how an ffmpeg exit is read.
 * The closed tokens live in packages/shared/lib/game-video-wire.ts; a few
 * free-form ones are added here for things the wire doesn't name.
 */
import { isRetryableConvertError } from "@scoutable/shared/lib/game-video-convert";
import type { GameVideoConvertError } from "@scoutable/shared/lib/game-video-wire";
import { FunctionError } from "./function-client.ts";

/** A failure with a name the function and the apps understand. */
export class ConvertFailure extends Error {
  constructor(
    public token: GameVideoConvertError | string,
    public retryable: boolean = isRetryableConvertError(token),
    detail?: string,
  ) {
    super(detail ? `${token}: ${detail}` : token);
    this.name = "ConvertFailure";
  }
}

export type AbortReason = "sigterm" | "stale_attempt";

/** The run was told to stop: by SIGTERM, or because another attempt owns the row now. */
export class Aborted extends Error {
  constructor(public reason: AbortReason) {
    super(reason);
    this.name = "Aborted";
  }
}

export function abortReason(signal: AbortSignal): AbortReason {
  return signal.reason === "stale_attempt" ? "stale_attempt" : "sigterm";
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Aborted(abortReason(signal));
}

/**
 * A file ffmpeg can't read is final; a stream map that finds nothing is
 * final; anything else (a full disk, a killed process, a converter bug) is
 * worth another attempt. The final patterns name the input specifically: a
 * generic "Invalid argument" also comes from output trouble and must not
 * fail a user's row for good.
 */
export function ffmpegFailureToken(stderr: string): GameVideoConvertError {
  if (/matches no streams|does not contain any stream/i.test(stderr)) return "no_video_stream";
  if (/Invalid data found when processing input|moov atom not found|Unknown input format|could not find codec parameters/i.test(stderr)) return "unsupported_type";
  return "transcode_incomplete";
}

export interface ClassifiedFailure {
  error: GameVideoConvertError | string;
  retryable: boolean;
}

/** What to tell the function about a thrown error. */
export function classifyFailure(e: unknown): ClassifiedFailure {
  if (e instanceof ConvertFailure) return { error: e.token, retryable: e.retryable };
  if (e instanceof Aborted) return { error: e.reason, retryable: true };
  if (e instanceof FunctionError) return { error: e.token, retryable: isRetryableConvertError(e.token) };
  const message = e instanceof Error ? e.message : String(e);
  // planParts() refuses a copy over the size cap or with a nonsensical size.
  if (message === "too_large" || message === "invalid_size") return { error: message, retryable: false };
  return { error: "internal_error", retryable: true };
}
