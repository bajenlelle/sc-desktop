import { NextResponse, type NextRequest } from "next/server";
import { hostedPageUrl, parseHostedPageSearchParams } from "@scoutable/shared/lib/stats-card-data";
import { createClient } from "@/lib/supabase/server";

/**
 * The federation's hosted statistics pages, for stats cards on the web
 * (lib/stats-card-data.ts; the desktop reads them itself through its HTTP
 * client). GET ?kind=box&competition=<id>&match=<id> for a game's box score,
 * ?kind=players&competition=<id> for a season's player statistics, &fresh=1
 * to skip the cache (the season card's Update).
 *
 * Signed-in users only, and the page's URL is built here from the validated
 * numbers (hostedBoxScoreUrl / hostedPlayerStatsUrl), never taken from the
 * query, so this can't be used as an open proxy. Pages are cached for ten
 * minutes on the server (the federation's own pages say the same) and passed
 * on as they are: the shared parsers in the browser stay the only parser.
 *
 * 400 for anything but the two pages by number, 401 signed out, 502 when the
 * federation doesn't send the whole page within 25 s, answers an error, or
 * sends more than 3 MB (a season page is ~0.5–0.7 MB and can take 10 s or more
 * to arrive when the federation's server is busy).
 */

const TIMEOUT_MS = 25_000;
// Room for the federation's slowest page on any plan (the platform default can be shorter than TIMEOUT_MS).
export const maxDuration = 60;
const MAX_BYTES = 3 * 1024 * 1024;
const REVALIDATE_SECONDS = 600;

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Someone else's page served from our origin: if a browser ever opens it, nothing in it runs here. */
const PAGE_HEADERS = {
  ...NO_STORE,
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

class UpstreamError extends Error {}

async function readPage(url: string, fresh: boolean): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "text/html" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...(fresh ? { cache: "no-store" as const } : { next: { revalidate: REVALIDATE_SECONDS } }),
  });
  if (!res.ok) throw new UpstreamError(`answered ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? "");
  if (declared > MAX_BYTES) throw new UpstreamError(`declared ${declared} bytes`);
  if (!res.body) throw new UpstreamError("sent no body");

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new UpstreamError(`sent more than ${MAX_BYTES} bytes`);
    }
    chunks.push(value);
  }
  const page = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    page.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return page;
}

export async function GET(request: NextRequest) {
  // Shape first: a malformed request needs no session lookup.
  const asked = parseHostedPageSearchParams(request.nextUrl.searchParams);
  if (!asked) {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const url = hostedPageUrl(asked.query);
  try {
    const page = await readPage(url, asked.fresh);
    return new NextResponse(page, { status: 200, headers: PAGE_HEADERS });
  } catch (err) {
    // The client falls back (a game counts its play-by-play) or says so; nothing to report.
    const reason = err instanceof UpstreamError ? err.message : err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[hosted-stats] ${url} ${reason}`);
    return NextResponse.json({ error: "upstream_failed" }, { status: 502, headers: NO_STORE });
  }
}
