import { describe, expect, it } from "vitest";
import {
  availableColumns,
  cardContent,
  defaultColumns,
  fallbackText,
  formatCardDate,
  formatStat,
  normalizeColumns,
  parseCardSpec,
  pickDefaultPlayer,
  rankPlayersByClips,
  type GameStatsCard,
  type SeasonStatsCard,
} from "../stats-card";
import type { GameLine, SeasonLine } from "../stat-lines";
import type { PlayByPlayEvent } from "../../types/match";

const bigGame: GameLine = {
  min: 31 * 60 + 2, pts: 24, fgm: 9, fga: 14, tpm: 3, tpa: 5, ftm: 3, fta: 4,
  oreb: 3, dreb: 7, ast: 5, stl: 1, blk: 0, tov: 2, pf: 3, pm: 12,
};

const season: SeasonLine = {
  gp: 30, gs: 30, mpg: 31.8, ppg: 13.3, rpg: 4.7, orpg: 0.5, drpg: 4.2, apg: 2.2, spg: 1.8, bpg: 0.3,
  topg: 1.1, pfpg: 3.5, fgPct: 38.7, tpm: 64, tpa: 189, tpPct: 33.9, ftPct: 90, pmPg: -8,
};

const profixioLine: GameLine = {
  min: null, pts: 12, fgm: 5, fga: null, tpm: 2, tpa: null, ftm: 0, fta: null,
  oreb: null, dreb: null, ast: null, stl: null, blk: null, tov: null, pf: 2, pm: null,
};

function gameCard(over: Partial<GameStatsCard> = {}): GameStatsCard {
  return {
    type: "stats",
    v: 1,
    source: "genius_hosted",
    scope: "game",
    player: { id: "1693025", name: "Alva Berg", number: "7", teamId: "187005", teamName: "Bajen Basket" },
    game: {
      matchId: "m-1", sourceGameId: "2668882", competitionId: 41539, opponent: "AIK",
      date: "2026-10-12", home: true, us: 84, them: 79,
    },
    line: bigGame,
    columns: ["pts", "reb", "ast", "fg"],
    heading: null,
    details: null,
    asOf: "2026-10-17T10:00:00Z",
    ...over,
  };
}

function seasonCard(over: Partial<SeasonStatsCard> = {}): SeasonStatsCard {
  return {
    type: "stats",
    v: 1,
    source: "genius_hosted",
    scope: "season",
    player: { id: "1693025", name: "Alva Berg", number: "7", teamId: "187005", teamName: "Bajen Basket" },
    season: { competitionId: 42132, leagueId: "superettan-herr", seasonId: "2025-26", label: "Superettan Herr 2025/26" },
    line: season,
    columns: ["pts", "reb", "stl", "ftPct"],
    heading: null,
    details: null,
    asOf: "2026-10-17T10:00:00Z",
    ...over,
  };
}

describe("formatStat", () => {
  it("prints a game line the way a box score does", () => {
    const card = gameCard();
    expect(formatStat("pts", card)).toBe("24");
    expect(formatStat("reb", card)).toBe("10");
    expect(formatStat("fg", card)).toBe("9/14");
    expect(formatStat("fgPct", card)).toBe("64");
    expect(formatStat("tp", card)).toBe("3/5");
    expect(formatStat("min", card)).toBe("31");
    expect(formatStat("pm", card)).toBe("+12");
    expect(formatStat("pm", gameCard({ line: { ...bigGame, pm: -3 } }))).toBe("−3");
    expect(formatStat("eff", card)).toBe(String(24 + 10 + 5 + 1 + 0 - 5 - 1 - 2));
    expect(formatStat("gp", card)).toBeNull();
  });

  it("prints season averages to one decimal and percentages bare, as published", () => {
    const card = seasonCard();
    expect(formatStat("pts", card)).toBe("13.3");
    expect(formatStat("fgPct", card)).toBe("38.7");
    expect(formatStat("ftPct", card)).toBe("90.0");
    expect(formatStat("tpm", card)).toBe((64 / 30).toFixed(1));
    expect(formatStat("pm", card)).toBe("−8.0");
    expect(formatStat("gp", card)).toBe("30");
    expect(formatStat("fg", card)).toBeNull();
  });

  it("offers made-only columns where attempts aren't recorded, and nothing it can't fill", () => {
    const profixio = gameCard({ source: "profixio", line: profixioLine });
    expect(availableColumns(profixio)).toEqual(["pts", "fgm", "tpm", "ftm", "pf"]);
    expect(availableColumns(gameCard())).not.toContain("fgm");
    expect(availableColumns(gameCard({ line: { ...bigGame, min: null, pm: null } }))).not.toContain("min");
  });

  it("drops a percentage with no attempts", () => {
    expect(formatStat("ftPct", gameCard({ line: { ...bigGame, ftm: 0, fta: 0 } }))).toBeNull();
  });
});

describe("defaultColumns", () => {
  it("leads with points, then the stats that stand out, in card order", () => {
    // reb 10 (2× its bar), 3/5 from three, 9/14 shooting, 5 assists stand out; FT 3/4 doesn't.
    expect(defaultColumns(gameCard())).toEqual(["pts", "reb", "ast", "fg", "tp"]);
  });

  it("fills a quiet game with the usual line instead of points alone", () => {
    const quiet: GameLine = { ...bigGame, pts: 4, oreb: 0, dreb: 2, ast: 1, stl: 0, tpm: 0, tpa: 1, fgm: 2, fga: 7, fta: 0, ftm: 0 };
    expect(defaultColumns(gameCard({ line: quiet }))).toEqual(["pts", "reb", "ast"]);
  });

  it("uses made counts for Profixio games", () => {
    expect(defaultColumns(gameCard({ source: "profixio", line: profixioLine }))).toEqual(["pts", "fgm", "tpm"]);
  });

  it("picks season stats against per-game bars", () => {
    expect(defaultColumns(seasonCard())).toEqual(["pts", "reb", "stl", "ftPct"]);
  });

  it("never returns more than six columns", () => {
    const all = availableColumns(gameCard());
    expect(normalizeColumns(all, gameCard())).toHaveLength(6);
  });
});

describe("cardContent", () => {
  it("fills heading, details and context automatically", () => {
    expect(cardContent(gameCard())).toEqual({
      heading: "Alva Berg",
      details: "#7 · Bajen Basket",
      context: "vs AIK · 12 Oct 2026 · W 84–79",
      cells: [
        { value: "24", label: "PTS" },
        { value: "10", label: "REB" },
        { value: "5", label: "AST" },
        { value: "9/14", label: "FG" },
      ],
    });
  });

  it("keeps overrides; an empty details line stays empty, an empty heading falls back to the name", () => {
    const c = cardContent(gameCard({ heading: "  ", details: "" }));
    expect(c.heading).toBe("Alva Berg");
    expect(c.details).toBe("");
    expect(cardContent(gameCard({ heading: "Alva “AB” Berg", details: "Guard · Class of 2028" })).details).toBe(
      "Guard · Class of 2028",
    );
  });

  it("writes away games and unknown scores without a result", () => {
    const away = gameCard({ game: { ...gameCard().game, home: false, us: null, them: null } });
    expect(cardContent(away).context).toBe("@ AIK · 12 Oct 2026");
  });

  it("says how many games a season card averages", () => {
    expect(cardContent(seasonCard()).context).toBe("Season averages · Superettan Herr 2025/26 · 30 games");
  });

  it("formats dates from a day or a timestamp", () => {
    expect(formatCardDate("2026-01-05")).toBe("5 Jan 2026");
    expect(formatCardDate("2026-10-12T18:00:00Z")).toBe("12 Oct 2026");
  });
});

describe("fallbackText", () => {
  it("is one readable line for apps that don't draw cards", () => {
    expect(fallbackText(gameCard())).toBe("Alva Berg · 24 PTS · 10 REB · 5 AST · 9/14 FG · vs AIK");
    expect(fallbackText(seasonCard({ columns: ["pts"] }))).toBe(
      "Alva Berg · 13.3 PTS · season averages, Superettan Herr 2025/26",
    );
  });
});

describe("parseCardSpec", () => {
  it("round-trips stored game and season cards", () => {
    for (const card of [gameCard(), seasonCard()]) {
      expect(parseCardSpec(JSON.parse(JSON.stringify(card)))).toEqual(card);
    }
  });

  it("drops unknown and unfillable columns", () => {
    const raw = JSON.parse(JSON.stringify(gameCard({ columns: [] })));
    raw.columns = ["pts", "nope", "gp", "reb"];
    expect(parseCardSpec(raw)?.columns).toEqual(["pts", "reb"]);
  });

  it("returns null for anything this build can't draw", () => {
    expect(parseCardSpec(null)).toBeNull();
    expect(parseCardSpec({ ...gameCard(), v: 2 })).toBeNull();
    expect(parseCardSpec({ ...gameCard(), type: "title" })).toBeNull();
    expect(parseCardSpec({ ...gameCard(), player: { name: "x" } })).toBeNull();
    expect(parseCardSpec({ ...gameCard(), line: { ...bigGame, pts: "24" } })).toBeNull();
    expect(parseCardSpec({ ...seasonCard(), season: { label: "x" } })).toBeNull();
    expect(parseCardSpec({ ...gameCard(), scope: "career" })).toBeNull();
  });
});

describe("default player", () => {
  let id = 1;
  const clip = (playerId: number, first: string, team: string): PlayByPlayEvent => ({
    eventId: id++, type: "2pt", subType: "", period: 1, gameClockTime: "09:00", realWorldTime: "",
    isSuccessful: 1, qualifiers: [],
    player: { playerId, pno: playerId % 50, firstName: first, familyName: "Test", teamNumber: 1 },
    eventTeam: { teamCode: "", teamName: team, teamNumber: 1 },
  });

  it("ranks players by clips", () => {
    const ranked = rankPlayersByClips([clip(1, "A", "Bajen"), clip(2, "B", "AIK"), clip(2, "B", "AIK"), { ...clip(3, "C", "x"), player: null }]);
    expect(ranked.map((p) => [p.playerId, p.clips])).toEqual([["2", 2], ["1", 1]]);
    expect(ranked[0]).toMatchObject({ name: "B Test", number: "2", teamName: "AIK" });
  });

  it("breaks a tie by the space's team, then by the playing clip", () => {
    const events = [clip(1, "A", "Bajen"), clip(2, "B", "AIK")];
    expect(pickDefaultPlayer(events)?.playerId).toBe("1");
    expect(pickDefaultPlayer(events, { preferTeam: (t) => t === "AIK" })?.playerId).toBe("2");
    expect(pickDefaultPlayer(events, { activePlayerId: "2" })?.playerId).toBe("2");
    expect(pickDefaultPlayer([])).toBeNull();
  });
});
