/**
 * A player's counting stats for one game, counted from the stored
 * play-by-play: the fallback when the official box score can't be read, and
 * the only source for Profixio games. Same data rules as leaders.ts: points
 * are derived from made shots, isSuccessful only means something on the
 * three shot types, and bookkeeping rows are skipped.
 *
 * Profixio's district protocol records made baskets and fouls only, so its
 * attempts, rebounds, assists, steals, blocks and turnovers are null (not
 * zero) and those columns aren't offered. Minutes and plus-minus aren't in
 * the stored rows for either source.
 */
import type { PlayByPlayEvent } from "../types/match";
import { isBookkeepingEvent } from "./events";
import type { GameLine } from "./stat-lines";

export type PbpSource = "genius" | "profixio";

export function pbpLine(events: PlayByPlayEvent[], playerId: number | string, source: PbpSource): GameLine {
  const madeOnly = source === "profixio";
  const id = String(playerId);
  let pts = 0;
  let twoPm = 0, twoPa = 0, tpm = 0, tpa = 0, ftm = 0, fta = 0;
  let oreb = 0, dreb = 0, ast = 0, stl = 0, blk = 0, tov = 0, pf = 0;

  for (const e of events) {
    if (!e.player || String(e.player.playerId) !== id || isBookkeepingEvent(e)) continue;
    const made = e.isSuccessful === 1;
    switch (e.type) {
      case "2pt":
        twoPa++;
        if (made) { twoPm++; pts += 2; }
        break;
      case "3pt":
        tpa++;
        if (made) { tpm++; pts += 3; }
        break;
      case "freethrow":
        fta++;
        if (made) { ftm++; pts += 1; }
        break;
      case "rebound": {
        const sub = e.subType?.toLowerCase() ?? "";
        if (sub === "offensive") oreb++;
        else if (sub === "defensive") dreb++;
        break;
      }
      case "assist": ast++; break;
      case "steal": stl++; break;
      case "block": blk++; break;
      case "turnover": tov++; break;
      case "foul": pf++; break;
    }
  }

  return {
    min: null,
    pts,
    fgm: twoPm + tpm,
    fga: madeOnly ? null : twoPa + tpa,
    tpm,
    tpa: madeOnly ? null : tpa,
    ftm,
    fta: madeOnly ? null : fta,
    oreb: madeOnly ? null : oreb,
    dreb: madeOnly ? null : dreb,
    ast: madeOnly ? null : ast,
    stl: madeOnly ? null : stl,
    blk: madeOnly ? null : blk,
    tov: madeOnly ? null : tov,
    pf,
    pm: null,
  };
}
