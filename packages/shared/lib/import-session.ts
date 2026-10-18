/**
 * Turning a picked league game into the row the import saves, and what the
 * save's failures mean. Pure, shared by the desktop and the web importer.
 *
 * The web and the desktop differ in one thing: the desktop links a local
 * file (`videoUrl` is a path on that computer), the web uploads the file to
 * the cloud. A new web row therefore carries no `videoUrl` at all (the
 * desktop treats any non-http value as a local path and would look for a
 * file), and a re-import keeps the existing row's id and whatever
 * `videoUrl` the desktop set, so the game updates in place and its clips
 * keep working.
 */
import type { GameVideoAnchorKind } from "./game-video-wire";
import type { ScheduleGame } from "./genius";
import type { GameData } from "./league-schedule";
import type { MatchSaveToken } from "./matches-db";
import { matchProvider } from "./provider";
import type { League, Season, Stage } from "../types/league";
import type { StoredMatch, SyncPoint } from "../types/match";

/** The game as picked: its catalogue place and its schedule row. */
export interface ImportPick {
  league: League;
  season: Season;
  /** Null for a game picked from "Your games", whose stage the schedule row names. */
  stage: Stage | null;
  game: ScheduleGame;
}

/** The row this fixture already has in the space, when it does. */
export interface ExistingImport {
  id: string;
  videoUrl?: string;
}

/**
 * The match to save for a pick. `data` is the fetched play-by-play (null when
 * the fetch failed: names and date then come from the schedule row). A
 * re-import keeps `existing`'s id and videoUrl; a new row gets `newId()` and
 * no videoUrl. The sync point is left undefined so an existing one survives
 * (saveMatch only writes it when set).
 */
export function buildStoredMatch(
  pick: ImportPick,
  data: GameData | null,
  opts: { orgId: string | null; existing: ExistingImport | null; newId: () => string },
): StoredMatch {
  const { game, league, season, stage } = pick;
  const home = data?.homeName || game.homeTeamInfo.names.long;
  const away = data?.awayName || game.awayTeamInfo.names.long;
  const scheduled = new Date(game.rawStartDateTime);
  const scheduledDate = Number.isNaN(scheduled.getTime()) ? null : scheduled.toISOString().slice(0, 10);
  const match: StoredMatch = {
    id: opts.existing?.id ?? opts.newId(),
    // Stable across re-imports of the same fixture: dedupes the quota log.
    sourceGameId: game.uuid,
    title: `${home} vs ${away}`,
    date: data?.date || scheduledDate || new Date().toISOString().slice(0, 10),
    homeTeam: { name: home, color: "" },
    awayTeam: { name: away, color: "" },
    homeRoster: data?.homeRoster ?? [],
    awayRoster: data?.awayRoster ?? [],
    events: data?.events ?? [],
    leagueId: league.id,
    seasonId: season.id,
    stageId: stage?.id,
  };
  if (opts.existing?.videoUrl) match.videoUrl = opts.existing.videoUrl;
  if (opts.orgId) match.orgId = opts.orgId;
  return match;
}

/** What the game's sync anchors on: the moment to find in the video and its wall-clock time. */
export interface ImportAnchor {
  kind: GameVideoAnchorKind;
  /** What to look for, in words: "the tip-off", "Örebro's first basket (2–0)". */
  label: string;
  /** Null when the feed carries no reference time (the plays can't be placed until it does). */
  realWorldTime: string | null;
}

/**
 * The anchor for a game's data: Genius games anchor on the Q1 tip-off (what
 * the detector finds); Profixio games on the first made basket, or the
 * table's start marker when nobody scored.
 */
export function importAnchor(data: Pick<GameData, "tipoffRealWorldTime" | "syncAnchor"> | null): ImportAnchor {
  if (data?.syncAnchor) return { kind: data.syncAnchor.kind, label: data.syncAnchor.label, realWorldTime: data.tipoffRealWorldTime };
  return { kind: "tipoff", label: "the tip-off", realWorldTime: data?.tipoffRealWorldTime ?? null };
}

/**
 * The anchor for a match already in the library, when the browser upload
 * starts later than the import (after a reload, or for a game imported on
 * the desktop): a sync point names its own anchor; a Profixio game's first
 * made basket is in its events; a Genius game's tip-off marker is not (the
 * normalized events hold plays only), so the caller fetches the game data
 * again. Null means "nothing here, ask the feed".
 */
export function importAnchorForMatch(
  match: Pick<StoredMatch, "syncPoint" | "events" | "sourceGameId" | "leagueId" | "homeTeam" | "awayTeam">,
): ImportAnchor | null {
  const sync = match.syncPoint;
  if (sync && typeof sync.syncVideoTime === "number" && sync.syncRealWorldTime) {
    return sync.anchor
      ? { kind: sync.anchor.kind, label: sync.anchor.label, realWorldTime: sync.syncRealWorldTime }
      : { kind: "tipoff", label: "the tip-off", realWorldTime: sync.syncRealWorldTime };
  }
  if (matchProvider(match) !== "profixio") return null;
  const basket = [...match.events]
    .filter((e) => (e.type === "2pt" || e.type === "3pt" || e.type === "freethrow") && e.isSuccessful && e.realWorldTime)
    .sort((a, b) => Date.parse(a.realWorldTime) - Date.parse(b.realWorldTime))[0];
  if (!basket) return null;
  const team = (basket.eventTeam?.teamName || (basket.player?.teamNumber === 2 ? match.awayTeam.name : match.homeTeam.name)).trim();
  const score = basket.scoreHome != null && basket.scoreAway != null ? ` (${basket.scoreHome}–${basket.scoreAway})` : "";
  return { kind: "first_basket", label: `${team}'s first basket${score}`, realWorldTime: basket.realWorldTime };
}

/**
 * The sync point for an anchor found at `seconds` into the video: the anchor
 * is named on the point when it isn't the tip-off, and the league's period
 * marks ride along so the quarters can be synced later.
 */
export function buildSyncPoint(seconds: number, anchor: ImportAnchor, periodMarks?: SyncPoint["marks"]): SyncPoint {
  return {
    syncVideoTime: seconds,
    syncRealWorldTime: anchor.realWorldTime ?? "",
    ...(anchor.kind !== "tipoff" ? { anchor: { kind: anchor.kind, label: anchor.label } } : {}),
    ...(periodMarks && Object.keys(periodMarks).length > 0 ? { marks: periodMarks } : {}),
  };
}

export type ImportBlock = MatchSaveToken;

/**
 * Why a save was refused by the database, or null for any other failure:
 * the import allowance (`import_limit_reached`) and the club's license lock
 * (`license_locked`) are triggers, so the precheck can race them and the
 * error is the real gate. Reads the token saveMatch attaches, and falls back
 * to the message for errors that came another way.
 */
export function importBlockOf(err: unknown): ImportBlock | null {
  const token = (err as { token?: unknown } | null)?.token;
  if (token === "import_limit_reached" || token === "license_locked") return token;
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (message.includes("import_limit_reached")) return "import_limit_reached";
  if (message.includes("license_locked")) return "license_locked";
  return null;
}
