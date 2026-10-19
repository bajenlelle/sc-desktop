/**
 * The words the game's sync speaks in, on the game page (per-quarter sync)
 * and in Fix sync: the desktop's (components/quarter-sync.tsx and
 * components/editor/sync-fix-sheet.tsx), so both apps say the same thing.
 */
import { eventLabel, formatGameClock, periodLabel, playerName } from "@scoutable/shared/lib/events";
import type { PeriodRow } from "@scoutable/shared/lib/period-sync";
import type { PlayByPlayEvent } from "@scoutable/shared/types/match";
import type { AnchorCopy } from "@/components/game/sync-picker";

/** A span of video as m:ss, or h:mm:ss past the hour. */
export function formatSpan(secs: number): string {
  const t = Math.round(Math.abs(secs));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "Q3", "Q3 and Q4", "Q2, Q3 and Q4". */
export function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "4 s later", "11:02 earlier". */
export function describeShift(deltaSeconds: number): string {
  const a = Math.abs(deltaSeconds);
  const amount = a < 60 ? `${Math.round(a * 10) / 10} s` : formatSpan(a);
  return `${amount} ${deltaSeconds < 0 ? "earlier" : "later"}`;
}

/** The play in words a coach can spot: "#7 Ida Andersson · 3PT Made · Q3 7:42". */
export function describePlay(event: PlayByPlayEvent): string {
  const who = event.player ? `${event.player.pno ? `#${event.player.pno} ` : ""}${playerName(event)}` : (event.eventTeam?.teamName ?? "");
  const clock = event.gameClockTime ? formatGameClock(event.gameClockTime) : "";
  return [who, eventLabel(event), `${periodLabel(event.period)}${clock ? ` ${clock}` : ""}`].filter(Boolean).join(" · ");
}

/** "Q3 and Q4 follow Q2.", for the quarters left without their own sync. */
export function followsSummary(rows: PeriodRow[]): string | null {
  const unset = rows.filter((r) => !r.set);
  if (unset.length === 0) return null;
  const groups = new Map<number, string[]>();
  for (const r of unset) groups.set(r.follows, [...(groups.get(r.follows) ?? []), r.name]);
  const parts = [...groups].map(([follows, names]) => `${joinNames(names)} follow${names.length === 1 ? "s" : ""} ${periodLabel(follows)}`);
  return `${parts.join("; ")}.`;
}

/** The picker's words for a quarter, by what its anchor is. */
export function quarterCopy(row: PeriodRow): Partial<AnchorCopy> {
  const confirmed = `${row.name} set at`;
  if (row.anchor?.kind === "period_start") {
    return {
      title: `Set the start of ${row.name}`,
      instruction: "Find the frame where the game clock starts, then set it.",
      button: `Set ${row.name}'s start here`,
      confirmed,
    };
  }
  if (row.anchor?.kind === "first_basket") {
    return {
      title: `Set ${row.name}'s first basket`,
      instruction: "Find the frame where the ball drops through the net, then set it.",
      button: `Set ${row.name} here`,
      confirmed,
    };
  }
  return {
    title: `Set ${row.name}`,
    instruction: "Find the play, then set it.",
    button: `Set ${row.name} here`,
    confirmed,
  };
}
