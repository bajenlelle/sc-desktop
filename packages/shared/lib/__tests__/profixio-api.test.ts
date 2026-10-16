import { describe, expect, it } from "vitest";
import {
  composeCatalog,
  groupTournaments,
  mapApiCategories,
  mapApiEvent,
  mapApiLineup,
  mapApiScheduleRow,
  mapApiTournament,
  sortEvents,
  type ProfixioMatchResponse,
} from "../profixio-wire";
import {
  buildProfixioRosters,
  categoriesToStages,
  findProfixioSyncAnchor,
  normalizeProfixioEvents,
  resolveSides,
} from "../profixio";
import userinfo from "./fixtures/profixio-api/userinfo.json";
import tournaments from "./fixtures/profixio-api/tournaments.json";
import categoriesBody from "./fixtures/profixio-api/match-categories-52949.json";
import matchesBody from "./fixtures/profixio-api/matches-52949-1184312.json";
import matchBody from "./fixtures/profixio-api/match-32727010.json";
import eventsBody from "./fixtures/profixio-api/events-32727010.json";
import lineupBody from "./fixtures/profixio-api/lineup-32727010.json";

// Real responses from Profixio's documented API (2026-10-16), anonymised:
// player, staff, referee and table-official names and person ids are fake,
// birth dates are all 2000-01-01, contact details removed. Clubs, venues,
// ids of tournaments/matches/teams, scores and timestamps are real.
// Match 32727010: Sollentuna Basket 90–98 KFUM Blackebergs IK Röd, Herrar U19
// Nivå 1, Stockholm, 2026-09-11.

const HOME = 1582934;
const AWAY = 1586471;

const summaries = tournaments
  .map((t) => mapApiTournament(t, t.id))
  .filter((t) => t != null);

describe("accessible tournaments → catalogue", () => {
  it("lists exactly the tournaments the key may view", () => {
    const granted = userinfo.permissions.organisations[0].specificTournaments.map((g) => g.tournamentId).sort();
    expect(summaries.map((s) => s.tournamentId).sort()).toEqual(granted);
    expect(summaries).toHaveLength(17);
  });

  it("names a league by league.name, not the prefixed tournament name", () => {
    const vastra = summaries.find((s) => s.tournamentId === 53107)!;
    expect(vastra).toEqual({
      tournamentId: 53107,
      leagueId: 27851,
      name: "Herrar Division 2",
      districtId: 754,
      districtName: "Westra Sveriges BDF",
      seasonId: 776,
      seasonLabel: "Säsongen 26/27",
    });
  });

  it("groups by district, national tournaments under district 0", () => {
    const rows = groupTournaments(summaries);
    expect(rows.map((r) => [r.districtId, r.districtName, r.leagues.length]).sort()).toEqual([
      [0, "Ungdoms-SM", 5],
      [748, "Östsvenska BDF", 1],
      [749, "Stockholms BDF", 5],
      [751, "Norrbottens BDF", 1],
      [752, "Skånes BDF", 2],
      [754, "Westra Sveriges BDF", 3],
    ]);
    expect(rows.every((r) => r.leagues.every((l) => l.tournamentId && l.tournamentId > 0))).toBe(true);
  });

  it("composes one picker league per tournament, keeping the tournament id on the season", () => {
    const leagues = composeCatalog(groupTournaments(summaries));
    expect(leagues).toHaveLength(17);
    const u19 = leagues.find((l) => l.id === "profixio-749-herrar-u19")!;
    expect(u19).toMatchObject({ name: "Herrar U19", region: "Stockholms BDF", gender: "men", provider: "profixio" });
    expect(u19.seasons).toEqual([
      { id: "2026-27", label: "2026/27", provider: "profixio", profixio: { leagueId: 27804, seasonId: 776, tournamentId: 52949 } },
    ]);
    expect(leagues.find((l) => l.id === "profixio-0-pojkar-u16-sm")).toMatchObject({ region: "Ungdoms-SM" });
  });

  it("skips a cancelled tournament or one without a league", () => {
    expect(mapApiTournament({ ...tournaments[0], isCancelled: true }, 1)).toBeNull();
    expect(mapApiTournament({ id: 1, name: "x" }, 1)).toBeNull();
  });
});

describe("categories", () => {
  it("labels categories by level and counts their matches", () => {
    const cats = mapApiCategories(categoriesBody.data, matchesBody.data);
    expect(cats).toEqual([
      { categoryId: 1184312, name: "Nivå 1", matchCount: 153 },
      { categoryId: 1184313, name: "Nivå 2 Blå", matchCount: 0 },
      { categoryId: 1184314, name: "Nivå 2 Gul", matchCount: 0 },
      { categoryId: 1184315, name: "Nivå 2 Vit", matchCount: 0 },
    ]);
    // Empty categories (here: not in the fixture's match list) stay out of the dropdown.
    expect(categoriesToStages(cats, "Herrar U19").map((s) => s.label)).toEqual(["Nivå 1"]);
  });
});

describe("schedule", () => {
  const rows = matchesBody.data.map((m) => mapApiScheduleRow(m, 27804));

  it("marks played games and leaves unplayed ones without a score", () => {
    expect(rows).toHaveLength(153);
    expect(rows.filter((r) => r.hasResult)).toHaveLength(42);
    const unplayed = rows.find((r) => !r.hasResult)!;
    expect(unplayed.homeScore).toBeNull();
    expect(unplayed.awayScore).toBeNull();
    expect(unplayed.winner).toBeNull();
  });

  it("maps a played game's score, winner, kickoff and venue", () => {
    expect(rows.find((r) => r.matchId === 32727010)).toEqual({
      matchId: 32727010,
      kickoff: "2026-09-11T17:30:00Z",
      homeName: "Sollentuna Basket",
      awayName: "KFUM Blackebergs IK Röd",
      homeScore: 90,
      awayScore: 98,
      hasResult: true,
      hasLivescore: false,
      winner: "B",
      venue: "Töjna sporthall",
      matchUrl: "https://www.profixio.com/app/leagueid27804/match/32727010",
      homeLogo: "",
      awayLogo: "",
    });
  });
});

describe("lineup", () => {
  const lineup = mapApiLineup(lineupBody, { homeTeamId: HOME, awayTeamId: AWAY });

  it("flattens both sides' players and staff with each side's team id", () => {
    expect(lineup).toHaveLength(9 + 1 + 12 + 2);
    expect(lineup.filter((r) => r.webTeamId === HOME && r.type === "player")).toHaveLength(9);
    expect(lineup.filter((r) => r.webTeamId === AWAY && r.type === "staff")).toHaveLength(2);
    expect(lineup[0]).toMatchObject({ webTeamId: HOME, teamRegistrationId: HOME, type: "player", name: "Spelare 1" });
  });

  it("keeps no birth dates, positions, referees or table officials", () => {
    const json = JSON.stringify(lineup);
    expect(json).not.toMatch(/birthDate|position|isCaptain|2000-01-01/);
    expect(json).not.toMatch(/Domare|Funktionär/);
    for (const row of lineup) {
      expect(Object.keys(row).sort()).toEqual(
        ["foulCount", "name", "number", "personId", "played", "starter", "teamRegistrationId", "type", "webTeamId"],
      );
    }
  });

  it("is empty for a body without sides (403 before lineupAvailableFrom)", () => {
    expect(mapApiLineup({ message: "Lineup not available yet" }, { homeTeamId: HOME, awayTeamId: AWAY })).toEqual([]);
  });
});

describe("a whole match through the normaliser", () => {
  const events = sortEvents(eventsBody.data.map(mapApiEvent));
  const lineup = mapApiLineup(lineupBody, { homeTeamId: HOME, awayTeamId: AWAY });
  const schedule = mapApiScheduleRow(matchBody.data, 27804);
  const m: ProfixioMatchResponse = {
    schemaVersion: 2,
    leagueId: 27804,
    categoryId: 1184312,
    matchId: 32727010,
    schedule,
    homeWebId: HOME,
    awayWebId: AWAY,
    matchPeriods: matchBody.data.periodInfo.numberOfPeriods,
    useMatchClock: false,
    state: "full_time",
    final: true,
    eventTypes: [],
    events,
    lineup,
    pbpStatus: "ok",
    source: "api",
    fetchedAt: "2026-10-16T12:00:00Z",
  };
  const ctx = { homeName: "Sollentuna Basket", awayName: "KFUM Blackebergs IK Röd" };

  it("maps every event and keeps the sides as the match states them", () => {
    expect(events).toHaveLength(157);
    expect(new Set(events.filter((e) => e.teamId != null).map((e) => e.teamId))).toEqual(new Set([HOME, AWAY]));
    expect(resolveSides(m)).toEqual({ homeWebId: HOME, awayWebId: AWAY });
  });

  it("produces clips whose running score reaches the final 90–98", () => {
    const normalized = normalizeProfixioEvents(m, ctx);
    expect(normalized.length).toBeGreaterThan(100);
    expect(Math.max(...normalized.map((e) => e.scoreHome ?? 0))).toBe(90);
    expect(Math.max(...normalized.map((e) => e.scoreAway ?? 0))).toBe(98);
    // Players are linked through the lineup's person ids.
    expect(normalized.some((e) => e.player?.familyName || e.player?.firstName)).toBe(true);
  });

  it("anchors video sync on the first made basket", () => {
    const firstGoal = events.find((e) => (e.goals ?? 0) > 0)!;
    const anchor = findProfixioSyncAnchor(m, ctx)!;
    expect(anchor.kind).toBe("first_basket");
    expect(anchor.realWorldTime).toBe(firstGoal.startedAt);
  });

  it("builds a roster per side from the players", () => {
    const rosters = buildProfixioRosters(lineup, resolveSides(m));
    expect(rosters.home).toHaveLength(9);
    expect(rosters.away).toHaveLength(12);
  });
});
