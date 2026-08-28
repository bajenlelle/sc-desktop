/**
 * Display helpers for play-by-play events.
 *
 * Shared so the desktop clip lists and the player-facing web pages label and
 * colour the same event identically — web previously rendered the raw `type`
 * enum ("2pt") because these lived only in the desktop app.
 */
import type { PlayByPlayEvent } from "../types/match";

/**
 * Human-readable event name, e.g. "3PT Made", "Def Rebound", "Bad Pass".
 *
 * Decodes `subType` where it carries meaning a player or coach would want —
 * "Bad Pass" says more than "Turnover", and "Charge" more than "Foul".
 */
export function eventLabel(e: PlayByPlayEvent): string {
  const sub = e.subType?.toLowerCase() ?? "";
  switch (e.type) {
    case "2pt":
      return e.isSuccessful ? "2PT Made" : "2PT Miss";
    case "3pt":
      return e.isSuccessful ? "3PT Made" : "3PT Miss";
    case "freethrow":
      return e.isSuccessful ? "FT Made" : "FT Miss";
    case "rebound":
      if (sub === "offensivedeadball") return "Inbound Play";
      if (sub.includes("off")) return "Off Rebound";
      if (sub.includes("def")) return "Def Rebound";
      return "Rebound";
    case "turnover":
      if (sub === "badpass") return "Bad Pass";
      if (sub === "ballhandling") return "Ball Handling";
      if (sub === "travel") return "Travel";
      if (sub === "24sec") return "Shot Clock";
      if (sub === "outofbounds") return "Out of Bounds";
      return "Turnover";
    case "steal":
      return "Steal";
    case "foul":
      if (sub === "offensive") return "Charge";
      if (["technical", "benchtechnical", "coachtechnical"].includes(sub)) return "Technical";
      return "Foul";
    case "foulon":
      return "Foul Drawn";
    case "block":
      return "Block";
    case "assist":
      return "Assist";
    default:
      return e.type;
  }
}

/**
 * Feed bookkeeping, not basketball: the league records a team-level
 * "dead-ball rebound" (no player attached) whenever possession changes hands
 * after a foul or score. There's nothing to watch — the clip window lands on
 * a baseline inbound — so browsers hide these. Playback surfaces still label
 * them ("Inbound Play") in case a legacy playlist references one.
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
  }
  return { strip: "bg-slate-300", badge: "bg-muted text-muted-foreground" };
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

/** "First Last", or an em dash when the event has no player attached. */
export function playerName(e: PlayByPlayEvent): string {
  if (!e.player) return "—";
  return `${e.player.firstName} ${e.player.familyName}`.trim();
}
