/**
 * Pure extractors for Profixio's public pages (Laravel Livewire v3 + Alpine).
 *
 * Imported by the `profixio` edge function (Deno) through a relative path and
 * unit-tested with vitest against saved page snippets, so: no imports except
 * types, no DOM (neither runtime has DOMParser), regex/string work only, and
 * every regex linear (`[^"]*`, `[^<]*`, or `[\s\S]*?` bounded by a literal).
 *
 * Page facts these rely on (verified 2026-10-02):
 *   - Livewire bootstrap: `<script src=…/livewire.min.js data-csrf="…"
 *     data-update-uri="…/app/livewire/update">`; also `<meta name="csrf-token">`.
 *   - Every component root carries `wire:snapshot` (HTML-escaped JSON with
 *     `memo.name`, `data`, `checksum`) — passed back VERBATIM in update calls.
 *   - The match page inlines an Alpine component in `wire:effects.scripts`
 *     whose fields are `key: JSON.parse('…')` where the literal is JSON text
 *     escaped as a JS string: every `"` is `\u0022`, `/` is `\/`, `&` is
 *     `\u0026`, `'` is `\u0027`.
 *   - Category pages render `<li wire:key="listkamp_{matchId}">` cards whose
 *     Alpine `x-data` carries `homegoals/awaygoals/hasResult/winner/timestamp`;
 *     `timestamp` is LOCAL MIDNIGHT of the match day (unix UTC), the time of
 *     day is a visible "HH:MM" text; team names sit in the divs whose `:class`
 *     tests `winner == 'H'` / `'B'`.
 */
// Structural twins of the wire types (profixio-wire.ts) so this file stays
// import-free for the Deno bundler.
type CategoryRow = { categoryId: number; name: string; matchCount: number | null };
type ScheduleRow = {
  matchId: number;
  kickoff: string;
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
  hasResult: boolean;
  hasLivescore: boolean;
  winner: "H" | "B" | null;
  venue: string;
  matchUrl: string;
  homeLogo: string;
  awayLogo: string;
};

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

export function decodeEntities(s: string): string {
  return s.replace(/&(quot|amp|lt|gt|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === "quot") return '"';
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "apos") return "'";
    if (k === "nbsp") return " ";
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return m;
  });
}

/** Visible text of an HTML fragment: comments and tags removed, entities decoded, whitespace collapsed. */
export function textOf(fragment: string): string {
  return decodeEntities(fragment.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function posInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Livewire bootstrap
// ---------------------------------------------------------------------------

/** The CSRF token Livewire posts back as `_token`. */
export function parseCsrf(html: string): string | null {
  return (
    html.match(/data-csrf="([^"]+)"/)?.[1] ??
    html.match(/<meta name="csrf-token" content="([^"]+)"/)?.[1] ??
    null
  );
}

export function parseUpdateUri(html: string): string | null {
  return html.match(/data-update-uri="([^"]+)"/)?.[1] ?? null;
}

export interface WireSnapshot {
  /** The attribute value, HTML-unescaped — what Livewire wants back verbatim. */
  raw: string;
  name: string;
  /** `data` with Livewire's `[value, meta]` tuples unwrapped one level. */
  data: Record<string, unknown>;
}

function unwrapTuple(v: unknown): unknown {
  if (Array.isArray(v) && v.length === 2 && typeof v[1] === "object" && v[1] !== null && "s" in (v[1] as object)) {
    return v[0];
  }
  return v;
}

/** Every `wire:snapshot` on the page, decoded; pick one by `memo.name`. */
export function parseWireSnapshots(html: string): WireSnapshot[] {
  const out: WireSnapshot[] = [];
  for (const m of html.matchAll(/wire:snapshot="([^"]*)"/g)) {
    const raw = decodeEntities(m[1]);
    try {
      const j = JSON.parse(raw) as { memo?: { name?: unknown }; data?: unknown };
      const data: Record<string, unknown> = {};
      if (j.data && typeof j.data === "object" && !Array.isArray(j.data)) {
        for (const [k, v] of Object.entries(j.data as Record<string, unknown>)) data[k] = unwrapTuple(v);
      }
      out.push({ raw, name: String(j.memo?.name ?? ""), data });
    } catch {
      // not a snapshot we can read — skip
    }
  }
  return out;
}

export interface NavState {
  districtId: number | null;
  seasonId: number | null;
  tournamentId: number | null;
  leagueId: number | null;
}

/** The old-style league page's navigation state: district, season, tournament and league ids. */
export function parseNavState(html: string): NavState | null {
  const nav = parseWireSnapshots(html).find((s) => s.name === "league.navigation-menu");
  if (!nav) return null;
  return {
    districtId: posInt(nav.data.district_id),
    seasonId: posInt(nav.data.sesong_id),
    tournamentId: posInt(nav.data.turnering_id),
    leagueId: posInt(nav.data.avd_id),
  };
}

/** The base64 argument of `x-intersect="$wire.__lazyLoad('…')"` (lazy district competition list). */
export function parseLazyLoadParam(html: string): string | null {
  return html.match(/\$wire\.__lazyLoad\((?:'|&#0?39;|&quot;)([A-Za-z0-9+/=]+)(?:'|&#0?39;|&quot;)\)/)?.[1] ?? null;
}

/** A category page that only rendered part of its match list and loads the rest via Livewire. */
export function hasLoadPostsInit(html: string): boolean {
  return /wire:init="loadPosts"/.test(html);
}

/** `POST /livewire/update` → the rendered HTML and the new snapshot of the first component. */
export function parseLivewireResponse(json: unknown): { html: string; snapshot: string } | null {
  const c = (json as { components?: Array<{ snapshot?: unknown; effects?: { html?: unknown } }> })
    ?.components?.[0];
  const html = c?.effects?.html;
  if (typeof html !== "string") return null;
  return { html, snapshot: typeof c?.snapshot === "string" ? c.snapshot : "" };
}

// ---------------------------------------------------------------------------
// Inline JS state (match page)
// ---------------------------------------------------------------------------

/** Read a single-quoted JS string literal starting at `src[start] === "'"`; the body keeps its escapes. */
export function readJsLiteral(src: string, start: number): { body: string; end: number } | null {
  if (src[start] !== "'") return null;
  let i = start + 1;
  let body = "";
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      body += ch + (src[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (ch === "'") return { body, end: i + 1 };
    body += ch;
    i++;
  }
  return null;
}

/** JS-string-decode a literal body (`\u0022`, `\/`, `\\`, `\'`) to its text. */
function decodeJsString(body: string): string {
  const escaped = body.replace(/\\'/g, "'").replace(/"/g, '\\"');
  try {
    return JSON.parse('"' + escaped + '"') as string;
  } catch {
    return body.replace(/\\'/g, "'");
  }
}

/** Body of a Blade-emitted `JSON.parse('…')` literal → parsed value. */
export function decodeJsLiteral(body: string): unknown {
  return JSON.parse(decodeJsString(body));
}

/** All `<script>` sources carried in `wire:effects.scripts` on the page. */
export function parseWireEffectsScripts(html: string): string {
  const parts: string[] = [];
  for (const m of html.matchAll(/wire:effects="([^"]*)"/g)) {
    try {
      const fx = JSON.parse(decodeEntities(m[1])) as { scripts?: Record<string, unknown> };
      for (const v of Object.values(fx?.scripts ?? {})) parts.push(String(v));
    } catch {
      // not an effects blob we can read — skip
    }
  }
  return parts.join("\n");
}

/** `key: JSON.parse('…')`, `key: '…'`, or `key: <scalar>` inside an Alpine component source. */
export function readAlpineField(src: string, key: string): unknown {
  const m = new RegExp(`\\b${key}:\\s*`).exec(src);
  if (!m) return undefined;
  const at = m.index + m[0].length;
  if (src.startsWith("JSON.parse('", at)) {
    const lit = readJsLiteral(src, at + "JSON.parse(".length);
    if (!lit) return undefined;
    try {
      return decodeJsLiteral(lit.body);
    } catch {
      return undefined;
    }
  }
  if (src[at] === "'") {
    const lit = readJsLiteral(src, at);
    return lit ? decodeJsString(lit.body) : undefined;
  }
  const scalar = src.slice(at, at + 40).match(/^(true|false|null|-?\d+(?:\.\d+)?)/)?.[1];
  return scalar === undefined ? undefined : (JSON.parse(scalar) as unknown);
}

export interface InlineMatchState {
  events: Array<Record<string, unknown>>;
  lineup: Array<Record<string, unknown>>;
  eventtypes: Array<Record<string, unknown>>;
  gamestate: Record<string, unknown> | null;
  homeWebId: number | null;
  awayWebId: number | null;
  matchPeriods: number;
  useMatchClock: boolean;
  /** Laravel-signed `/app/api/emp/{id}/0?expires=…&signature=…`, valid ~24 h. */
  apiUrl: string | null;
}

/** The match page's inline state, or null when the page carries none. */
export function parseMatchPage(html: string): InlineMatchState | null {
  const src = parseWireEffectsScripts(html);
  if (!src) return null;
  const events = readAlpineField(src, "events");
  const eventtypes = readAlpineField(src, "eventtypes");
  if (!Array.isArray(events) || !Array.isArray(eventtypes)) return null;
  const lineup = readAlpineField(src, "lineup");
  const gamestate = readAlpineField(src, "gamestate");
  const periods = readAlpineField(src, "matchPeriods");
  const apiUrl = readAlpineField(src, "apiurl");
  return {
    events: events as Array<Record<string, unknown>>,
    lineup: Array.isArray(lineup) ? (lineup as Array<Record<string, unknown>>) : [],
    eventtypes: eventtypes as Array<Record<string, unknown>>,
    gamestate: gamestate && typeof gamestate === "object" ? (gamestate as Record<string, unknown>) : null,
    homeWebId: posInt(readAlpineField(src, "homewebid")),
    awayWebId: posInt(readAlpineField(src, "awaywebid")),
    matchPeriods: posInt(periods) ?? 4,
    useMatchClock: readAlpineField(src, "useMatchClock") === true,
    apiUrl: typeof apiUrl === "string" && apiUrl ? apiUrl : null,
  };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/** `…/leagueid{L}/categories` → categories with their match counts ("Nivå 2A Herrar U19 42 matcher"). */
export function parseCategoryLinks(html: string, leagueId: number): CategoryRow[] {
  const re = new RegExp(
    `<a[^>]+href="[^"]*/leagueid${leagueId}/category/(\\d+)"[^>]*>([\\s\\S]*?)</a>`,
    "g",
  );
  const out = new Map<number, CategoryRow>();
  for (const m of html.matchAll(re)) {
    const categoryId = Number(m[1]);
    if (out.has(categoryId)) continue;
    const text = textOf(m[2]);
    const count = text.match(/(\d+)\s+matcher$/i);
    out.set(categoryId, {
      categoryId,
      name: count ? text.slice(0, count.index).trim() : text,
      matchCount: count ? Number(count[1]) : null,
    });
  }
  return [...out.values()];
}

/** District competition list (lazy-loaded HTML) → public league ids and names. */
export function parseCompetitionLinks(html: string): Array<{ leagueId: number; name: string }> {
  const out = new Map<number, { leagueId: number; name: string }>();
  for (const m of html.matchAll(/<a[^>]+href="[^"]*lx\/competition\/leagueid(\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const leagueId = Number(m[1]);
    if (out.has(leagueId)) continue;
    const name = textOf(m[2]);
    if (name) out.set(leagueId, { leagueId, name });
  }
  return [...out.values()];
}

/** The season `<select>` in the competition list → ids and labels, in page order. */
export function parseSeasonOptions(html: string): Array<{ seasonId: number; label: string }> {
  const out: Array<{ seasonId: number; label: string }> = [];
  for (const m of html.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)<\/option>/g)) {
    const label = textOf(m[2]);
    if (label) out.push({ seasonId: Number(m[1]), label });
  }
  return out;
}

/**
 * Match cards of an old-style category page (or of a `loadPosts` response).
 * Kickoff = the card's `timestamp` (local midnight, unix UTC) plus its visible
 * "HH:MM" time of day — exact except on the two DST switch days.
 */
export function parseMatchCards(html: string, leagueId: number): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  const chunks = html.split(/(?=<li[^>]*wire:key="listkamp_\d+")/);
  for (const chunk of chunks) {
    const id = chunk.match(/^<li[^>]*wire:key="listkamp_(\d+)"/)?.[1];
    if (!id) continue;
    const x = decodeEntities(chunk.match(/x-data="([^"]*)"/)?.[1] ?? "");
    const ts = Number(x.match(/\btimestamp:\s*(\d+)/)?.[1]);
    if (!Number.isFinite(ts)) continue;
    const str = (k: string) => x.match(new RegExp(`\\b${k}:\\s*'([^']*)'`))?.[1] ?? null;
    const flag = (k: string) => x.match(new RegExp(`\\b${k}:\\s*(true|false)`))?.[1] === "true";
    const name = (side: "H" | "B") =>
      textOf(
        chunk.match(
          new RegExp(`:class="\\{\\s*'font-bold':\\s*winner\\s*==\\s*'${side}'\\s*\\}"[^>]*>([\\s\\S]*?)</div>`),
        )?.[1] ?? "",
      );
    const time = chunk.match(/>\s*(\d{1,2}):(\d{2})\s*</);
    const offset = time ? Number(time[1]) * 3600 + Number(time[2]) * 60 : 0;
    const logos = [...chunk.matchAll(/<img[^>]+src=['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const hasResult = flag("hasResult");
    const winner = str("winner");
    rows.push({
      matchId: Number(id),
      kickoff: new Date((ts + offset) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      homeName: name("H"),
      awayName: name("B"),
      homeScore: hasResult ? Number(str("homegoals")) : null,
      awayScore: hasResult ? Number(str("awaygoals")) : null,
      hasResult,
      hasLivescore: flag("hasLivescore"),
      winner: winner === "H" || winner === "B" ? winner : null,
      venue: "",
      matchUrl: `https://www.profixio.com/app/leagueid${leagueId}/match/${id}`,
      homeLogo: logos[0] ?? "",
      awayLogo: logos[1] ?? "",
    });
  }
  return rows.sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.matchId - b.matchId);
}
