import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  decodeEntities,
  decodeJsLiteral,
  hasLoadPostsInit,
  parseCategoryLinks,
  parseCompetitionLinks,
  parseCsrf,
  parseLazyLoadParam,
  parseLivewireResponse,
  parseMatchCards,
  parseMatchPage,
  parseNavState,
  parseSeasonOptions,
  parseUpdateUri,
  parseWireSnapshots,
  readJsLiteral,
} from "../profixio-html";

// Snippets cut from real profixio.com pages on 2026-10-02 (clubs and league
// names are public; the match page's players are anonymised). See the
// fixtures README for how they were produced.
const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/profixio-html/${name}`, import.meta.url)), "utf8");
const matchPage = fixture("match-page.html");
const categorySmall = fixture("category-small.html");
const categoryLarge = fixture("category-large.html");
const categoriesPage = fixture("categories-page.html");
const leaguePage = fixture("league-page.html");
const districtPage = fixture("district-page.html");
const loadPosts = JSON.parse(fixture("category-large.loadposts.json"));
const lazyLoad = JSON.parse(fixture("district-page.lazyload.json"));

describe("decodeEntities", () => {
  it("decodes the entities Blade emits inside attributes", () => {
    expect(decodeEntities("&quot;a&quot; &amp; &#039;b&#039; &lt;c&gt; &#229; &#x27;")).toBe(`"a" & 'b' <c> å '`);
    expect(decodeEntities("plain")).toBe("plain");
    expect(decodeEntities("&unknown;")).toBe("&unknown;");
  });
});

describe("Livewire bootstrap", () => {
  it("finds the CSRF token and update URI on the livewire script tag", () => {
    expect(parseCsrf(matchPage)).toBe("TESTCSRF0000000000000000000000000000");
    expect(parseUpdateUri(matchPage)).toBe("https://www.profixio.com/app/livewire/update");
    expect(parseCsrf("<html></html>")).toBeNull();
  });

  it("falls back to the csrf meta tag", () => {
    expect(parseCsrf('<meta name="csrf-token" content="META">')).toBe("META");
  });

  it("lists wire:snapshot components by name with the raw string kept verbatim", () => {
    const snaps = parseWireSnapshots(categorySmall);
    const per = snaps.find((s) => s.name === "matches.matches-per-category")!;
    expect(per).toBeDefined();
    expect(JSON.parse(per.raw).checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(per.data.klasse_id).toBe(1172071);
  });

  it("reads the Livewire nav state of a league page", () => {
    expect(parseNavState(leaguePage)).toEqual({ districtId: 749, seasonId: 763, tournamentId: 40488, leagueId: 17550 });
    expect(parseNavState("<html></html>")).toBeNull();
  });

  it("extracts the lazy-load parameter of the district competition list", () => {
    const param = parseLazyLoadParam(districtPage);
    expect(param).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(parseLazyLoadParam(categorySmall)).toBeNull();
  });

  it("recognises a category page that lazy-loads its match list", () => {
    expect(hasLoadPostsInit(categoryLarge)).toBe(true);
    expect(hasLoadPostsInit(categorySmall)).toBe(false);
  });

  it("unwraps a Livewire update response", () => {
    const res = parseLivewireResponse(loadPosts);
    expect(res?.html).toContain("listkamp_32469266");
    expect(res?.snapshot).toContain("matches.matches-per-category");
    expect(parseLivewireResponse({})).toBeNull();
    expect(parseLivewireResponse({ components: [{ effects: {} }] })).toBeNull();
  });
});

describe("JS literal decoding", () => {
  it("reads a single-quoted literal body, honouring escapes", () => {
    expect(readJsLiteral("x: 'ab\\'c', y", 3)).toEqual({ body: "ab\\'c", end: 10 });
    expect(readJsLiteral("'unterminated", 0)).toBeNull();
    expect(readJsLiteral("no quote", 0)).toBeNull();
  });

  it("decodes Blade's hex-escaped JSON literal", () => {
    expect(decodeJsLiteral("[{\\u0022a\\u0022:\\u0022O\\u0027Neil \\u0026 co\\/x\\u0022}]")).toEqual([
      { a: "O'Neil & co/x" },
    ]);
  });
});

describe("parseMatchPage", () => {
  it("extracts the inline match state", () => {
    const m = parseMatchPage(matchPage)!;
    expect(m).toBeTruthy();
    expect(m.homeWebId).toBe(1001);
    expect(m.awayWebId).toBe(1002);
    expect(m.matchPeriods).toBe(4);
    expect(m.useMatchClock).toBe(false);
    expect(m.apiUrl).toBe("https://www.profixio.com/app/api/emp/11111111/0?expires=1791038376&signature=abc");
    expect(m.events).toHaveLength(3);
    expect(m.events[0]).toMatchObject({ id: 500907, description: "Matchen är slut", stopsMatch: true });
    expect(m.lineup).toHaveLength(2);
    expect(m.lineup[0]).toMatchObject({ name: "Spelare 1", webTeamId: 1002, teamid: 2002 });
    expect(m.eventtypes).toHaveLength(2);
    expect(m.gamestate).toMatchObject({ hasResult: true });
  });

  it("returns null on a page without the component", () => {
    expect(parseMatchPage(categorySmall)).toBeNull();
  });
});

describe("parseCategoryLinks", () => {
  it("lists categories with their match counts", () => {
    expect(parseCategoryLinks(categoriesPage, 17550)).toEqual([
      { categoryId: 1172071, name: "Nivå 2A Herrar U19", matchCount: 42 },
      { categoryId: 1172072, name: "Nivå 2B Herrar U19", matchCount: 90 },
      { categoryId: 1172074, name: "Nivå 2C Herrar U19", matchCount: 120 },
      { categoryId: 9999999, name: "Utan antal", matchCount: null },
    ]);
  });

  it("ignores links of another league", () => {
    expect(parseCategoryLinks(categoriesPage, 1)).toEqual([]);
  });
});

describe("parseMatchCards", () => {
  it("parses played and upcoming cards, kickoff from the unix timestamp", () => {
    const rows = parseMatchCards(categorySmall, 17550);
    expect(rows.map((r) => r.matchId)).toEqual([32406188, 32406189, 32727043]);
    expect(rows[0]).toEqual({
      matchId: 32406188,
      kickoff: expect.stringMatching(/^2026-02-14T\d{2}:\d{2}:00Z$/),
      homeName: "Norrköping Dolphins Svart",
      awayName: "Västerås Basket P07/08",
      homeScore: 95,
      awayScore: 89,
      hasResult: true,
      hasLivescore: false,
      winner: "H",
      venue: "",
      matchUrl: "https://www.profixio.com/app/leagueid17550/match/32406188",
      homeLogo: expect.stringContaining("res.cloudinary.com/profixio"),
      awayLogo: expect.any(String),
    });
    expect(rows[1]).toMatchObject({ matchId: 32406189, homeName: "Spånga Basket", awayName: "KFUM Huddinge Basketklubb", homeScore: 76, awayScore: 87, winner: "B", kickoff: "2026-02-15T14:00:00Z" });
    expect(rows[2]).toMatchObject({ matchId: 32727043, homeName: "Stockholm Nordväst", awayName: "Sollentuna Basket", hasResult: false, homeScore: null, awayScore: null, winner: null });
    // The card's unix `timestamp` is local midnight; the time of day comes from the visible "HH:MM".
    expect(rows[2].kickoff).toMatch(/^2026-10-02T1\d:\d{2}:00Z$/);
  });

  it("parses the cards inside a loadPosts response and dedupes by id", () => {
    const first = parseMatchCards(categoryLarge, 17550);
    expect(first.map((r) => r.matchId)).toEqual([32406494]);
    const more = parseMatchCards(parseLivewireResponse(loadPosts)!.html, 17550);
    expect(more.map((r) => r.matchId).sort()).toEqual([32406494, 32469266]);
    const merged = new Map([...first, ...more].map((r) => [r.matchId, r]));
    expect(merged.size).toBe(2);
    expect(merged.get(32469266)).toMatchObject({ homeName: "Kungsholmen Svart", awayName: "Kungsholmen Vit", homeScore: 56, awayScore: 96 });
  });

  it("returns nothing for a page without cards and stays fast on a large list", () => {
    expect(parseMatchCards(categoriesPage, 17550)).toEqual([]);
    const card = categorySmall.slice(categorySmall.indexOf('<li wire:key="listkamp_32406189"'));
    const li = card.slice(0, card.indexOf("</li>") + 5);
    const big = Array.from({ length: 120 }, (_, i) => li.replace(/32406189/g, String(32400000 + i))).join("\n");
    const t0 = performance.now();
    expect(parseMatchCards(`<ul>${big}</ul>`, 17550)).toHaveLength(120);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe("district competition list", () => {
  it("lists competitions with their public league ids", () => {
    const html = parseLivewireResponse(lazyLoad)!.html;
    expect(parseCompetitionLinks(html)).toEqual([
      { leagueId: 27794, name: "Herrar Division 2" },
      { leagueId: 27800, name: "Damer Division 2" },
      { leagueId: 27817, name: "Pojkar 12 Easy Basket" },
      { leagueId: 28711, name: "Pojkar U10" },
    ]);
  });

  it("reads the season selector", () => {
    const html = parseLivewireResponse(lazyLoad)!.html;
    expect(parseSeasonOptions(html).slice(0, 3)).toEqual([
      { seasonId: 776, label: "Säsongen 26/27" },
      { seasonId: 763, label: "Säsongen 25/26" },
      { seasonId: 733, label: "Säsongen 24/25" },
    ]);
  });
});
