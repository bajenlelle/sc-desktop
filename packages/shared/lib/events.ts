/**
 * Display helpers for play-by-play events.
 *
 * Shared so the desktop clip lists and the player-facing web pages label and
 * colour the same event identically — web previously rendered the raw `type`
 * enum ("2pt") because these lived only in the desktop app.
 */
import type { PlayByPlayEvent } from "../types/match";

/**
 * Human-readable event name, e.g. "3PT made", "Def. rebound", "Bad pass".
 *
 * Decodes `subType` where it carries meaning a player or coach would want —
 * "Bad pass" says more than "Turnover", and "Charge" more than "Foul".
 */
export function eventLabel(e: PlayByPlayEvent): string {
  const sub = e.subType?.toLowerCase() ?? "";
  switch (e.type) {
    case "2pt":
      return e.isSuccessful ? "2PT made" : "2PT miss";
    case "3pt":
      return e.isSuccessful ? "3PT made" : "3PT miss";
    case "freethrow":
      return e.isSuccessful ? "FT made" : "FT miss";
    case "rebound":
      if (sub === "offensivedeadball") return "Inbound play";
      if (sub.includes("off")) return "Off. rebound";
      if (sub.includes("def")) return "Def. rebound";
      return "Rebound";
    case "turnover":
      if (sub === "badpass") return "Bad pass";
      if (sub === "ballhandling") return "Ball handling";
      if (sub === "travel") return "Travel";
      if (sub === "24sec") return "Shot clock";
      if (sub === "outofbounds") return "Out of bounds";
      return "Turnover";
    case "steal":
      return "Steal";
    case "foul":
      if (sub === "offensive") return "Charge";
      if (["technical", "benchtechnical", "coachtechnical"].includes(sub)) return "Technical";
      // Profixio's district protocol (FIBA) names these.
      if (sub === "unsportsmanlike") return "Unsportsmanlike";
      if (sub === "disqualifying") return "Disqualifying";
      if (sub === "flagrant" || sub === "disruptive") return "Flagrant";
      return "Foul";
    case "foulon":
      return "Foul drawn";
    case "block":
      return "Block";
    case "assist":
      return "Assist";
    case "timeout":
      return "Timeout";
    default:
      return e.type;
  }
}

/**
 * Feed bookkeeping, not basketball: the league records a team-level
 * "dead-ball rebound" (no player attached) whenever possession changes hands
 * after a foul or score. There's nothing to watch — the clip window lands on
 * a baseline inbound — so browsers hide these. Playback surfaces still label
 * them ("Inbound play") in case a legacy playlist references one.
 */
export function isBookkeepingEvent(e: PlayByPlayEvent): boolean {
  return e.type === "rebound" && (e.subType?.toLowerCase() ?? "") === "offensivedeadball";
}

/** "Q1".."Q4", then "OT1", "OT2", … for overtime periods. */
export function periodLabel(period: number): string {
  return period > 4 ? `OT${period - 4}` : `Q${period}`;
}

/**
 * Tailwind classes for an event's colour coding.
 *
 * `strip` is the solid left rail on a clip row; `badge` is the pill behind
 * the label. Shooting events deepen with value (FT → 2PT → 3PT) in green for
 * makes and red for misses, so a list is scannable at a glance.
 */
export function eventColors(e: PlayByPlayEvent): { strip: string; badge: string } {
  const made = !!e.isSuccessful;
  if (e.type === "freethrow") {
    return made
      ? { strip: "bg-emerald-300", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" }
      : { strip: "bg-red-300",     badge: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300" };
  }
  if (e.type === "2pt") {
    return made
      ? { strip: "bg-emerald-400", badge: "bg-emerald-200 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200" }
      : { strip: "bg-red-400",     badge: "bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-200" };
  }
  if (e.type === "3pt") {
    return made
      ? { strip: "bg-emerald-600", badge: "bg-emerald-300 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100" }
      : { strip: "bg-red-600",     badge: "bg-red-300 text-red-900 dark:bg-red-800 dark:text-red-100" };
  }
  switch (e.type) {
    case "rebound": {
      const sub = e.subType?.toLowerCase() ?? "";
      if (sub.includes("off")) return { strip: "bg-sky-400",   badge: "bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300" };
      if (sub.includes("def")) return { strip: "bg-blue-500",  badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200" };
      return                          { strip: "bg-slate-400", badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" };
    }
    case "assist":   return { strip: "bg-cyan-400",   badge: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/60 dark:text-cyan-300" };
    case "steal":    return { strip: "bg-violet-400", badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-300" };
    case "block":    return { strip: "bg-violet-600", badge: "bg-violet-200 text-violet-800 dark:bg-violet-800 dark:text-violet-200" };
    case "turnover": return { strip: "bg-amber-400",  badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300" };
    case "foul":
    case "foulon":   return { strip: "bg-orange-400", badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-orange-300" };
    // Timeouts (Profixio) are team events with nothing to score: neutral, but distinct from the fallback below.
    case "timeout":  return { strip: "bg-slate-500",  badge: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200" };
  }
  return { strip: "bg-slate-300", badge: "bg-muted text-muted-foreground" };
}

/**
 * The one colour family an event belongs to, for apps that mark a clip with a
 * single dot instead of `eventColors`' strip and pill (the mobile app). Shot
 * value no longer deepens the colour: a dot is too small to carry it.
 */
export type EventHue =
  | "make"
  | "miss"
  | "rebound"
  | "assist"
  | "steal"
  | "block"
  | "turnover"
  | "foul"
  | "neutral";

export function eventHue(e: Pick<PlayByPlayEvent, "type"> & { isSuccessful: number | boolean }): EventHue {
  switch (e.type) {
    case "freethrow":
    case "2pt":
    case "3pt":
      return e.isSuccessful ? "make" : "miss";
    case "rebound":
    case "assist":
    case "steal":
    case "block":
    case "turnover":
      return e.type;
    case "foul":
    case "foulon":
      return "foul";
  }
  return "neutral";
}

/** Trims the API's "MM:SS:CS" countdown to the "MM:SS" people actually read. */
export function formatGameClock(raw: string): string {
  if (!raw) return "—";
  const parts = raw.split(":");
  return parts.slice(0, 2).join(":");
}

/**
 * Seconds for a "MM:SS" clock as produced by formatGameClock; -1 for "—" or
 * anything unparseable. The -1 sentinel is what clock sorts key on, so
 * unparseable clocks group at one extreme instead of interleaving.
 */
export function parseGameClock(raw: string): number {
  if (!raw || raw === "—") return -1;
  const parts = raw.split(":");
  if (parts.length < 2) return -1;
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

/**
 * A game's plays in the order they happened: period, then wall-clock time,
 * then event id. The database returns a game's plays in no particular order,
 * so anything that lists them reads them through this. A play without a usable
 * `realWorldTime` goes after the timed ones of its period, by event id. Returns
 * a new array (the cached lists are shared and never mutated).
 */
export function sortPlaysChronologically<T extends Pick<PlayByPlayEvent, "eventId" | "period" | "realWorldTime">>(plays: readonly T[]): T[] {
  const ms = (p: T) => {
    const t = p.realWorldTime ? new Date(p.realWorldTime).getTime() : Number.NaN;
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  return plays
    .map((play) => ({ play, t: ms(play) }))
    .sort((a, b) => (a.play.period ?? 0) - (b.play.period ?? 0) || (a.t === b.t ? 0 : a.t < b.t ? -1 : 1) || a.play.eventId - b.play.eventId)
    .map((x) => x.play);
}

/** "First Last", or an em dash when the event has no player attached. */
export function playerName(e: PlayByPlayEvent): string {
  if (!e.player) return "—";
  return `${e.player.firstName} ${e.player.familyName}`.trim();
}

/** The play's place on the scoreboard clock: "Q3 07:42", or just "Q3" when the feed has no clock. */
export function playClock(e: PlayByPlayEvent): string {
  const clock = e.gameClockTime ? formatGameClock(e.gameClockTime) : "";
  return `${periodLabel(e.period)}${clock ? ` ${clock}` : ""}`;
}

/** The play in words a coach can spot in the footage: "#7 Ida Andersson, 3PT made"; the team when no player is on it. */
export function describePlay(e: PlayByPlayEvent): string {
  const who = e.player ? `${e.player.pno ? `#${e.player.pno} ` : ""}${playerName(e)}` : (e.eventTeam?.teamName ?? "");
  return [who, eventLabel(e)].filter(Boolean).join(", ");
}
