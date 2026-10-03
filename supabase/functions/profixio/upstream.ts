// Upstream fetch context for the profixio function: one instance per request.
// Enforces the per-request fetch budget and deadline, keeps the cookie jar a
// Livewire call needs, and speaks the Livewire v3 update protocol.

export const PROFIXIO_BASE = "https://www.profixio.com/app";
const USER_AGENT = "Scoutable/1.0 (+https://scoutable.se; hello@scoutable.se)";
const MAX_BODY_BYTES = 4_000_000;

/** A request the client caused: becomes `{ error: token }` with `status`. */
export class ClientError extends Error {
  constructor(public readonly status: number, public readonly token: string) {
    super(token);
  }
}

/** A page fetched fine but an extractor found nothing — Profixio changed its markup. */
export class ParseError extends Error {}

export class Upstream {
  private fetches = 0;
  private readonly startedAt = Date.now();
  private readonly cookies = new Map<string, string>();

  constructor(private readonly opts: { maxFetches: number; deadlineMs: number }) {}

  pastDeadline(): boolean {
    return Date.now() - this.startedAt > this.opts.deadlineMs;
  }

  /** GET a page as text. */
  get(url: string, timeoutMs = 20_000): Promise<string> {
    return this.text(url, { headers: this.headers({ Accept: "text/html,application/json;q=0.9,*/*;q=0.8" }) }, timeoutMs);
  }

  /** GET JSON (the documented API, or the page's signed `apiurl`). */
  async getJson(url: string, extraHeaders: Record<string, string> = {}, timeoutMs = 20_000): Promise<unknown> {
    const body = await this.text(url, { headers: this.headers({ Accept: "application/json", ...extraHeaders }) }, timeoutMs);
    return JSON.parse(body);
  }

  /**
   * One Livewire v3 component call. `snapshot` is the component's
   * `wire:snapshot` attribute (HTML-unescaped), passed back verbatim so the
   * server-side checksum still validates. Returns the rendered HTML and the
   * new snapshot (needed to chain a second call, e.g. a season switch).
   */
  async livewire(
    pageUrl: string,
    csrf: string,
    updateUri: string,
    snapshot: string,
    calls: Array<{ method: string; params: unknown[] }>,
    updates: Record<string, unknown> = {},
  ): Promise<{ html: string; snapshot: string }> {
    const body = JSON.stringify({
      _token: csrf,
      components: [{ snapshot, updates, calls: calls.map((c) => ({ path: "", method: c.method, params: c.params })) }],
    });
    const text = await this.text(
      updateUri,
      {
        method: "POST",
        body,
        headers: this.headers({
          "X-Livewire": "",
          "Content-Type": "application/json",
          Accept: "text/html, application/xhtml+xml",
          Referer: pageUrl,
          Origin: "https://www.profixio.com",
        }),
      },
      30_000,
    );
    let json: { components?: Array<{ snapshot?: unknown; effects?: { html?: unknown } }> };
    try {
      json = JSON.parse(text);
    } catch {
      throw new ParseError("livewire response is not JSON");
    }
    const c = json?.components?.[0];
    if (typeof c?.effects?.html !== "string") throw new ParseError("livewire response without effects.html");
    return { html: c.effects.html, snapshot: typeof c.snapshot === "string" ? c.snapshot : snapshot };
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    return {
      "User-Agent": USER_AGENT,
      "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.5",
      ...(cookie ? { Cookie: cookie } : {}),
      ...extra,
    };
  }

  private async text(url: string, init: RequestInit, timeoutMs: number): Promise<string> {
    if (++this.fetches > this.opts.maxFetches) throw new Error(`upstream budget exceeded at ${url}`);
    const res = await fetch(url, { ...init, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      if (i > 0) this.cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    if (!res.ok) {
      if (res.status === 403 || res.status === 429 || res.status === 503) {
        console.error(`[profixio] upstream_blocked ${res.status} ${url}`);
      }
      throw new Error(`profixio ${res.status} ${url}`);
    }
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BODY_BYTES) throw new Error(`profixio oversize ${len} ${url}`);
    const body = await res.text();
    if (body.length > MAX_BODY_BYTES * 2) throw new Error(`profixio oversize body ${url}`);
    return body;
  }
}
