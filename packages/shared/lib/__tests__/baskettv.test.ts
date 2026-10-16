import { describe, expect, it } from "vitest";
import {
  LEAGUE_CHANNELS,
  MAX_ATTEMPTS,
  MAX_NOT_FOUND_ATTEMPTS,
  PILOT_CHANNELS,
  SETTLE_S,
  gameUrl,
  selectGamesToProcess,
  toGame,
  type BaskettvGame,
  type BaskettvPastGame,
  type RecordedRun,
} from "../baskettv";

// Trimmed from a real past_games item (Cross Over – Sollentuna, 2026-10-04).
const raw: BaskettvPastGame = {
  slug: "bx7z4omn",
  title: "Cross Over Basketball Academy Club - Sollentuna Basket",
  start_at: 1791113400,
  end_at: 1791120924,
  is_replay: true,
  has_livestream: true,
  home_score: 67,
  away_score: 85,
  event: { name: "Herrar - Superettan Herr" },
  home_team: { name: "Cross Over Basketball Academy Club" },
  away_team: { name: "Sollentuna Basket" },
};

describe("toGame", () => {
  it("keeps what the job needs from a past_games item", () => {
    expect(toGame(raw, "superettanherr")).toEqual({
      slug: "bx7z4omn",
      channel: "superettanherr",
      league: "Herrar - Superettan Herr",
      homeTeam: "Cross Over Basketball Academy Club",
      awayTeam: "Sollentuna Basket",
      score: "67-85",
      startAt: 1791113400,
      endAt: 1791120924,
      isReplay: true,
    });
  });

  it("tolerates missing scores and teams", () => {
    const g = toGame({ ...raw, home_score: null, away_score: null, home_team: null, away_team: null, event: null }, "superettanherr");
    expect(g).toMatchObject({ score: null, homeTeam: null, awayTeam: null, league: null });
  });
});

describe("selectGamesToProcess", () => {
  const now = 1791200000; // 2026-10-05 11:33 UTC
  const game = (slug: string, startAt: number, extra: Partial<BaskettvGame> = {}): BaskettvGame => ({
    slug,
    channel: "superettanherr",
    league: "Herrar - Superettan Herr",
    homeTeam: "A",
    awayTeam: "B",
    score: "1-0",
    startAt,
    endAt: startAt + 7500,
    isReplay: true,
    ...extra,
  });
  const recorded = (entries: [string, RecordedRun][]) => new Map(entries);

  it("keeps finished replays newest first, within the window, up to max", () => {
    const games = [game("old", now - 10 * 86400), game("b", now - 86400), game("a", now - 3600 * 5), game("c", now - 2 * 86400)];
    const picked = selectGamesToProcess(games, { nowTs: now, sinceTs: now - 3 * 86400, recorded: recorded([]), max: 2 });
    expect(picked.map((g) => g.slug)).toEqual(["a", "b"]);
  });

  it("waits until a replay exists and the game has settled", () => {
    const games = [
      game("live", now - 3600, { isReplay: false }),
      game("just-ended", now - 7500 - 60, { endAt: now - 60 }),
      game("settled", now - 7500 - SETTLE_S - 1, { endAt: now - SETTLE_S - 1 }),
      game("no-end", now - 4 * 3600, { endAt: null }),
    ];
    const picked = selectGamesToProcess(games, { nowTs: now, sinceTs: now - 86400, recorded: recorded([]), max: 10 });
    expect(picked.map((g) => g.slug)).toEqual(["settled", "no-end"]);
  });

  it("skips games already recorded, retries failures a few times and a not-found once", () => {
    // Model readings are not deterministic: a game found on one pass can come back
    // "not found" on another, so one more look is worth $0.08.
    const games = [game("done", now - 3600 * 6), game("none", now - 3600 * 7), game("none2", now - 3600 * 7.5), game("late", now - 3600 * 8), game("flaky", now - 3600 * 9), game("hopeless", now - 3600 * 10)];
    const rec = recorded([
      ["done", { status: "found", attempts: 1 }],
      ["none", { status: "not_found", attempts: 1 }],
      ["none2", { status: "not_found", attempts: MAX_NOT_FOUND_ATTEMPTS }],
      ["late", { status: "starts_after_tipoff", attempts: 1 }],
      ["flaky", { status: "failed", attempts: MAX_ATTEMPTS - 1 }],
      ["hopeless", { status: "failed", attempts: MAX_ATTEMPTS }],
    ]);
    const picked = selectGamesToProcess(games, { nowTs: now, sinceTs: now - 86400, recorded: rec, max: 10 });
    expect(picked.map((g) => g.slug)).toEqual(["none", "flaky"]);
  });

  it("processes exactly the requested games when `only` is given, even if recorded or old", () => {
    const games = [game("x", now - 30 * 86400), game("y", now - 3600 * 6), game("z", now - 3600 * 7)];
    const rec = recorded([["x", { status: "found", attempts: 1 }]]);
    const picked = selectGamesToProcess(games, { nowTs: now, sinceTs: now - 86400, recorded: rec, only: ["z", "x", "missing"], max: 10 });
    expect(picked.map((g) => g.slug)).toEqual(["z", "x"]);
  });

  it("dedupes a slug that appears on two pages", () => {
    const games = [game("dup", now - 3600 * 6), game("dup", now - 3600 * 6)];
    expect(selectGamesToProcess(games, { nowTs: now, sinceTs: now - 86400, recorded: recorded([]), max: 10 })).toHaveLength(1);
  });
});

describe("channels and links", () => {
  it("maps the three leagues to their BasketTV channels and pilots only Superettan Herr", () => {
    expect(LEAGUE_CHANNELS["Herrar - Superettan Herr"]).toBe("superettanherr");
    expect(LEAGUE_CHANNELS["Herrar - Basketettan Herr"]).toBe("basketettan-herr");
    expect(LEAGUE_CHANNELS["Damer - Basketettan Dam"]).toBe("basketettan-dam");
    expect(PILOT_CHANNELS).toEqual(["superettanherr"]);
  });

  it("builds the public game page link on the league channel", () => {
    expect(gameUrl("superettanherr", "bx7z4omn")).toBe("https://baskettv.se/superettanherr/games/g/bx7z4omn");
  });
});
