/**
 * The converter's side of the `job_*` actions on the `game-video` function
 * (packages/shared/lib/game-video-wire.ts): one POST per call with the
 * worker secret in a header, `{ error }` tokens turned into typed errors.
 * Every write carries the attempt number; a 409 `stale_attempt` means
 * another attempt owns the row now and this run must stop. 5xx answers and
 * network failures are retried with a growing pause; 4xx answers are not.
 */
import type {
  GameVideoConvertError,
  GameVideoJobDoneRequest,
  GameVideoJobDoneResponse,
  GameVideoJobFailedResponse,
  GameVideoJobTakeResponse,
  GameVideoSignPartsResponse,
} from "@scoutable/shared/lib/game-video-wire";

export class FunctionError extends Error {
  constructor(
    public token: string,
    public status: number,
    options?: ErrorOptions,
  ) {
    super(`${token} (http ${status})`, options);
    this.name = "FunctionError";
  }
}

/** 409 stale_attempt: another attempt owns the row; this run stops without reporting anything. */
export class StaleAttempt extends FunctionError {
  constructor() {
    super("stale_attempt", 409);
    this.name = "StaleAttempt";
  }
}

export interface FunctionClientOptions {
  /** GAME_VIDEO_FN_URL: `https://<ref>.supabase.co/functions/v1`. */
  url: string;
  secret: string;
  videoId: string;
  fetch?: typeof fetch;
  /** Per request; the default allows for a slow CompleteMultipartUpload inside job_done. */
  timeoutMs?: number;
  /** Base of the pause between tries (× try number). */
  retryDelayMs?: number;
}

export interface CallOptions {
  tries?: number;
  timeoutMs?: number;
}

export type JobDoneBody = Omit<GameVideoJobDoneRequest, "action" | "videoId" | "attempt">;

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_DELAY_MS = 1000;

const isRetryableStatus = (status: number) => status >= 500 || status === 429;

export class FunctionClient {
  private readonly endpoint: string;

  constructor(private readonly o: FunctionClientOptions) {
    this.endpoint = `${o.url.replace(/\/+$/, "")}/game-video`;
  }

  take(): Promise<GameVideoJobTakeResponse> {
    return this.call<GameVideoJobTakeResponse>({ action: "job_take" }, { tries: 3 });
  }

  async progress(attempt: number, progress: number): Promise<void> {
    await this.call<unknown>({ action: "job_progress", attempt, progress }, { tries: 2 });
  }

  signParts(attempt: number, partNumbers: number[]): Promise<GameVideoSignPartsResponse> {
    return this.call<GameVideoSignPartsResponse>({ action: "job_sign_parts", attempt, partNumbers }, { tries: 3 });
  }

  /** Idempotent on the function's side: a repeat finds the row ready and answers the same. */
  done(attempt: number, body: JobDoneBody): Promise<GameVideoJobDoneResponse> {
    return this.call<GameVideoJobDoneResponse>({ action: "job_done", attempt, ...body }, { tries: 5 });
  }

  failed(attempt: number, error: GameVideoConvertError | string, retryable: boolean, opts: CallOptions = {}): Promise<GameVideoJobFailedResponse> {
    return this.call<GameVideoJobFailedResponse>({ action: "job_failed", attempt, error, retryable }, { tries: 3, ...opts });
  }

  private async call<T>(body: Record<string, unknown>, opts: CallOptions): Promise<T> {
    const tries = Math.max(1, opts.tries ?? 1);
    const timeoutMs = opts.timeoutMs ?? this.o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const doFetch = this.o.fetch ?? fetch;
    let last: FunctionError | null = null;
    for (let n = 1; n <= tries; n++) {
      try {
        const res = await doFetch(this.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", "x-worker-secret": this.o.secret },
          body: JSON.stringify({ ...body, videoId: this.o.videoId }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        let json: unknown = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        if (res.ok) return json as T;
        const token = typeof (json as { error?: unknown } | null)?.error === "string" ? (json as { error: string }).error : `http_${res.status}`;
        if (token === "stale_attempt") throw new StaleAttempt();
        const err = new FunctionError(token, res.status);
        if (!isRetryableStatus(res.status)) throw err;
        last = err;
      } catch (e) {
        if (e instanceof FunctionError) {
          if (!isRetryableStatus(e.status)) throw e;
          last = e;
        } else {
          // A network failure or a timeout: the function may or may not have seen the call.
          last = new FunctionError("request_failed", 0, { cause: e });
        }
      }
      if (n < tries) await new Promise((r) => setTimeout(r, (this.o.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS) * n));
    }
    throw last ?? new FunctionError("request_failed", 0);
  }
}
