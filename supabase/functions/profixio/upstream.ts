// Upstream fetch context for the profixio function: one instance per request.
// Enforces the per-request fetch budget and deadline for calls to Profixio's
// documented API.

export const PROFIXIO_BASE = "https://www.profixio.com/app";
const USER_AGENT = "Scoutable/1.0 (+https://scoutable.se; hello@scoutable.se)";
const MAX_BODY_BYTES = 4_000_000;

/** A request the client caused: becomes `{ error: token }` with `status`. */
export class ClientError extends Error {
  constructor(public readonly status: number, public readonly token: string) {
    super(token);
  }
}

/** Profixio answered, but not with the JSON shape the API documents. */
export class ParseError extends Error {}

/** Profixio answered with a non-2xx status. */
export class UpstreamStatusError extends Error {
  constructor(public readonly status: number, url: string) {
    super(`profixio ${status} ${url}`);
  }
}

export class Upstream {
  private fetches = 0;
  private readonly startedAt = Date.now();

  constructor(private readonly opts: { maxFetches: number; deadlineMs: number }) {}

  pastDeadline(): boolean {
    return Date.now() - this.startedAt > this.opts.deadlineMs;
  }

  /** GET JSON from the API. */
  async getJson(url: string, extraHeaders: Record<string, string> = {}, timeoutMs = 20_000): Promise<unknown> {
    const body = await this.text(url, { headers: this.headers({ Accept: "application/json", ...extraHeaders }) }, timeoutMs);
    try {
      return JSON.parse(body);
    } catch {
      throw new ParseError(`not JSON: ${url}`);
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.5",
      ...extra,
    };
  }

  private async text(url: string, init: RequestInit, timeoutMs: number): Promise<string> {
    if (++this.fetches > this.opts.maxFetches) throw new Error(`upstream budget exceeded at ${url}`);
    const res = await fetch(url, { ...init, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      if (res.status === 429 || res.status === 503) {
        console.error(`[profixio] upstream_blocked ${res.status} ${url}`);
      }
      await res.body?.cancel();
      throw new UpstreamStatusError(res.status, url);
    }
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BODY_BYTES) throw new Error(`profixio oversize ${len} ${url}`);
    const body = await res.text();
    if (body.length > MAX_BODY_BYTES * 2) throw new Error(`profixio oversize body ${url}`);
    return body;
  }
}
