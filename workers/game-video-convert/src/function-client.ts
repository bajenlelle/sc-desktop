/**
 * The container's side of the `game-video` function's worker actions
 * (packages/shared/lib/game-video-wire.ts): one POST per call with the
 * worker secret in a header, `{ error }` tokens turned into typed errors.
 * Two programs speak through it: the converter (`job_*`, about a `videoId`)
 * and the renderer (`render_*`, about a render job's `jobId`); both carry
 * the attempt number on every write, and a 409 `stale_attempt` means
 * another attempt owns the row now and this run must stop; a 409
 * `cancelled` means the owner stopped the render job (render_cancel) and
 * this run must stop too. 5xx answers and network failures are retried
 * with a growing pause; 4xx answers are not.
 */
import type {
  GameVideoConvertError,
  GameVideoJobDoneRequest,
  GameVideoJobDoneResponse,
  GameVideoJobFailedResponse,
  GameVideoJobTakeResponse,
  GameVideoSignPartsResponse,
  RenderClipResult,
  RenderDoneRequest,
  RenderDoneResponse,
  RenderFailedResponse,
  RenderPhase,
  RenderTakeResponse,
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

/** 409 cancelled: the owner stopped the render job; this run stops without reporting anything. */
export class Cancelled extends FunctionError {
  constructor() {
    super("cancelled", 409);
    this.name = "Cancelled";
  }
}

/** What both clients share: the endpoint, the secret, the retry policy. */
export interface FunctionCallerOptions {
  /** GAME_VIDEO_FN_URL: `https://<ref>.supabase.co/functions/v1`. */
  url: string;
  secret: string;
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

/** The field every call names its row by, and the prefix of its actions. */
export type IdField = "videoId" | "jobId";
export type ActionPrefix = "job" | "render";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_DELAY_MS = 1000;

const isRetryableStatus = (status: number) => status >= 500 || status === 429;

/**
 * The POST loop both clients run: `{ action: "<prefix>_<name>", <idField>: id, …body }`
 * with the secret header, retried on 5xx and network failures.
 */
export class FunctionCaller {
  private readonly endpoint: string;

  constructor(
    private readonly o: FunctionCallerOptions,
    private readonly prefix: ActionPrefix,
    private readonly idField: IdField,
    private readonly id: string,
  ) {
    this.endpoint = `${o.url.replace(/\/+$/, "")}/game-video`;
  }

  protected async call<T>(name: string, body: Record<string, unknown>, opts: CallOptions): Promise<T> {
    const tries = Math.max(1, opts.tries ?? 1);
    const timeoutMs = opts.timeoutMs ?? this.o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const doFetch = this.o.fetch ?? fetch;
    let last: FunctionError | null = null;
    for (let n = 1; n <= tries; n++) {
      try {
        const res = await doFetch(this.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", "x-worker-secret": this.o.secret },
          body: JSON.stringify({ action: `${this.prefix}_${name}`, ...body, [this.idField]: this.id }),
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
        if (token === "cancelled") throw new Cancelled();
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

// ---------------------------------------------------------------------------
// The converter: job_* about a game_videos row
// ---------------------------------------------------------------------------

export interface FunctionClientOptions extends FunctionCallerOptions {
  videoId: string;
}

export type JobDoneBody = Omit<GameVideoJobDoneRequest, "action" | "videoId" | "attempt">;

export class FunctionClient extends FunctionCaller {
  constructor(o: FunctionClientOptions) {
    super(o, "job", "videoId", o.videoId);
  }

  take(): Promise<GameVideoJobTakeResponse> {
    return this.call<GameVideoJobTakeResponse>("take", {}, { tries: 3 });
  }

  async progress(attempt: number, progress: number): Promise<void> {
    await this.call<unknown>("progress", { attempt, progress }, { tries: 2 });
  }

  signParts(attempt: number, partNumbers: number[]): Promise<GameVideoSignPartsResponse> {
    return this.call<GameVideoSignPartsResponse>("sign_parts", { attempt, partNumbers }, { tries: 3 });
  }

  /** Idempotent on the function's side: a repeat finds the row ready and answers the same. */
  done(attempt: number, body: JobDoneBody): Promise<GameVideoJobDoneResponse> {
    return this.call<GameVideoJobDoneResponse>("done", { attempt, ...body }, { tries: 5 });
  }

  failed(attempt: number, error: GameVideoConvertError | string, retryable: boolean, opts: CallOptions = {}): Promise<GameVideoJobFailedResponse> {
    return this.call<GameVideoJobFailedResponse>("failed", { attempt, error, retryable }, { tries: 3, ...opts });
  }
}

// ---------------------------------------------------------------------------
// The renderer: render_* about a render_jobs row
// ---------------------------------------------------------------------------

export interface RenderClientOptions extends FunctionCallerOptions {
  jobId: string;
}

/** What an export's render_done carries: the uploaded file's size and length, and whether a share's poster went up too. */
export type RenderExportDone = NonNullable<RenderDoneRequest["export"]>;

export class RenderClient extends FunctionCaller {
  constructor(o: RenderClientOptions) {
    super(o, "render", "jobId", o.jobId);
  }

  take(): Promise<RenderTakeResponse> {
    return this.call<RenderTakeResponse>("take", {}, { tries: 3 });
  }

  /** `phase` is an export's (clips, stitch, upload); a ship job sends none. */
  async progress(attempt: number, progress: number, phase?: RenderPhase): Promise<void> {
    await this.call<unknown>("progress", { attempt, progress, ...(phase ? { phase } : {}) }, { tries: 2 });
  }

  /**
   * A ship job sends a result per clip; an export sends `results: []` and what it uploaded.
   * Idempotent on the function's side: a repeat finds the job done and answers the same.
   */
  done(attempt: number, results: RenderClipResult[], exportDone?: RenderExportDone): Promise<RenderDoneResponse> {
    return this.call<RenderDoneResponse>("done", { attempt, results, ...(exportDone ? { export: exportDone } : {}) }, { tries: 5 });
  }

  failed(attempt: number, error: string, retryable: boolean, opts: CallOptions = {}): Promise<RenderFailedResponse> {
    return this.call<RenderFailedResponse>("failed", { attempt, error, retryable }, { tries: 3, ...opts });
  }
}
