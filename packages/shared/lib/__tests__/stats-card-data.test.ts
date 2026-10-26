import { afterEach, describe, expect, it, vi } from "vitest";
import { HOSTED_STATS_BASE, HostedLayoutError, hostedBoxScoreUrl, hostedPlayerStatsUrl } from "../hosted-stats";
import { defaultColumns, type StatKey } from "../stats-card";
import {
  createStatsCardLoader,
  hostedPageQuery,
  hostedPageSearchParams,
  hostedPageUrl,
  isHostedLayoutError,
  leagueSeasonsOf,
  makeGameCard,
  makeSeasonCard,
  parseHostedPageSearchParams,
  seasonOf,
  statsKindOf,
  type HostedLayoutReporter,
  type HostedPageFetcher,
  type HostedPageQuery,
} from "../stats-card-data";
import type { League } from "../../types/league";
import type { PlayByPlayEvent, StoredMatch } from "../../types/match";
import { HOSTED_BOXSCORE_HTML as boxHtml, HOSTED_PLAYER_STATS_HTML as seasonHtml } from "./fixtures/hosted-pages";

type Person = NonNullable<PlayByPlayEvent["player"]>;

// The fixture's box score: Home Team (900001) 1000001–1000004, Away Team
// (900002) 1000005–1000008; 1000004 and 1000008 didn't play. 27–13.
const alva: Person = { playerId: 1000003, pno: 21, firstName: "Alva", familyName: "Berg", teamNumber: 1 };
const ines: Person = { playerId: 1000007, pno: 6, firstName: "Ines", familyName: "Ek", teamNumber: 2 };

let nextId = 1;
function ev(type: string, player: Person | null, partial: Partial<PlayByPlayEvent> = {}): PlayByPlayEvent {
  return {
    eventId: nextId++,
    type,
    subType: "",
    period: 1,
    gameClockTime: "09:45",
    realWorldTime: "2026-01-10T18:05:00Z",
    isSuccessful: 1,
    player,
    eventTeam: player ? { teamCode: "", teamName: player.teamNumber === 2 ? "Away Team" : "Home Team", teamNumber: player.teamNumber } : null,
    qualifiers: [],
    ...partial,
  };
}

function game(partial: Partial<StoredMatch> = {}): StoredMatch {
  return {
    id: "m1",
    title: "Home Team – Away Team",
    date: "2026-01-10",
    homeTeam: { name: "Home Team", color: "#111111" },
    awayTeam: { name: "Away Team", color: "#eeeeee" },
    homeRoster: [],
    awayRoster: [],
    events: [ev("2pt", alva), ev("3pt", alva), ev("2pt", ines), ev("freethrow", ines, { isSuccessful: 0 })],
    leagueId: "superettan-herr",
    seasonId: "2025-26",
    sourceGameId: "2668882",
    ...partial,
  };
}

const leagues: League[] = [
  {
    id: "superettan-herr",
    name: "Superettan Herr",
    country: "SE",
    seasons: [
      { id: "2025-26", label: "2025/26", competitionId: 41539, stages: [] },
      { id: "2024-25", label: "2024/25", stages: [] },
    ],
  },
  {
    id: "profixio-stockholm-div1",
    name: "Division 1",
    country: "SE",
    provider: "profixio",
    seasons: [{ id: "2025-26", label: "2025/26", provider: "profixio", competitionId: 5, stages: [] }],
  },
];

const BOX_URL = hostedBoxScoreUrl(41539, "2668882");
const SEASON_URL = hostedPlayerStatsUrl(42132);

/** A fetcher serving the fixture pages, and the reporter, as spies. */
function setup(pages: Record<string, string> = { [BOX_URL]: boxHtml, [SEASON_URL]: seasonHtml }) {
  const fetchPage = vi.fn<HostedPageFetcher>(async (url) => {
    const html = pages[url];
    if (html === undefined) throw new Error("The stats page answered 404");
    return html;
  });
  const onLayoutError = vi.fn<HostedLayoutReporter>();
  return { fetchPage, onLayoutError, loader: createStatsCardLoader({ fetchPage, onLayoutError }) };
}

/** A promise settled by hand, for reads that overlap. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("statsKindOf", () => {
  it("knows Genius games by a numeric source id and Profixio games by their prefix", () => {
    expect(statsKindOf(game())).toBe("genius");
    expect(statsKindOf(game({ sourceGameId: "profixio:31337" }))).toBe("profixio");
  });

  it("gives older imports and missing games no stats", () => {
    expect(statsKindOf(game({ sourceGameId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed" }))).toBeNull();
    expect(statsKindOf(game({ sourceGameId: undefined }))).toBeNull();
    expect(statsKindOf(undefined)).toBeNull();
  });
});

describe("leagueSeasonsOf", () => {
  const withTwo: League[] = [
    {
      id: "superettan-herr",
      name: "Superettan Herr",
      country: "SE",
      seasons: [
        { id: "2026-27", label: "2026/27", competitionId: 48974, stages: [] },
        { id: "2025-26", label: "2025/26", competitionId: 41539, stages: [] },
        { id: "2024-25", label: "2024/25", stages: [] },
      ],
    },
    ...leagues.slice(1),
  ];

  it("lists every season of the game's league that has hosted stats, newest first", () => {
    // A clip from 2025/26: this season is there to pick too.
    expect(leagueSeasonsOf(game(), withTwo)).toEqual([
      { competitionId: 48974, leagueId: "superettan-herr", seasonId: "2026-27", label: "Superettan Herr 2026/27" },
      { competitionId: 41539, leagueId: "superettan-herr", seasonId: "2025-26", label: "Superettan Herr 2025/26" },
    ]);
  });

  it("is empty for a game with no league, an unknown league, and a Profixio league", () => {
    expect(leagueSeasonsOf(game({ leagueId: undefined }), withTwo)).toEqual([]);
    expect(leagueSeasonsOf(game({ leagueId: "nope" }), withTwo)).toEqual([]);
    expect(leagueSeasonsOf(game({ leagueId: "profixio-stockholm-div1" }), withTwo)).toEqual([]);
    expect(leagueSeasonsOf(game(), [])).toEqual([]);
  });
});

describe("seasonOf", () => {
  it("names a Genius competition the way a card prints it", () => {
    expect(seasonOf(game(), leagues)).toEqual({
      competitionId: 41539,
      leagueId: "superettan-herr",
      seasonId: "2025-26",
      label: "Superettan Herr 2025/26",
    });
  });

  it("is null without a competition, for an unknown league or season, and for Profixio", () => {
    expect(seasonOf(game({ seasonId: "2024-25" }), leagues)).toBeNull();
    expect(seasonOf(game({ seasonId: "2019-20" }), leagues)).toBeNull();
    expect(seasonOf(game(), [])).toBeNull();
    expect(seasonOf(game({ leagueId: "profixio-stockholm-div1" }), leagues)).toBeNull();
  });
});

describe("isHostedLayoutError", () => {
  it("knows the error by class and by its code", () => {
    expect(isHostedLayoutError(new HostedLayoutError("box score lacks Pts"))).toBe(true);
    expect(isHostedLayoutError(Object.assign(new Error("hosted_layout_changed: x"), { code: "hosted_layout_changed" }))).toBe(true);
    expect(isHostedLayoutError(new Error("The stats page answered 502"))).toBe(false);
    expect(isHostedLayoutError("hosted_layout_changed")).toBe(false);
  });
});

describe("loadGameStats: Profixio games", () => {
  it("counts the stored play-by-play and never asks for a page", async () => {
    const { fetchPage, loader } = setup();
    const match = game({
      sourceGameId: "profixio:31337",
      leagueId: "profixio-stockholm-div1",
      events: [ev("2pt", ines), ev("2pt", alva), ev("3pt", alva), ev("foul", ines, { subType: "personal" })],
    });
    const stats = await loader.loadGameStats(match, leagues);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(stats?.source).toBe("profixio");
    // Home team first, whatever the order of the events.
    expect(stats?.players.map((p) => [p.player, p.side])).toEqual([
      [{ id: "1000003", name: "Alva Berg", number: "21", teamId: null, teamName: "Home Team" }, "home"],
      [{ id: "1000007", name: "Ines Ek", number: "6", teamId: null, teamName: "Away Team" }, "away"],
    ]);
    expect(stats?.players[0].line).toMatchObject({ pts: 5, fgm: 2, fga: null, tpm: 1, tpa: null, pf: 0 });
    expect(stats?.players[1].line).toMatchObject({ pts: 2, pf: 1, ast: null });
    expect(stats?.score).toEqual({ home: 5, away: 2 });
  });
});

describe("loadGameStats: Genius games", () => {
  it("reads the official box score: players who played, home first, with the final score", async () => {
    const { fetchPage, onLayoutError, loader } = setup();
    const stats = await loader.loadGameStats(game(), leagues);
    expect(fetchPage).toHaveBeenCalledExactlyOnceWith(BOX_URL, false);
    expect(onLayoutError).not.toHaveBeenCalled();
    expect(stats?.source).toBe("genius_hosted");
    // 1000004 and 1000008 didn't play; 1000005 played 4:58 without scoring.
    expect(stats?.players.map((p) => [p.player.id, p.side])).toEqual([
      ["1000001", "home"],
      ["1000002", "home"],
      ["1000003", "home"],
      ["1000005", "away"],
      ["1000006", "away"],
      ["1000007", "away"],
    ]);
    expect(stats?.score).toEqual({ home: 27, away: 13 });
  });

  it("names players as our events do, else as the page prints them, with the page's shirt numbers", async () => {
    const { loader } = setup();
    const stats = await loader.loadGameStats(game(), leagues);
    const byId = new Map(stats!.players.map((p) => [p.player.id, p]));
    expect(byId.get("1000003")?.player).toEqual({ id: "1000003", name: "Alva Berg", number: "21", teamId: "900001", teamName: "Home Team" });
    expect(byId.get("1000001")?.player).toEqual({ id: "1000001", name: "P. Player01", number: "34", teamId: "900001", teamName: "Home Team" });
    expect(byId.get("1000003")?.line).toMatchObject({ min: 32 * 60 + 19, pts: 17, pm: 7 });
  });

  it("matches the tables to our teams by name, ignoring case and punctuation", async () => {
    const { loader } = setup();
    // Imported the other way round: the page's first table is our away team.
    const flipped = game({ homeTeam: { name: "AWAY team!", color: "#111111" }, awayTeam: { name: "home-team", color: "#eeeeee" } });
    const stats = await loader.loadGameStats(flipped, leagues);
    expect(stats?.players.find((p) => p.player.id === "1000003")?.side).toBe("away");
    expect(stats?.players.find((p) => p.player.id === "1000007")?.side).toBe("home");
    expect(stats?.score).toEqual({ home: 13, away: 27 });
  });

  it("takes the first table as home when no team name matches", async () => {
    const { loader } = setup();
    const renamed = game({ homeTeam: { name: "Bajen", color: "#111111" }, awayTeam: { name: "AIK", color: "#eeeeee" } });
    const stats = await loader.loadGameStats(renamed, leagues);
    expect(stats?.players.find((p) => p.player.id === "1000001")?.side).toBe("home");
    expect(stats?.players.find((p) => p.player.id === "1000005")?.side).toBe("away");
  });

  it("is null for a game with no stats, and counts events when the season isn't known", async () => {
    const { fetchPage, loader } = setup();
    expect(await loader.loadGameStats(game({ sourceGameId: undefined }), leagues)).toBeNull();
    const stats = await loader.loadGameStats(game(), []);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(stats?.source).toBe("pbp");
  });
});

describe("loadGameStats: falling back to the play-by-play", () => {
  it("counts the events when the page can't be read, and doesn't report a network failure", async () => {
    const { onLayoutError, loader } = setup({});
    const stats = await loader.loadGameStats(game(), leagues);
    expect(stats?.source).toBe("pbp");
    expect(stats?.players.map((p) => p.player.name)).toEqual(["Alva Berg", "Ines Ek"]);
    // Genius play-by-play has attempts, unlike Profixio's.
    expect(stats?.players[0].line).toMatchObject({ pts: 5, fgm: 2, fga: 2, min: null, pm: null });
    expect(stats?.players[1].line).toMatchObject({ pts: 2, fta: 1, ftm: 0 });
    expect(stats?.score).toEqual({ home: 5, away: 2 });
    expect(onLayoutError).not.toHaveBeenCalled();
  });

  it("reports a page whose layout changed, with its URL, and still fills the card from the events", async () => {
    const { onLayoutError, loader } = setup({ [BOX_URL]: "<html><body>Maintenance</body></html>" });
    const stats = await loader.loadGameStats(game(), leagues);
    expect(stats?.source).toBe("pbp");
    expect(onLayoutError).toHaveBeenCalledOnce();
    const [err, url] = onLayoutError.mock.calls[0];
    expect(err).toBeInstanceOf(HostedLayoutError);
    expect(url).toBe(BOX_URL);
  });

  it("turns a fetcher that throws outright into the same fallback", async () => {
    const loader = createStatsCardLoader({
      fetchPage: () => {
        throw new Error("offline");
      },
    });
    expect((await loader.loadGameStats(game(), leagues))?.source).toBe("pbp");
  });
});

describe("the page cache", () => {
  it("reads a page once per ten minutes, and again when asked for fresh numbers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    const { fetchPage, loader } = setup();
    await loader.loadGameStats(game(), leagues);
    vi.setSystemTime(new Date("2026-10-19T12:09:59Z"));
    await loader.loadGameStats(game(), leagues);
    expect(fetchPage).toHaveBeenCalledTimes(1);

    await loader.loadGameStats(game(), leagues, { fresh: true });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenLastCalledWith(BOX_URL, true);

    vi.setSystemTime(new Date("2026-10-19T12:20:00Z"));
    await loader.loadGameStats(game(), leagues);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenLastCalledWith(BOX_URL, false);
  });

  it("serves every player of a competition from one season page", async () => {
    const { fetchPage, loader } = setup();
    await loader.loadSeasonPlayer(42132, "2000001");
    await loader.loadSeasonPlayer(42132, "2000003");
    expect(fetchPage).toHaveBeenCalledExactlyOnceWith(SEASON_URL, false);
  });

  it("forgets a failure, so the next read tries again", async () => {
    const { fetchPage, loader } = setup();
    fetchPage.mockRejectedValueOnce(new Error("The stats page answered 503"));
    expect((await loader.loadGameStats(game(), leagues))?.source).toBe("pbp");
    expect((await loader.loadGameStats(game(), leagues))?.source).toBe("genius_hosted");
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("keeps a fresh read when an older one fails after it", async () => {
    const { fetchPage, loader } = setup();
    const slow = deferred<string>();
    fetchPage.mockReturnValueOnce(slow.promise);
    const first = loader.loadGameStats(game(), leagues);
    const fresh = await loader.loadGameStats(game(), leagues, { fresh: true });
    expect(fresh?.source).toBe("genius_hosted");
    slow.reject(new Error("timed out"));
    expect((await first)?.source).toBe("pbp");
    expect((await loader.loadGameStats(game(), leagues))?.source).toBe("genius_hosted");
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("is each loader's own", async () => {
    const a = setup();
    const b = setup();
    await a.loader.loadGameStats(game(), leagues);
    await b.loader.loadGameStats(game(), leagues);
    expect(a.fetchPage).toHaveBeenCalledTimes(1);
    expect(b.fetchPage).toHaveBeenCalledTimes(1);
  });
});

describe("loadSeasonPlayer", () => {
  it("finds the player's season line by personId", async () => {
    const { loader } = setup();
    const p = await loader.loadSeasonPlayer(42132, "2000002");
    expect(p).toMatchObject({ personId: "2000002", name: "Player 02", stints: 1 });
    expect(p?.line).toMatchObject({ gp: 28, ppg: 10.7, rpg: 5.2 });
  });

  it("is null for a player the competition doesn't list", async () => {
    const { loader } = setup();
    expect(await loader.loadSeasonPlayer(42132, "1000003")).toBeNull();
  });

  it("throws when the page can't be read, reporting only a layout change", async () => {
    const network = setup({});
    await expect(network.loader.loadSeasonPlayer(42132, "2000002")).rejects.toThrow("404");
    expect(network.onLayoutError).not.toHaveBeenCalled();

    const layout = setup({ [SEASON_URL]: seasonHtml.replaceAll(">FG%<", ">FGP<") });
    await expect(layout.loader.loadSeasonPlayer(42132, "2000002")).rejects.toBeInstanceOf(HostedLayoutError);
    expect(layout.onLayoutError).toHaveBeenCalledExactlyOnceWith(expect.any(HostedLayoutError), SEASON_URL);
  });
});

describe("loadSeasonPlayers", () => {
  it("lists every player of the competition from one page read", async () => {
    const { fetchPage, loader } = setup();
    const players = await loader.loadSeasonPlayers(42132);
    expect(fetchPage).toHaveBeenCalledExactlyOnceWith(SEASON_URL, false);
    expect([...players.keys()].sort()).toEqual(["2000001", "2000002", "2000003", "2000004"]);
    expect(players.get("2000002")?.line).toMatchObject({ gp: 28, ppg: 10.7, rpg: 5.2 });
    // A player who changed teams has both rows combined.
    expect(players.get("2000004")).toMatchObject({ stints: 2, line: { gp: 16 } });
  });

  it("parses the cached page once, and a following loadSeasonPlayer fetches nothing new", async () => {
    const { fetchPage, loader } = setup();
    const first = await loader.loadSeasonPlayers(42132);
    const again = await loader.loadSeasonPlayers(42132);
    expect(again).toBe(first);
    expect(await loader.loadSeasonPlayer(42132, "2000003")).toBe(first.get("2000003"));
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("shares one parse between overlapping reads", async () => {
    const { fetchPage, loader } = setup();
    const [a, b] = await Promise.all([loader.loadSeasonPlayers(42132), loader.loadSeasonPlayer(42132, "2000001")]);
    expect(b).toBe(a.get("2000001"));
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("re-reads and re-parses when asked for fresh numbers", async () => {
    const { fetchPage, loader } = setup();
    const stale = await loader.loadSeasonPlayers(42132);
    const fresh = await loader.loadSeasonPlayers(42132, { fresh: true });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenLastCalledWith(SEASON_URL, true);
    expect(fresh).not.toBe(stale);
    expect(fresh.get("2000002")?.line.ppg).toBe(10.7);
  });

  it("throws when the page can't be read, reporting only a layout change, and tries again next time", async () => {
    const network = setup({});
    await expect(network.loader.loadSeasonPlayers(42132)).rejects.toThrow("404");
    expect(network.onLayoutError).not.toHaveBeenCalled();

    const layout = setup({ [SEASON_URL]: seasonHtml.replaceAll(">FG%<", ">FGP<") });
    await expect(layout.loader.loadSeasonPlayers(42132)).rejects.toBeInstanceOf(HostedLayoutError);
    expect(layout.onLayoutError).toHaveBeenCalledExactlyOnceWith(expect.any(HostedLayoutError), SEASON_URL);

    const flaky = setup();
    flaky.fetchPage.mockRejectedValueOnce(new Error("The stats page answered 503"));
    await expect(flaky.loader.loadSeasonPlayers(42132)).rejects.toThrow("503");
    expect((await flaky.loader.loadSeasonPlayers(42132)).size).toBe(4);
    expect(flaky.fetchPage).toHaveBeenCalledTimes(2);
  });
});

describe("makeGameCard", () => {
  it("builds the card from the player's side of the game", async () => {
    const { loader } = setup();
    const match = game();
    const stats = (await loader.loadGameStats(match, leagues))!;
    const home = makeGameCard(match, stats, stats.players.find((p) => p.player.id === "1000003")!, 41539);
    expect(home).toMatchObject({
      type: "stats",
      v: 1,
      source: "genius_hosted",
      scope: "game",
      player: { id: "1000003", name: "Alva Berg" },
      game: { matchId: "m1", sourceGameId: "2668882", competitionId: 41539, opponent: "Away Team", date: "2026-01-10", home: true, us: 27, them: 13 },
      heading: null,
      details: null,
    });
    expect(home.columns).toEqual(defaultColumns(home));
    expect(Number.isNaN(Date.parse(home.asOf))).toBe(false);

    const away = makeGameCard(match, stats, stats.players.find((p) => p.player.id === "1000007")!, null);
    expect(away.game).toMatchObject({ opponent: "Home Team", home: false, us: 13, them: 27, competitionId: null });
  });

  it("keeps the overrides, and hand-picked columns while the new line has them", async () => {
    const { loader } = setup();
    const match = game();
    const stats = (await loader.loadGameStats(match, leagues))!;
    const option = stats.players.find((p) => p.player.id === "1000003")!;
    const kept = makeGameCard(match, stats, option, 41539, { heading: "Player of the game", details: "#21", columns: ["pm", "pts", "pts", "min"] });
    expect(kept.heading).toBe("Player of the game");
    expect(kept.details).toBe("#21");
    expect(kept.columns).toEqual(["pts", "min", "pm"]); // card order, once each
    // None of these exist on a game line, so the defaults apply.
    const fresh = makeGameCard(match, stats, option, 41539, { columns: ["gp"] as StatKey[] });
    expect(fresh.columns).toEqual(defaultColumns(fresh));
  });
});

describe("makeSeasonCard", () => {
  it("builds a season card from the official page", async () => {
    const { loader } = setup();
    const seasonPlayer = (await loader.loadSeasonPlayer(42132, "2000002"))!;
    const season = { competitionId: 42132, leagueId: "superettan-herr", seasonId: "2025-26", label: "Superettan Herr 2025/26" };
    const player = { id: "2000002", name: "Player 02", number: "9", teamId: null, teamName: "Home Team" };
    const card = makeSeasonCard(season, player, seasonPlayer, { heading: "Season so far", columns: ["gp", "pts"] });
    expect(card).toMatchObject({ source: "genius_hosted", scope: "season", season, player, heading: "Season so far", details: null });
    expect(card.line).toEqual(seasonPlayer.line);
    expect(card.columns).toEqual(["pts", "gp"]);
    expect(makeSeasonCard(season, player, seasonPlayer).columns).toEqual(defaultColumns(card));
  });
});

describe("hosted page queries (the web's /api/hosted-stats)", () => {
  const box: HostedPageQuery = { kind: "box", competitionId: 41539, matchId: "2668882" };
  const players: HostedPageQuery = { kind: "players", competitionId: 42132 };

  it("round-trips the loader's URLs through a route's search params", () => {
    for (const [url, query] of [[BOX_URL, box], [SEASON_URL, players]] as const) {
      expect(hostedPageQuery(url)).toEqual(query);
      expect(hostedPageUrl(query)).toBe(url);
      for (const fresh of [false, true]) {
        const params = hostedPageSearchParams(query, fresh);
        expect(parseHostedPageSearchParams(new URLSearchParams(params.toString()))).toEqual({ query, fresh });
      }
    }
    expect(hostedPageSearchParams(box, true).toString()).toBe("kind=box&competition=41539&match=2668882&fresh=1");
    expect(hostedPageSearchParams(players).toString()).toBe("kind=players&competition=42132");
  });

  it("knows only the two page URLs the loader builds", () => {
    for (const url of [
      `${BOX_URL}/`,
      `${BOX_URL}?x=1`,
      BOX_URL.replace("https:", "http:"),
      BOX_URL.replace("hosted.dcd.shared.geniussports.com", "evil.example"),
      `${HOSTED_STATS_BASE}/competition/41539/match/2668882/playbyplay`,
      `${HOSTED_STATS_BASE}/competition/0/statistics/player`,
      `${HOSTED_STATS_BASE}/competition/abc/statistics/player`,
      "https://example.com/",
    ]) {
      expect(hostedPageQuery(url), url).toBeNull();
    }
  });

  it("refuses search params that aren't one of the two pages by number", () => {
    for (const qs of [
      "",
      "kind=boxscore&competition=1&match=2",
      "kind=box&competition=41539",
      "kind=box&competition=abc&match=2668882",
      "kind=box&competition=0&match=2668882",
      "kind=box&competition=-1&match=2668882",
      "kind=box&competition=1e3&match=2668882",
      "kind=box&competition=%2041539&match=2668882",
      "kind=box&competition=1234567890&match=2668882",
      "kind=box&competition=41539&match=12a",
      "kind=box&competition=41539&match=1%2F..%2F..%2Fevil",
      "kind=box&competition=41539&match=1234567890123456",
      "kind=players&competition=42132&match=2668882",
      "kind=players&competition=https%3A%2F%2Fevil.example",
      "kind=players&competition=42132&fresh=yes",
    ]) {
      expect(parseHostedPageSearchParams(new URLSearchParams(qs)), qs).toBeNull();
    }
    expect(parseHostedPageSearchParams(new URLSearchParams("kind=players&competition=42132&fresh=0"))).toEqual({ query: players, fresh: false });
  });

  it("builds every URL from the numbers under the federation's base", () => {
    const asked = parseHostedPageSearchParams(new URLSearchParams("kind=box&competition=7&match=0042"))!;
    expect(hostedPageUrl(asked.query)).toBe(`${HOSTED_STATS_BASE}/competition/7/match/0042/boxscore`);
  });
});
