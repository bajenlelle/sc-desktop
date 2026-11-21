// Builders for plays and a team's library games in tests (team-video).
import type { PlayByPlayEvent } from "../../../types/match";
import type { TeamGame } from "../../team-video";
import type { TeamGameRow } from "../../team-schedule";

/**
 * A play on one side, by a player of that side (person id = `extra.player?.playerId` or 100 + side) unless
 * `extra.player` is null, which makes it a team row. Period 1, the clock counting down one second per id.
 */
export function ev(id: number, type: string, side: 1 | 2, extra: Partial<PlayByPlayEvent> = {}): PlayByPlayEvent {
  const s = 600 - id;
  return {
    eventId: id,
    type,
    subType: "",
    period: 1,
    gameClockTime: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`,
    realWorldTime: "",
    isSuccessful: 1,
    player: { playerId: 100 + side, pno: side, firstName: "A", familyName: side === 1 ? "Home" : "Away", teamNumber: side },
    eventTeam: { teamCode: "", teamName: side === 1 ? "Home" : "Away", teamNumber: side },
    qualifiers: [],
    ...extra,
  };
}

/** A player on a side, for `ev`'s `extra.player`. */
export function who(playerId: number, side: 1 | 2, familyName = "P"): NonNullable<PlayByPlayEvent["player"]> {
  return { playerId, pno: playerId % 100, firstName: "A", familyName, teamNumber: side };
}

/** One of the team's games in the coach's library. */
export function tgame(over: Partial<TeamGame> = {}): TeamGame {
  return {
    leagueMatchId: 1,
    gameId: "g1",
    side: 1,
    at: "2026-11-01T18:00:00Z",
    home: true,
    opponentName: "Beta",
    result: "W",
    score: { own: 80, opp: 70 },
    ...over,
  };
}

/** A fixture row of the team's schedule. */
export function row(over: Partial<TeamGameRow> = {}): TeamGameRow {
  return {
    matchId: 1,
    at: "2026-11-01T18:00:00Z",
    home: true,
    opponentId: 2,
    opponentName: "Beta",
    status: "played",
    regular: true,
    score: { own: 80, opp: 70 },
    result: "W",
    ppp: null,
    importable: true,
    ...over,
  };
}
